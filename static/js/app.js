(function () {
  "use strict";

  let isEditingSetOrder = false;
  let isStagetimeMode = false;
  var emptyStageMessageTimerId = null;

  /** Bumped with releases; pair with index.html ASSET_VERSION + sw.js for cache/SW refresh. */
  window.STAGETIME_APP_VERSION = "0.1.5";
  window.currentJokeId = null;
  window.currentSetId = null;
  // Cache-buster asset version: must match index.html ASSET_VERSION and ?v=... querystrings (Asset v105 / app 0.1.5).
  var VERSION = typeof ASSET_VERSION !== "undefined" ? String(ASSET_VERSION) : "105";
  window.VERSION = VERSION;
  (function syncVersionFooter() {
    var el = document.getElementById("version-display");
    if (el) el.textContent = "v" + window.STAGETIME_APP_VERSION;
  })();

  var API = "/api";
  var dataLayer = window.dataLayer;

  let _cache = [];
  let _filters = { status: "all", rating: "all", search: "", topic: "all" };
  var _hubSearchDebounceTimer = null;
  var _jokesSearchDebounceTimer = null;
  let _pendingSourceIdeaId = null;

  function normalizeMirrorRecord(row, typeHint) {
    if (!row || typeof row !== "object") return null;
    var t = typeHint != null ? typeHint : row.type;
    t = t === "idea" ? "idea" : "joke";
    var o = {};
    var k;
    for (k in row) {
      if (Object.prototype.hasOwnProperty.call(row, k)) o[k] = row[k];
    }
    o.type = t;
    var topicRaw = o.topic != null ? String(o.topic).trim() : "";
    o.topic = topicRaw !== "" ? topicRaw : "Uncategorized";
    o.tags = Array.isArray(o.tags) ? o.tags.slice() : [];
    if (o.title == null) o.title = "";
    if (t === "joke") {
      if (o.content == null && o.premise != null) o.content = String(o.premise);
      if (o.content == null) o.content = "";
      var rat = o.rating != null ? Number(o.rating) : 0;
      o.rating = rat >= 1 && rat <= 5 ? rat : 0;
    } else {
      if (o.content == null) o.content = "";
    }
    return o;
  }

  function getFilteredData() {
    var list = Array.isArray(_cache) ? _cache.slice() : [];
    var f = _filters;
    var q = f.search != null ? String(f.search).trim().toLowerCase() : "";
    return list.filter(function (item) {
      if (!item) return false;
      var typ = item.type === "idea" ? "idea" : "joke";
      if (typ === "joke") {
        if (f.status != null && f.status !== "all") {
          if (String(item.status || "") !== String(f.status)) return false;
        }
        if (f.rating != null && f.rating !== "all") {
          var r = item.rating != null ? Number(item.rating) : 0;
          var ranked = r >= 1 && r <= 5;
          if (f.rating === "unranked") {
            if (ranked) return false;
          } else {
            var want = parseInt(String(f.rating), 10);
            if (r !== want) return false;
          }
        }
      }
      if (f.topic != null && f.topic !== "all") {
        var top = item.topic != null && String(item.topic).trim() !== "" ? String(item.topic).trim() : "Uncategorized";
        if (top !== f.topic) return false;
      }
      if (q !== "") {
        var title = item.title != null ? String(item.title).toLowerCase() : "";
        var content = "";
        if (typ === "joke") {
          content =
            (item.content != null ? String(item.content) : "") +
            " " +
            (item.act_out != null ? String(item.act_out) : "") +
            " " +
            (item.premise != null ? String(item.premise) : "") +
            " " +
            (item.punchline != null ? String(item.punchline) : "");
        } else {
          content = item.content != null ? String(item.content) : "";
        }
        content = content.trim().toLowerCase();
        if (title.indexOf(q) < 0 && content.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function updateGlobalTagDatalistFromCache() {
    var tagDl = document.getElementById("tag-datalist");
    if (!tagDl) return;
    var set = {};
    (Array.isArray(_cache) ? _cache : []).forEach(function (item) {
      var tags = item && item.tags;
      if (!Array.isArray(tags)) return;
      tags.forEach(function (t) {
        var s = t != null ? String(t).trim() : "";
        if (s) set[s.toLowerCase()] = s;
      });
    });
    tagDl.innerHTML = "";
    Object.keys(set)
      .sort()
      .forEach(function (key) {
        var opt = document.createElement("option");
        opt.value = set[key];
        tagDl.appendChild(opt);
      });
  }

  function countActiveSlicerFilters() {
    var n = 0;
    if (_filters.status != null && _filters.status !== "all") n++;
    if (_filters.rating != null && _filters.rating !== "all") n++;
    if (_filters.topic != null && _filters.topic !== "all") n++;
    return n;
  }

  function updateJokesFiltersButtonLabel() {
    var btn = document.getElementById("jokes-filters-btn");
    if (!btn) return;
    var c = countActiveSlicerFilters();
    btn.textContent = c > 0 ? "FILTERS (" + c + ")" : "FILTERS";
  }

  function renderSlicerIntoHost(host, topicFromJokesOnly) {
    if (!host) return;
    host.innerHTML = "";
    function makePill(label, kind, value, isActive) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "slicer-pill" + (isActive ? " active" : "");
      b.setAttribute("data-slicer-kind", kind);
      b.setAttribute("data-slicer-value", value);
      b.textContent = label;
      return b;
    }
    function addRow(title, kind, entries) {
      var wrap = document.createElement("div");
      wrap.className = "hub-slicer-row";
      wrap.setAttribute("data-slicer-group", kind);
      var lab = document.createElement("div");
      lab.className = "hub-slicer-row-label";
      lab.textContent = title;
      wrap.appendChild(lab);
      var chips = document.createElement("div");
      chips.className = "hub-slicer-row-chips status-slicer";
      entries.forEach(function (en) {
        chips.appendChild(makePill(en.label, kind, en.value, _filters[kind] === en.value));
      });
      wrap.appendChild(chips);
      host.appendChild(wrap);
    }
    var jokesInCache = (Array.isArray(_cache) ? _cache : []).filter(function (x) {
      return x && x.type === "joke";
    });
    var statusOrder = ["draft", "testing", "active", "retired", "archived"];
    var statusLabelMap = { draft: "DRAFT", testing: "TESTING", active: "ACTIVE", retired: "RETIRED", archived: "ARCHIVED" };
    var statusSeen = {};
    jokesInCache.forEach(function (j) {
      var st = j.status != null && String(j.status).trim() !== "" ? String(j.status).trim() : "draft";
      statusSeen[st] = true;
    });
    var statusEntries = [{ label: "ALL", value: "all" }];
    statusOrder.forEach(function (st) {
      if (statusSeen[st]) {
        statusEntries.push({ label: statusLabelMap[st] || st.toUpperCase(), value: st });
      }
    });
    Object.keys(statusSeen).forEach(function (st) {
      if (statusOrder.indexOf(st) >= 0) return;
      statusEntries.push({ label: st.toUpperCase(), value: st });
    });
    addRow("Status", "status", statusEntries);
    var hasUnranked = jokesInCache.some(function (j) {
      var r = j.rating != null ? Number(j.rating) : 0;
      return !(r >= 1 && r <= 5);
    });
    var ratingUsed = {};
    jokesInCache.forEach(function (j) {
      var r = j.rating != null ? Number(j.rating) : 0;
      if (r >= 1 && r <= 5) ratingUsed[r] = true;
    });
    var ratingEntries = [{ label: "ALL", value: "all" }];
    if (hasUnranked) ratingEntries.push({ label: "0 (Unranked)", value: "unranked" });
    [1, 2, 3, 4, 5].forEach(function (n) {
      if (ratingUsed[n]) ratingEntries.push({ label: String(n), value: String(n) });
    });
    addRow("Rating", "rating", ratingEntries);
    var topicsSet = {};
    var topicSource = topicFromJokesOnly ? jokesInCache : (Array.isArray(_cache) ? _cache : []);
    topicSource.forEach(function (item) {
      if (!item) return;
      if (topicFromJokesOnly && item.type !== "joke") return;
      var top = item.topic != null && String(item.topic).trim() !== "" ? String(item.topic).trim() : "Uncategorized";
      topicsSet[top] = true;
    });
    var topicList = Object.keys(topicsSet).sort(function (a, b) {
      return a.localeCompare(b);
    });
    var topicEntries = [{ label: "ALL", value: "all" }];
    topicList.forEach(function (t) {
      topicEntries.push({ label: t, value: t });
    });
    addRow("Topic", "topic", topicEntries);
  }

  /**
   * Renders Status / Rating / Topic chips into a chip host. Pass containerId to refresh one host only;
   * omit to refresh the Home Hub and the Jokes sidebar (when present).
   * @param {string} [containerId] - Element id: "hub-slicer-chip-rows" or "jokes-slicer-chip-rows"
   */
  function renderSlicer(containerId) {
    var id = containerId != null ? String(containerId).trim() : "";
    if (id !== "") {
      var single = document.getElementById(id);
      if (!single) return;
      var jokesOnly = id === "jokes-slicer-chip-rows";
      renderSlicerIntoHost(single, jokesOnly);
      return;
    }
    var hubHost = document.getElementById("hub-slicer-chip-rows");
    if (hubHost) renderSlicerIntoHost(hubHost, false);
    var jokesHost = document.getElementById("jokes-slicer-chip-rows");
    if (jokesHost) renderSlicerIntoHost(jokesHost, true);
  }

  async function refreshCache() {
    if (!dataLayer) {
      _cache = [];
      jokesListCache = [];
    updateGlobalTagDatalistFromCache();
    renderSlicer();
    updateJokesFiltersButtonLabel();
    updateDashboardStats();
    return;
    }
    var jokes = [];
    var ideas = [];
    try {
      jokes = await dataLayer.listJokes().catch(function () {
        return [];
      });
      ideas = await dataLayer.listIdeas().catch(function () {
        return [];
      });
    } catch (err) {
      jokes = [];
      ideas = [];
    }
    if (!Array.isArray(jokes)) jokes = [];
    if (!Array.isArray(ideas)) ideas = [];
    var normJ = jokes
      .map(function (j) {
        return normalizeMirrorRecord(j, "joke");
      })
      .filter(Boolean);
    var normI = ideas
      .map(function (i) {
        return normalizeMirrorRecord(i, "idea");
      })
      .filter(Boolean);
    _cache = normJ.concat(normI);
    jokesListCache = _cache.filter(function (x) {
      return x && x.type === "joke";
    });
    updateGlobalTagDatalistFromCache();
    renderSlicer();
    updateJokesFiltersButtonLabel();
    updateDashboardStats();
    var ideasPanel = document.getElementById("panel-ideas");
    if (ideasPanel && !ideasPanel.classList.contains("hidden")) {
      var ideaSearchInput = document.getElementById("idea-search-input");
      renderIdeas(ideaSearchInput ? ideaSearchInput.value : "");
    }
    var jokesPanel = document.getElementById("panel-jokes");
    if (jokesPanel && !jokesPanel.classList.contains("hidden")) {
      var jokeDetail = getJokeDetailEl();
      var keepId = undefined;
      if (jokeDetail && !jokeDetail.classList.contains("hidden") && jokeDetail.dataset.jokeId) {
        var parsed = parseInt(jokeDetail.dataset.jokeId, 10);
        if (Number.isFinite(parsed)) keepId = parsed;
      }
      renderJokeList(keepId);
    }
  }

  function getJokeListOptionalKeepDetailId() {
    var jokeDetail = getJokeDetailEl();
    if (jokeDetail && !jokeDetail.classList.contains("hidden") && jokeDetail.dataset.jokeId) {
      var parsed = parseInt(jokeDetail.dataset.jokeId, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  }

  function onSlicerFiltersChanged() {
    renderSlicer();
    updateDashboardStats();
    updateJokesFiltersButtonLabel();
    var jokesPanel = document.getElementById("panel-jokes");
    if (jokesPanel && !jokesPanel.classList.contains("hidden")) {
      renderJokeList(getJokeListOptionalKeepDetailId());
    }
  }

  function bindSlicerClickHost(hostEl) {
    if (!hostEl || hostEl.dataset.slicerClickBound === "1") return;
    hostEl.dataset.slicerClickBound = "1";
    hostEl.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("button.slicer-pill[data-slicer-kind]") : null;
      if (!btn || !hostEl.contains(btn)) return;
      var kind = btn.getAttribute("data-slicer-kind");
      var value = btn.getAttribute("data-slicer-value");
      if (!kind || value === null || value === undefined) return;
      _filters[kind] = value;
      onSlicerFiltersChanged();
    });
  }

  function initHubSmartSlicer() {
    var hub = document.getElementById("hub-smart-slicer");
    if (hub && hub.dataset.hubSlicerBound !== "1") {
      hub.dataset.hubSlicerBound = "1";
      bindSlicerClickHost(hub);
    }
    var jokesAside = document.getElementById("jokes-filter-sidebar");
    if (jokesAside && jokesAside.dataset.jokesSlicerBound !== "1") {
      jokesAside.dataset.jokesSlicerBound = "1";
      bindSlicerClickHost(jokesAside);
    }
    var searchEl = document.getElementById("hub-slicer-search");
    if (searchEl && searchEl.dataset.hubSearchBound !== "1") {
      searchEl.dataset.hubSearchBound = "1";
      searchEl.addEventListener("input", function () {
        var el = searchEl;
        if (_hubSearchDebounceTimer != null) clearTimeout(_hubSearchDebounceTimer);
        _hubSearchDebounceTimer = setTimeout(function () {
          _hubSearchDebounceTimer = null;
          _filters.search = el.value != null ? String(el.value) : "";
          updateDashboardStats();
        }, 150);
      });
    }
  }

  function setJokesFilterSidebarOpen(open) {
    var side = document.getElementById("jokes-filter-sidebar");
    var back = document.getElementById("jokes-sidebar-backdrop");
    var isOpen = !!open;
    if (side) {
      side.classList.toggle("is-open", isOpen);
      side.setAttribute("aria-hidden", isOpen ? "false" : "true");
    }
    if (back) {
      back.classList.toggle("is-open", isOpen);
      back.setAttribute("aria-hidden", isOpen ? "false" : "true");
    }
  }

  function initJokesFolderChrome() {
    var panel = document.getElementById("panel-jokes");
    if (!panel || panel.dataset.jokesFolderChromeBound === "1") return;
    panel.dataset.jokesFolderChromeBound = "1";
    var filtersBtn = document.getElementById("jokes-filters-btn");
    var newBtn = document.getElementById("jokes-new-btn");
    var backdrop = document.getElementById("jokes-sidebar-backdrop");
    var closeBtn = document.getElementById("jokes-sidebar-close");
    var clearBtn = document.getElementById("jokes-clear-filters-btn");
    var searchEl = document.getElementById("jokes-search");
    if (filtersBtn) {
      filtersBtn.addEventListener("click", function () {
        setJokesFilterSidebarOpen(true);
      });
    }
    if (newBtn) {
      newBtn.addEventListener("click", function () {
        openNewJokeDetail();
      });
    }
    if (backdrop) {
      backdrop.addEventListener("click", function () {
        setJokesFilterSidebarOpen(false);
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        setJokesFilterSidebarOpen(false);
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        _filters.status = "all";
        _filters.rating = "all";
        _filters.topic = "all";
        onSlicerFiltersChanged();
        setJokesFilterSidebarOpen(false);
      });
    }
    if (searchEl) {
      searchEl.addEventListener("input", function () {
        if (_jokesSearchDebounceTimer != null) clearTimeout(_jokesSearchDebounceTimer);
        _jokesSearchDebounceTimer = setTimeout(function () {
          _jokesSearchDebounceTimer = null;
          renderJokeList(getJokeListOptionalKeepDetailId());
        }, 150);
      });
    }
  }

  async function convertToJoke(ideaId) {
    var iid = parseInt(String(ideaId).trim(), 10);
    if (!Number.isFinite(iid) || iid < 1) throw new Error("Invalid idea id");
    if (!dataLayer || typeof dataLayer.getIdea !== "function") {
      throw new Error("Convert not available");
    }
    var idea = await dataLayer.getIdea(iid);
    if (!idea) throw new Error("Idea not found");
    _pendingSourceIdeaId = iid;
    closeIdeaDetailModal();
    showPanel("jokes", false);
    setJokesFilterSidebarOpen(false);
    var mc = document.getElementById("modal-container");
    if (mc) mc.classList.add("is-detail-view");
    var el = getJokeDetailEl();
    if (!el) {
      _pendingSourceIdeaId = null;
      throw new Error("Joke detail container missing");
    }
    setJokesDetailVisibility(true);
    el.dataset.jokeId = "";
    window.currentJokeId = null;
    var mappedTitle = idea.title != null ? String(idea.title).trim() : "";
    var mappedBody = idea.content != null ? String(idea.content) : "";
    var ideaTopicRaw = idea.topic != null ? String(idea.topic).trim() : "";
    var mappedTopic = ideaTopicRaw !== "" ? ideaTopicRaw : "Uncategorized";
    var mappedTags = Array.isArray(idea.tags) ? idea.tags.slice() : [];
    var mappedNotes = idea.notes != null ? String(idea.notes) : "";
    renderUniversalDetail(
      "joke",
      {
        title: mappedTitle,
        content: mappedBody,
        act_out: "",
        premise: mappedBody,
        punchline: "",
        status: "draft",
        rating: "",
        setup_notes: mappedNotes,
        tags: mappedTags,
        duration: null
      },
      { el: el, hideDelete: true }
    );
    var titleRich = document.getElementById("joke-detail-title-display");
    var titleInput = getJokeEditTitleEl();
    if (titleRich) {
      titleRich.classList.remove("hidden");
      titleRich.innerHTML = "<span style=\"color: var(--neon-green)\">CONVERTING IDEA</span>";
    }
    if (titleInput) {
      titleInput.value = mappedTitle;
      titleInput.classList.add("hidden");
    }
    toggleJokeAdmin(false);
    var topicEl = document.getElementById("joke-edit-topic");
    fillTopicSelect(topicEl, mappedTopic).then(function () {
      if (topicEl) topicEl.value = mappedTopic;
    });
    var setTrig = el.querySelector(".btn-set-trigger");
    if (setTrig) {
      setTrig.disabled = true;
      setTrig.setAttribute("aria-disabled", "true");
      setTrig.title = "Save the joke first to add to a set";
    }
    bindJokeDetailActions(el, mc, { skipBodyFocus: true });
    await refreshCache();
  }

  function showToast(message, backgroundColor) {
    var msg = message != null ? String(message) : "";
    if (msg === "") return;
    var t = document.createElement("div");
    t.className = "stagetime-toast";
    t.setAttribute("role", "status");
    t.textContent = msg;
    t.style.zIndex = "2147483647";
    t.style.setProperty("z-index", "2147483647", "important");
    var bg = backgroundColor != null ? String(backgroundColor).trim() : "";
    if (bg !== "") t.style.backgroundColor = bg;
    document.body.appendChild(t);
    setTimeout(function () {
      t.style.opacity = "0";
      t.style.transition = "opacity 0.25s ease";
      setTimeout(function () {
        if (t.parentNode) t.parentNode.removeChild(t);
      }, 250);
    }, 5000);
  }

  function getJokeAdminFieldsEl() {
    return document.getElementById("joke-admin-fields");
  }

  function getJokeAdminToggleBtnEl() {
    return document.getElementById("joke-detail-more-btn");
  }

  function toggleJokeAdmin(forceVisible) {
    var fields = getJokeAdminFieldsEl();
    var btn = getJokeAdminToggleBtnEl() || document.getElementById("joke-admin-toggle-btn") || document.getElementById("joke-admin-toggle");
    if (!fields) return;
    var show = typeof forceVisible === "boolean" ? forceVisible : fields.classList.contains("hidden");
    fields.classList.toggle("hidden", !show);
    if (btn) btn.textContent = show ? "Less -" : "More +";
  }

  window.toggleJokeAdmin = toggleJokeAdmin;

  /**
   * Sums joke durations and returns a string in MM:SS format.
   * If any joke has null/undefined duration, that joke is skipped from the sum
   * and the result is suffixed with "+" (e.g. "05:30+").
   * @param {Array<{duration?: number|null}>} jokes - Array of joke objects with optional duration (seconds).
   * @returns {string} - "MM:SS" or "MM:SS+"
   */
  function calculateSetTime(jokes) {
    if (!Array.isArray(jokes)) return "0:00";
    var totalSeconds = 0;
    var hasMissing = false;
    for (var i = 0; i < jokes.length; i++) {
      var d = jokes[i] && jokes[i].duration;
      if (d == null || d === undefined) {
        hasMissing = true;
      } else {
        var sec = Number(d);
        if (typeof sec === "number" && !isNaN(sec) && isFinite(sec) && sec >= 0) {
          totalSeconds += sec;
        } else {
          hasMissing = true;
        }
      }
    }
    var m = Math.floor(totalSeconds / 60);
    var s = Math.floor(totalSeconds % 60);
    var mm = m < 10 ? "0" + m : String(m);
    var ss = s < 10 ? "0" + s : String(s);
    return mm + ":" + ss + (hasMissing ? "+" : "");
  }

  function fetchOpts() {
    return { credentials: "same-origin" };
  }

  function getBaseUrl() {
    return dataLayer ? dataLayer.getBaseUrl() : (function () {
      try {
        var base = sessionStorage.getItem("stagetime_api_base");
        if (base) return base.replace(/\/$/, "");
      } catch (e) {}
      return window.location.origin;
    })();
  }

  function showAuthShell() {
    var authEl = document.getElementById("auth-shell");
    var appEl = document.getElementById("app-container");
    if (authEl) authEl.classList.remove("hidden");
    if (appEl) appEl.classList.add("hidden");
  }

  function hideAuthShell(username) {
    var authEl = document.getElementById("auth-shell");
    var appEl = document.getElementById("app-container");
    if (authEl) authEl.classList.add("hidden");
    if (appEl) appEl.classList.remove("hidden");
    var userInfo = document.getElementById("user-info");
    if (userInfo) userInfo.textContent = username ? "Logged in as " + username : "";
  }
  function renderSets() {
    var panelSets = document.getElementById("panel-sets");
    if (!panelSets || panelSets.classList.contains("hidden")) return;
    loadSets();
  }

  function initAuthForm() {
    var form = document.getElementById("auth-form");
    var usernameEl = document.getElementById("auth-username");
    var passwordEl = document.getElementById("auth-password");
    var errorEl = document.getElementById("auth-error");
    var submitBtn = document.getElementById("auth-submit");
    var tabs = document.querySelectorAll(".auth-tab");
    if (!form || !usernameEl || !passwordEl) return;

    function showAuthError(msg) {
      if (errorEl) { errorEl.textContent = msg || "Login failed"; errorEl.classList.remove("hidden"); }
    }
    function hideAuthError() {
      if (errorEl) errorEl.classList.add("hidden");
    }

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var mode = tab.getAttribute("data-auth");
        tabs.forEach(function (t) { t.classList.toggle("active", t.getAttribute("data-auth") === mode); });
        if (submitBtn) submitBtn.textContent = mode === "register" ? "Register" : "Log in";
        hideAuthError();
      });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var username = (usernameEl.value || "").trim();
      var password = passwordEl.value || "";
      if (!username || !password) {
        showAuthError("Username and password required");
        return;
      }
      hideAuthError();
      var activeTab = document.querySelector(".auth-tab.active");
      var isRegister = activeTab && activeTab.getAttribute("data-auth") === "register";
      var path = isRegister ? "/register" : "/login";
      var url = getBaseUrl() + API + path;
      var opts = {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username, password: password })
      };
      if (submitBtn) submitBtn.disabled = true;
      fetch(url, opts)
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, status: r.status, data: data }; }); })
        .then(function (result) {
          if (result.ok) {
            hideAuthShell(result.data.username || username);
            loadIdeas();
            loadJokes();
            loadSets();
          } else {
            showAuthError(result.data.error || "Login failed");
          }
        })
        .catch(function () { showAuthError("Network error. Try again."); })
        .then(function () { if (submitBtn) submitBtn.disabled = false; });
    });
  }

  function apiFetch(path, opts) {
    if (dataLayer && dataLayer.apiFetch) return dataLayer.apiFetch(path, opts);
    opts = opts || {};
    opts.credentials = "same-origin";
    return fetch(getBaseUrl() + API + path, opts).then(function (r) {
      if (r.status === 401) { showAuthShell(); return Promise.reject(new Error("Login required")); }
      return r;
    });
  }

  function getBreakpointMobile() {
    var val = getComputedStyle(document.documentElement).getPropertyValue("--breakpoint-mobile").trim();
    var num = val ? parseInt(val, 10) : NaN;
    return typeof num === "number" && !isNaN(num) ? num : 768;
  }

  function isMobileView() {
    return window.matchMedia("(max-width: " + getBreakpointMobile() + "px)").matches;
  }

  function getJokesPanelEl() {
    return document.getElementById("jokes-modal") || document.getElementById("panel-jokes");
  }

  function schedulePanelFocus(inputId) {
    if (!inputId) return;
    setTimeout(function () {
      var targetInput = document.getElementById(inputId);
      if (targetInput && typeof targetInput.focus === "function") {
        targetInput.focus();
      }
    }, 50);
  }

  function getIdeasPanelTitleEl() {
    var panel = document.getElementById("panel-ideas");
    return panel ? panel.querySelector(".panel-title") : null;
  }

  function setIdeasPanelTitle(title) {
    var panelTitle = getIdeasPanelTitleEl();
    if (!panelTitle) return;
    var t = title != null ? String(title) : "";
    panelTitle.textContent = t.trim() !== "" ? t : "IDEAS";
  }

  function normalizeIdeaFieldValue(field, value) {
    if (field === "tags") {
      if (Array.isArray(value)) return value;
      var src = value != null ? String(value).trim() : "";
      return src ? src.split(",").map(function (t) { return t.trim(); }).filter(Boolean) : [];
    }
    if (field === "topic") {
      var topic = value != null ? String(value).trim() : "";
      return topic || null;
    }
    return value != null ? String(value).trim() : "";
  }

  function formatIdeaFieldDisplayValue(idea, field) {
    if (!idea) return "";
    if (field === "title") {
      var tTitle = idea.title != null ? String(idea.title) : "";
      return tTitle.trim() !== "" ? tTitle : "Untitled Idea";
    }
    if (field === "content") {
      var tContent = idea.content != null ? String(idea.content) : "";
      return tContent.trim() !== "" ? tContent : "No body yet.";
    }
    if (field === "topic") {
      var tTopic = idea.topic != null ? String(idea.topic) : "";
      return tTopic.trim() !== "" ? tTopic : "Uncategorized";
    }
    if (field === "tags") return Array.isArray(idea.tags) && idea.tags.length ? idea.tags.join(", ") : "—";
    return "";
  }

  function renderIdeaDetailField(label, field, value, multiline) {
    var safeLabel = escapeHtml(label);
    var safeField = escapeHtml(field);
    var safeDisplay = escapeHtml(value);
    var editorTag = multiline ? "textarea" : "input";
    var editorExtra = multiline ? " rows=\"6\"" : " type=\"text\"";
    var valueClass = "idea-detail-value";
    var isEditable = field === "title" || field === "content" || field === "topic";
    if (field === "title") valueClass += " editable-field idea-title-text";
    if (field === "content") valueClass += " editable-field idea-body-text";
    if (field === "topic") valueClass += " editable-field idea-topic-text";
    if (field === "tags") valueClass += " idea-tags-list";
    var actionAttrs = isEditable
      ? " data-action=\"edit-idea-field\" data-field=\"" + safeField + "\" tabindex=\"0\" role=\"button\" aria-label=\"Edit " + safeLabel + "\""
      : "";
    return "<div class=\"modal-form-row idea-detail-field\" data-field=\"" + safeField + "\">" +
      "<p class=\"detail-label\">" + safeLabel + "</p>" +
      "<div class=\"" + valueClass + "\"" + actionAttrs + ">" + safeDisplay + "</div>" +
      "<div class=\"idea-detail-editor hidden\">" +
      "<" + editorTag + " class=\"idea-detail-input\"" + editorExtra + " data-field=\"" + safeField + "\"></" + editorTag + ">" +
      "<button type=\"button\" class=\"btn-primary\" data-action=\"update-idea-field\" data-field=\"" + safeField + "\">Update</button>" +
      "</div></div>";
  }

  function openIdeaFieldEditor(modalEl, field) {
    if (!modalEl || !field) return;
    var idea = modalEl._currentIdea;
    if (!idea) return;
    var row = modalEl.querySelector('.idea-detail-field[data-field="' + field + '"]');
    if (!row) return;
    var valueEl = row.querySelector(".idea-detail-value");
    var editorEl = row.querySelector(".idea-detail-editor");
    var inputEl = row.querySelector('.idea-detail-input[data-field="' + field + '"]');
    if (!valueEl || !editorEl || !inputEl) return;
    if (!valueEl.classList.contains("editable-field")) return;
    valueEl.classList.add("hidden");
    editorEl.classList.remove("hidden");
    if (field === "tags") inputEl.value = Array.isArray(idea.tags) ? idea.tags.join(", ") : "";
    else if (field === "content") inputEl.value = idea.content != null ? String(idea.content) : "";
    else if (field === "title") inputEl.value = idea.title != null ? String(idea.title) : "";
    else if (field === "topic") inputEl.value = idea.topic != null ? String(idea.topic) : "";
    setTimeout(function () {
      if (typeof inputEl.focus === "function") inputEl.focus();
    }, 50);
  }

  function closeIdeaFieldEditor(modalEl, field) {
    if (!modalEl || !field) return;
    var row = modalEl.querySelector('.idea-detail-field[data-field="' + field + '"]');
    if (!row) return;
    var valueEl = row.querySelector(".idea-detail-value");
    var editorEl = row.querySelector(".idea-detail-editor");
    if (valueEl) valueEl.classList.remove("hidden");
    if (editorEl) editorEl.classList.add("hidden");
  }

  /**
   * Opens the full-screen modal for the given tab (ideas, jokes, sets, settings).
   * Shows #modal-container and the corresponding panel; hides all other panels.
   */
  function globalHideFolderLayers() {
    document.querySelectorAll(".folder-layer").forEach(function (el) {
      el.style.display = "none";
      el.classList.add("hidden");
      el.classList.remove("active");
      if (el.id === "panel-ideas") {
        el.classList.remove("is-detail-view", "is-viewing-detail");
        el.classList.remove("modal-idea", "modal-joke");
        document.getElementById("panel-ideas-list")?.classList.remove("hidden");
        var ideaDetLayer = document.getElementById("idea-detail");
        if (ideaDetLayer) {
          ideaDetLayer.classList.add("hidden");
          ideaDetLayer.innerHTML = "";
          ideaDetLayer.style.display = "";
        }
      }
    });
  }

  function revealFolderLayer(el) {
    if (!el) return;
    el.classList.remove("hidden");
    el.style.removeProperty("display");
  }

  function syncFolderLayerActiveForTab(tabId) {
    document.querySelectorAll(".folder-layer").forEach(function (el) {
      el.classList.remove("active");
    });
    var folder = tabId === "jokes" ? "jokes" : tabId;
    var layer = document.querySelector('.folder-layer[data-folder="' + folder + '"]');
    if (!layer || layer.classList.contains("hidden")) return;
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        layer.classList.add("active");
      });
    });
  }

  function openModal(tabId) {
    var modalContainer = document.getElementById("modal-container");
    var targetPanel = tabId === "jokes" ? getJokesPanelEl() : document.getElementById("panel-" + tabId);
    if (modalContainer) modalContainer.setAttribute("aria-hidden", "true");
    sweepOpenDetailSlabs(true);
    /* Ideas list lives in the panel; never leave an empty #modal-container over the list */
    if (tabId === "ideas" && modalContainer) {
      modalContainer.classList.add("hidden");
      modalContainer.classList.remove("is-detail-view");
      modalContainer.classList.remove("modal-joke", "modal-idea");
      var udcOpen = document.getElementById("universal-detail-content");
      if (udcOpen) udcOpen.innerHTML = "";
    }
    showPanel(tabId, false);
    targetPanel = tabId === "jokes" ? getJokesPanelEl() : document.getElementById("panel-" + tabId);
    var folder = tabId === "jokes" ? "jokes" : tabId;
    document.querySelectorAll(".header .tab").forEach(function (t) {
      t.classList.toggle("active", t.getAttribute("data-tab") === tabId);
    });
    if (tabId === "jokes") setJokesNavHeaderRowVisible(true);
    if (tabId === "ideas") loadIdeas();
    if (tabId === "jokes") loadJokes();
    if (tabId === "sets") loadSets();
    syncFolderLayerActiveForTab(tabId);
    if (tabId === "ideas") schedulePanelFocus("new-idea-title-input");
    if (tabId === "jokes") schedulePanelFocus("jokes-search");
    if (tabId === "sets") schedulePanelFocus("new-set-title-input");
  }

  /**
   * Workstation hub: opens a folder layer (slides up via .active + workstation.css).
   */
  function openFolder(folderName) {
    var id = folderName != null ? String(folderName).trim() : "";
    if (!id) return;
    openModal(id);
  }

  window.openModal = openModal;
  window.openFolder = openFolder;
  window.showJokeDetail = showJokeDetail;

  /**
   * Closes joke/idea detail overlays and #modal-container so NavGrid switches never stack slabs.
   * @param {boolean} [forPanelSwitch] When true, skip hub/tab reset (used when navigating between panels).
   */
  function sweepOpenDetailSlabs(forPanelSwitch) {
    var jokeDetail = getJokeDetailEl();
    if (jokeDetail && typeof jokeDetail._returnToJokeList === "function") {
      jokeDetail._returnToJokeList();
    } else {
      setJokesDetailVisibility(false);
    }
    var modalContainer = document.getElementById("modal-container");
    if (modalContainer) {
      modalContainer.classList.add("hidden");
      modalContainer.classList.remove("modal-joke", "modal-idea", "is-detail-view");
      modalContainer.setAttribute("aria-hidden", "true");
      var udc = document.getElementById("universal-detail-content");
      if (udc) udc.innerHTML = "";
    }
    var panelIdeas = document.getElementById("panel-ideas");
    if (panelIdeas) {
      panelIdeas.classList.remove("is-viewing-detail");
      panelIdeas.classList.remove("is-detail-view");
      panelIdeas.classList.remove("modal-idea");
    }
    var ideaDetSweep = document.getElementById("idea-detail");
    if (ideaDetSweep) {
      ideaDetSweep.classList.add("hidden");
      ideaDetSweep.innerHTML = "";
      ideaDetSweep.style.display = "";
    }
    setIdeasPanelTitle("IDEAS");
    document.getElementById("panel-sets")?.classList.remove("hidden");
    document.getElementById("panel-sets-list")?.classList.remove("hidden");
    document.getElementById("panel-ideas-list")?.classList.remove("hidden");
    document.getElementById("panel-jokes-list")?.classList.remove("hidden");
    if (!forPanelSwitch) {
      document.querySelectorAll(".folder-layer").forEach(function (el) {
        el.classList.remove("active");
      });
    }
  }

  /**
   * Hides the detail overlay (#modal-container) without navigating home.
   * Panel folder layers stay as-is; use sweepOnly for global nav clean-sweep only.
   * @param {boolean} [sweepOnly] When true, delegates to sweepOpenDetailSlabs(true).
   */
  function updateNavActiveState(activeId) {
    var id = activeId != null ? String(activeId).trim() : "";
    if (id === "panel-dashboard") id = "home";
    if (id === "jokes-modal" || id === "panel-jokes") id = "jokes";
    if (id.indexOf("panel-") === 0) id = id.slice(6);
    if (id.length > 6 && id.indexOf("-panel") === id.length - 6) {
      id = id.slice(0, -6);
    }
    if (!id) id = "home";
    document.querySelectorAll(".nav-pill-btn").forEach(function (btn) {
      btn.classList.remove("active", "active-nav");
      var panel = btn.getAttribute("data-nav-panel");
      if (panel === id) btn.classList.add("active");
    });
  }

  function closeModal(sweepOnly) {
    _pendingSourceIdeaId = null;
    var jokeTitleDisplay = document.getElementById("joke-detail-title-display");
    if (jokeTitleDisplay) {
      jokeTitleDisplay.classList.add("hidden");
      jokeTitleDisplay.innerHTML = "";
    }
    var jokeDetailEl = getJokeDetailEl();
    var jokeTitleInputReset = getJokeEditTitleEl();
    var jokeDetailOpen = jokeDetailEl && !jokeDetailEl.classList.contains("hidden");
    if (jokeTitleInputReset && jokeDetailOpen) {
      jokeTitleInputReset.classList.remove("hidden");
    }
    if (sweepOnly) {
      sweepOpenDetailSlabs(true);
      return;
    }
    var modalContainer = document.getElementById("modal-container");
    if (modalContainer) {
      modalContainer.classList.add("hidden");
      modalContainer.classList.remove("is-detail-view", "modal-joke", "modal-idea");
      modalContainer.setAttribute("aria-hidden", "true");
      modalContainer.style.display = "";
    }
    var udc = document.getElementById("universal-detail-content");
    if (udc) udc.innerHTML = "";
    var panelIdeas = document.getElementById("panel-ideas");
    if (panelIdeas) {
      panelIdeas.classList.remove("is-viewing-detail", "is-detail-view", "modal-idea");
    }
    var ideaDetModalClose = document.getElementById("idea-detail");
    if (ideaDetModalClose) {
      ideaDetModalClose.classList.add("hidden");
      ideaDetModalClose.innerHTML = "";
      ideaDetModalClose.style.display = "";
    }
    document.getElementById("panel-ideas-list")?.classList.remove("hidden");
    setIdeasPanelTitle("IDEAS");
    var jokeDet = document.getElementById("jokes-detail-container");
    if (jokeDet && !jokeDet.classList.contains("hidden")) {
      setJokesDetailVisibility(false);
    }
  }

  function showPanel(panelId, isNavClick) {
    if (isNavClick) {
      closeModal(true);
    }
    var normalizedId = panelId != null ? String(panelId).trim() : "";

    if (normalizedId === "panel-dashboard") normalizedId = "home";
    if (normalizedId === "jokes-modal" || normalizedId === "panel-jokes") normalizedId = "jokes";
    if (normalizedId.indexOf("panel-") === 0) normalizedId = normalizedId.slice(6);
    if (normalizedId.length > 6 && normalizedId.indexOf("-panel") === normalizedId.length - 6) {
      normalizedId = normalizedId.slice(0, -6);
    }

    if (normalizedId === "settings" && !isNavClick) {
      sweepOpenDetailSlabs(true);
    }

    var navPill = document.getElementById("nav-command-pill");
    if (navPill) {
      navPill.classList.add("nav-active");
      navPill.style.display = "flex";
    }

    var panelHome = document.getElementById("panel-home");

    if (normalizedId === "home" || !normalizedId) {
      if (document.body) document.body.classList.remove("panel-open");
      globalHideFolderLayers();
      document.querySelectorAll('[id^="modal-detail-"], #set-picker-modal').forEach(function (el) {
        el.classList.remove("active");
        el.classList.add("hidden");
      });
      if (panelHome) {
        panelHome.classList.remove("hidden");
        panelHome.style.display = "flex";
      }
    } else {
      if (document.body) document.body.classList.add("panel-open");
      if (panelHome) {
        panelHome.classList.add("hidden");
        panelHome.style.display = "none";
      }
      globalHideFolderLayers();
      var targetPanel = document.getElementById(normalizedId + "-panel") ||
        document.getElementById("panel-" + normalizedId) ||
        document.getElementById(normalizedId);
      if (targetPanel) revealFolderLayer(targetPanel);
    }

    window.scrollTo(0, 0);

    updateNavActiveState(normalizedId || "home");

    /* After a nav-pill click (isNavClick), refresh list UIs. Internal showPanel(..., false) avoids a clean-sweep + load loop (e.g. set detail). */
    if (isNavClick && (normalizedId === "sets" || normalizedId === "jokes" || normalizedId === "ideas")) {
      var panelRefreshId = normalizedId;
      window.requestAnimationFrame(function () {
        if (panelRefreshId === "sets") loadSets();
        else if (panelRefreshId === "jokes") loadJokes();
        else if (panelRefreshId === "ideas") loadIdeas();
      });
    }
  }

  var STAGETIME_ACCENT_KEY = "stagetime_accent_hex";
  var DEFAULT_ACCENT_HEX = "#00f2ff";
  /** Preset chips in Settings (Steel Gray replaces pure black for visibility). */
  var SETTINGS_ACCENT_PRESET_HEXES = ["#444444", "#00f2ff", "#e879f9", "#4ade80", "#fbbf24", "#fb7185"];

  function updateThemeColorMeta() {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    var themeColor = getComputedStyle(document.documentElement).getPropertyValue("--theme-color").trim();
    if (themeColor) meta.content = themeColor;
  }

  function hexToRgbForAccent(hex) {
    var h = hex != null ? String(hex).trim() : "";
    if (h.indexOf("#") === 0) h = h.slice(1);
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    if (h.length !== 6 || !/^[0-9a-fA-F]+$/.test(h)) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }

  function normalizeAccentHex(hex) {
    var triplet = hexToRgbForAccent(hex);
    if (!triplet) return null;
    function pad2(n) {
      var s = Number(n).toString(16);
      return s.length < 2 ? "0" + s : s;
    }
    return "#" + pad2(triplet.r) + pad2(triplet.g) + pad2(triplet.b);
  }

  /** Relative luminance 0–1; below ~0.1 reads as "invisible" on dark chrome UI. */
  function accentHexBrightness01(hex) {
    var t = hexToRgbForAccent(hex);
    if (!t) return 0;
    return (0.299 * t.r + 0.587 * t.g + 0.114 * t.b) / 255;
  }

  function clampAccentToVisibleHex(normalized) {
    if (!normalized) return DEFAULT_ACCENT_HEX;
    var lower = normalized.toLowerCase();
    if (lower === "#000000" || accentHexBrightness01(normalized) < 0.1) return DEFAULT_ACCENT_HEX;
    return normalized;
  }

  function setAccentColor(hex) {
    if (hex != null && String(hex).trim().toLowerCase() === "#000000") hex = "#00f2ff";
    var normalized = normalizeAccentHex(hex);
    if (!normalized) normalized = DEFAULT_ACCENT_HEX;
    normalized = clampAccentToVisibleHex(normalized);
    var triplet = hexToRgbForAccent(normalized);
    if (!triplet) triplet = hexToRgbForAccent(DEFAULT_ACCENT_HEX);
    var root = document.documentElement;
    root.style.setProperty("--accent-color", normalized);
    root.style.setProperty("--accent-rgb", String(triplet.r) + ", " + String(triplet.g) + ", " + String(triplet.b));
    root.style.setProperty("--3d-light", "rgba(" + triplet.r + ", " + triplet.g + ", " + triplet.b + ", 0.2)");
    try {
      localStorage.setItem(STAGETIME_ACCENT_KEY, normalized);
    } catch (e) {}
    var colorInput = document.getElementById("settings-accent-color");
    if (colorInput && colorInput.value !== normalized) colorInput.value = normalized;
    updateThemeColorMeta();
  }

  function initAccent() {
    var saved = "";
    try {
      saved = localStorage.getItem(STAGETIME_ACCENT_KEY) || "";
    } catch (e) {}
    try {
      localStorage.removeItem("stagetime_theme");
    } catch (e2) {}
    if (saved) setAccentColor(saved);
    else setAccentColor(DEFAULT_ACCENT_HEX);
  }

  function bindSettingsAccentControl() {
    var colorInput = document.getElementById("settings-accent-color");
    if (!colorInput || colorInput.dataset.accentBound === "1") return;
    colorInput.dataset.accentBound = "1";
    var current = "";
    try {
      current = localStorage.getItem(STAGETIME_ACCENT_KEY) || "";
    } catch (e) {}
    if (current) {
      var norm = normalizeAccentHex(current);
      if (norm) colorInput.value = norm;
    }
    colorInput.addEventListener("input", function () {
      setAccentColor(colorInput.value);
    });
  }

  function bindSettingsAccentPresets() {
    var colorInput = document.getElementById("settings-accent-color");
    var parent = colorInput && colorInput.parentElement;
    if (!parent) return;
    var wrap = document.getElementById("settings-accent-presets");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "settings-accent-presets";
      wrap.className = "settings-accent-presets";
      wrap.setAttribute("role", "group");
      wrap.setAttribute("aria-label", "Accent color presets");
      if (colorInput.nextSibling) parent.insertBefore(wrap, colorInput.nextSibling);
      else parent.appendChild(wrap);
    }
    if (wrap.dataset.accentPresetsBound === "1") return;
    wrap.dataset.accentPresetsBound = "1";
    SETTINGS_ACCENT_PRESET_HEXES.forEach(function (presetHex) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-accent-preset-btn";
      btn.style.backgroundColor = presetHex;
      btn.setAttribute("aria-label", "Use accent " + presetHex);
      btn.addEventListener("click", function () {
        setAccentColor(presetHex);
      });
      wrap.appendChild(btn);
    });
  }

  function showSettingsView(view) {
    var dashboard = document.getElementById("settings-dashboard");
    var importExportView = document.getElementById("settings-view-import-export");
    if (dashboard) dashboard.classList.toggle("hidden", view !== "dashboard");
    if (importExportView) importExportView.classList.toggle("hidden", view !== "import-export");
  }

  function formatDashboardRuntime(totalSeconds) {
    var t = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    var m = Math.floor(t / 60);
    var s = t % 60;
    var mm = m < 10 ? "0" + m : String(m);
    var ss = s < 10 ? "0" + s : String(s);
    return mm + ":" + ss;
  }

  function sumJokeRuntimeSeconds(jokes) {
    if (!Array.isArray(jokes)) return 0;
    var sum = 0;
    for (var i = 0; i < jokes.length; i++) {
      var raw = jokes[i] && jokes[i].duration;
      var n = raw != null && raw !== "" ? Number(raw) : 0;
      if (typeof n === "number" && !isNaN(n) && isFinite(n) && n > 0) sum += Math.floor(n);
    }
    return sum;
  }

  function updateDashboardStats() {
    var jokesEl = document.getElementById("dash-stat-jokes");
    var runtimeEl = document.getElementById("dash-stat-runtime");
    var ideasEl = document.getElementById("dash-stat-ideas");
    var setsEl = document.getElementById("dash-stat-sets");
    if (!jokesEl && !runtimeEl && !ideasEl && !setsEl) return;
    function nTxt(n) {
      return String(Math.max(0, Math.floor(Number(n) || 0)));
    }
    if (!dataLayer) {
      if (jokesEl) jokesEl.textContent = "0";
      if (runtimeEl) runtimeEl.textContent = formatDashboardRuntime(0);
      if (ideasEl) ideasEl.textContent = "0";
      if (setsEl) setsEl.textContent = "0";
      return;
    }
    Promise.all([dataLayer.listSets().catch(function () { return []; })]).then(function (results) {
      var setsRows = Array.isArray(results[0]) ? results[0] : [];
      var slice = getFilteredData();
      var jokesOnly = slice.filter(function (x) {
        return x && x.type === "joke";
      });
      var ideasOnly = slice.filter(function (x) {
        return x && x.type === "idea";
      });
      if (jokesEl) jokesEl.textContent = nTxt(jokesOnly.length);
      if (runtimeEl) runtimeEl.textContent = formatDashboardRuntime(sumJokeRuntimeSeconds(jokesOnly));
      if (ideasEl) ideasEl.textContent = nTxt(ideasOnly.length);
      if (setsEl) setsEl.textContent = nTxt(setsRows.length);
    }).catch(function () {
      if (jokesEl) jokesEl.textContent = "0";
      if (runtimeEl) runtimeEl.textContent = formatDashboardRuntime(0);
      if (ideasEl) ideasEl.textContent = "0";
      if (setsEl) setsEl.textContent = "0";
    });
  }

  function getJokeListEl() { return document.getElementById("joke-list"); }
  function getJokesPanelTitleDisplayEl() {
    return document.getElementById("jokes-panel-title-display");
  }
  function getJokeEditTitleEl() {
    return document.getElementById("joke-edit-title");
  }
  function setJokesPanelHeaderListMode() {
    var rich = document.getElementById("joke-detail-title-display");
    if (rich) {
      rich.classList.add("hidden");
      rich.innerHTML = "";
    }
    var h2 = getJokesPanelTitleDisplayEl();
    var inp = getJokeEditTitleEl();
    if (h2) {
      h2.classList.remove("hidden");
      h2.textContent = "Jokes";
    }
    if (inp) {
      inp.classList.add("hidden");
      inp.value = "";
    }
  }
  function setJokeHeaderTitleFromData(titleStr) {
    var titleInput = getJokeEditTitleEl();
    if (!titleInput) return;
    titleInput.value = titleStr != null ? String(titleStr) : "";
  }
  function getJokeDetailEl() { return document.getElementById("jokes-detail-container"); }
  function getJokeControlsEl() { return document.getElementById("joke-controls"); }
  function getJokesNavHeaderRowEl() {
    var jokesPanel = getJokesPanelEl();
    return jokesPanel ? jokesPanel.querySelector(".nav-header-row") : null;
  }
  function setJokesNavHeaderRowVisible(visible) {
    var el = getJokesNavHeaderRowEl();
    if (!el) return;
    el.classList.toggle("hidden", !visible);
  }
  function getSetListEl() { return document.getElementById("set-list"); }
  function getSetDetailEl() { return document.getElementById("set-detail"); }
  window.getSetDetailEl = getSetDetailEl;
  function getIdeaListEl() { return document.getElementById("idea-list"); }

  function setJokesDetailVisibility(isDetailVisible) {
    var detailEl = getJokeDetailEl();
    var jokesListFolder = document.getElementById("panel-jokes-list");
    var controlsEl = getJokeControlsEl();
    var modalContainer = document.getElementById("modal-container");

    if (isDetailVisible) {
      if (jokesListFolder) jokesListFolder.classList.add("hidden");
      if (detailEl) detailEl.classList.remove("hidden");
      if (controlsEl) controlsEl.classList.add("hidden");
      var titleRich = document.getElementById("joke-detail-title-display");
      if (titleRich) {
        titleRich.classList.add("hidden");
        titleRich.innerHTML = "";
      }
      var titleH2 = getJokesPanelTitleDisplayEl();
      var titleInp = getJokeEditTitleEl();
      if (titleH2) titleH2.classList.add("hidden");
      if (titleInp) titleInp.classList.remove("hidden");
    } else {
      if (jokesListFolder) jokesListFolder.classList.remove("hidden");
      if (detailEl) detailEl.classList.add("hidden");
      if (controlsEl) controlsEl.classList.remove("hidden");
      setJokesPanelHeaderListMode();
    }
    if (isDetailVisible) setJokesNavHeaderRowVisible(false);
    else setJokesNavHeaderRowVisible(true);
    if (modalContainer) {
      modalContainer.classList.toggle("is-detail-view", !!isDetailVisible);
      modalContainer.style.display = isDetailVisible ? "flex" : "";
    }
  }

  function filterIdeaCardsBySearch() {
    var ideaSearchInput = document.getElementById("idea-search-input");
    var filterValue = ideaSearchInput ? ideaSearchInput.value : "";
    renderIdeas(filterValue);
  }
  function getIdeaDetailEl() { return document.getElementById("idea-detail"); }
  function getIdeasToolbarEl() { return document.getElementById("ideas-toolbar"); }
  function getSetsNewFormEl() { return document.getElementById("sets-new-form"); }

  function applyFilterAndSort(list, opts) {
    opts = opts || {};
    var topic = opts.topic;
    var rating = opts.rating;
    var tags = opts.tags;
    var sort = opts.sort || "newest";
    if (!Array.isArray(list)) return [];
    var out = list.slice();
    if (topic != null && topic !== "") out = out.filter(function (i) { return (i.topic || "") === topic; });
    if (rating != null && rating !== "") {
      var r = parseInt(rating, 10);
          out = out.filter(function (i) { return i.rating != null && i.rating === r; });
    }
    if (tags && typeof tags === "string" && tags.trim()) {
      var tagList = tags.split(",").map(function (t) { return t.trim().toLowerCase(); }).filter(Boolean);
      if (tagList.length) out = out.filter(function (i) {
        var itemTags = (i.tags || []).map(function (t) { return String(t).toLowerCase(); });
        return tagList.some(function (t) { return itemTags.indexOf(t) >= 0; });
      });
    }
    if (sort === "highest-rated") {
      out.sort(function (a, b) {
        var ra = a.rating != null ? a.rating : 0;
        var rb = b.rating != null ? b.rating : 0;
        return rb - ra;
      });
    } else if (sort === "topic") {
      out.sort(function (a, b) {
        var ta = (a.topic || "").toLowerCase();
        var tb = (b.topic || "").toLowerCase();
        return ta.localeCompare(tb);
      });
    } else {
      out.sort(function (a, b) {
        var ta = (a.updated_at || a.created_at || "").replace("Z", "");
        var tb = (b.updated_at || b.created_at || "").replace("Z", "");
        return tb.localeCompare(ta);
      });
    }
    return out;
  }

  var jokesModalFilterState = { topic: "all", status: "all", rating: "all", query: "", sortBy: "newest" };
  var jokesListCache = [];

  function getFilteredJokes(data, state) {
    if (!Array.isArray(data)) return [];
    var out = data.slice();
    if (state.topic != null && state.topic !== "all" && state.topic !== "") {
      out = out.filter(function (j) {
        var top = j.topic != null && String(j.topic).trim() !== "" ? String(j.topic).trim() : "Uncategorized";
        return top === state.topic;
      });
    }
    if (state.status != null && state.status !== "all" && state.status !== "") {
      out = out.filter(function (j) { return (j.status || "") === state.status; });
    }
    if (state.rating != null && state.rating !== "all" && state.rating !== "") {
      if (state.rating === "unranked") {
        out = out.filter(function (j) {
          var r = j.rating != null ? Number(j.rating) : 0;
          return !(r >= 1 && r <= 5);
        });
      } else {
        var wantR = parseInt(String(state.rating), 10);
        out = out.filter(function (j) {
          var r = j.rating != null ? Number(j.rating) : 0;
          return r === wantR;
        });
      }
    }
    if (state.query != null && String(state.query).trim() !== "") {
      var q = String(state.query).trim().toLowerCase();
      out = out.filter(function (j) {
        var title = (j.title || "").toLowerCase();
        var content = (
          (j.content != null ? String(j.content) : "") +
          " " +
          (j.act_out != null ? String(j.act_out) : "") +
          " " +
          (j.premise != null ? String(j.premise) : "") +
          " " +
          (j.punchline != null ? String(j.punchline) : "")
        )
          .toLowerCase()
          .replace(/\s+/g, " ");
        return title.indexOf(q) >= 0 || content.indexOf(q) >= 0;
      });
    }
    if (state.sortBy === "rating") {
      out.sort(function (a, b) {
        var ra = a.rating != null ? a.rating : 0;
        var rb = b.rating != null ? b.rating : 0;
        return rb - ra;
      });
    } else {
      out.sort(function (a, b) {
        var ta = (a.updated_at || a.created_at || "").replace("Z", "");
        var tb = (b.updated_at || b.created_at || "").replace("Z", "");
        return tb.localeCompare(ta);
      });
    }
    return out;
  }

  function formatJokeDuration(seconds) {
    if (seconds == null || typeof seconds !== "number" || isNaN(seconds)) return "—";
    return seconds < 60
      ? seconds + " sec"
      : Math.floor(seconds / 60) + ":" + (seconds % 60 < 10 ? "0" : "") + (seconds % 60);
  }

  /**
   * Workstation jokes list: title row; content opens editor.
   */
  function renderJokeCard(joke) {
    var el = document.createElement("div");
    el.className = "slab-item joke-slab joke-item";
    el.setAttribute("role", "listitem");
    el.setAttribute("data-id", joke.id != null ? String(joke.id) : "");
    var jid = joke.id;
    var titleRaw = joke.title != null ? String(joke.title) : "";
    var titleText = titleRaw.trim() !== "" ? titleRaw.trim() : "Untitled";

    var titleEl = document.createElement("span");
    titleEl.className = "slab-title";
    titleEl.textContent = titleText;
    el.appendChild(titleEl);

    el.addEventListener("click", function () {
      window.editJoke(jid);
      var listEl = getJokeListEl();
      if (listEl) listEl.querySelectorAll(".joke-item").forEach(function (x) { x.classList.remove("active"); });
      el.classList.add("active");
    });

    return el;
  }

  function createJokeCard(joke) {
    return renderJokeCard(joke);
  }

  /**
   * Ideas list card with shared push to set picker.
   */
  function renderIdeaCard(idea) {
    var el = document.createElement("div");
    el.className = "slab-item idea-slab idea-item";
    el.setAttribute("role", "listitem");
    el.dataset.id = idea.id != null ? String(idea.id) : "";
    var ideaIdNum = idea && idea.id != null ? Number(idea.id) : NaN;
    if (Number.isFinite(ideaIdNum)) {
      el.setAttribute("onclick", "window.showIdeaDetail(" + ideaIdNum + ")");
    }
    var tTitle = idea.title != null ? String(idea.title) : "";
    var tPrem = idea.premise != null ? String(idea.premise) : "";
    var tContent = idea.content != null ? String(idea.content) : "";
    var titleRaw =
      tTitle.trim() !== ""
        ? tTitle.trim()
        : tPrem.trim() !== ""
          ? tPrem.trim()
          : tContent.trim() !== ""
            ? tContent.trim()
            : "Untitled Idea";
    var titleEl = document.createElement("span");
    titleEl.className = "slab-title idea-title idea-title-text title";
    titleEl.textContent = titleRaw;
    el.appendChild(titleEl);
    return el;
  }

  function createSetCard(set) {
    set = set || {};
    var nameRaw = set.name != null ? String(set.name) : "";
    var titleForDisplay = nameRaw.trim() !== "" ? nameRaw : "Untitled";
    var name = escapeHtml(titleForDisplay);
    var idAttr = set.id != null ? String(set.id) : "";
    return "<li class=\"set-item slab-item card\" data-action=\"view-set-detail\" data-id=\"" + idAttr + "\">" +
      "<span class=\"slab-title title\">" + name + "</span>" +
      "</li>";
  }

  function renderJokeList(optionalSelectJokeId) {
    jokesModalFilterState.topic = _filters.topic != null ? _filters.topic : "all";
    jokesModalFilterState.status = _filters.status != null ? _filters.status : "all";
    jokesModalFilterState.rating = _filters.rating != null ? _filters.rating : "all";
    var searchEl = document.getElementById("jokes-search");
    jokesModalFilterState.query = searchEl ? String(searchEl.value || "") : "";
    jokesModalFilterState.sortBy = "newest";
    var list = getFilteredJokes(jokesListCache, jokesModalFilterState);
    var el = getJokeListEl();
    if (!el) return;
    if (list.length === 0) {
      var emptyMsg =
        jokesListCache.length === 0
          ? "No jokes yet. Tap NEW JOKE above to create one."
          : "No jokes match these filters. Adjust search or filters.";
      el.innerHTML = "<div class=\"list-empty\" role=\"status\">" + emptyMsg + "</div>";
      setJokesDetailVisibility(false);
      scheduleJokesControlRowGeometrySync();
      return;
    }
    el.innerHTML = "";
    for (var i = 0; i < list.length; i++) {
      el.appendChild(createJokeCard(list[i]));
    }
    if (optionalSelectJokeId) {
      el.querySelectorAll(".joke-item").forEach(function (x) { x.classList.remove("active"); });
      var jokeSelId = optionalSelectJokeId != null ? String(optionalSelectJokeId) : "";
      var activeCard = el.querySelector(".joke-item[data-id=\"" + jokeSelId + "\"]");
      if (activeCard) activeCard.classList.add("active");
      showJokeDetail(optionalSelectJokeId);
    } else {
      setJokesDetailVisibility(false);
    }
    scheduleJokesControlRowGeometrySync();
  }

  var jokesControlRowGeometrySyncRaf = null;

  function syncJokesControlRowGeometry() {
    return;
  }

  function scheduleJokesControlRowGeometrySync() {
    if (jokesControlRowGeometrySyncRaf != null) cancelAnimationFrame(jokesControlRowGeometrySyncRaf);
    jokesControlRowGeometrySyncRaf = window.requestAnimationFrame(function () {
      jokesControlRowGeometrySyncRaf = null;
      syncJokesControlRowGeometry();
    });
  }

  function fetchJokesForModal(optionalSelectJokeId) {
    function afterCacheFill() {
      jokesListCache = Array.isArray(_cache) ? _cache.filter(function (x) { return x && x.type === "joke"; }) : [];
      renderJokeList(optionalSelectJokeId);
      return Promise.resolve();
    }
    return refreshCache()
      .then(afterCacheFill)
      .catch(function () {
        jokesListCache = [];
        var listEl = getJokeListEl();
        if (listEl) listEl.innerHTML = "<div class=\"list-empty\" role=\"alert\">Could not load jokes." + (dataLayer && dataLayer.getStorageMode() === "local" ? "" : " Is the server running?") + "</div>";
        var detailEl = getJokeDetailEl();
        if (detailEl) detailEl.classList.add("hidden");
        if (listEl) listEl.classList.remove("hidden");
        updateDashboardStats();
      });
  }

  function loadJokes(optionalSelectJokeId) {
    fetchJokesForModal(optionalSelectJokeId);
    schedulePanelFocus("jokes-search");
  }

  /** Split stored punchline into Act Out + Punchline (double newline); legacy single block → punch only. */
  function splitJokeActOutPunchline(punchlineStr) {
    var s = punchlineStr != null ? String(punchlineStr).trim() : "";
    if (!s) return { actOut: "", punch: "" };
    var parts = s.split(/\n\n+/);
    if (parts.length >= 2) return { actOut: parts[0].trim(), punch: parts.slice(1).join("\n\n").trim() };
    return { actOut: "", punch: s };
  }

  function joinJokeActOutPunchline(actOut, punch) {
    var a = actOut != null ? String(actOut).trim() : "";
    var p = punch != null ? String(punch).trim() : "";
    if (a && p) return a + "\n\n" + p;
    var one = a || p;
    return one === "" ? null : one;
  }

  function readJokePremiseFromForm() {
    var el = document.getElementById("joke-edit-premise");
    return el ? el.value.trim() : "";
  }

  function readJokePunchlineFromForm() {
    var punchEl = document.getElementById("joke-edit-punchline");
    var raw = punchEl ? punchEl.value.trim() : "";
    return raw === "" ? null : raw;
  }

  function focusJokeBodyIfEmpty() {
    var premiseEl = document.getElementById("joke-edit-premise");
    if (!premiseEl || String(premiseEl.value || "").trim() !== "") return;
    requestAnimationFrame(function () {
      premiseEl.focus();
    });
  }

  window.focusJokeBodyIfEmpty = focusJokeBodyIfEmpty;

  function saveJoke(el, saveBtn) {
    var tagsInput = document.getElementById("joke-edit-tags");
    var tagsVal = tagsInput ? tagsInput.value.trim() : "";
    var durationInput = document.getElementById("joke-edit-duration");
    var durationVal = durationInput && durationInput.value.trim() !== "" ? parseInt(durationInput.value.trim(), 10) : null;
    if (durationVal !== null && (isNaN(durationVal) || durationVal < 0)) durationVal = null;
    var titleHead = document.getElementById("joke-edit-title");
    var payload = {
      title: titleHead ? titleHead.value.trim() || null : null,
      premise: readJokePremiseFromForm(),
      punchline: readJokePunchlineFromForm(),
      status: document.getElementById("joke-edit-status").value,
      setup_notes: document.getElementById("joke-edit-setup_notes") ? document.getElementById("joke-edit-setup_notes").value.trim() || null : undefined,
      topic: document.getElementById("joke-edit-topic") ? document.getElementById("joke-edit-topic").value.trim() || null : undefined,
      tags: tagsVal ? tagsVal.split(",").map(function (t) { return t.trim(); }).filter(Boolean) : [],
      rating: (function () { var r = document.getElementById("joke-edit-rating"); var v = r ? r.value : ""; return v ? parseInt(v, 10) : null; })(),
      duration: durationVal
    };
    if (!payload.title) return;

    var jidRaw = el.dataset.jokeId != null ? String(el.dataset.jokeId).trim() : "";
    var isNewJoke = jidRaw === "";

    if (isNewJoke) {
      var addFn = window.dataLayer && window.dataLayer.addJoke ? window.dataLayer.addJoke.bind(window.dataLayer) : null;
      if (!addFn) {
        addFn = function (data) {
          return apiFetch("/jokes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: data.title,
              premise: data.premise || "",
              punchline: data.punchline != null ? data.punchline : "",
              status: data.status || "draft",
              topic: data.topic,
              tags: data.tags,
              duration: data.duration,
              setup_notes: data.setup_notes,
              rating: data.rating
            })
          }).then(function (r) {
            if (!r.ok) throw new Error("Save failed");
            return r.json();
          });
        };
      }
      addFn({
        title: payload.title,
        premise: payload.premise,
        punchline: payload.punchline != null ? payload.punchline : "",
        status: payload.status,
        topic: payload.topic,
        tags: payload.tags,
        duration: payload.duration,
        setup_notes: payload.setup_notes,
        rating: payload.rating
      })
        .then(function (created) {
          var pendingSrc = _pendingSourceIdeaId;
          function finishNewJokeSaveUi() {
            var titleRich = document.getElementById("joke-detail-title-display");
            if (titleRich) {
              titleRich.classList.add("hidden");
              titleRich.innerHTML = "";
            }
            var titleInp = getJokeEditTitleEl();
            if (titleInp) {
              titleInp.classList.remove("hidden");
              var newTitle = created && created.title != null ? String(created.title) : (payload.title || "");
              titleInp.value = newTitle;
            }
            if (created && created.id != null) {
              el.dataset.jokeId = String(created.id);
              window.currentJokeId = created.id;
            }
            var setTrig = el.querySelector(".btn-set-trigger");
            if (setTrig) {
              setTrig.disabled = false;
              setTrig.removeAttribute("aria-disabled");
              setTrig.removeAttribute("title");
            }
            loadJokes(created && created.id != null ? created.id : undefined);
            if (!saveBtn) return;
            saveBtn.classList.add("btn-save-success");
            saveBtn.textContent = "Saved! ✓";
            window.setTimeout(function () {
              saveBtn.classList.remove("btn-save-success");
              saveBtn.textContent = "Save";
            }, 1500);
          }
          if (pendingSrc != null) {
            var delP = dataLayer && typeof dataLayer.deleteIdea === "function"
              ? dataLayer.deleteIdea(pendingSrc)
              : apiFetch("/ideas/" + pendingSrc, { method: "DELETE" }).then(function (r) {
                  if (!r.ok) throw new Error("Delete failed");
                });
            delP
              .then(function () {
                _pendingSourceIdeaId = null;
                return refreshCache();
              })
              .then(function () {
                var ideaSearch = document.getElementById("idea-search-input");
                renderIdeas(ideaSearch ? ideaSearch.value : "");
                updateDashboardStats();
                finishNewJokeSaveUi();
              })
              .catch(function () {
                _pendingSourceIdeaId = null;
                finishNewJokeSaveUi();
              });
          } else {
            _pendingSourceIdeaId = null;
            finishNewJokeSaveUi();
          }
        })
        .catch(function () {});
      return;
    }

    var jokeIdNum = parseInt(jidRaw, 10);
    if (isNaN(jokeIdNum)) return;

    var updateP = dataLayer
      ? dataLayer.updateJoke(jokeIdNum, payload)
      : apiFetch("/jokes/" + jokeIdNum, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then(function (r) {
          if (!r.ok) throw new Error("Update failed");
          return r.json();
        });
    updateP
      .then(function (updated) {
        if (updated) {
          window.currentJokeId = updated.id;
          el.dataset.jokeId = updated.id != null ? String(updated.id) : "";
        }
        loadJokes();
        setJokesDetailVisibility(false);
        if (!saveBtn) return;
        saveBtn.classList.add("btn-save-success");
        saveBtn.textContent = "Saved! ✓";
        window.setTimeout(function () {
          saveBtn.classList.remove("btn-save-success");
          saveBtn.textContent = "Save";
        }, 1500);
      })
      .catch(function () {});
  }

  /**
   * Wires save / admin toggle / optional body focus after joke detail DOM is built.
   * New jokes use el.dataset.jokeId === ""; existing jokes use numeric id string.
   */
  function bindJokeDetailActions(el, mc, opts) {
    opts = opts || {};
    var skipBodyFocus = !!opts.skipBodyFocus;

    function returnToJokeList() {
      clearJokeDetailAndBack(el, mc);
    }
    el._returnToJokeList = returnToJokeList;

    var saveBtn = el.querySelector("#joke-detail-save-btn");
    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        saveJoke(el, saveBtn);
      });
    }

    var moreBtn = document.getElementById("joke-detail-more-btn");
    if (moreBtn) moreBtn.addEventListener("click", function () { toggleJokeAdmin(); });

    if (!skipBodyFocus) focusJokeBodyIfEmpty();
  }

  function applyModalContentTypeClass(type, item) {
    var modalContainer = document.getElementById("modal-container");
    var ideasPanel = document.getElementById("panel-ideas");
    if (ideasPanel) {
      ideasPanel.classList.toggle("modal-idea", type === "idea");
    }
    if (modalContainer) {
      modalContainer.classList.remove("modal-joke", "modal-idea");
      if (type === "joke") {
        modalContainer.classList.add("modal-joke");
        return;
      }
      if (type === "idea") {
        var udc = document.getElementById("universal-detail-content");
        if (udc && modalContainer.contains(udc)) {
          modalContainer.classList.add("modal-idea");
        }
        return;
      }
      if (!item || typeof item !== "object") return;
      if (item.premise != null && item.type !== "idea") {
        modalContainer.classList.add("modal-joke");
        return;
      }
      if (item.content != null) {
        modalContainer.classList.add("modal-idea");
      }
    }
  }

  /**
   * Step A: set innerHTML (scroll + actions shell). Step B: populate via getElementById.
   * @param {"joke"|"idea"} type
   * @param {object} data – joke/idea fields for step B
   * @param {{ el?: Element, hideDelete?: boolean }} [opts]
   */
  function renderUniversalDetail(type, data, opts) {
    data = data || {};
    opts = opts || {};
    applyModalContentTypeClass(type, data);
    var el = opts.el;
    if (!el) {
      if (type === "joke") el = getJokeDetailEl();
      else if (type === "idea") el = getIdeaDetailEl();
      else el = getIdeaDetailEl();
    }
    if (!el) return;

    if (type === "joke") {
      var hideDelete = !!opts.hideDelete;
      el.innerHTML =
        "<div class=\"modal-detail-shell modal-detail-joke joke-master-document detail-layout focus-slab focus-slab-joke\">" +
        "<div class=\"joke-detail-edit-form\">" +
        "<div class=\"modal-detail-scroll-content joke-master-body\">" +
        "<div class=\"modal-form-row joke-master-field\"><p class=\"detail-label\">BODY</p>" +
        "<textarea id=\"joke-edit-premise\" class=\"live-edit-field joke-master-textarea\" rows=\"8\"></textarea></div>" +
        "<div class=\"modal-form-row joke-master-field\"><p class=\"detail-label\">ACT OUT</p>" +
        "<textarea id=\"joke-edit-punchline\" class=\"live-edit-field joke-master-textarea\" rows=\"4\"></textarea></div>" +
        "</div>" +
        "<div class=\"joke-master-footer ribbon\">" +
        "<div class=\"joke-master-ribbon-row\">" +
        "<div class=\"joke-master-ribbon-actions\">" +
        "<button type=\"button\" id=\"joke-back-btn\" class=\"slab-button detail-modal-close-btn\" onclick=\"window.closeModal(event)\" aria-label=\"Close\">×</button>" +
        "<button type=\"button\" class=\"slab-button btn-set-trigger\" onclick=\"window.openSetPicker(currentJokeId, 'joke')\">+SET</button>" +
        "<button type=\"button\" id=\"joke-detail-save-btn\" class=\"slab-button btn-save-joke\">Save</button>" +
        "<button type=\"button\" id=\"joke-delete-btn\" class=\"slab-button delete-btn" + (hideDelete ? " hidden" : "") + "\" onclick=\"window.deleteCurrentItem()\">DEL</button>" +
        "</div>" +
        "<div id=\"joke-admin-fields\" class=\"lab-accordion hidden joke-master-admin-below-actions\">" +
        "<div class=\"joke-admin-fields-row\">" +
        "<div class=\"admin-metadata-row\">" +
        "<div class=\"modal-form-row status-group joke-admin-field-grow\"><p class=\"detail-label\">STGE</p>" +
        "<select id=\"joke-edit-status\" class=\"workstation-select\">" +
        "<option value=\"draft\">Draft</option>" +
        "<option value=\"testing\">Testing</option>" +
        "<option value=\"active\">Show</option>" +
        "<option value=\"retired\">Retired</option>" +
        "<option value=\"archived\">Archived</option>" +
        "</select></div>" +
        "<div class=\"modal-form-row rank-group joke-admin-field-compact joke-admin-field-center\"><p class=\"detail-label\">RK</p>" +
        "<select id=\"joke-edit-rating\" class=\"workstation-select\">" +
        "<option value=\"\"></option>" +
        "<option value=\"1\">1</option><option value=\"2\">2</option><option value=\"3\">3</option><option value=\"4\">4</option><option value=\"5\">5</option>" +
        "</select></div>" +
        "<div class=\"modal-form-row dur-group joke-admin-field-compact joke-admin-field-center\"><p class=\"detail-label\">SEC</p>" +
        "<input type=\"number\" id=\"joke-edit-duration\" class=\"live-edit-field\" min=\"0\" step=\"1\" value=\"\"></div>" +
        "</div>" +
        "</div>" +
        "<div class=\"joke-admin-fields-row\">" +
        "<div class=\"modal-form-row joke-admin-field-grow\"><p class=\"detail-label\">Topic</p><select id=\"joke-edit-topic\" class=\"topic-select-global\"><option value=\"\">-</option></select></div>" +
        "<div class=\"modal-form-row joke-admin-field-grow\"><p class=\"detail-label\">Tags</p>" +
        "<input type=\"text\" id=\"joke-edit-tags\" class=\"live-edit-field joke-master-tags\" list=\"tag-datalist\" value=\"\"></div>" +
        "</div>" +
        "<div class=\"modal-form-row\"><p class=\"detail-label\">Notes</p><textarea id=\"joke-edit-setup_notes\" class=\"live-edit-field\" rows=\"2\"></textarea></div>" +
        "</div>" +
        "<div class=\"joke-master-admin-toggle-row\">" +
        "<button type=\"button\" id=\"joke-detail-more-btn\" class=\"slab-button btn-more-options\">+/-</button>" +
        "</div>" +
        "</div></div></div></div>";

      var j = data;
      var parts = splitJokeActOutPunchline(j.punchline);
      var premiseIn = document.getElementById("joke-edit-premise");
      if (premiseIn) {
        var premRaw = j.premise != null ? String(j.premise) : "";
        var prem = premRaw.trim() !== "" ? premRaw : (j.content != null ? String(j.content) : "");
        premiseIn.value = prem;
      }
      var punchIn = document.getElementById("joke-edit-punchline");
      if (punchIn) {
        var actRaw = j.act_out != null ? String(j.act_out) : "";
        var actPart = actRaw.trim() !== "" ? actRaw.trim() : (parts.actOut || "");
        var punchPart = parts.punch || "";
        var punchRaw = j.punchline != null ? String(j.punchline) : "";
        if (actPart && punchPart) punchIn.value = actPart + "\n\n" + punchPart;
        else if (actPart) punchIn.value = actPart;
        else if (punchPart) punchIn.value = punchPart;
        else if (punchRaw.trim() !== "") punchIn.value = punchRaw;
        else punchIn.value = "";
      }
      var st = document.getElementById("joke-edit-status");
      var statusRaw = j.status != null ? String(j.status) : "";
      if (st) st.value = statusRaw.trim() !== "" ? statusRaw : "draft";
      var dur = document.getElementById("joke-edit-duration");
      if (dur) dur.value = j.duration != null && j.duration !== "" && !isNaN(Number(j.duration)) ? String(j.duration) : "";
      var rt = document.getElementById("joke-edit-rating");
      if (rt) rt.value = j.rating != null ? String(j.rating) : "";
      var tagsIn = document.getElementById("joke-edit-tags");
      if (tagsIn) tagsIn.value = Array.isArray(j.tags) ? j.tags.map(function (t) { return t != null ? String(t) : ""; }).filter(function (s) { return s !== ""; }).join(", ") : "";
      var notes = document.getElementById("joke-edit-setup_notes");
      if (notes) notes.value = j.setup_notes != null ? String(j.setup_notes) : "";
    } else if (type === "idea") {
      var item = data;
      var ideaId = item.id != null ? Number(item.id) : null;
      var contentPane = el || getIdeaDetailEl();
      if (!contentPane) return;
      var modalContainer = document.getElementById("modal-container");
      var ideasPanelEl = document.getElementById("panel-ideas");
      contentPane._currentIdea = item;
      if (ideasPanelEl) ideasPanelEl._currentIdea = item;
      if (modalContainer) modalContainer._currentIdea = item;
      var udcLegacy = document.getElementById("universal-detail-content");
      if (modalContainer && udcLegacy && modalContainer.contains(udcLegacy)) {
        modalContainer.style.display = "flex";
        modalContainer.classList.add("is-detail-view");
        modalContainer.classList.remove("hidden");
        modalContainer.setAttribute("aria-hidden", "false");
      }
      var ideaTitleStr = item.title != null ? String(item.title) : "";
      var ideaTitleHeading = ideaTitleStr.trim() !== "" ? ideaTitleStr : "Untitled Idea";
      var ideaBodyStr =
        item.content != null ? String(item.content) : (item.premise != null ? String(item.premise) : "");
      var ideaNotesStr =
        item.notes != null ? String(item.notes) : (item.setup_notes != null ? String(item.setup_notes) : "");
      contentPane.innerHTML =
        `<div class="modal-detail-shell">` +
        `<div class="branded-modal-content idea-silo-spine">` +
        `<div class="idea-detail-header-row">` +
        `<h2 class="joke-detail-title" id="modal-idea-title">${escapeHtml(ideaTitleHeading)}</h2>` +
        `</div>` +
        `<div class="modal-form-row"><p class="detail-label">Content</p><textarea id="idea-focus-content" class="live-edit-field" rows="7">${escapeHtml(ideaBodyStr)}</textarea></div>` +
        `<div class="modal-form-row"><p class="detail-label">Notes</p><textarea id="idea-focus-notes" class="live-edit-field" rows="4">${escapeHtml(ideaNotesStr)}</textarea></div>` +
        `<div class="modal-form-row"><p class="detail-label">Topic</p><select id="idea-edit-topic" class="workstation-select topic-select-global" aria-label="Idea topic"></select></div>` +
        `<div class="modal-form-row"><p class="detail-label">Tags</p><input type="text" id="idea-edit-tags" class="live-edit-field" list="tag-datalist" placeholder="Comma-separated tags" value="" autocomplete="off" aria-label="Idea tags"></div>` +
        `<div class="silo-footer-actions">` +
        `<button type="button" class="silo-slab detail-modal-close-btn" onclick="window.closeModal(event)" aria-label="Close">×</button>` +
        `<button type="button" class="silo-slab" onclick="window.openSetPicker(${ideaId != null && !isNaN(ideaId) ? String(ideaId) : "null"}, 'idea')">+SET</button>` +
        `<button type="button" class="silo-slab" onclick="window.saveIdea(${ideaId != null && !isNaN(ideaId) ? String(ideaId) : "null"})">Save</button>` +
        `<button type="button" class="silo-slab silo-btn-danger" onclick="window.deleteCurrentItem()">DEL</button>` +
        `</div>` +
        `<button type="button" id="idea-detail-btn-convert" class="convert-joke-trigger silo-slab">CONVERT TO JOKE</button>` +
        `</div>` +
        `</div>`;
      el = contentPane;
      var topicSel = document.getElementById("idea-edit-topic");
      var tagsInp = document.getElementById("idea-edit-tags");
      var topicVal =
        item.topic != null && String(item.topic).trim() !== ""
          ? String(item.topic).trim()
          : "Uncategorized";
      if (tagsInp) {
        tagsInp.value = Array.isArray(item.tags)
          ? item.tags
              .map(function (t) {
                return t != null ? String(t) : "";
              })
              .filter(function (s) {
                return s !== "";
              })
              .join(", ")
          : "";
      }
      if (topicSel) {
        fillTopicSelect(topicSel, topicVal).then(function () {
          if (topicSel) topicSel.value = topicVal;
        });
      }
    }

    el.classList.remove("hidden");
    el.style.display = "flex";
  }

  function clearJokeDetailAndBack(el, mc) {
    _pendingSourceIdeaId = null;
    el.classList.add("hidden");
    el.innerHTML = "";
    window.currentJokeId = null;
    setJokesDetailVisibility(false);
    if (mc) mc.classList.remove("is-detail-view");
  }

  function showJokeDetail(id) {
    if (id == null || id === "") {
      return Promise.resolve();
    }
    var jokeP = dataLayer ? dataLayer.getJoke(id) : apiFetch("/jokes/" + id).then(function (r) { return r.json(); });
    return jokeP
      .then(function (j) {
        if (!j) return;
        var mc = document.getElementById("modal-container");
        if (mc) mc.classList.add("is-detail-view");
        var el = getJokeDetailEl();
        setJokesDetailVisibility(true);
        el.dataset.jokeId = j.id != null ? String(j.id) : "";
        window.currentJokeId = j.id;

        renderUniversalDetail(
          "joke",
          {
            title: j.title != null ? String(j.title) : "",
            content: j.content != null ? String(j.content) : "",
            act_out: j.act_out != null ? String(j.act_out) : "",
            premise: j.premise != null ? String(j.premise) : "",
            punchline: j.punchline != null ? String(j.punchline) : "",
            status: (function () {
              var s = j.status != null ? String(j.status) : "";
              return s.trim() !== "" ? s : "draft";
            })(),
            rating: j.rating != null ? String(j.rating) : "",
            setup_notes: j.setup_notes != null ? String(j.setup_notes) : "",
            tags: Array.isArray(j.tags) ? j.tags : [],
            duration: j.duration
          },
          { el: el, hideDelete: false }
        );
        var titleInput = document.getElementById("joke-edit-title");
        if (titleInput) {
          titleInput.value = j.title != null ? String(j.title) : "";
        }
        toggleJokeAdmin(false);
        var topicEl = document.getElementById("joke-edit-topic");
        var topicSnap = j.topic != null ? String(j.topic) : "";
        fillTopicSelect(topicEl, topicSnap).then(function () {
          if (topicEl) topicEl.value = topicSnap;
        });

        bindJokeDetailActions(el, mc, {});
      });
  }

  function openNewJokeDetail() {
    setJokesFilterSidebarOpen(false);
    var mc = document.getElementById("modal-container");
    if (mc) mc.classList.add("is-detail-view");
    var el = getJokeDetailEl();
    if (!el) return;
    setJokesDetailVisibility(true);
    el.dataset.jokeId = "";
    window.currentJokeId = null;

    renderUniversalDetail(
      "joke",
      {
        title: "",
        content: "",
        act_out: "",
        premise: "",
        punchline: "",
        status: "draft",
        rating: "",
        setup_notes: "",
        tags: [],
        duration: null
      },
      { el: el, hideDelete: true }
    );

    var titleInput = getJokeEditTitleEl();
    if (titleInput) titleInput.value = "";
    toggleJokeAdmin(false);
    var topicEl = document.getElementById("joke-edit-topic");
    var topicSnap = "";
    fillTopicSelect(topicEl, topicSnap).then(function () {
      if (topicEl) topicEl.value = topicSnap;
    });

    var setTrig = el.querySelector(".btn-set-trigger");
    if (setTrig) {
      setTrig.disabled = true;
      setTrig.setAttribute("aria-disabled", "true");
      setTrig.title = "Save the joke first to add to a set";
    }

    bindJokeDetailActions(el, mc, { skipBodyFocus: true });

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var ti = getJokeEditTitleEl();
        if (ti) ti.focus();
      });
    });
  }

  function renderSetsList(sets, optionalSelectSetId) {
    var el = getSetListEl();
    if (!el) return;
    if (!sets || sets.length === 0) {
      el.innerHTML = "<li class=\"empty\">No sets yet. Create one below.</li>";
      syncSetsListChromeVisible();
      return;
    }
    var html = "";
    for (var i = 0; i < sets.length; i++) {
      html += createSetCard(sets[i]);
    }
    el.innerHTML = html;
    if (optionalSelectSetId) {
      el.querySelectorAll(".set-item").forEach(function (x) { x.classList.remove("active"); });
      var setSelId = optionalSelectSetId != null ? String(optionalSelectSetId) : "";
      var activeCard = el.querySelector(".set-item[data-id=\"" + setSelId + "\"]");
      if (activeCard) activeCard.classList.add("active");
      showSetDetail(optionalSelectSetId);
    } else {
      syncSetsListChromeVisible();
    }
  }

  function loadSets() {
    var panelSetsGate = document.getElementById("panel-sets");
    if (!panelSetsGate || panelSetsGate.classList.contains("hidden")) return;
    var setDetailEl = getSetDetailEl();
    var currentSetId = setDetailEl && !setDetailEl.classList.contains("hidden") && setDetailEl.dataset.setId ? setDetailEl.dataset.setId : null;
    (dataLayer ? dataLayer.listSets() : apiFetch("/sets").then(function (r) { return r.json(); }))
      .then(function (list) {
        if (!Array.isArray(list)) list = [];
        renderSetsList(list, currentSetId);
        schedulePanelFocus("new-set-title-input");
        updateDashboardStats();
      })
      .catch(function () {
        returnToSetList();
        var el = getSetListEl();
        if (el) el.innerHTML = "<li class=\"empty\">Could not load sets. Is the server running?</li>";
        updateDashboardStats();
      });
  }

  function renderIdeas(filter) {
    var filterText = filter == null ? "" : String(filter);
    var normalizedFilter = filterText.trim().toLowerCase();
    var listEl = getIdeaListEl();
    if (!listEl) return Promise.resolve([]);
    var list = Array.isArray(_cache) ? _cache.filter(function (x) { return x && x.type === "idea"; }) : [];
    var filteredIdeas = normalizedFilter
      ? list.filter(function (idea) {
          var title = idea && idea.title != null ? String(idea.title).toLowerCase() : "";
          var content = idea && idea.content != null ? String(idea.content).toLowerCase() : "";
          var notes = idea && idea.notes != null ? String(idea.notes).toLowerCase() : "";
          return title.indexOf(normalizedFilter) >= 0 ||
            content.indexOf(normalizedFilter) >= 0 ||
            notes.indexOf(normalizedFilter) >= 0;
        })
      : list;
    listEl.innerHTML = "";
    if (list.length === 0) {
      listEl.innerHTML = "<div class=\"list-empty\" role=\"status\">No ideas yet. Use the Add button above to create one.</div>";
      updateDashboardStats();
      return Promise.resolve(filteredIdeas);
    }
    if (filteredIdeas.length === 0) {
      listEl.innerHTML = "<div class=\"list-empty neon-text-blue\" role=\"status\">No matching ideas found.</div>";
      updateDashboardStats();
      return Promise.resolve(filteredIdeas);
    }
    filteredIdeas.forEach(function (idea) {
      listEl.appendChild(renderIdeaCard(idea));
    });
    var activeEl = document.activeElement;
    var activeTag = activeEl && activeEl.tagName ? String(activeEl.tagName).toUpperCase() : "";
    var isTypingField = activeTag === "INPUT" || activeTag === "TEXTAREA";
    if (!isTypingField) {
      schedulePanelFocus("new-idea-title-input");
    }
    updateDashboardStats();
    return Promise.resolve(filteredIdeas);
  }

  function loadIdeas() {
    var ideaSearchInput = document.getElementById("idea-search-input");
    var filterValue = ideaSearchInput ? ideaSearchInput.value : "";
    return refreshCache().then(function () {
      return renderIdeas(filterValue);
    });
  }

  /** Exit idea detail overlay only: reveal list behind, do not close workstation or change tab. */
  function returnToIdeaList() {
    var container = document.getElementById("modal-container");
    if (container) {
      container.classList.remove("is-detail-view");
      container.classList.add("hidden");
      container.setAttribute("aria-hidden", "true");
      var udcBack = document.getElementById("universal-detail-content");
      if (udcBack) udcBack.innerHTML = "";
    }
    document.getElementById("panel-ideas-list")?.classList.remove("hidden");
    var panel = document.getElementById("panel-ideas");
    if (panel) {
      revealFolderLayer(panel);
      panel.classList.remove("is-detail-view");
      panel.classList.remove("is-viewing-detail");
      panel.classList.remove("modal-idea");
    }
    setIdeasPanelTitle("IDEAS");
    var listEl = getIdeaListEl();
    var detailEl = getIdeaDetailEl();
    var toolbarEl = getIdeasToolbarEl();
    if (detailEl) {
      detailEl.classList.add("hidden");
      detailEl.innerHTML = "";
    }
    if (listEl) listEl.classList.remove("hidden");
    if (toolbarEl) toolbarEl.classList.remove("hidden");
  }

  function showIdeaDetail(idea) {
    if (idea === null || idea === undefined) {
      returnToIdeaList();
      return;
    }
    var ideaRef = idea;
    if (typeof ideaRef !== "object") {
      const numericId = Number(idea);
      if (!Number.isFinite(numericId)) {
        console.error("[showIdeaDetail] Invalid idea id (not a finite number):", idea);
        return;
      }
      function continueWithNormalizedIdea(normalized) {
        if (normalized === null || normalized === undefined) {
          console.error("[showIdeaDetail] No idea found for id:", numericId);
          return;
        }
        showIdeaDetail(normalized);
      }
      var dexieDb = window.db;
      if (dexieDb && dexieDb.ideas) {
        dexieDb.ideas
          .get(numericId)
          .then(function (row) {
            if (row === null || row === undefined) {
              console.error("[showIdeaDetail] IndexedDB has no idea row for id:", numericId);
              return;
            }
            if (dataLayer && typeof dataLayer.getIdea === "function") {
              return dataLayer.getIdea(numericId).then(continueWithNormalizedIdea);
            }
            console.error("[showIdeaDetail] dataLayer.getIdea is not available");
          })
          .catch(function (err) {
            console.error("[showIdeaDetail] IndexedDB or getIdea failed for id:", numericId, err);
          });
        return;
      }
      if (dataLayer && typeof dataLayer.getIdea === "function") {
        dataLayer
          .getIdea(numericId)
          .then(continueWithNormalizedIdea)
          .catch(function (err) {
            console.error("[showIdeaDetail] getIdea failed:", err);
          });
        return;
      }
      var listP = dataLayer ? dataLayer.listIdeas() : apiFetch("/ideas").then(function (r) { return r.json(); });
      listP
        .then(function (list) {
          var found = Array.isArray(list) ? list.find(function (x) { return Number(x.id) === numericId; }) : null;
          if (found) {
            showIdeaDetail(found);
          } else {
            console.error("[showIdeaDetail] Idea not found in list for id:", numericId);
          }
        })
        .catch(function (err) {
          console.error("[showIdeaDetail] Failed to load ideas list:", err);
        });
      return;
    }
    document.getElementById("panel-ideas-list")?.classList.add("hidden");
    var ideaDetailOpen = getIdeaDetailEl();
    if (ideaDetailOpen) {
      ideaDetailOpen.classList.remove("hidden");
      ideaDetailOpen.style.display = "flex";
    }
    var mc = document.getElementById("modal-container");
    var udcMc = document.getElementById("universal-detail-content");
    if (mc && udcMc && mc.contains(udcMc)) {
      mc.classList.add("is-detail-view");
      mc.classList.remove("hidden");
      mc.setAttribute("aria-hidden", "false");
    }
    var panel = document.getElementById("panel-ideas");
    if (panel) {
      revealFolderLayer(panel);
      panel.classList.add("is-detail-view");
      panel.classList.add("is-viewing-detail");
    }
    var ideaPanelTitleRaw = ideaRef.title != null ? String(ideaRef.title) : "";
    setIdeasPanelTitle(ideaPanelTitleRaw.trim() !== "" ? ideaPanelTitleRaw : "Untitled Idea");
    renderUniversalDetail("idea", ideaRef);
  }

  function closeIdeaDetailModal() {
    var ide = document.getElementById("modal-container");
    if (ide) {
      var udcClose = document.getElementById("universal-detail-content");
      if (udcClose) udcClose.innerHTML = "";
      ide.classList.add("hidden");
      ide.classList.remove("modal-joke", "modal-idea");
      ide.setAttribute("aria-hidden", "true");
    }

    var panel = document.getElementById("panel-ideas");
    if (panel) {
      revealFolderLayer(panel);
      panel.classList.remove("is-viewing-detail");
      panel.classList.remove("is-detail-view");
      panel.classList.remove("modal-idea");
    }
    document.getElementById("panel-ideas-list")?.classList.remove("hidden");
    var ideaDetCloseIdea = getIdeaDetailEl();
    if (ideaDetCloseIdea) {
      ideaDetCloseIdea.classList.add("hidden");
      ideaDetCloseIdea.innerHTML = "";
      ideaDetCloseIdea.style.display = "";
    }
    setIdeasPanelTitle("IDEAS");
    var mc = document.getElementById("modal-container");
    if (mc) mc.classList.remove("is-detail-view");
    if (mc) mc.classList.remove("modal-joke", "modal-idea");
  }

  function deleteIdeaRequest(ideaId) {
    (dataLayer ? dataLayer.deleteIdea(ideaId) : apiFetch("/ideas/" + ideaId, { method: "DELETE" }))
      .then(function (r) {
        if (r && r.ok === false) throw new Error("Delete failed");
        return refreshCache();
      })
      .catch(function () {});
  }

  /** List view only: show set list + new form, hide detail slab (no showPanel / loadSets — avoids loops with renderSetsList). */
  function syncSetsListChromeVisible() {
    var listEl = getSetListEl();
    var detailEl = getSetDetailEl();
    var newFormEl = getSetsNewFormEl();
    if (detailEl) detailEl.classList.add("hidden");
    window.currentSetId = null;
    var setsPanelChrome = document.getElementById("panel-sets");
    if (setsPanelChrome) revealFolderLayer(setsPanelChrome);
    document.getElementById("panel-sets-list")?.classList.remove("hidden");
    if (listEl) listEl.classList.remove("hidden");
    if (newFormEl) newFormEl.classList.remove("hidden");
  }

  function returnToSetList() {
    var detailEl = getSetDetailEl();
    if (detailEl) {
      detailEl.innerHTML = "";
    }
    window.currentSetId = null;
    showPanel("sets", true);
    syncFolderLayerActiveForTab("sets");
    syncSetsListChromeVisible();
  }

  function renderSetList() {
    returnToSetList();
  }

  function formatSetDetailItemTitle(item) {
    item = item || {};
    if (item.type === "idea") {
      var ti = item.title != null ? String(item.title).trim() : "";
      return ti !== "" ? ti : "Untitled";
    }
    var tit = item.title != null ? String(item.title).trim() : "";
    if (tit !== "") return tit;
    var pr = item.premise != null ? String(item.premise).trim() : "";
    return pr !== "" ? pr : "Untitled";
  }

  /**
   * HTML for set member list: high-density tiles; jokes vs ideas by border and IDEA label.
   */
  function renderSetItems(items, editOrder) {
    items = Array.isArray(items) ? items : [];
    editOrder = !!editOrder;
    if (items.length === 0) {
      return "<p class=\"meta set-list-empty\">No jokes added yet.</p>";
    }
    var jokesHtml = "";
    var removeLabel = "\u2014";
    if (editOrder) {
      jokesHtml = "<ul class=\"set-joke-links set-joke-reorder set-bit-tile-list set-detail-list\">";
      items.forEach(function (item, i) {
        item = item || {};
        var itemTypeRaw = item.type != null ? String(item.type) : "";
        var itemType = itemTypeRaw !== "" ? itemTypeRaw : "joke";
        var isIdea = itemType === "idea";
        var tit = item.title != null ? String(item.title) : "";
        tit = tit.trim();
        var pr = item.premise != null ? String(item.premise) : "";
        pr = pr.trim();
        var titlePlain;
        if (isIdea) {
          titlePlain = tit !== "" ? tit : "Untitled";
        } else {
          titlePlain = tit !== "" ? tit : (pr !== "" ? pr : "Untitled");
        }
        var title = escapeHtml(titlePlain);
        var upDisabled = i === 0 ? " disabled" : "";
        var downDisabled = i === items.length - 1 ? " disabled" : "";
        var itemIdAttr = item.id != null ? String(item.id) : "";
        var tileMod = isIdea ? "set-bit-tile--idea" : "set-bit-tile--joke";
        var ideaTag = isIdea ? "<span class=\"set-bit-type-label\" aria-hidden=\"true\">IDEA</span>" : "";
        jokesHtml += "<li class=\"set-bit-tile set-joke-item " + tileMod + "\" data-item-type=\"" + itemType + "\" data-item-id=\"" + itemIdAttr + "\">" +
          "<span class=\"set-joke-order-btns set-bit-tile-controls\">" +
          "<button type=\"button\" class=\"btn-order btn-order-up\" title=\"Move up\"" + upDisabled + ">↑</button>" +
          "<button type=\"button\" class=\"btn-order btn-order-down\" title=\"Move down\"" + downDisabled + ">↓</button>" +
          "</span>" +
          "<span class=\"set-bit-tile-body\">" + ideaTag + "<span class=\"set-bit-tile-title\">" + title + "</span></span>" +
          "<button type=\"button\" class=\"btn-remove-from-set\" title=\"Remove from set\" data-item-type=\"" + itemType + "\" data-item-id=\"" + itemIdAttr + "\">" + removeLabel + "</button></li>";
      });
      jokesHtml += "</ul>";
    } else {
      jokesHtml = "<ul class=\"set-joke-links set-bit-tile-list set-detail-list\">";
      items.forEach(function (item) {
        item = item || {};
        var itemTypeRaw = item.type != null ? String(item.type) : "";
        var itemType = itemTypeRaw !== "" ? itemTypeRaw : "joke";
        var isIdea = itemType === "idea";
        var tit = item.title != null ? String(item.title) : "";
        tit = tit.trim();
        var pr = item.premise != null ? String(item.premise) : "";
        pr = pr.trim();
        var titlePlain;
        if (isIdea) {
          titlePlain = tit !== "" ? tit : "Untitled";
        } else {
          titlePlain = tit !== "" ? tit : (pr !== "" ? pr : "Untitled");
        }
        var title = escapeHtml(titlePlain);
        var itemIdAttr = item.id != null ? String(item.id) : "";
        var tileMod = isIdea ? "set-bit-tile--idea" : "set-bit-tile--joke";
        var ideaTag = isIdea ? "<span class=\"set-bit-type-label\" aria-hidden=\"true\">IDEA</span>" : "";
        jokesHtml += "<li class=\"set-bit-tile set-joke-item " + tileMod + "\" data-item-type=\"" + itemType + "\" data-item-id=\"" + itemIdAttr + "\">" +
          "<span class=\"set-bit-tile-body\">" + ideaTag + "<span class=\"set-bit-tile-title\">" + title + "</span></span></li>";
      });
      jokesHtml += "</ul>";
    }
    return jokesHtml;
  }

  var activeSetDetailName = "";
  var activeSetDetailItems = [];
  window.activeSetDetailItems = activeSetDetailItems;

  function showEmptySetDetailStageMessage(messageText) {
    var container = document.querySelector("#set-detail-items");
    if (!container) return;
    if (emptyStageMessageTimerId != null) {
      clearTimeout(emptyStageMessageTimerId);
      emptyStageMessageTimerId = null;
    }
    container.innerHTML =
      "<div class=\"empty-stage-message\" style=\"color: #00ffff; text-align: center; margin-top: 60px; font-weight: bold; font-size: 1.1rem; padding: 20px; font-family: 'Courier New', Courier, monospace;\">" +
      escapeHtml(messageText) +
      "</div>";
    emptyStageMessageTimerId = setTimeout(function () {
      emptyStageMessageTimerId = null;
      var c = document.querySelector("#set-detail-items");
      if (!c) return;
      var its = Array.isArray(activeSetDetailItems) ? activeSetDetailItems : [];
      c.innerHTML = renderSetItems(its, !!isEditingSetOrder);
    }, 3000);
  }

  function toggleEditSetOrder() {
    var items = Array.isArray(activeSetDetailItems) ? activeSetDetailItems : [];
    if (items.length === 0) {
      showEmptySetDetailStageMessage("Add some jokes to this set before editing!");
      return;
    }

    try {
      var setDetailEl = getSetDetailEl();
      var isEditMode = !!(setDetailEl && setDetailEl.querySelector("#save-set-order-btn"));

      if (!setDetailEl) {
        return;
      }

      var setIdVal = setDetailEl.dataset.setId;
      var setId = setIdVal != null ? String(setIdVal) : "";
      if (setId === "") {
        return;
      }

      showSetDetail(setId, { editOrder: !isEditMode });

      isEditingSetOrder = !isEditMode;
      window.isEditingSetOrder = isEditingSetOrder;
    } catch (err) {
      console.error("❌ Edit Logic Failed:", err);
    }
  }

  function commitSetDetailOrderSave() {
    var el = getSetDetailEl();
    if (!el) return;
    var reorderRoot = el.querySelector(".set-joke-reorder");
    var setId = el.dataset.setId;
    var btn = el.querySelector("#save-set-order-btn");
    if (!setId || !btn) return;
    if (!reorderRoot) {
      showSetDetail(setId, { editOrder: false });
      return;
    }
    function getSetJokeOrder() {
      var lis = reorderRoot.querySelectorAll(".set-joke-item");
      var ids = [];
      lis.forEach(function (li) {
        var t = li.getAttribute("data-item-type") || "joke";
        if (t !== "joke") return;
        var n = parseInt(li.getAttribute("data-item-id"), 10);
        if (!isNaN(n)) ids.push(n);
      });
      return ids;
    }
    function getSetItemRefs() {
      var lis = reorderRoot.querySelectorAll(".set-joke-item");
      var refs = [];
      lis.forEach(function (li) {
        var t = li.getAttribute("data-item-type") || "joke";
        var id = parseInt(li.getAttribute("data-item-id"), 10);
        if (!isNaN(id)) refs.push({ item_type: t, item_id: id });
      });
      return refs;
    }
    var order = getSetJokeOrder();
    var refs = getSetItemRefs();
    var preferRefs = !!el._setDetailPreferItemRefs;
    var useRefs = preferRefs && dataLayer && dataLayer.reorderSetItems && refs.length > 0;
    if (!useRefs && !order.length) return;
    btn.disabled = true;
    btn.textContent = "Saving…";
    var path = "/sets/" + setId + "/jokes/order";
    var pathGet = path + "?joke_ids=" + encodeURIComponent(order.join(","));
    function handleResponse(r) {
      if (r.ok) {
        showSetDetail(setId);
        return;
      }
      return r.json().catch(function () { return {}; }).then(function (body) {
        var msg = body.error || "Save failed (" + r.status + ")";
        if (r.status === 404) {
          msg += ". Use the app from Flask: run 'python app.py' and open http://localhost:5000 in your browser. If the page is on another port, add ?api=http://localhost:5000 to the URL and reload.";
        }
        throw new Error(msg);
      });
    }
    var p = useRefs
      ? dataLayer.reorderSetItems(setId, refs).then(function (result) { showSetDetail(setId); return result; })
      : (dataLayer
        ? dataLayer.reorderSetJokes(setId, order).then(function (result) { showSetDetail(setId); return result; })
        : apiFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ joke_ids: order }) }).then(function (r) {
            if (r.status === 405 || r.status === 404) return apiFetch(pathGet).then(handleResponse);
            return handleResponse(r);
          }));
    p.catch(function (err) {
      btn.disabled = false;
      btn.textContent = "Save";
      alert(err && err.message ? err.message : "Could not save order. Try again.");
    });
  }

  function startStagetimeMode() {
    try {
      var items = Array.isArray(activeSetDetailItems) ? activeSetDetailItems : [];
      if (items.length === 0) {
        showEmptySetDetailStageMessage("You need a setlist before you can go on stage!");
        return;
      }
      var jokesInSet = items.filter(function (i) {
        if (!i) return false;
        var typ = i.type != null ? String(i.type) : "joke";
        return typ === "joke";
      });
      if (jokesInSet.length === 0) {
        showToast("Add some jokes before entering StageTime mode! 🎤");
        return;
      }
      var setNameVal = activeSetDetailName;
      var setName = setNameVal != null ? String(setNameVal) : "";
      var startMs = Date.now();
      var overlay = document.createElement("div");
      overlay.className = "performance-mode-overlay";
      overlay.setAttribute("aria-hidden", "false");
      var listHtml = "<ul class=\"performance-mode-list\">";
      items.forEach(function (j) {
        j = j || {};
        var val = formatSetDetailItemTitle(j);
        var title = val != null ? String(val) : "";
        var typeVal = j.type;
        var itemType = typeVal != null ? String(typeVal) : "";
        var ideaClass = itemType === "idea" ? " idea-item" : "";
        listHtml += "<li class=\"" + ideaClass + "\">" + escapeHtml(title) + "</li>";
      });
      listHtml += "</ul>";
      overlay.innerHTML =
        "<div class=\"performance-mode-stopwatch\" id=\"performance-mode-stopwatch\">0:00</div>" +
        "<h2 class=\"performance-mode-title\">" + escapeHtml(setName) + "</h2>" +
        listHtml +
        "<p class=\"performance-mode-exit\">Tap below to exit</p>";
      document.body.classList.toggle("stage-lock-active", true);
      isStagetimeMode = true;
      document.body.appendChild(overlay);
      var stopwatchEl = document.getElementById("performance-mode-stopwatch");
      function formatElapsed(ms) {
        var totalSec = Math.floor(ms / 1000);
        var m = Math.floor(totalSec / 60);
        var s = totalSec % 60;
        return m + ":" + (s < 10 ? "0" : "") + s;
      }
      function tick() {
        if (stopwatchEl) stopwatchEl.textContent = formatElapsed(Date.now() - startMs);
      }
      tick();
      var intervalId = setInterval(tick, 1000);
      function closePerformanceMode() {
        clearInterval(intervalId);
        isStagetimeMode = false;
        document.body.classList.toggle("stage-lock-active", false);
        overlay.remove();
      }
      var exitEl = overlay.querySelector(".performance-mode-exit");
      if (exitEl) {
        exitEl.addEventListener("click", function () {
          closePerformanceMode();
        });
      }
    } catch (err) {
      console.error("❌ Stagetime Logic Failed:", err);
    }
  }

  function renderSetDetail(data, items, allJokes, editOrder) {
    data = data || {};
    items = Array.isArray(items) ? items : [];
    allJokes = Array.isArray(allJokes) ? allJokes : [];
    editOrder = !!editOrder;
    var jokesHtml = renderSetItems(items, editOrder);
    var desc = data.set != null ? (data.set.description != null ? String(data.set.description) : "") : "";
    var hasDescription = desc.trim() !== "" && desc.trim().toLowerCase() !== "no description";
    var setTitleVal = data.set != null ? data.set.name : null;
    var setName = setTitleVal != null ? String(setTitleVal) : "";
    var setNameAttr = setName.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    var setJokes = items.filter(function (i) {
      var typRaw = i != null ? (i.type != null ? String(i.type) : "") : "";
      var typ = typRaw !== "" ? typRaw : "joke";
      return typ === "joke";
    });
    var setTimeVal = setJokes.length > 0 ? calculateSetTime(setJokes) : null;
    var setTimeStrSafe = setTimeVal != null ? String(setTimeVal) : "";
    var setTimeMetaInner = setTimeStrSafe.trim() !== ""
      ? ("Set time: " + escapeHtml(setTimeStrSafe))
      : "Set time: —";
    var setTimeMeta = "<span class=\"set-detail-time-meta meta\">" + setTimeMetaInner + "</span>";
    var headerRow = "<div class=\"set-detail-header-row\">" +
      "<input type=\"text\" id=\"set-detail-name-input\" class=\"set-detail-name-input\" maxlength=\"100\" autocomplete=\"off\" aria-label=\"Set name\" value=\"" + setNameAttr + "\">" +
      setTimeMeta +
      "</div>";
    var editBtnIdVal = "edit-set-order-btn";
    var stagetimeBtnIdVal = "stagetime-btn";
    var backBtnIdVal = "set-detail-back-btn";
    var deleteBtnIdVal = "set-detail-delete-btn";
    var saveBtnIdVal = "save-set-order-btn";
    var val = editBtnIdVal;
    var editBtnId = val != null ? String(val) : "";
    val = stagetimeBtnIdVal;
    var stagetimeBtnId = val != null ? String(val) : "";
    val = backBtnIdVal;
    var backBtnId = val != null ? String(val) : "";
    val = deleteBtnIdVal;
    var deleteBtnId = val != null ? String(val) : "";
    val = saveBtnIdVal;
    var saveBtnId = val != null ? String(val) : "";
    var editLabelVal = "Edit";
    var stagetimeLabelVal = "Stagetime";
    var backLabelVal = "\u2190 Back";
    var deleteLabelVal = "Delete";
    var saveLabelVal = "Save";
    val = editLabelVal;
    var editLabel = val != null ? String(val) : "";
    val = stagetimeLabelVal;
    var stagetimeLabel = val != null ? String(val) : "";
    val = backLabelVal;
    var backLabel = val != null ? String(val) : "";
    val = deleteLabelVal;
    var deleteLabel = val != null ? String(val) : "";
    val = saveLabelVal;
    var saveLabel = val != null ? String(val) : "";
    var hasItems = items.length > 0;
    var primaryDisabledAttr = hasItems ? "" : " disabled";
    var ribbonPrimaryHtml = "";
    if (editOrder) {
      ribbonPrimaryHtml =
        "<button type=\"button\" id=\"" + saveBtnId + "\" data-btn-id=\"" + saveBtnId + "\" data-action=\"save-set\" class=\"slab-button set-detail-save-order-btn set-detail-ribbon-btn\"" + primaryDisabledAttr + ">" + escapeHtml(saveLabel) + "</button>" +
        "<button type=\"button\" onclick=\"startStagetime()\" id=\"" + stagetimeBtnId + "\" data-btn-id=\"" + stagetimeBtnId + "\" data-action=\"start-stage\" class=\"btn-stagetime btn-primary btn-lift set-detail-stagetime-btn set-detail-ribbon-btn\">" + escapeHtml(stagetimeLabel) + "</button>";
    } else {
      ribbonPrimaryHtml =
        "<button type=\"button\" onclick=\"toggleEditSetOrder()\" id=\"" + editBtnId + "\" data-btn-id=\"" + editBtnId + "\" data-action=\"edit-set\" class=\"slab-button set-detail-edit-btn set-detail-ribbon-btn\">" + escapeHtml(editLabel) + "</button>" +
        "<button type=\"button\" onclick=\"startStagetime()\" id=\"" + stagetimeBtnId + "\" data-btn-id=\"" + stagetimeBtnId + "\" data-action=\"start-stage\" class=\"btn-stagetime btn-primary btn-lift set-detail-stagetime-btn set-detail-ribbon-btn\">" + escapeHtml(stagetimeLabel) + "</button>";
    }
    var jokeOptions = allJokes.map(function (j) {
      j = j || {};
      var idVal = j.id != null ? String(j.id) : "";
      var t = j.title != null ? String(j.title) : "";
      var p = j.premise != null ? String(j.premise) : "";
      var label = t.trim() !== "" ? t : (p.trim() !== "" ? p : "Untitled");
      return "<option value=\"" + idVal + "\">" + escapeHtml(label) + "</option>";
    }).join("");
    var addConsoleHtml = "<div class=\"add-to-set add-bit-pull set-detail-add-console\">" +
      "<div class=\"set-detail-add-console-row set-detail-add-console-oneline\">" +
      "<input type=\"search\" id=\"set-detail-joke-search\" class=\"set-detail-console-search\" placeholder=\"Search to filter dropdown options\" autocomplete=\"off\" aria-label=\"Filter jokes for dropdown\">" +
      "<select id=\"add-to-set-joke-select\" class=\"set-detail-console-select\" aria-label=\"Choose joke\"><option value=\"\">Choose a joke…</option>" +
      jokeOptions +
      "</select>" +
      "<button type=\"button\" id=\"add-to-set-btn\" class=\"slab-button set-detail-add-btn\" aria-label=\"Add selected joke to set\">+</button>" +
      "</div></div>";
    var ribbonHtml = "<div class=\"joke-master-footer ribbon set-detail-bottom-ribbon\">" +
      "<div class=\"joke-master-ribbon-row\">" +
      "<div class=\"joke-master-ribbon-actions\">" + ribbonPrimaryHtml + "</div>" +
      "<div class=\"ribbon-right-group\">" +
      "<button type=\"button\" id=\"" + backBtnId + "\" data-btn-id=\"" + backBtnId + "\" data-action=\"back\" class=\"slab-button detail-back-btn set-detail-ribbon-btn\">" + escapeHtml(backLabel) + "</button>" +
      "<button type=\"button\" id=\"" + deleteBtnId + "\" data-btn-id=\"" + deleteBtnId + "\" data-action=\"delete-set\" class=\"slab-button btn-delete-inline set-detail-ribbon-btn\">" + escapeHtml(deleteLabel) + "</button>" +
      "</div></div></div>";
    return "<div class=\"modal-detail-shell modal-detail-set set-detail-view detail-layout\">" +
      "<div class=\"set-detail-top-rail\">" +
      headerRow +
      (hasDescription ? "<p class=\"meta set-detail-desc-meta\">" + escapeHtml(desc) + "</p>" : "") +
      "</div>" +
      "<div class=\"set-detail-list-container set-list-section\" id=\"set-detail-items\">" +
      jokesHtml +
      "</div>" +
      "<div class=\"set-detail-bottom-dock\">" +
      addConsoleHtml +
      ribbonHtml +
      "</div>" +
      "</div>";
  }

  function showSetDetail(id, opts) {
    showPanel("sets", false);
    document.getElementById("panel-sets")?.classList.add("hidden");
    syncFolderLayerActiveForTab("sets");
    var editOrder = opts && opts.editOrder === true;
    var setP = dataLayer && dataLayer.getSetWithItems
      ? dataLayer.getSetWithItems(id)
      : (dataLayer ? dataLayer.getSetWithJokes(id) : apiFetch("/sets/" + id).then(function (r) { if (!r.ok) throw new Error("Set not found"); return r.json(); }));
    var jokesP = dataLayer ? dataLayer.listJokes() : apiFetch("/jokes").then(function (r) { if (!r.ok) throw new Error("Jokes not found"); return r.json(); });
    Promise.all([setP, jokesP]).then(function (results) {
        var data = results[0];
        var jokesRaw = results[1];
        var allJokes = Array.isArray(jokesRaw)
          ? jokesRaw.filter(function (j) {
              var typRaw = j != null && j.type != null ? String(j.type) : "";
              var typ = typRaw !== "" ? typRaw : "joke";
              return typ === "joke";
            })
          : [];
        return { setData: data, allJokes: allJokes, useItems: !!(data && data.items) };
      })
      .then(function (payload) {
        var data = payload.setData;
        var allJokes = payload.allJokes || [];
        var useItems = payload.useItems && data.items;
        var items = useItems ? data.items : (data.jokes || []).map(function (j) { return Object.assign({ type: "joke" }, j); });
        var activeTitleVal = data && data.set != null ? data.set.name : null;
        activeSetDetailName = activeTitleVal != null ? String(activeTitleVal) : "";
        activeSetDetailItems = Array.isArray(items) ? items.slice() : [];
        window.activeSetDetailItems = activeSetDetailItems;
        var el = getSetDetailEl();
        el.classList.remove("hidden");
        revealFolderLayer(el);
        el.dataset.setId = id != null ? String(id) : "";
        window.currentSetId = id;
        el._setDetailPreferItemRefs = !!(payload.useItems && data.items != null);
        el._pullJokesTableOnly = allJokes.slice();

        if (emptyStageMessageTimerId != null) {
          clearTimeout(emptyStageMessageTimerId);
          emptyStageMessageTimerId = null;
        }

        el.innerHTML = renderSetDetail(data, items, allJokes, editOrder);
        isEditingSetOrder = !!editOrder;
        window.isEditingSetOrder = isEditingSetOrder;
        var nameInputEl = el.querySelector("#set-detail-name-input");
        if (nameInputEl) {
          var origNameVal = data.set != null ? data.set.name : null;
          var origNameSnap = origNameVal != null ? String(origNameVal) : "";
          nameInputEl.addEventListener("blur", function () {
            var v = nameInputEl.value != null ? String(nameInputEl.value).trim() : "";
            if (v === "") {
              nameInputEl.value = origNameSnap;
              return;
            }
            if (v === origNameSnap) return;
            var sidRaw = getSetDetailEl().dataset.setId;
            var sid = sidRaw != null ? String(sidRaw) : "";
            if (!sid) return;
            if (dataLayer && typeof dataLayer.updateSet === "function") {
              dataLayer.updateSet(sid, { name: v }).then(function () {
                showSetDetail(sid);
                loadSets();
              }).catch(function () {
                nameInputEl.value = origNameSnap;
              });
            }
          });
        }
        function removeBitFromSet(setId, itemType, bitId) {
          var safeSetId = setId != null ? String(setId) : "";
          var safeItemTypeRaw = itemType != null ? String(itemType) : "";
          var safeItemType = safeItemTypeRaw !== "" ? safeItemTypeRaw : "joke";
          var safeBitId = bitId != null ? String(bitId) : "";
          if (safeSetId === "" || safeBitId === "") return;

          var setDetailEl = getSetDetailEl();
          if (!setDetailEl) return;

          var bitTile = null;
          var tiles = setDetailEl.querySelectorAll(".set-joke-item");
          tiles.forEach(function (tile) {
            if (bitTile) return;
            var tileIdRaw = tile.getAttribute("data-item-id");
            var tileId = tileIdRaw != null ? String(tileIdRaw) : "";
            var tileTypeRaw = tile.getAttribute("data-item-type");
            var tileType = tileTypeRaw != null ? String(tileTypeRaw) : "joke";
            if (tileId === safeBitId && tileType === safeItemType) {
              bitTile = tile;
            }
          });
          if (bitTile) bitTile.remove();

          items = items.filter(function (item) {
            var idVal = item != null && item.id != null ? String(item.id) : "";
            var typeRaw = item != null && item.type != null ? String(item.type) : "";
            var typeVal = typeRaw !== "" ? typeRaw : "joke";
            return !(idVal === safeBitId && typeVal === safeItemType);
          });

          var setTimeEl = setDetailEl.querySelector(".set-detail-time-meta");
          if (setTimeEl) {
            var jokesOnly = items.filter(function (it) {
              var typRaw = it != null && it.type != null ? String(it.type) : "";
              var typ = typRaw !== "" ? typRaw : "joke";
              return typ === "joke";
            });
            var nextTimeVal = jokesOnly.length > 0 ? calculateSetTime(jokesOnly) : null;
            var nextTimeStr = nextTimeVal != null ? String(nextTimeVal) : "";
            setTimeEl.textContent = nextTimeStr.trim() !== "" ? ("Set time: " + nextTimeStr) : "Set time: —";
          }

          var removeP = dataLayer && dataLayer.removeItemFromSet
            ? dataLayer.removeItemFromSet(safeSetId, safeItemType, safeBitId)
            : Promise.reject(new Error("Remove from set not available"));
          removeP.catch(function () {
            alert("Could not remove from set.");
            showSetDetail(safeSetId, { editOrder: true });
          });
        }

        el.querySelectorAll(".btn-remove-from-set").forEach(function (btn) {
          btn.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            var setId = getSetDetailEl().dataset.setId;
            var itemTypeAttr = btn.getAttribute("data-item-type");
            var itemTypeRaw = itemTypeAttr != null ? String(itemTypeAttr) : "";
            var itemType = itemTypeRaw !== "" ? itemTypeRaw : "joke";
            var itemIdAttr = btn.getAttribute("data-item-id");
            var itemId = itemIdAttr != null ? String(itemIdAttr) : "";
            removeBitFromSet(setId, itemType, itemId);
          });
        });

        if (editOrder) {
          var listEl = el.querySelector(".set-joke-reorder");
          if (listEl) {
            function updateArrowStates() {
              var items = listEl.querySelectorAll(".set-joke-item");
              items.forEach(function (item, i) {
                var upBtn = item.querySelector(".btn-order-up");
                var downBtn = item.querySelector(".btn-order-down");
                if (upBtn) upBtn.disabled = i === 0;
                if (downBtn) downBtn.disabled = i === items.length - 1;
              });
            }
            listEl.querySelectorAll(".btn-order-up").forEach(function (btn) {
              btn.addEventListener("click", function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (btn.disabled) return;
                var item = btn.closest(".set-joke-item");
                if (!item) return;
                var allItems = listEl.querySelectorAll(".set-joke-item");
                var idx = Array.prototype.indexOf.call(allItems, item);
                if (idx <= 0) return;
                var prevLi = allItems[idx - 1];
                if (prevLi) listEl.insertBefore(item, prevLi);
                updateArrowStates();
              });
            });
            listEl.querySelectorAll(".btn-order-down").forEach(function (btn) {
              btn.addEventListener("click", function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (btn.disabled) return;
                var item = btn.closest(".set-joke-item");
                if (!item) return;
                var allItems = listEl.querySelectorAll(".set-joke-item");
                var idx = Array.prototype.indexOf.call(allItems, item);
                if (idx < 0 || idx >= allItems.length - 1) return;
                var nextLi = allItems[idx + 1];
                if (nextLi && nextLi.nextSibling) {
                  listEl.insertBefore(item, nextLi.nextSibling);
                } else {
                  listEl.appendChild(item);
                }
                updateArrowStates();
              });
            });
          }
        }

        function populateAddBitPullSelect(jokesTableOnly, searchQuery) {
          var select = document.getElementById("add-to-set-joke-select");
          if (!select || !Array.isArray(jokesTableOnly)) return;
          var qRaw = searchQuery != null ? String(searchQuery) : "";
          var q = qRaw.trim().toLowerCase();
          var jokes = jokesTableOnly.filter(function (j) {
            j = j || {};
            var typeRaw = j.type != null ? String(j.type) : "";
            var typ = typeRaw !== "" ? typeRaw : "joke";
            if (typ !== "joke") return false;
            if (!q) return true;
            var t = (j.title != null ? String(j.title) : "").toLowerCase();
            var p = (j.premise != null ? String(j.premise) : "").toLowerCase();
            return t.indexOf(q) >= 0 || p.indexOf(q) >= 0;
          });
          var currentVal = select.value;
          select.innerHTML = "<option value=\"\">Choose a joke…</option>";
          jokes.forEach(function (j) {
            var opt = document.createElement("option");
            opt.value = j.id != null ? String(j.id) : "";
            var t = j.title != null ? String(j.title) : "";
            var p = j.premise != null ? String(j.premise) : "";
            var label = t.trim() !== "" ? t : (p.trim() !== "" ? p : "Untitled");
            opt.textContent = label;
            select.appendChild(opt);
          });
          if (currentVal && jokes.some(function (j) { return String(j.id) === String(currentVal); })) {
            select.value = currentVal;
          }
        }

        function refreshSetDetailJokeDropdown() {
          var detail = getSetDetailEl();
          var searchEl = document.getElementById("set-detail-joke-search");
          var q = searchEl && searchEl.value != null ? String(searchEl.value) : "";
          (dataLayer ? dataLayer.listJokes() : apiFetch("/jokes").then(function (r) { return r.json(); })).then(function (list) {
            var jokes = Array.isArray(list)
              ? list.filter(function (j) {
                  j = j || {};
                  var typeRaw = j.type != null ? String(j.type) : "";
                  var typ = typeRaw !== "" ? typeRaw : "joke";
                  return typ === "joke";
                })
              : [];
            if (detail) detail._pullJokesTableOnly = jokes;
            populateAddBitPullSelect(jokes, q);
          });
        }
        var jokeSelectEl = document.getElementById("add-to-set-joke-select");
        var setDetailJokeSearchEl = document.getElementById("set-detail-joke-search");
        if (setDetailJokeSearchEl) {
          setDetailJokeSearchEl.addEventListener("input", function () {
            var detail = getSetDetailEl();
            var src = (detail && detail._pullJokesTableOnly) || allJokes || [];
            populateAddBitPullSelect(src, setDetailJokeSearchEl.value);
          });
        }
        if (jokeSelectEl) {
          jokeSelectEl.addEventListener("focus", refreshSetDetailJokeDropdown);
          jokeSelectEl.addEventListener("click", refreshSetDetailJokeDropdown);
          refreshSetDetailJokeDropdown();
        }
        el.querySelector("#add-to-set-btn").addEventListener("click", function () {
          var select = document.getElementById("add-to-set-joke-select");
          var jokeId = select.value;
          if (!jokeId) return;
          var setId = getSetDetailEl().dataset.setId;
          var position = items.length;
          (dataLayer ? dataLayer.addJokeToSet(setId, parseInt(jokeId, 10), position) : apiFetch("/sets/" + setId + "/jokes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ joke_id: parseInt(jokeId, 10), position: position }) }))
            .then(function (r) {
              if (r && r.ok === false) throw new Error("Add failed");
              showSetDetail(setId);
            })
            .catch(function () {});
        });
      });
  }

  function escapeHtml(s) {
    if (s == null) return "";
    var div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  /** High-fidelity read row: fixed label + bordered value. */
  function hfDetailRow(labelUpper, rawText) {
    var display = rawText == null || String(rawText).trim() === "" ? "—" : String(rawText);
    return "<div class=\"detail-field-row\">" +
      "<span class=\"detail-field-label\">" + labelUpper + "</span>" +
      "<div class=\"detail-field-value\">" + escapeHtml(display) + "</div></div>";
  }

  function initJokesModalDelegation() {
    var modal = getJokesPanelEl();
    if (!modal) return;
    modal.addEventListener("click", function (e) {
      var target = e.target;
      var actionEl = target.closest("[data-action]");
      var action = actionEl ? actionEl.getAttribute("data-action") : null;
      if (action === "open-set-picker") {
        e.preventDefault();
        e.stopPropagation();
        var itemId = parseInt(actionEl.getAttribute("data-item-id"), 10);
        var itemType = actionEl.getAttribute("data-item-type") || "joke";
        if (!isNaN(itemId)) openSetPicker(itemId, itemType);
        return;
      }
      if (action === "view-detail") {
        var card = target.closest(".joke-item");
        if (card && card.dataset.id) {
          getJokeListEl().querySelectorAll(".joke-item").forEach(function (x) { x.classList.remove("active"); });
          card.classList.add("active");
          showJokeDetail(card.dataset.id);
        }
        return;
      }
      if (target.id === "joke-back-btn" || target.id === "joke-detail-back-btn" || (target.classList.contains("detail-back-btn") && getJokeDetailEl() && getJokeDetailEl().contains(target))) {
        var detailElBack = getJokeDetailEl();
        if (detailElBack && detailElBack._returnToJokeList) detailElBack._returnToJokeList();
        return;
      }
      if (target.closest("[data-action=\"open-set-picker\"]")) return;
      var card = target.closest("#joke-list .joke-item");
      if (card && card.dataset.id) {
        getJokeListEl().querySelectorAll(".joke-item").forEach(function (x) { x.classList.remove("active"); });
        card.classList.add("active");
        showJokeDetail(card.dataset.id);
      }
    });
  }

  function initSetsPanelDelegation() {
    var panel = document.getElementById("panel-sets");
    if (!panel) return;
    panel.addEventListener("click", function (e) {
      var target = e.target;
      var actionEl = target.closest("[data-action]");
      var action = actionEl ? actionEl.getAttribute("data-action") : null;
      if (action === "view-set-detail") {
        var card = target.closest(".set-item");
        if (card && card.dataset.id) {
          getSetListEl().querySelectorAll(".set-item").forEach(function (x) { x.classList.remove("active"); });
          card.classList.add("active");
          showSetDetail(card.dataset.id);
        }
      }
    });
  }

  var createSetBtn = document.getElementById("create-set");
  if (createSetBtn) {
    createSetBtn.addEventListener("click", function () {
      var newSetNameEl = document.getElementById("new-set-name");
      var newSetDescEl = document.getElementById("new-set-desc");
      var name = newSetNameEl ? newSetNameEl.value.trim() : "";
      var desc = newSetDescEl ? newSetDescEl.value.trim() : "";
      if (!name) return;
      (dataLayer ? dataLayer.createSet(name, desc) : apiFetch("/sets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name, description: desc }) }).then(function (r) { if (!r.ok) throw new Error("Create failed"); return r.json(); }))
        .then(function () {
          if (newSetNameEl) newSetNameEl.value = "";
          if (newSetDescEl) newSetDescEl.value = "";
          loadSets();
        })
        .catch(function () {});
    });
  }

  var STAGETIME_LAST_OPEN_KEY = "stagetime_last_open";
  var FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

  function checkStorageNotice() {
    try {
      var last = parseInt(localStorage.getItem(STAGETIME_LAST_OPEN_KEY) || "0", 10);
      var now = Date.now();
      localStorage.setItem(STAGETIME_LAST_OPEN_KEY, String(now));
      if (last && (now - last) >= FIVE_DAYS_MS) {
        var el = document.getElementById("storage-notice");
        if (el) el.classList.remove("hidden");
      }
    } catch (e) {}
  }

  function initStorageNoticeDismiss() {
    var btn = document.getElementById("storage-notice-dismiss");
    var el = document.getElementById("storage-notice");
    if (btn && el) {
      btn.addEventListener("click", function () { el.classList.add("hidden"); });
    }
  }

  function syncOnOnline() {
    if (!dataLayer) return;
    refreshCache()
      .catch(function () {})
      .then(function () {
        loadSets();
      });
  }

  function initApp() {
    var pickerKick = document.getElementById("settings-accent-color");
    try {
      if (pickerKick && !localStorage.getItem(STAGETIME_ACCENT_KEY)) {
        pickerKick.value = "#00f2ff";
        setAccentColor("#00f2ff");
      }
    } catch (eKick) {}
    initStorageNoticeDismiss();
    checkStorageNotice();
    window.addEventListener("online", syncOnOnline);
    document.querySelectorAll(".tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var tab = btn.getAttribute("data-tab");
        openModal(tab);
        if (tab === "ideas") {
          returnToIdeaList();
          loadIdeas();
          fillDatalists();
        }
        if (tab === "sets") returnToSetList();
        if (tab === "settings") showSettingsView("dashboard");
      });
    });
    var ideasWorkstation = document.getElementById("ideas-workstation") || document.getElementById("panel-ideas");
    var ideaSearchInput = ideasWorkstation
      ? ideasWorkstation.querySelector("#idea-search-input")
      : document.getElementById("idea-search-input");
    if (ideaSearchInput && ideaSearchInput.dataset.deepSearchBound !== "1") {
      ideaSearchInput.dataset.deepSearchBound = "1";
      ideaSearchInput.addEventListener("keydown", function (e) {
        var target = e && e.target ? e.target : null;
        var tag = target && target.tagName ? String(target.tagName).toUpperCase() : "";
        if (tag === "INPUT" || tag === "TEXTAREA") {
          e.stopPropagation();
          return;
        }
      });
      ideaSearchInput.addEventListener("input", function (e) {
        var target = e && e.target ? e.target : null;
        renderIdeas(target ? target.value : "");
      });
    }
    var ideaBackToListBtn = document.getElementById("idea-back-to-list-btn");
    if (ideaBackToListBtn) ideaBackToListBtn.addEventListener("click", function () {
      returnToIdeaList();
    });
    var btnImportExport = document.getElementById("settings-btn-import-export");
    if (btnImportExport) btnImportExport.addEventListener("click", function () { showSettingsView("import-export"); });
    var backImportExport = document.getElementById("settings-back-from-import-export");
    if (backImportExport) backImportExport.addEventListener("click", function () { showSettingsView("dashboard"); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      var setDetailEl = getSetDetailEl();
      if (!setDetailEl || setDetailEl.classList.contains("hidden")) return;
      var setId = setDetailEl.dataset.setId;
      if (!setId) return;
      var setsPanel = document.getElementById("panel-sets");
      if (!setsPanel || setsPanel.classList.contains("hidden")) return;
      showSetDetail(setId);
    });
    refreshCache()
      .catch(function () {})
      .then(function () {
        loadSets();
      });
    initModals();
    initJokesModalDelegation();
    initJokesFolderChrome();
    initSetsPanelDelegation();
    fillDatalists();
    // Default to dashboard on load.
    showPanel("panel-dashboard");
  }

  /**
   * Normalize ids, skip duplicates, persist via Dexie (or joke API fallback), then refresh lists.
   * Signature: (setId, itemId, itemType) — itemType "joke" | "idea".
   */
  function addItemToSetUnified(setId, itemId, itemType) {
    var sid = parseInt(String(setId).trim(), 10);
    var iid = parseInt(String(itemId).trim(), 10);
    var typeNorm = itemType === "idea" ? "idea" : "joke";
    if (isNaN(sid) || isNaN(iid) || sid < 1 || iid < 1) {
      return Promise.reject(new Error("Invalid set or item id"));
    }
    function syncUI() {
      if (typeof window.loadSets === "function") window.loadSets();
      if (typeof window.loadJokes === "function") window.loadJokes();
      if (typeof window.loadIdeas === "function") window.loadIdeas();
    }
    if (dataLayer && dataLayer.getSetWithItems && dataLayer.addItemToSet) {
      return dataLayer.getSetWithItems(sid).then(function (d) {
        if (!d || !d.set) return Promise.reject(new Error("Set not found"));
        var items = Array.isArray(d.items) ? d.items : [];
        var dup = items.some(function (it) {
          return Number(it.id) === iid && (it.type || "joke") === typeNorm;
        });
        if (dup) {
          syncUI();
          return { skipped: true, duplicate: true };
        }
        var pos = items.length;
        return dataLayer.addItemToSet(sid, typeNorm, iid, pos);
      }).then(function (res) {
        syncUI();
        return res;
      });
    }
    if (typeNorm === "joke" && dataLayer && dataLayer.getSetWithJokes && dataLayer.addJokeToSet) {
      return dataLayer.getSetWithJokes(sid).then(function (setData) {
        var jokes = (setData && setData.jokes) || [];
        if (jokes.some(function (j) { return Number(j.id) === iid; })) {
          syncUI();
          return { skipped: true, duplicate: true };
        }
        return dataLayer.addJokeToSet(sid, iid, jokes.length);
      }).then(function (res) {
        syncUI();
        return res;
      });
    }
    if (typeNorm === "joke") {
      return apiFetch("/sets/" + sid)
        .then(function (r) {
          if (!r.ok) throw new Error("Set not found");
          return r.json();
        })
        .then(function (setData) {
          var jokes = (setData && setData.jokes) || [];
          if (jokes.some(function (j) { return Number(j.id) === iid; })) {
            syncUI();
            return { skipped: true, duplicate: true };
          }
          return apiFetch("/sets/" + sid + "/jokes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ joke_id: iid, position: jokes.length })
          });
        })
        .then(function (r) {
          if (r && r.ok === false) throw new Error("Add failed");
          syncUI();
          return r;
        });
    }
    return Promise.reject(new Error("Cannot add idea to set without local storage"));
  }

  function closeSetPickerModal() {
    var m = document.getElementById("set-picker-modal");
    if (m) {
      m.classList.add("hidden");
      m.style.removeProperty("display");
    }
  }

  function ensureSetPickerModal() {
    var el = document.getElementById("set-picker-modal");
    if (!el) {
      el = document.createElement("div");
      el.id = "set-picker-modal";
      el.className = "hidden";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "true");
      el.setAttribute("aria-label", "Select a set");
      el.innerHTML =
        "<div id=\"set-picker-overlay\" aria-hidden=\"true\"></div>" +
        "<div class=\"workstation-card workstation-picker-panel\">" +
        "<h3 class=\"workstation-picker-title\">Select a Set</h3>" +
        "<div id=\"set-options-list\" class=\"set-options-list\"></div>" +
        "<button type=\"button\" id=\"set-picker-close-btn\" class=\"btn-primary btn-lift set-picker-close\">Close</button>" +
        "</div>";
      document.body.appendChild(el);
    }
    if (!el.dataset.setPickerWired) {
      el.dataset.setPickerWired = "1";
      var closeBtn = el.querySelector("#set-picker-close-btn");
      var overlay = document.getElementById("set-picker-overlay");
      if (closeBtn) {
        closeBtn.addEventListener("click", function (e) {
          e.preventDefault();
          closeSetPickerModal();
        });
      }
      if (overlay) {
        overlay.addEventListener("click", function (e) {
          e.preventDefault();
          closeSetPickerModal();
        });
      }
    }
    return el;
  }

  function openSetPicker(itemId, itemType) {
    var iid = parseInt(String(itemId), 10);
    if (isNaN(iid)) return;
    var typeNorm = itemType === "joke" ? "joke" : "idea";
    var modal = ensureSetPickerModal();
    if (!modal) return;
    var mc = document.getElementById("modal-container");
    if (mc) {
      mc.style.removeProperty("z-index");
      mc.style.removeProperty("Z-index");
    }
    var listEl = modal.querySelector("#set-options-list");
    if (!listEl) return;
    modal.dataset.pickerItemId = String(iid);
    modal.dataset.pickerItemType = typeNorm;
    listEl.innerHTML = "<p class=\"meta set-picker-loading\">Loading sets.</p>";
    modal.classList.remove("hidden");
    modal.style.removeProperty("display");
    var listSetsP = dataLayer && dataLayer.listSets ? dataLayer.listSets() : Promise.resolve([]);
    listSetsP.then(function (sets) {
      listEl.innerHTML = "";
      if (!sets || sets.length === 0) {
        var empty = document.createElement("p");
        empty.className = "meta";
        empty.textContent = "No sets found. Create one in the Sets panel first.";
        listEl.appendChild(empty);
        return;
      }
      sets.forEach(function (s) {
        var row = document.createElement("button");
        row.type = "button";
        row.className = "set-selection-row";
        var setPickerName = s.name != null ? String(s.name).trim() : "";
        row.textContent = setPickerName !== "" ? setPickerName : "Untitled";
        row.setAttribute("data-set-id", s.id != null ? String(s.id) : "");
        row.addEventListener("click", function (e) {
          e.preventDefault();
          var sid = row.getAttribute("data-set-id");
          if (typeof window.addItemToSet === "function") {
            window
              .addItemToSet(sid, modal.dataset.pickerItemId, modal.dataset.pickerItemType)
              .then(function () {
                closeSetPickerModal();
              })
              .catch(function () {});
          }
        });
        listEl.appendChild(row);
      });
    }).catch(function () {
      listEl.innerHTML = "<p class=\"meta\">Could not load sets.</p>";
    });
  }

  var openSetSelectionModal = openSetPicker;

  function openAddIdeaToSetModal(ideaId) {
    openSetPicker(ideaId, "idea");
  }

  function initModals() {
    var ideaModalBackdrop = document.getElementById("modal-container");
    /* Enable click-outside-to-close for quick discard/exit behavior. */
    if (ideaModalBackdrop && !ideaModalBackdrop.dataset.backdropCloseWired) {
      ideaModalBackdrop.dataset.backdropCloseWired = "1";
      ideaModalBackdrop.addEventListener("click", function (e) {
        if (e.target === ideaModalBackdrop && !ideaModalBackdrop.classList.contains("is-detail-view")) closeModal();
      });
    }
    /* Idea detail DOM is rebuilt per open; delegate to #modal-container or #panel-ideas (in-panel #idea-detail). */
    var ideaActionShell = ideaModalBackdrop || document.getElementById("panel-ideas");
    if (ideaActionShell && !ideaActionShell.dataset.ideaActionsDelegated) {
      ideaActionShell.dataset.ideaActionsDelegated = "1";
      ideaActionShell.addEventListener("keydown", function (e) {
        var valueBtn = e.target && e.target.closest ? e.target.closest(".idea-detail-value[data-action=\"edit-idea-field\"]") : null;
        if (!valueBtn || !ideaActionShell.contains(valueBtn)) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openIdeaFieldEditor(ideaActionShell, valueBtn.getAttribute("data-field"));
        }
      });
      ideaActionShell.addEventListener("click", function (e) {
        var btn = e.target && e.target.closest ? e.target.closest("button") : null;
        var valueBtn = e.target && e.target.closest ? e.target.closest(".idea-detail-value[data-action=\"edit-idea-field\"]") : null;
        if (valueBtn && ideaActionShell.contains(valueBtn)) {
          openIdeaFieldEditor(ideaActionShell, valueBtn.getAttribute("data-field"));
          return;
        }
        if (!btn || !ideaActionShell.contains(btn)) return;
        if (btn.id === "idea-detail-btn-convert") {
          var curCv = ideaActionShell._currentIdea;
          if (!curCv || curCv.id == null) return;
          var convBtn = btn;
          convBtn.disabled = true;
          convertToJoke(curCv.id)
            .catch(function () {
              showToast("Could not convert idea.", "#8b0000");
            })
            .then(function () {
              convBtn.disabled = false;
            });
          return;
        }
        if (btn.getAttribute("data-action") === "update-idea-field") {
          var idea = ideaActionShell._currentIdea;
          if (!idea) return;
          var field = btn.getAttribute("data-field");
          if (!field) return;
          var row = btn.closest(".idea-detail-field");
          var inputEl = row ? row.querySelector('.idea-detail-input[data-field="' + field + '"]') : null;
          if (!inputEl) return;
          var parsedValue = normalizeIdeaFieldValue(field, inputEl.value);
          if (field === "title" && !parsedValue) return;
          var payload = {};
          payload[field] = parsedValue;
          var originalText = btn.textContent;
          btn.disabled = true;
          btn.textContent = "Saving...";
          (dataLayer ? dataLayer.updateIdea(idea.id, payload) : apiFetch("/ideas/" + idea.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then(function (r) { if (!r.ok) throw new Error("Update failed"); return r.json(); }))
            .then(function (updated) {
              if (updated) {
                idea.title = updated.title != null ? updated.title : idea.title;
                idea.content = updated.content != null ? updated.content : idea.content;
                idea.topic = updated.topic != null ? updated.topic : idea.topic;
                idea.tags = Array.isArray(updated.tags) ? updated.tags : idea.tags;
              } else {
                idea[field] = parsedValue;
              }
              ideaActionShell._currentIdea = idea;
              var titleEl = ideaActionShell.querySelector("#modal-idea-title");
              if (titleEl) titleEl.textContent = formatIdeaFieldDisplayValue(idea, "title");
              setIdeasPanelTitle(formatIdeaFieldDisplayValue(idea, "title"));
              var displayEl = row ? row.querySelector(".idea-detail-value") : null;
              if (displayEl) displayEl.textContent = formatIdeaFieldDisplayValue(idea, field);
              btn.textContent = "Saved! ✓";
              btn.classList.add("btn-save-success");
              window.setTimeout(function () {
                btn.disabled = false;
                btn.textContent = originalText || "Update";
                btn.classList.remove("btn-save-success");
                closeIdeaFieldEditor(ideaActionShell, field);
              }, 1200);
              var listLi = getIdeaListEl() && getIdeaListEl().querySelector(".idea-item[data-id=\"" + String(idea.id) + "\"]");
              if (listLi) {
                var titleSpan = listLi.querySelector(".idea-title");
                if (titleSpan) titleSpan.textContent = idea.title != null ? idea.title : "";
                var cardBody = listLi.querySelector(".idea-card-body");
                var hasContent = idea.content != null && String(idea.content).trim() !== "";
                if (cardBody && !hasContent) cardBody.remove();
                else if (cardBody) cardBody.textContent = idea.content;
                else if (hasContent) {
                  var newBody = document.createElement("div");
                  newBody.className = "idea-card-body";
                  newBody.textContent = idea.content;
                  var tagsDiv = listLi.querySelector(".idea-card-tags");
                  if (tagsDiv) listLi.insertBefore(newBody, tagsDiv);
                  else listLi.appendChild(newBody);
                }
              }
              loadIdeas();
            })
            .catch(function () {
              btn.disabled = false;
              btn.textContent = originalText || "Update";
            });
        }
      });
    }
  }

  function fillTopicSelect(selectEl, selectedValue) {
    if (!selectEl || !dataLayer || !dataLayer.getMasterTopics) return Promise.resolve();
    return dataLayer.getMasterTopics().then(function (topics) {
      selectEl.innerHTML = "<option value=\"\">—</option>";
      (topics || []).forEach(function (t) {
        var opt = document.createElement("option");
        opt.value = t;
        opt.textContent = escapeHtml(t);
        selectEl.appendChild(opt);
      });
      selectEl.value = selectedValue != null && selectedValue !== "" ? selectedValue : "";
    });
  }

  function fillDatalists() {
    if (Array.isArray(_cache) && _cache.length > 0) {
      updateGlobalTagDatalistFromCache();
      return;
    }
    var tagDl = document.getElementById("tag-datalist");
    if (!dataLayer) return;
    if (tagDl && dataLayer.getAllTags) {
      dataLayer.getAllTags().then(function (tags) {
        tagDl.innerHTML = "";
        (tags || []).forEach(function (t) {
          var opt = document.createElement("option");
          opt.value = t;
          tagDl.appendChild(opt);
        });
      });
    }
  }

  // Topics management removed (legacy cleanup).

  function showAuthError(msg) {
    var el = document.getElementById("auth-error");
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  function hideAuthError() {
    document.getElementById("auth-error").classList.add("hidden");
  }

  function getStorageMode() {
    if (dataLayer && dataLayer.getStorageMode) return dataLayer.getStorageMode();
    try {
      var m = localStorage.getItem("stagetime_storage");
      return (m === "local" || m === "server") ? m : "server";
    } catch (e) { return "server"; }
  }

  function setStorageMode(mode) {
    if (dataLayer && dataLayer.setStorageMode) {
      dataLayer.setStorageMode(mode);
    } else {
      try { localStorage.setItem("stagetime_storage", mode === "local" ? "local" : "server"); } catch (e) {}
    }
  }

  var EXPORT_HEADER = "STAGETIME_EXPORT 1";

  function buildExportTxt() {
    return Promise.all([
      dataLayer.listIdeas(),
      dataLayer.listJokes(),
      dataLayer.listSets()
    ]).then(function (res) {
      var ideas = res[0] || [];
      var jokes = res[1] || [];
      var setList = res[2] || [];
      var setsWithJokes = setList.map(function (s) { return dataLayer.getSetWithJokes(s.id); });
      return Promise.all(setsWithJokes).then(function (setDetails) {
        var out = [EXPORT_HEADER, "", "[IDEAS]"];
        ideas.forEach(function (i) { out.push((i.content || "").trim()); });
        out.push("", "[JOKES]");
        jokes.forEach(function (j) {
          out.push("---");
          out.push((j.title || "").trim());
          out.push("PREMISE");
          out.push((j.premise || "").trim());
          out.push("PUNCHLINE");
          out.push((j.punchline || "").trim());
          out.push("STATUS");
          out.push((j.status || "draft").trim());
          if (j.setup_notes && String(j.setup_notes).trim()) {
            out.push("SETUP_NOTES");
            out.push(String(j.setup_notes).trim());
          }
          out.push("---");
        });
        out.push("", "[SETS]");
        setDetails.forEach(function (sd) {
          if (!sd || !sd.set) return;
          out.push("===");
          out.push((sd.set.name || "").trim());
          out.push("DESCRIPTION");
          out.push((sd.set.description || "").trim());
          out.push("JOKES");
          (sd.jokes || []).forEach(function (j) { out.push((j.title || "").trim()); });
          out.push("===");
        });
        return out.join("\r\n");
      });
    });
  }

  function parseAndImportTxt(text) {
    var lines = text.split(/\r\n|\r|\n/);
    var section = null;
    var ideas = [];
    var jokes = [];
    var sets = [];
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (line === "[IDEAS]") { section = "ideas"; i++; continue; }
      if (line === "[JOKES]") { section = "jokes"; i++; continue; }
      if (line === "[SETS]") { section = "sets"; i++; continue; }
      if (section === "ideas") {
        if (line === "" || line === "---" || line === "===") { section = null; continue; }
        ideas.push(line);
        i++;
        continue;
      }
      if (section === "jokes") {
        if (line === "---") {
          i++;
          var title = (lines[i] || "").trim();
          i++;
          if (lines[i] === "PREMISE") i++;
          var premise = [];
          while (i < lines.length && lines[i] !== "PUNCHLINE" && lines[i] !== "---") { premise.push(lines[i]); i++; }
          if (lines[i] === "PUNCHLINE") i++;
          var punchline = [];
          while (i < lines.length && lines[i] !== "STATUS" && lines[i] !== "---") { punchline.push(lines[i]); i++; }
          if (lines[i] === "STATUS") i++;
          var status = (lines[i] || "draft").trim();
          i++;
          var setup_notes = "";
          if (i < lines.length && lines[i] === "SETUP_NOTES") {
            i++;
            var notes = [];
            while (i < lines.length && lines[i] !== "---") { notes.push(lines[i]); i++; }
            setup_notes = notes.join("\n").trim();
          }
          while (i < lines.length && lines[i] !== "---") i++;
          jokes.push({ title: title, premise: premise.join("\n").trim(), punchline: punchline.join("\n").trim(), status: status, setup_notes: setup_notes || null });
          i++;
          continue;
        }
        i++;
        continue;
      }
      if (section === "sets") {
        if (line === "===") {
          i++;
          var name = (lines[i] || "").trim();
          i++;
          if (lines[i] === "DESCRIPTION") i++;
          var desc = [];
          while (i < lines.length && lines[i] !== "JOKES" && lines[i] !== "===") { desc.push(lines[i]); i++; }
          if (lines[i] === "JOKES") i++;
          var titles = [];
          while (i < lines.length && lines[i] !== "===") { titles.push((lines[i] || "").trim()); i++; }
          sets.push({ name: name, description: desc.join("\n").trim(), jokeTitles: titles.filter(Boolean) });
          i++;
          continue;
        }
        i++;
      } else {
        i++;
      }
    }
    var titleToId = {};
    return Promise.all([
      dataLayer.listIdeas(),
      dataLayer.listJokes(),
      dataLayer.listSets()
    ]).then(function (res) {
      var existingIdeas = (res[0] || []).map(function (i) { return (i.content || "").trim(); });
      var existingJokes = res[1] || [];
      var existingSetsByName = {};
      (res[2] || []).forEach(function (s) {
        var n = (s.name || "").trim();
        if (n) existingSetsByName[n] = s;
      });
      var existingIdeaSet = new Set(existingIdeas);
      existingJokes.forEach(function (j) {
        var t = (j.title || "").trim();
        if (!titleToId[t]) titleToId[t] = [];
        titleToId[t].push(j.id);
      });
      function jokeMatches(a, b) {
        return (a.title || "").trim() === (b.title || "").trim() &&
          (a.premise || "").trim() === (b.premise || "").trim() &&
          (a.punchline || "").trim() === (b.punchline || "").trim();
      }
      return ideas.reduce(function (p, content) {
        var c = (content || "").trim();
        if (!c || existingIdeaSet.has(c)) return p;
        return p.then(function () {
          return dataLayer.addIdea(content).then(function () { existingIdeaSet.add(c); });
        });
      }, Promise.resolve()).then(function () {
        return jokes.reduce(function (p, j) {
          return p.then(function () {
            var dup = existingJokes.some(function (e) { return jokeMatches(j, e); });
            if (dup) return;
            return dataLayer.addJoke({ title: j.title, premise: j.premise, punchline: j.punchline, status: j.status, setup_notes: j.setup_notes }).then(function (added) {
              if (added && added.title !== undefined) {
                var t = (added.title || "").trim();
                if (!titleToId[t]) titleToId[t] = [];
                titleToId[t].push(added.id);
              }
              return added;
            });
          });
        }, Promise.resolve());
      }).then(function () {
        var idCopy = {};
        Object.keys(titleToId).forEach(function (t) { idCopy[t] = titleToId[t].slice(); });
        return sets.reduce(function (p, s) {
          return p.then(function () {
            var name = (s.name || "").trim();
            var existingSet = name ? existingSetsByName[name] : null;
            var setIdPromise = existingSet
              ? Promise.resolve({ id: existingSet.id })
              : dataLayer.createSet(s.name, s.description || "").then(function (created) {
                  if (created && created.id) existingSetsByName[name] = { id: created.id };
                  return created;
                });
            return setIdPromise.then(function (created) {
              if (!created || !created.id) return;
              var setId = created.id;
              return dataLayer.getSetWithJokes(setId).then(function (detail) {
                var existingJokeIds = new Set((detail && detail.jokes || []).map(function (j) { return j.id; }));
                var pos = (detail && detail.jokes) ? detail.jokes.length : 0;
                return s.jokeTitles.reduce(function (innerP, title) {
                  return innerP.then(function () {
                    var ids = idCopy[title];
                    var id = ids && ids.length ? ids.shift() : null;
                    if (!id || existingJokeIds.has(id)) return;
                    existingJokeIds.add(id);
                    return dataLayer.addJokeToSet(setId, id, pos).then(function () { pos++; });
                  });
                }, Promise.resolve());
              });
            });
          });
        }, Promise.resolve());
      });
    });
  }

  function initUpdateCheck() {
    var updateBtn = document.getElementById("update-btn");
    if (!updateBtn || !navigator.serviceWorker) return;
    updateBtn.addEventListener("click", function () {
      navigator.serviceWorker.ready.then(function (reg) {
        reg.update();
        navigator.serviceWorker.addEventListener("controllerchange", function onControllerChange() {
          navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
          window.location.reload();
        }, { once: true });
      });
    });
  }

  function runWhenReady() {
    initAccent();
    bindSettingsAccentControl();
    bindSettingsAccentPresets();
    initAuthForm();
    try { localStorage.setItem("stagetime_storage", "local"); } catch (e) {}
    var appShell = document.getElementById("app-container");
    if (appShell) appShell.classList.remove("hidden");
    window.addEventListener("stagetime-401", showAuthShell);
    var navPillReady = document.getElementById("nav-command-pill");
    if (navPillReady) {
      navPillReady.classList.add("nav-active");
      navPillReady.style.display = "flex";
    }
    globalHideFolderLayers();
    var panelHomeReady = document.getElementById("panel-home");
    if (panelHomeReady) {
      panelHomeReady.classList.remove("hidden");
      panelHomeReady.style.display = "flex";
    }
    initHubSmartSlicer();
    initApp();
    initUpdateCheck();
    loadJokes();
    setTimeout(function () {
      closeModal();
      updateDashboardStats();
    }, 50);
    updateNavActiveState("home");
  }

  function saveIdea(id) {
    if (id == null) return Promise.resolve();
    var titleInput = document.getElementById("modal-idea-title");
    var contentInput = document.getElementById("idea-focus-content");
    var notesInput = document.getElementById("idea-focus-notes");
    var topicInput = document.getElementById("idea-edit-topic");
    var tagsInput = document.getElementById("idea-edit-tags");
    var title = titleInput ? String(titleInput.textContent || "").trim() : "";
    var content = contentInput ? String(contentInput.value || "") : "";
    var notes = notesInput ? String(notesInput.value || "") : "";
    var topicRaw = topicInput ? String(topicInput.value || "").trim() : "";
    var topic = topicRaw !== "" ? topicRaw : "Uncategorized";
    var tagsStr = tagsInput ? String(tagsInput.value || "").trim() : "";
    var tags = tagsStr ? tagsStr.split(",").map(function (t) { return t.trim(); }).filter(Boolean) : [];
    if (!title) return Promise.resolve();
    var ideaListEl = getIdeaListEl ? getIdeaListEl() : document.getElementById("idea-list");
    var priorScrollTop = ideaListEl ? ideaListEl.scrollTop : 0;
    var priorActiveId = null;
    if (ideaListEl) {
      var activeCard = ideaListEl.querySelector(".idea-item.active");
      if (activeCard && activeCard.dataset && activeCard.dataset.id != null) {
        priorActiveId = String(activeCard.dataset.id);
      }
    }
    return dataLayer.updateIdea(id, {
      title: title,
      content: content,
      notes: notes,
      topic: topic,
      tags: tags
    }).then(function (updated) {
      var modalContainer = document.getElementById("modal-container");
      var ideasPanelSave = document.getElementById("panel-ideas");
      var ideaDetSave = document.getElementById("idea-detail");
      if (modalContainer && updated) modalContainer._currentIdea = updated;
      if (ideasPanelSave && updated) ideasPanelSave._currentIdea = updated;
      if (ideaDetSave && updated) ideaDetSave._currentIdea = updated;
      setIdeasPanelTitle(title);
      return refreshCache()
        .then(function () {
          var ideaSearchInput = document.getElementById("idea-search-input");
          return renderIdeas(ideaSearchInput ? ideaSearchInput.value : "");
        })
        .then(function () {
          closeModal();
          showPanel("ideas");
          setTimeout(function () {
            var refreshedIdeaListEl = getIdeaListEl ? getIdeaListEl() : document.getElementById("idea-list");
            if (!refreshedIdeaListEl) return;
            if (priorActiveId != null) {
              refreshedIdeaListEl.querySelectorAll(".idea-item").forEach(function (x) { x.classList.remove("active"); });
              var priorActive = refreshedIdeaListEl.querySelector('.idea-item[data-id="' + priorActiveId + '"]');
              if (priorActive) priorActive.classList.add("active");
            }
            refreshedIdeaListEl.scrollTop = priorScrollTop;
          }, 0);
          return updated;
        });
    }).catch(function () {});
  }

  function createIdeaFromQuickAdd() {
    var titleInput = document.getElementById("new-idea-title-input");
    var title = titleInput ? titleInput.value.trim() : "";
    if (!title) return Promise.resolve();
    var createPayload = { title: title, content: "", tags: [] };
    var addPromise = dataLayer
      ? dataLayer.addIdea(createPayload)
      : apiFetch("/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createPayload)
      }).then(function (r) {
        if (!r.ok) throw new Error("Add failed");
        return r.json();
      });
    return addPromise.then(function () {
      if (titleInput) titleInput.value = "";
      loadIdeas();
    }).catch(function () {});
  }
  // --- Workstation quick-add wiring (unique names to avoid collisions) ---
  var wsCreateIdeaBtn = document.getElementById("create-idea-btn");
  var wsIdeaInput = document.getElementById("new-idea-title-input");
  if (wsCreateIdeaBtn && wsIdeaInput && wsCreateIdeaBtn.dataset.wsBound !== "1") {
    wsCreateIdeaBtn.dataset.wsBound = "1";
    wsCreateIdeaBtn.addEventListener("click", function (e) {
      e.preventDefault();
      createIdeaFromQuickAdd();
    });
    wsIdeaInput.addEventListener("keypress", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        wsCreateIdeaBtn.click();
      }
    });
  }

  var wsCreateSetBtn = document.getElementById("create-set-btn");
  var wsSetInput = document.getElementById("new-set-title-input");
  if (wsCreateSetBtn && wsSetInput && wsCreateSetBtn.dataset.wsBound !== "1") {
    wsCreateSetBtn.dataset.wsBound = "1";
    wsCreateSetBtn.addEventListener("click", function (e) {
      e.preventDefault();
      var wsSetTitle = wsSetInput.value.trim();
      if (!wsSetTitle) return;
      dataLayer.createSet(wsSetTitle, "").then(function () {
        wsSetInput.value = "";
        if (typeof renderSets === "function") renderSets();
      });
    });
    wsSetInput.addEventListener("keypress", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        wsCreateSetBtn.click();
      }
    });
  }

  function handleRibbonAction(e) {
    var actionEl = e.target && e.target.closest ? e.target.closest("[data-action]") : null;
    var action = actionEl && actionEl.getAttribute ? actionEl.getAttribute("data-action") : null;

    if (!actionEl) {
      actionEl = e.target && e.target.closest ? e.target.closest("#edit-set-order-btn, #save-set-order-btn, #stagetime-btn, .detail-back-btn, .set-detail-ribbon-btn") : null;
      if (!actionEl || actionEl.disabled) return;

      var legacyId = actionEl.id != null ? String(actionEl.id) : "";
      var legacyClassList = actionEl.classList;
      if (legacyId === "edit-set-order-btn" || (legacyClassList && legacyClassList.contains("set-detail-edit-btn"))) {
        action = "edit-set";
      } else if (legacyId === "save-set-order-btn" || (legacyClassList && legacyClassList.contains("set-detail-save-order-btn"))) {
        action = "save-set";
      } else if (legacyId === "stagetime-btn") {
        action = "start-stage";
      } else if (legacyClassList && legacyClassList.contains("detail-back-btn")) {
        action = "back";
      } else if (legacyClassList && legacyClassList.contains("btn-delete-inline")) {
        action = "delete-set";
      } else {
        return;
      }
    } else {
      if (!action) return;
      if (actionEl.disabled) return;
    }

    var isHandled =
      action === "edit-set" ||
      action === "save-set" ||
      action === "start-stage" ||
      action === "back" ||
      action === "delete-set";
    if (!isHandled) return;

    if (e.cancelable) e.preventDefault();
    e.stopPropagation();

    if (action === "edit-set" || action === "save-set") {
      toggleEditSetOrder();
      return;
    }
    if (action === "start-stage") {
      startStagetimeMode();
      return;
    }
    if (action === "back") {
      var hasSaveSetBtn =
        !!document.querySelector('[data-action="save-set"]') ||
        !!document.querySelector("#save-set-order-btn, .set-detail-save-order-btn");
      if (hasSaveSetBtn) {
        if (window.currentSetId != null) showSetDetail(window.currentSetId, { editOrder: false });
      } else {
        renderSetList();
      }
      return;
    }
    if (action === "delete-set") {
      if (!window.confirm("Delete this set?")) return;
      if (window.currentSetId != null && window.dataLayer != null && typeof window.dataLayer.deleteSet === "function") {
        window.dataLayer.deleteSet(window.currentSetId).then(function (val) {
          if (val != null) {
            closeModal();
            return;
          }
          closeModal();
        }).catch(function () {});
      }
    }
  }

  window.addEventListener("touchend", handleRibbonAction, { capture: true, passive: false });
  window.addEventListener("click", handleRibbonAction, { capture: true });

  // 3. THE WIRING (Connecting your buttons to the HTML)
  window.renderSetItems = renderSetItems;
  window.showPanel = showPanel;
  window.goHome = function () {
    closeModal();
    globalHideFolderLayers();
    document.querySelectorAll('[id^="modal-detail-"], #set-picker-modal').forEach(function (el) {
      el.classList.remove("active");
      el.classList.add("hidden");
    });
    var panelHome = document.getElementById("panel-home");
    if (panelHome) {
      panelHome.classList.remove("hidden");
      panelHome.style.display = "flex";
    }
    if (document.body) document.body.classList.remove("panel-open");
    var navPillGo = document.getElementById("nav-command-pill");
    if (navPillGo) {
      navPillGo.classList.add("nav-active");
      navPillGo.style.display = "flex";
    }
    updateNavActiveState("home");
    window.scrollTo(0, 0);
  };
  window.setJokesDetailVisibility = setJokesDetailVisibility;
  window.loadJokes = loadJokes;
  window.renderJokeList = renderJokeList;
  window.renderSets = renderSets;
  window.editJoke = function (id) {
    return showJokeDetail(id);
  };
  window.openNewJokeDetail = openNewJokeDetail;
  window.fetchJokesForModal = fetchJokesForModal;
  window.refreshCache = refreshCache;
  window.convertToJoke = convertToJoke;
  window.saveIdea = saveIdea;
  window.deleteCurrentItem = function () {
    var modalContainer = document.getElementById("modal-container");
    var ideasPanelDel = document.getElementById("panel-ideas");
    var ideaShell =
      modalContainer &&
      modalContainer.classList.contains("modal-idea") &&
      modalContainer.classList.contains("is-detail-view")
        ? modalContainer
        : ideasPanelDel &&
            ideasPanelDel.classList.contains("modal-idea") &&
            ideasPanelDel.classList.contains("is-viewing-detail")
          ? ideasPanelDel
          : null;
    if (ideaShell) {
      var item = ideaShell._currentIdea;
      var ideaId = item && item.id != null ? Number(item.id) : null;
      if (ideaId == null || isNaN(ideaId)) return;
      if (!confirm("Delete this idea?")) return;
      deleteIdeaRequest(ideaId);
      closeIdeaDetailModal();
      return;
    }
    var jokeEl = getJokeDetailEl();
    if (!jokeEl || jokeEl.classList.contains("hidden")) return;
    var delBtn = jokeEl.querySelector("#joke-delete-btn");
    if (delBtn && delBtn.classList.contains("hidden")) return;
    var jokeIdRaw = jokeEl.dataset.jokeId;
    var jokeId = jokeIdRaw != null ? String(jokeIdRaw).trim() : "";
    if (jokeId === "") return;
    if (!confirm("Delete this joke? This cannot be undone.")) return;
    (dataLayer ? dataLayer.deleteJoke(jokeId) : apiFetch("/jokes/" + jokeId, { method: "DELETE" }))
      .then(function (r) {
        if (r && r.ok === false) throw new Error("Delete failed");
        clearJokeDetailAndBack(jokeEl, modalContainer);
        loadJokes();
      })
      .catch(function () {});
  };
  window.deleteIdea = function (ideaId) {
    if (ideaId == null || !confirm("Delete this idea?")) return;
    deleteIdeaRequest(ideaId);
    closeIdeaDetailModal();
  };
  window.showIdeaDetail = showIdeaDetail;
  window.openSetPicker = openSetPicker;
  window.addItemToSet = addItemToSetUnified;
  window.showAddToSetModal = function (id, itemType) { return openSetPicker(id, itemType || "joke"); };
  window.closeSetPickerModal = closeSetPickerModal;
  window.showSetDetail = showSetDetail;
  window.closeModal = function (e) {
    if (e) e.preventDefault();
    closeModal();
  };
  window.handleRibbonAction = handleRibbonAction;
  window.showToast = showToast;
  window.setAccentColor = setAccentColor;
  window.updateDashboardStats = updateDashboardStats;

  window.toggleEditSetOrder = toggleEditSetOrder;
  window.startStagetimeMode = startStagetimeMode;
  window.startStagetime = startStagetimeMode;
  window.isEditingSetOrder = isEditingSetOrder;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runWhenReady);
  } else {
    runWhenReady();
  }
})(); // <--- THIS MUST BE THE ABSOLUTE LAST LINE