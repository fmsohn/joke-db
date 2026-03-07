(function () {
  "use strict";

  var API = "/api";
  var dataLayer = window.dataLayer;

  function fetchOpts() {
    return { credentials: "same-origin" };
  }

  function getBaseUrl() {
    return dataLayer ? dataLayer.getBaseUrl() : (function () {
      try {
        var base = sessionStorage.getItem("joke_db_api_base");
        if (base) return base.replace(/\/$/, "");
      } catch (e) {}
      return window.location.origin;
    })();
  }

  function apiFetch(path, opts) {
    if (dataLayer && dataLayer.apiFetch) return dataLayer.apiFetch(path, opts);
    opts = opts || {};
    opts.credentials = "same-origin";
    return fetch(getBaseUrl() + API + path, opts).then(function (r) {
      if (r.status === 401) { window.location.reload(); return Promise.reject(new Error("Login required")); }
      return r;
    });
  }

  function showPanel(id) {
    document.querySelectorAll(".panel").forEach(function (p) {
      p.classList.toggle("active", p.id === "panel-" + id);
    });
    document.querySelectorAll(".tab").forEach(function (t) {
      t.classList.toggle("active", t.getAttribute("data-tab") === id);
    });
  }

  function getJokeListEl() { return document.getElementById("joke-list"); }
  function getJokeDetailEl() { return document.getElementById("joke-detail"); }
  function getSetListEl() { return document.getElementById("set-list"); }
  function getSetDetailEl() { return document.getElementById("set-detail"); }
  function getIdeaListEl() { return document.getElementById("idea-list"); }

  function loadJokes(optionalSelectJokeId) {
    var status = document.getElementById("filter-status").value;
    var listP = dataLayer ? dataLayer.listJokes(status || undefined) : apiFetch("/jokes" + (status ? "?status=" + encodeURIComponent(status) : "")).then(function (r) { return r.json(); });
    listP.then(function (list) {
        if (!Array.isArray(list)) list = [];
        var el = getJokeListEl();
        el.innerHTML = "";
        if (list.length === 0) {
          el.innerHTML = "<li class=\"empty\">No jokes yet. Add one in the Add Joke tab.</li>";
          getJokeDetailEl().classList.add("hidden");
          return;
        }
        list.forEach(function (j) {
          var li = document.createElement("li");
          li.dataset.id = j.id;
          li.innerHTML = "<span class=\"title\">" + escapeHtml(j.title || "Untitled") + "</span>" +
            "";
          li.addEventListener("click", function () {
            getJokeListEl().querySelectorAll("li").forEach(function (x) { x.classList.remove("active"); });
            li.classList.add("active");
            showJokeDetail(j.id);
          });
          el.appendChild(li);
        });
        if (optionalSelectJokeId) {
          getJokeListEl().querySelectorAll("li").forEach(function (x) { x.classList.remove("active"); });
          var activeLi = getJokeListEl().querySelector("li[data-id=\"" + optionalSelectJokeId + "\"]");
          if (activeLi) activeLi.classList.add("active");
          showJokeDetail(optionalSelectJokeId);
        } else {
          getJokeDetailEl().classList.add("hidden");
        }
      })
      .catch(function () {
        getJokeListEl().innerHTML = "<li class=\"empty\">Could not load jokes." + (dataLayer && dataLayer.getStorageMode() === "local" ? "" : " Is the server running?") + "</li>";
      });
  }

  function showJokeDetail(id) {
    var jokeP = dataLayer ? dataLayer.getJoke(id) : apiFetch("/jokes/" + id).then(function (r) { return r.json(); });
    var setsP = dataLayer ? dataLayer.listSets() : apiFetch("/sets").then(function (r) { return r.json(); });
    Promise.all([jokeP, setsP])
      .then(function (results) {
        var j = results[0];
        var sets = results[1] || [];
        if (!j) return;
        var el = getJokeDetailEl();
        el.classList.remove("hidden");
        el.dataset.jokeId = j.id;

        var setOptions = "<option value=\"\">Choose a set…</option>" +
          (Array.isArray(sets) ? sets : []).map(function (s) {
            return "<option value=\"" + s.id + "\">" + escapeHtml(s.name) + "</option>";
          }).join("");

        el.innerHTML = "<div class=\"joke-detail-view\">" +
          "<h3>" + escapeHtml(j.title || "Untitled") + "</h3>" +
          "<p class=\"detail-label\">Body</p><div class=\"detail-body\">" + escapeHtml((function () { var p = (j.premise || "").trim().replace(/\s+/g, " "); var t = (j.title || "").trim().replace(/\s+/g, " "); return (p && t && p === t) ? "" : (j.premise || ""); })()) + "</div>" +
          (j.punchline ? "<p class=\"detail-label\">Act Out</p><div class=\"detail-actout\">" + escapeHtml(j.punchline) + "</div>" : "") +
          "<span class=\"status\">" + escapeHtml(j.status) + "</span>" +
          "<div class=\"add-joke-to-set\"><strong>Add to set:</strong>" +
          "<select id=\"joke-detail-set-select\">" + setOptions + "</select>" +
          "<button type=\"button\" id=\"joke-detail-add-to-set-btn\">Add to set</button></div>" +
          "<button type=\"button\" id=\"joke-detail-edit-btn\" class=\"btn-edit-inline\">Edit</button> " +
          "<button type=\"button\" id=\"joke-detail-delete-btn\" class=\"btn-delete-inline\">Delete joke</button></div>";

        el.querySelector("#joke-detail-edit-btn").addEventListener("click", function () {
          var view = el.querySelector(".joke-detail-view");
          view.classList.add("hidden");
          var formDiv = document.createElement("div");
          formDiv.className = "joke-detail-edit-form";
          formDiv.innerHTML =
            "<p class=\"detail-label\">Title</p><input type=\"text\" id=\"joke-edit-title\" class=\"detail-edit-input\">" +
            "<p class=\"detail-label\">Body</p><textarea id=\"joke-edit-premise\" class=\"detail-edit-input\" rows=\"6\"></textarea>" +
            "<p class=\"detail-label\">Act Out</p><textarea id=\"joke-edit-punchline\" class=\"detail-edit-input\" rows=\"2\"></textarea>" +
            "<p class=\"detail-label\">Status</p><select id=\"joke-edit-status\"><option value=\"draft\">Draft</option><option value=\"testing\">Testing</option><option value=\"active\">Active</option><option value=\"retired\">Retired</option><option value=\"archived\">Archived</option></select>" +
            "<div class=\"detail-edit-actions\"><button type=\"button\" id=\"joke-detail-save-btn\">Save</button> <button type=\"button\" id=\"joke-detail-cancel-edit-btn\">Cancel</button></div>";
          el.appendChild(formDiv);
          document.getElementById("joke-edit-title").value = j.title || "";
          document.getElementById("joke-edit-premise").value = (function () { var p = (j.premise || "").trim().replace(/\s+/g, " "); var t = (j.title || "").trim().replace(/\s+/g, " "); return (p && t && p === t) ? "" : (j.premise || ""); })();
          document.getElementById("joke-edit-punchline").value = j.punchline || "";
          document.getElementById("joke-edit-status").value = j.status || "draft";

          el.querySelector("#joke-detail-cancel-edit-btn").addEventListener("click", function () {
            formDiv.remove();
            view.classList.remove("hidden");
          });

          el.querySelector("#joke-detail-save-btn").addEventListener("click", function () {
            var payload = {
              title: document.getElementById("joke-edit-title").value.trim() || null,
              premise: document.getElementById("joke-edit-premise").value.trim(),
              punchline: document.getElementById("joke-edit-punchline").value.trim() || null,
              status: document.getElementById("joke-edit-status").value
            };
            if (!payload.title) return;
            var updateP = dataLayer
              ? dataLayer.updateJoke(j.id, payload)
              : apiFetch("/jokes/" + j.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then(function (r) { if (!r.ok) throw new Error("Update failed"); return r.json(); });
            updateP.then(function (updated) {
                if (updated) j = updated;
                showJokeDetail(j.id);
              })
              .catch(function () {});
          });
        });

        el.querySelector("#joke-detail-add-to-set-btn").addEventListener("click", function () {
          var select = document.getElementById("joke-detail-set-select");
          var setId = select.value;
          if (!setId) return;
          var jokeId = getJokeDetailEl().dataset.jokeId;
          var getSetP = dataLayer ? dataLayer.getSetWithJokes(setId) : apiFetch("/sets/" + setId).then(function (r) { return r.json(); });
          getSetP.then(function (setData) {
              var position = ((setData && setData.jokes) || []).length;
              return dataLayer
                ? dataLayer.addJokeToSet(setId, parseInt(jokeId, 10), position)
                : apiFetch("/sets/" + setId + "/jokes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ joke_id: parseInt(jokeId, 10), position: position }) });
            })
            .then(function (r) {
              if (r && r.ok === false) throw new Error("Add failed");
              select.value = "";
            })
            .catch(function () {});
        });

        el.querySelector("#joke-detail-delete-btn").addEventListener("click", function () {
          if (!confirm("Delete this joke? This cannot be undone.")) return;
          var jokeId = getJokeDetailEl().dataset.jokeId;
          (dataLayer ? dataLayer.deleteJoke(jokeId) : apiFetch("/jokes/" + jokeId, { method: "DELETE" }))
            .then(function (r) {
              if (r && r.ok === false) throw new Error("Delete failed");
              getJokeDetailEl().classList.add("hidden");
              getJokeDetailEl().innerHTML = "";
              loadJokes();
            })
            .catch(function () {});
        });
      });
  }

  function loadSets() {
    var setDetailEl = getSetDetailEl();
    var currentSetId = setDetailEl && !setDetailEl.classList.contains("hidden") && setDetailEl.dataset.setId ? setDetailEl.dataset.setId : null;
    (dataLayer ? dataLayer.listSets() : apiFetch("/sets").then(function (r) { return r.json(); }))
      .then(function (list) {
        if (!Array.isArray(list)) list = [];
        var el = getSetListEl();
        el.innerHTML = "";
        if (list.length === 0) {
          setDetailEl.classList.add("hidden");
          el.innerHTML = "<li class=\"empty\">No sets yet. Create one below.</li>";
          return;
        }
        list.forEach(function (s) {
          var li = document.createElement("li");
          li.dataset.id = s.id;
          li.innerHTML = "<span class=\"title\">" + escapeHtml(s.name) + "</span>";
          li.addEventListener("click", function () {
            getSetListEl().querySelectorAll("li").forEach(function (x) { x.classList.remove("active"); });
            li.classList.add("active");
            showSetDetail(s.id);
          });
          el.appendChild(li);
        });
        if (currentSetId) {
          showSetDetail(currentSetId);
          var activeLi = getSetListEl().querySelector("li[data-id=\"" + currentSetId + "\"]");
          if (activeLi) {
            getSetListEl().querySelectorAll("li").forEach(function (x) { x.classList.remove("active"); });
            activeLi.classList.add("active");
          }
        } else {
          setDetailEl.classList.add("hidden");
        }
      })
      .catch(function () {
        getSetListEl().innerHTML = "<li class=\"empty\">Could not load sets. Is the server running?</li>";
      });
  }

  function loadIdeas() {
    (dataLayer ? dataLayer.listIdeas() : apiFetch("/ideas").then(function (r) { return r.json(); }))
      .then(function (list) {
        if (!Array.isArray(list)) list = [];
        var el = getIdeaListEl();
        el.innerHTML = "";
        if (list.length === 0) {
          el.innerHTML = "<li class=\"empty\">No ideas yet. Add a one-line idea above; convert it to a joke when ready.</li>";
          return;
        }
        list.forEach(function (idea) {
          var li = document.createElement("li");
          li.dataset.id = idea.id;
          li.innerHTML = "<span class=\"title idea-title\">" + escapeHtml(idea.content) + "</span>" +
            "<div class=\"idea-actions\">" +
            "<button type=\"button\" class=\"btn-edit\" data-action=\"edit\">Edit</button>" +
            "<button type=\"button\" class=\"btn-convert\" data-action=\"convert\">Convert to joke</button>" +
            "<button type=\"button\" class=\"btn-delete\" data-action=\"delete\">Delete</button>" +
            "</div>";
          li.querySelector(".idea-title").addEventListener("click", function (e) {
            e.stopPropagation();
            var listEl = getIdeaListEl();
            listEl.querySelectorAll("li.show-actions").forEach(function (other) { other.classList.remove("show-actions"); });
            li.classList.toggle("show-actions");
          });
          li.querySelector(".btn-convert").addEventListener("click", function (e) {
            e.stopPropagation();
            convertIdeaToJoke(idea.id, idea.content);
          });
          li.querySelector(".btn-delete").addEventListener("click", function (e) {
            e.stopPropagation();
            if (!confirm("Delete this idea?")) return;
            deleteIdea(idea.id);
          });
          li.querySelector(".btn-edit").addEventListener("click", function (e) {
            e.stopPropagation();
            var titleEl = li.querySelector(".idea-title");
            var actionsEl = li.querySelector(".idea-actions");
            if (li.querySelector(".idea-edit-form")) return;
            titleEl.classList.add("hidden");
            actionsEl.classList.add("hidden");
            var formDiv = document.createElement("div");
            formDiv.className = "idea-edit-form";
            formDiv.innerHTML =
              "<input type=\"text\" class=\"idea-edit-input\" placeholder=\"Edit idea...\" maxlength=\"500\">" +
              "<div class=\"idea-edit-actions\">" +
              "<button type=\"button\" class=\"btn-save-idea\">Save</button>" +
              "<button type=\"button\" class=\"btn-cancel-idea\">Cancel</button>" +
              "</div>";
            li.appendChild(formDiv);
            var inputEl = formDiv.querySelector(".idea-edit-input");
            inputEl.value = idea.content;
            inputEl.focus();

            formDiv.querySelector(".btn-cancel-idea").addEventListener("click", function (ev) {
              ev.stopPropagation();
              formDiv.remove();
              titleEl.classList.remove("hidden");
              actionsEl.classList.remove("hidden");
            });
            formDiv.querySelector(".btn-save-idea").addEventListener("click", function (ev) {
              ev.stopPropagation();
              var newContent = inputEl.value.trim();
              if (!newContent) return;
              (dataLayer ? dataLayer.updateIdea(idea.id, newContent) : apiFetch("/ideas/" + idea.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: newContent }) }).then(function (r) { if (!r.ok) throw new Error("Update failed"); return r.json(); }))
                .then(function (updated) {
                  if (updated) idea.content = updated.content;
                  else idea.content = newContent;
                  titleEl.textContent = idea.content;
                  formDiv.remove();
                  titleEl.classList.remove("hidden");
                  actionsEl.classList.remove("hidden");
                })
                .catch(function () {});
            });
          });
          el.appendChild(li);
        });
      })
      .catch(function () {
        getIdeaListEl().innerHTML = "<li class=\"empty\">Could not load ideas. Is the server running?</li>";
      });
  }

  function convertIdeaToJoke(ideaId, ideaContent) {
    (dataLayer ? dataLayer.convertIdeaToJoke(ideaId, ideaContent) : apiFetch("/ideas/" + ideaId + "/convert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: ideaContent || "", status: "draft" }) }).then(function (r) { if (!r.ok) throw new Error("Convert failed"); return r.json(); }))
      .then(function (joke) {
        loadIdeas();
        showPanel("jokes");
        loadJokes();
      })
      .catch(function () {});
  }

  function deleteIdea(ideaId) {
    (dataLayer ? dataLayer.deleteIdea(ideaId) : apiFetch("/ideas/" + ideaId, { method: "DELETE" }))
      .then(function (r) {
        if (r && r.ok === false) throw new Error("Delete failed");
        loadIdeas();
      })
      .catch(function () {});
  }

  function showSetDetail(id, opts) {
    var editOrder = opts && opts.editOrder === true;
    var setP = dataLayer ? dataLayer.getSetWithJokes(id) : apiFetch("/sets/" + id).then(function (r) { if (!r.ok) throw new Error("Set not found"); return r.json(); });
    var jokesP = dataLayer ? dataLayer.listJokes() : apiFetch("/jokes").then(function (r) { if (!r.ok) throw new Error("Jokes not found"); return r.json(); });
    setP.then(function (data) {
        return jokesP.then(function (allJokes) {
          return { setData: data, allJokes: Array.isArray(allJokes) ? allJokes : [] };
        });
      })
      .then(function (payload) {
        var data = payload.setData;
        var allJokes = payload.allJokes || [];
        var el = getSetDetailEl();
        el.classList.remove("hidden");
        el.dataset.setId = id;

        var setJokes = data.jokes || [];
        var jokesHtml = "";
        if (setJokes.length === 0) {
          jokesHtml = "<p class=\"meta\">None added yet.</p>";
        } else if (editOrder) {
          jokesHtml = "<ul class=\"set-joke-links set-joke-reorder\">";
          setJokes.forEach(function (j, i) {
            var title = escapeHtml(j.title || j.premise || "Untitled");
            var upDisabled = i === 0 ? " disabled" : "";
            var downDisabled = i === setJokes.length - 1 ? " disabled" : "";
            jokesHtml += "<li class=\"set-joke-item\" data-joke-id=\"" + j.id + "\">" +
              "<span class=\"set-joke-order-btns\">" +
              "<button type=\"button\" class=\"btn-order btn-order-up\" title=\"Move up\"" + upDisabled + ">↑</button>" +
              "<button type=\"button\" class=\"btn-order btn-order-down\" title=\"Move down\"" + downDisabled + ">↓</button>" +
              "</span>" +
              "<a href=\"#\" class=\"joke-link\" data-joke-id=\"" + j.id + "\">" + title + "</a></li>";
          });
          jokesHtml += "</ul>";
        } else {
          jokesHtml = "<ul class=\"set-joke-links\">";
          setJokes.forEach(function (j) {
            var title = escapeHtml(j.title || j.premise || "Untitled");
            jokesHtml += "<li><a href=\"#\" class=\"joke-link\" data-joke-id=\"" + j.id + "\">" + title + "</a></li>";
          });
          jokesHtml += "</ul>";
        }

        var desc = data.set.description;
        var hasDescription = desc && String(desc).trim() && String(desc).trim().toLowerCase() !== "no description";
        var editOrderBtn = setJokes.length > 0 && !editOrder
          ? "<button type=\"button\" id=\"edit-set-order-btn\">Edit Set Order</button>"
          : "";
        var saveOrderBtn = editOrder
          ? "<button type=\"button\" id=\"save-set-order-btn\">Save</button>"
          : "";
        var performanceModeBtn = setJokes.length > 0 && !editOrder
          ? "<button type=\"button\" id=\"performance-mode-btn\" class=\"performance-mode-btn\">Performance Mode</button>"
          : "";
        el.innerHTML = "<h3>" + escapeHtml(data.set.name) + "</h3>" +
          (hasDescription ? " <p class=\"meta\">" + escapeHtml(desc) + "</p>" : "") +
          jokesHtml +
          (editOrderBtn || saveOrderBtn ? (editOrderBtn || saveOrderBtn) + " " : "") +
          (performanceModeBtn ? performanceModeBtn + " " : "") +
          "<div class=\"add-to-set\"><strong>Add joke to this set:</strong>" +
          "<select id=\"add-to-set-joke-select\"><option value=\"\">Choose a joke…</option>" +
          allJokes.map(function (j) { return "<option value=\"" + j.id + "\">" + escapeHtml(j.title || j.premise || "Untitled") + "</option>"; }).join("") +
          "</select><button type=\"button\" id=\"add-to-set-btn\">Add to set</button></div>" +
          "<button type=\"button\" id=\"set-detail-delete-btn\" class=\"btn-delete-inline\">Delete set</button>";

        el.querySelectorAll(".joke-link").forEach(function (a) {
          a.addEventListener("click", function (e) {
            e.preventDefault();
            var jokeId = parseInt(a.getAttribute("data-joke-id"), 10);
            showPanel("jokes");
            loadJokes(jokeId);
          });
        });

        if (editOrder) {
          var listEl = el.querySelector(".set-joke-reorder");
          if (listEl) {
            function getSetJokeOrder() {
              var items = listEl.querySelectorAll(".set-joke-item");
              var ids = [];
              items.forEach(function (item) {
                var n = parseInt(item.getAttribute("data-joke-id"), 10);
                if (!isNaN(n)) ids.push(n);
              });
              return ids;
            }
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
            el.querySelector("#save-set-order-btn").addEventListener("click", function () {
              var order = getSetJokeOrder();
              var setId = getSetDetailEl().dataset.setId;
              var btn = el.querySelector("#save-set-order-btn");
              if (!setId || !order.length) return;
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
              (dataLayer
                ? dataLayer.reorderSetJokes(setId, order).then(function (result) { showSetDetail(setId); return result; })
                : apiFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ joke_ids: order }) }).then(function (r) {
                    if (r.status === 405 || r.status === 404) return apiFetch(pathGet).then(handleResponse);
                    return handleResponse(r);
                  }))
                .catch(function (err) {
                  btn.disabled = false;
                  btn.textContent = "Save";
                  alert(err && err.message ? err.message : "Could not save order. Try again.");
                });
            });
          }
        } else if (el.querySelector("#edit-set-order-btn")) {
          el.querySelector("#edit-set-order-btn").addEventListener("click", function () {
            showSetDetail(id, { editOrder: true });
          });
        }

        if (el.querySelector("#performance-mode-btn")) {
          el.querySelector("#performance-mode-btn").addEventListener("click", function () {
            var setName = data.set.name;
            var jokes = setJokes.map(function (j) { return j.title || j.premise || "Untitled"; });
            var startMs = Date.now();
            var overlay = document.createElement("div");
            overlay.className = "performance-mode-overlay";
            overlay.setAttribute("aria-hidden", "false");
            var listHtml = "<ul class=\"performance-mode-list\">";
            jokes.forEach(function (title) {
              listHtml += "<li>" + escapeHtml(title) + "</li>";
            });
            listHtml += "</ul>";
            overlay.innerHTML =
              "<div class=\"performance-mode-stopwatch\" id=\"performance-mode-stopwatch\">0:00</div>" +
              "<h2 class=\"performance-mode-title\">" + escapeHtml(setName) + "</h2>" +
              listHtml +
              "<p class=\"performance-mode-exit\">Tap below to exit</p>";
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
            overlay.querySelector(".performance-mode-exit").addEventListener("click", function () {
              clearInterval(intervalId);
              overlay.remove();
            });
          });
        }

        el.querySelector("#add-to-set-btn").addEventListener("click", function () {
          var select = document.getElementById("add-to-set-joke-select");
          var jokeId = select.value;
          if (!jokeId) return;
          var setId = getSetDetailEl().dataset.setId;
          var position = setJokes.length;
          (dataLayer ? dataLayer.addJokeToSet(setId, parseInt(jokeId, 10), position) : apiFetch("/sets/" + setId + "/jokes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ joke_id: parseInt(jokeId, 10), position: position }) }))
            .then(function (r) {
              if (r && r.ok === false) throw new Error("Add failed");
              showSetDetail(setId);
            })
            .catch(function () {});
        });

        el.querySelector("#set-detail-delete-btn").addEventListener("click", function () {
          if (!confirm("Delete this set? Jokes will not be deleted, only the set list.")) return;
          var setId = getSetDetailEl().dataset.setId;
          (dataLayer ? dataLayer.deleteSet(setId) : apiFetch("/sets/" + setId, { method: "DELETE" }))
            .then(function (r) {
              if (r && r.ok === false) throw new Error("Delete failed");
              getSetDetailEl().classList.add("hidden");
              getSetDetailEl().innerHTML = "";
              loadSets();
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

  document.getElementById("filter-status").addEventListener("change", loadJokes);
  document.getElementById("refresh-jokes").addEventListener("click", loadJokes);

  document.getElementById("add-joke-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var title = document.getElementById("new-joke-title").value.trim();
    var premise = document.getElementById("new-joke-premise").value.trim();
    var punchline = document.getElementById("new-joke-punchline").value.trim();
    var status = document.getElementById("new-joke-status").value;
    if (!title) return;
    var resultEl = document.getElementById("add-result");
    (dataLayer ? dataLayer.addJoke({ title: title, premise: premise, punchline: punchline, status: status }) : apiFetch("/jokes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title, premise: premise, punchline: punchline, status: status }) }).then(function (r) { if (!r.ok) throw new Error("Save failed"); return r.json(); }))
      .then(function () {
        resultEl.textContent = "Joke saved.";
        resultEl.className = "result success";
        resultEl.classList.remove("hidden");
        document.getElementById("new-joke-title").value = "";
        document.getElementById("new-joke-premise").value = "";
        document.getElementById("new-joke-punchline").value = "";
        setTimeout(function () {
          showPanel("jokes");
          loadJokes();
          resultEl.classList.add("hidden");
        }, 800);
      })
      .catch(function () {
        resultEl.textContent = "Could not save. Is the server running?";
        resultEl.className = "result error";
        resultEl.classList.remove("hidden");
      });
  });

  document.getElementById("add-idea-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var input = document.getElementById("new-idea-content");
    var content = input.value.trim();
    if (!content) return;
    (dataLayer ? dataLayer.addIdea(content) : apiFetch("/ideas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: content }) }).then(function (r) { if (!r.ok) throw new Error("Add failed"); return r.json(); }))
      .then(function () {
        input.value = "";
        loadIdeas();
      })
      .catch(function () {});
  });

  document.getElementById("create-set").addEventListener("click", function () {
    var name = document.getElementById("new-set-name").value.trim();
    var desc = document.getElementById("new-set-desc").value.trim();
    if (!name) return;
    (dataLayer ? dataLayer.createSet(name, desc) : apiFetch("/sets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name, description: desc }) }).then(function (r) { if (!r.ok) throw new Error("Create failed"); return r.json(); }))
      .then(function () {
        document.getElementById("new-set-name").value = "";
        document.getElementById("new-set-desc").value = "";
        loadSets();
      })
      .catch(function () {});
  });

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
    loadIdeas();
    loadJokes();
    loadSets();
  }

  function initApp() {
    initStorageNoticeDismiss();
    checkStorageNotice();
    window.addEventListener("online", syncOnOnline);
    document.querySelectorAll(".tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var tab = btn.getAttribute("data-tab");
        showPanel(tab);
        if (tab === "jokes") loadJokes();
        if (tab === "ideas") loadIdeas();
        if (tab === "sets") loadSets();
      });
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      var setDetailEl = getSetDetailEl();
      if (!setDetailEl || setDetailEl.classList.contains("hidden")) return;
      var setId = setDetailEl.dataset.setId;
      if (!setId) return;
      var setsPanel = document.getElementById("panel-sets");
      if (!setsPanel || !setsPanel.classList.contains("active")) return;
      showSetDetail(setId);
    });
    loadIdeas();
  }

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
      var m = localStorage.getItem("joke_db_storage");
      return (m === "local" || m === "server") ? m : "server";
    } catch (e) { return "server"; }
  }

  function setStorageMode(mode) {
    if (dataLayer && dataLayer.setStorageMode) {
      dataLayer.setStorageMode(mode);
    } else {
      try { localStorage.setItem("joke_db_storage", mode === "local" ? "local" : "server"); } catch (e) {}
    }
  }

  var EXPORT_HEADER = "JOKE_DB_EXPORT 1";

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

  function initImportPanel() {
    var panelImport = document.getElementById("panel-import");
    var exportBox = document.getElementById("import-export-box");
    var fileImportBox = document.getElementById("import-from-file-box");
    if (!panelImport || !dataLayer) return;

    if (exportBox) exportBox.classList.remove("hidden");
    if (fileImportBox) fileImportBox.classList.remove("hidden");

    var exportBtn = document.getElementById("export-txt-btn");
    var exportResult = document.getElementById("export-result");
    var importFileInput = document.getElementById("import-file-input");
    var importFileResult = document.getElementById("import-file-result");

    function showExportResult(msg, isError) {
      if (!exportResult) return;
      exportResult.textContent = msg;
      exportResult.className = "result " + (isError ? "error" : "success");
      exportResult.classList.remove("hidden");
    }
    function showImportFileResult(msg, isError) {
      if (!importFileResult) return;
      importFileResult.textContent = msg;
      importFileResult.className = "result " + (isError ? "error" : "success");
      importFileResult.classList.remove("hidden");
    }

    if (exportBtn) {
      exportBtn.addEventListener("click", function () {
        showExportResult("Exporting…", false);
        buildExportTxt()
          .then(function (txt) {
            var blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
            var url = URL.createObjectURL(blob);
            var a = document.createElement("a");
            a.href = url;
            a.download = "joke-db-export-" + (new Date().toISOString().slice(0, 10)) + ".txt";
            a.style.display = "none";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showExportResult("Exported. File saved.", false);
          })
          .catch(function (err) {
            showExportResult(err && err.message ? err.message : "Export failed.", true);
          });
      });
    }

    if (importFileInput) {
      importFileInput.addEventListener("change", function () {
        var file = importFileInput.files && importFileInput.files[0];
        importFileInput.value = "";
        if (!file) return;
        showImportFileResult("Importing…", false);
        var reader = new FileReader();
        reader.onload = function () {
          var text = typeof reader.result === "string" ? reader.result : "";
          if (!text.trim() || text.indexOf("JOKE_DB_EXPORT") !== 0) {
            showImportFileResult("Not a valid Joke DB .txt file.", true);
            return;
          }
          parseAndImportTxt(text)
            .then(function () {
              showImportFileResult("Import done. Ideas, jokes, and sets added.", false);
              loadIdeas();
              loadJokes();
              loadSets();
            })
            .catch(function (err) {
              showImportFileResult(err && err.message ? err.message : "Import failed.", true);
            });
        };
        reader.onerror = function () { showImportFileResult("Could not read file.", true); };
        reader.readAsText(file, "UTF-8");
      });
    }
  }

  try { localStorage.setItem("joke_db_storage", "local"); } catch (e) {}
  document.getElementById("app-shell").classList.remove("hidden");
  var importTab = document.querySelector(".tab-import");
  if (importTab) importTab.classList.remove("hidden");
  var panelImport = document.getElementById("panel-import");
  if (panelImport) panelImport.classList.remove("hidden");
  initApp();
  initImportPanel();
})();
