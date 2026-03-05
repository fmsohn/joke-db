(function () {
  "use strict";

  var API = "/api";

  function fetchOpts() {
    return { credentials: "same-origin" };
  }

  function showPanel(id) {
    document.querySelectorAll(".panel").forEach(function (p) {
      p.classList.toggle("active", p.id === "panel-" + id);
    });
    document.querySelectorAll(".tab").forEach(function (t) {
      t.classList.toggle("active", t.getAttribute("data-tab") === id);
    });
  }

  function getBaseUrl() {
    try {
      var base = sessionStorage.getItem("joke_db_api_base");
      if (base) return base.replace(/\/$/, "");
    } catch (e) {}
    return window.location.origin;
  }

  function getJokeListEl() { return document.getElementById("joke-list"); }
  function getJokeDetailEl() { return document.getElementById("joke-detail"); }
  function getSetListEl() { return document.getElementById("set-list"); }
  function getSetDetailEl() { return document.getElementById("set-detail"); }
  function getIdeaListEl() { return document.getElementById("idea-list"); }

  function loadJokes(optionalSelectJokeId) {
    var status = document.getElementById("filter-status").value;
    var q = status ? "?status=" + encodeURIComponent(status) : "";
    fetch(getBaseUrl() + API + "/jokes" + q)
      .then(function (r) { return r.json(); })
      .then(function (list) {
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
        getJokeListEl().innerHTML = "<li class=\"empty\">Could not load jokes. Is the server running?</li>";
      });
  }

  function showJokeDetail(id) {
    Promise.all([
      fetch(getBaseUrl() + API + "/jokes/" + id).then(function (r) { return r.json(); }),
      fetch(getBaseUrl() + API + "/sets").then(function (r) { return r.json(); })
    ])
      .then(function (results) {
        var j = results[0];
        var sets = results[1] || [];
        var el = getJokeDetailEl();
        el.classList.remove("hidden");
        el.dataset.jokeId = j.id;

        var setOptions = "<option value=\"\">Choose a set…</option>" +
          sets.map(function (s) {
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
            fetch(getBaseUrl() + API + "/jokes/" + j.id, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            })
              .then(function (r) {
                if (!r.ok) throw new Error("Update failed");
                return r.json();
              })
              .then(function (updated) {
                j = updated;
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
          fetch(getBaseUrl() + API + "/sets/" + setId)
            .then(function (r) { return r.json(); })
            .then(function (setData) {
              var position = (setData.jokes || []).length;
              return fetch(getBaseUrl() + API + "/sets/" + setId + "/jokes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ joke_id: parseInt(jokeId, 10), position: position })
              });
            })
            .then(function (r) {
              if (!r.ok) throw new Error("Add failed");
              select.value = "";
            })
            .catch(function () {});
        });

        el.querySelector("#joke-detail-delete-btn").addEventListener("click", function () {
          if (!confirm("Delete this joke? This cannot be undone.")) return;
          var jokeId = getJokeDetailEl().dataset.jokeId;
          fetch(getBaseUrl() + API + "/jokes/" + jokeId, { method: "DELETE" })
            .then(function (r) {
              if (!r.ok) throw new Error("Delete failed");
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
    fetch(getBaseUrl() + API + "/sets")
      .then(function (r) { return r.json(); })
      .then(function (list) {
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
    fetch(getBaseUrl() + API + "/ideas")
      .then(function (r) { return r.json(); })
      .then(function (list) {
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
              fetch(getBaseUrl() + API + "/ideas/" + idea.id, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: newContent })
              })
                .then(function (r) {
                  if (!r.ok) throw new Error("Update failed");
                  idea.content = newContent;
                  titleEl.textContent = newContent;
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
    fetch(getBaseUrl() + API + "/ideas/" + ideaId + "/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: ideaContent || "", status: "draft" })
    })
      .then(function (r) {
        if (!r.ok) throw new Error("Convert failed");
        return r.json();
      })
      .then(function (joke) {
        loadIdeas();
        showPanel("jokes");
        loadJokes();
      })
      .catch(function () {});
  }

  function deleteIdea(ideaId) {
    fetch(getBaseUrl() + API + "/ideas/" + ideaId, { method: "DELETE" })
      .then(function (r) {
        if (!r.ok) throw new Error("Delete failed");
        loadIdeas();
      })
      .catch(function () {});
  }

  function showSetDetail(id, opts) {
    var editOrder = opts && opts.editOrder === true;
    fetch(getBaseUrl() + API + "/sets/" + id, fetchOpts())
      .then(function (r) {
        if (!r.ok) throw new Error("Set not found");
        return r.json();
      })
      .then(function (data) {
        return fetch(getBaseUrl() + API + "/jokes", fetchOpts()).then(function (r2) {
          if (!r2.ok) throw new Error("Jokes not found");
          return r2.json();
        }).then(function (allJokes) {
          return { setData: data, allJokes: allJokes };
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
              var base = getBaseUrl();
              var path = "/sets/" + setId + "/jokes/order";
              var urlPost = base + API + path;
              var urlGet = base + API + path + "?joke_ids=" + encodeURIComponent(order.join(","));
              var optsPost = {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ joke_ids: order }),
                credentials: "same-origin"
              };
              var optsGet = { method: "GET", credentials: "same-origin" };
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
              fetch(urlPost, optsPost)
                .then(function (r) {
                  if (r.status === 405 || r.status === 404) {
                    return fetch(urlGet, optsGet).then(handleResponse);
                  }
                  return handleResponse(r);
                })
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
          fetch(getBaseUrl() + API + "/sets/" + setId + "/jokes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ joke_id: parseInt(jokeId, 10), position: position })
          })
            .then(function (r) {
              if (!r.ok) throw new Error("Add failed");
              showSetDetail(setId);
            })
            .catch(function () {});
        });

        el.querySelector("#set-detail-delete-btn").addEventListener("click", function () {
          if (!confirm("Delete this set? Jokes will not be deleted, only the set list.")) return;
          var setId = getSetDetailEl().dataset.setId;
          fetch(getBaseUrl() + API + "/sets/" + setId, { method: "DELETE" })
            .then(function (r) {
              if (!r.ok) throw new Error("Delete failed");
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
    fetch(getBaseUrl() + API + "/jokes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title, premise: premise, punchline: punchline, status: status })
    })
      .then(function (r) {
        if (!r.ok) throw new Error("Save failed");
        return r.json();
      })
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
    fetch(getBaseUrl() + API + "/ideas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content })
    })
      .then(function (r) {
        if (!r.ok) throw new Error("Add failed");
        return r.json();
      })
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
    fetch(getBaseUrl() + API + "/sets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, description: desc })
    })
      .then(function (r) {
        if (!r.ok) throw new Error("Create failed");
        return r.json();
      })
      .then(function () {
        document.getElementById("new-set-name").value = "";
        document.getElementById("new-set-desc").value = "";
        loadSets();
      })
      .catch(function () {});
  });

  function initApp() {
    document.querySelectorAll(".tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        showPanel(btn.getAttribute("data-tab"));
        if (btn.getAttribute("data-tab") === "jokes") loadJokes();
        if (btn.getAttribute("data-tab") === "ideas") loadIdeas();
        if (btn.getAttribute("data-tab") === "sets") loadSets();
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

  var baseUrl = getBaseUrl();
  if (!baseUrl || baseUrl === "null" || baseUrl.indexOf("file:") === 0) {
    document.getElementById("app-shell").classList.add("hidden");
    document.getElementById("auth-shell").classList.remove("hidden");
    showAuthError("Open this app from the server address (e.g. http://localhost:5000 or http://YOUR_PC_IP:5000), not as a file.");
    return;
  }

  fetch(baseUrl + API + "/me", fetchOpts())
    .then(function (r) { return r.json(); })
    .then(function (me) {
      if (!me.logged_in) {
        document.getElementById("app-shell").classList.add("hidden");
        document.getElementById("auth-shell").classList.remove("hidden");
        var authForm = document.getElementById("auth-form");
        var authSubmit = document.getElementById("auth-submit");
        var isRegister = false;
        document.querySelectorAll(".auth-tab").forEach(function (btn) {
          btn.addEventListener("click", function () {
            document.querySelectorAll(".auth-tab").forEach(function (b) { b.classList.remove("active"); });
            btn.classList.add("active");
            isRegister = btn.getAttribute("data-auth") === "register";
            authSubmit.textContent = isRegister ? "Register" : "Log in";
            hideAuthError();
          });
        });
        authForm.addEventListener("submit", function (e) {
          e.preventDefault();
          hideAuthError();
          var username = document.getElementById("auth-username").value.trim();
          var password = document.getElementById("auth-password").value;
          if (!username || !password) {
            showAuthError("Username and password required");
            return;
          }
          var url = getBaseUrl() + API + (isRegister ? "/register" : "/login");
          fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: username, password: password }),
            credentials: "same-origin"
          })
            .then(function (r) {
              if (r.ok) {
                window.location.reload();
                return;
              }
              return r.json().then(function (data) {
                showAuthError(data.error || "Something went wrong");
              });
            })
            .catch(function () { showAuthError("Network error"); });
        });
        return;
      }
      document.getElementById("auth-shell").classList.add("hidden");
      document.getElementById("app-shell").classList.remove("hidden");
      var userInfo = document.getElementById("user-info");
      userInfo.innerHTML = "<span class=\"header-username\">" + escapeHtml(me.username) + "</span><button type=\"button\" class=\"logout-btn\">Log out</button>";
      userInfo.querySelector(".logout-btn").addEventListener("click", function () {
        fetch(getBaseUrl() + API + "/logout", { method: "POST", credentials: "same-origin" })
          .then(function () { window.location.reload(); });
      });
      initApp();
    })
    .catch(function () {
      document.getElementById("app-shell").classList.add("hidden");
      document.getElementById("auth-shell").classList.remove("hidden");
      showAuthError("Could not reach server. Start the server with: python app.py (in the joke-db folder). Then open this page at http://localhost:5000 or, from your phone, http://YOUR_PC_IP:5000");
    });
})();
