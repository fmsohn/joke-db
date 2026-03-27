/**
 * Data layer: server (API) or local (IndexedDB) based on storage mode.
 * Provides same Promise API for app.js and importFromWeb() for local mode.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "stagetime_storage";
  var API = "/api";

  function getStorageMode() {
    try {
      var m = localStorage.getItem(STORAGE_KEY);
      return (m === "local" || m === "server") ? m : "server";
    } catch (e) {
      return "server";
    }
  }

  function setStorageMode(mode) {
    try {
      localStorage.setItem(STORAGE_KEY, mode === "local" ? "local" : "server");
    } catch (e) {}
  }

  function getBaseUrl() {
    try {
      var base = sessionStorage.getItem("stagetime_api_base");
      if (base) return base.replace(/\/$/, "");
    } catch (e) {}
    return window.location.origin;
  }

  function apiFetch(path, opts) {
    opts = opts || {};
    opts.credentials = "same-origin";
    return fetch(getBaseUrl() + API + path, opts).then(function (r) {
      if (r.status === 401) {
        try { window.dispatchEvent(new CustomEvent("stagetime-401")); } catch (e) {}
        return Promise.reject(new Error("Login required"));
      }
      return r;
    });
  }

  function serverListJokes(status) {
    var q = status ? "?status=" + encodeURIComponent(status) : "";
    return apiFetch("/jokes" + q).then(function (r) { return r.json(); });
  }

  function serverGetJoke(id) {
    return apiFetch("/jokes/" + id).then(function (r) { return r.json(); });
  }

  function serverAddJoke(data) {
    return apiFetch("/jokes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }).then(function (r) { return r.json(); });
  }

  function serverUpdateJoke(id, data) {
    return apiFetch("/jokes/" + id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }).then(function (r) { return r.json(); });
  }

  function serverDeleteJoke(id) {
    return apiFetch("/jokes/" + id, { method: "DELETE" }).then(function () {});
  }

  function serverListIdeas() {
    return apiFetch("/ideas").then(function (r) { return r.json(); });
  }

  function serverAddIdea(ideaOrContent) {
    var payload = typeof ideaOrContent === "object" && ideaOrContent !== null
      ? { title: ideaOrContent.title != null ? ideaOrContent.title : "", content: ideaOrContent.content != null ? ideaOrContent.content : "", tags: Array.isArray(ideaOrContent.tags) ? ideaOrContent.tags : [] }
      : { title: ideaOrContent || "", content: "", tags: [] };
    return apiFetch("/ideas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }

  function serverUpdateIdea(id, payload) {
    var body = typeof payload === "object" && payload !== null
      ? { title: payload.title != null ? payload.title : "", content: payload.content != null ? payload.content : "", topic: payload.topic, tags: Array.isArray(payload.tags) ? payload.tags : [] }
      : { content: payload || "" };
    return apiFetch("/ideas/" + id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  function serverDeleteIdea(id) {
    return apiFetch("/ideas/" + id, { method: "DELETE" }).then(function () {});
  }

  function serverConvertIdeaToJoke(ideaId, title) {
    return apiFetch("/ideas/" + ideaId + "/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title || "", status: "draft" })
    }).then(function (r) { return r.json(); });
  }

  function serverListSets() {
    return apiFetch("/sets").then(function (r) { return r.json(); });
  }

  function serverGetSetWithJokes(setId) {
    return apiFetch("/sets/" + setId).then(function (r) { return r.json(); });
  }

  function serverCreateSet(name, description) {
    return apiFetch("/sets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, description: description || "" })
    }).then(function (r) { return r.json(); });
  }

  function serverAddJokeToSet(setId, jokeId, position) {
    return apiFetch("/sets/" + setId + "/jokes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ joke_id: jokeId, position: position })
    }).then(function () {});
  }

  function serverReorderSetJokes(setId, jokeIds) {
    return apiFetch("/sets/" + setId + "/jokes/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ joke_ids: jokeIds })
    }).then(function (r) {
      if (r.ok) return r.json();
      return apiFetch("/sets/" + setId + "/jokes/order?joke_ids=" + encodeURIComponent(jokeIds.join(","))).then(function (r2) { return r2.json(); });
    });
  }

  function serverDeleteSet(setId) {
    return apiFetch("/sets/" + setId, { method: "DELETE" }).then(function () {});
  }

  /** Import from web: fetch jokes, ideas, sets from server and write into local DB (replaces local data). */
  function importFromWeb() {
    var base = getBaseUrl();
    if (!base || base === "null" || base.indexOf("file:") === 0) {
      return Promise.reject(new Error("Open this app from the server URL (e.g. http://YOUR_PC_IP:5000) to import from web."));
    }
    var Local = window.JokeDBLocal;
    if (!Local) return Promise.reject(new Error("Local storage not available."));

    return apiFetch("/jokes")
      .then(function (r) { return r.json(); })
      .then(function (jokes) {
        return apiFetch("/ideas").then(function (r) { return r.json(); }).then(function (ideas) {
          return apiFetch("/sets").then(function (r) { return r.json(); }).then(function (sets) {
            return { jokes: jokes, ideas: ideas, sets: sets };
          });
        });
      })
      .then(function (payload) {
        return Local.clearAll().then(function () {
          return Local.open();
        }).then(function (db) {
          var tx = db.transaction(["jokes", "ideas", "sets", "set_jokes"], "readwrite");
          var jokeStore = tx.objectStore("jokes");
          var ideaStore = tx.objectStore("ideas");
          var setStore = tx.objectStore("sets");
          var setJokeStore = tx.objectStore("set_jokes");

          var idMap = {}; // old server id -> new local id for jokes (so we can fix set_jokes)

          payload.jokes.forEach(function (j) {
            var t = (j.updated_at || j.created_at || new Date().toISOString()).replace("Z", "");
            var obj = {
              comedian_id: 1,
              title: j.title || null,
              premise: (j.premise || "").trim(),
              punchline: (j.punchline || "").trim() || null,
              setup_notes: j.setup_notes || null,
              status: j.status || "draft",
              created_at: j.created_at || t,
              updated_at: t
            };
            var req = jokeStore.add(obj);
            req.onsuccess = function () { idMap[j.id] = req.result; };
          });

          payload.ideas.forEach(function (i) {
            ideaStore.add({
              comedian_id: 1,
              content: (i.content || "").trim(),
              created_at: i.created_at || new Date().toISOString()
            });
          });

          payload.sets.forEach(function (s) {
            var t = (s.updated_at || s.created_at || new Date().toISOString()).replace("Z", "");
            setStore.add({
              comedian_id: 1,
              name: (s.name || "").trim(),
              description: (s.description || "").trim() || null,
              created_at: s.created_at || t,
              updated_at: t
            });
          });

          return new Promise(function (resolve, reject) {
            tx.oncomplete = function () {
              // Fetch set details to get joke order per set (set_jokes)
              var setIds = payload.sets.map(function (s) { return s.id; });
              var done = 0;
              if (setIds.length === 0) {
                resolve();
                return;
              }
              setIds.forEach(function (sid) {
                apiFetch("/sets/" + sid)
                  .then(function (r) { return r.json(); })
                  .then(function (data) {
                    var localSetId = payload.sets.filter(function (s) { return s.id === sid; })[0];
                    if (!localSetId) return;
                    var setIndex = payload.sets.findIndex(function (s) { return s.id === sid; });
                    var localSetIdNew = setIndex + 1;
                    (data.jokes || []).forEach(function (j, pos) {
                      var newJokeId = idMap[j.id];
                      if (newJokeId != null) {
                        return Local.addJokeToSet(localSetIdNew, newJokeId, pos);
                      }
                    });
                  })
                  .then(function () {
                    done++;
                    if (done >= setIds.length) resolve();
                  })
                  .catch(reject);
              });
            };
            tx.onerror = function () { reject(tx.error); };
          });
        });
      });
  }

  /** We need to fix import: server set ids don't match local set ids after add. So we should create sets one by one and then add jokes. Let me simplify: clear local, then create sets by name and re-add jokes by matching server joke ids to local joke ids (we already have idMap). So we need to create sets and set_jokes in the same transaction after jokes/ideas. Actually the issue is local set IDs are auto-increment so they'll be 1,2,3... and we're adding set_jokes with set_id from server (e.g. 5,6). I'll refactor import to: 1) clear all. 2) Add jokes, collect new ids. 3) Add ideas. 4) Add sets one by one, get new set id, then add set_jokes for that set using new joke ids. That way we need two phases. Let me do it in a simpler way: in the transaction we add jokes and store idMap (server id -> request.result is not available synchronously). So we need to do import in steps: 1) clear, 2) add all jokes and build idMap (async), 3) add all ideas, 4) for each set create set and get new id, then add set_jokes with new set id and idMap[joke_id]. I'll rewrite importFromWeb to be step-by-step. */
  function importFromWebFixed() {
    var base = getBaseUrl();
    if (!base || base === "null" || base.indexOf("file:") === 0) {
      return Promise.reject(new Error("Open this app from the server URL (e.g. http://YOUR_PC_IP:5000) to import from web."));
    }
    var Local = window.JokeDBLocal;
    if (!Local) return Promise.reject(new Error("Local storage not available."));

    var idMap = {};
    var setIdMap = {};

    return apiFetch("/jokes").then(function (r) { return r.json(); })
      .then(function (jokes) {
        return Local.clearAll().then(function () {
          return Promise.all(jokes.map(function (j) {
            return Local.addJoke({ title: j.title, premise: j.premise || "", punchline: j.punchline || "", status: j.status || "draft" })
              .then(function (created) {
                idMap[j.id] = created.id;
                return created;
              });
          }));
        });
      })
      .then(function () {
        return apiFetch("/ideas").then(function (r) { return r.json(); });
      })
      .then(function (ideas) {
        return Promise.all(ideas.map(function (i) {
          return Local.addIdea(i.content);
        }));
      })
      .then(function () {
        return apiFetch("/sets").then(function (r) { return r.json(); });
      })
      .then(function (sets) {
        return Promise.all(sets.map(function (s) {
          return Local.createSet(s.name, s.description || "").then(function (res) {
            var localSetId = res.set.id;
            return apiFetch("/sets/" + s.id).then(function (r) { return r.json(); })
              .then(function (detail) {
                var jokesInOrder = detail.jokes || [];
                return Promise.all(jokesInOrder.map(function (j, pos) {
                  var localJokeId = idMap[j.id];
                  if (localJokeId == null) return Promise.resolve();
                  return Local.addJokeToSet(localSetId, localJokeId, pos);
                }));
              });
          });
        }));
      });
  }

  window.dataLayer = {
    getStorageMode: getStorageMode,
    setStorageMode: setStorageMode,
    getBaseUrl: getBaseUrl,
    apiFetch: apiFetch,

    listJokes: function (status) {
      return getStorageMode() === "local"
        ? window.JokeDBLocal.listJokes(status)
        : serverListJokes(status);
    },

    getJoke: function (id) {
      return getStorageMode() === "local"
        ? window.JokeDBLocal.getJoke(id)
        : serverGetJoke(id);
    },

    addJoke: function (data) {
      return getStorageMode() === "local"
        ? window.JokeDBLocal.addJoke(data)
        : serverAddJoke(data);
    },

    updateJoke: function (id, data) {
      return getStorageMode() === "local"
        ? window.JokeDBLocal.updateJoke(id, data)
        : serverUpdateJoke(id, data);
    },

    deleteJoke: function (id) {
      return getStorageMode() === "local"
        ? window.JokeDBLocal.deleteJoke(id)
        : serverDeleteJoke(id);
    },

    listIdeas: function () {
      return getStorageMode() === "local"
        ? window.JokeDBLocal.listIdeas()
        : serverListIdeas();
    },

    addIdea: function (ideaOrContent) {
      return getStorageMode() === "local"
        ? window.JokeDBLocal.addIdea(ideaOrContent)
        : serverAddIdea(ideaOrContent);
    },

    updateIdea: function (id, content) {
      return getStorageMode() === "local"
        ? window.JokeDBLocal.updateIdea(id, content)
        : serverUpdateIdea(id, content);
    },

    deleteIdea: function (id) {
      return getStorageMode() === "local"
        ? window.JokeDBLocal.deleteIdea(id)
        : serverDeleteIdea(id);
    },

    convertIdeaToJoke: function (ideaId, title) {
      return getStorageMode() === "local"
        ? window.JokeDBLocal.convertIdeaToJoke(ideaId, title)
        : serverConvertIdeaToJoke(ideaId, title);
    },

    listSets: function () {
      return getStorageMode() === "local"
        ? window.JokeDBLocal.listSets()
        : serverListSets();
    },

    getSetWithJokes: function (setId) {
      return getStorageMode() === "local"
        ? window.JokeDBLocal.getSetWithJokes(setId)
        : serverGetSetWithJokes(setId);
    },

    createSet: function (name, description) {
      return getStorageMode() === "local"
        ? window.JokeDBLocal.createSet(name, description)
        : serverCreateSet(name, description);
    },

    addJokeToSet: function (setId, jokeId, position) {
      return getStorageMode() === "local"
        ? window.JokeDBLocal.addJokeToSet(setId, jokeId, position)
        : serverAddJokeToSet(setId, jokeId, position);
    },

    reorderSetJokes: function (setId, jokeIds) {
      return getStorageMode() === "local"
        ? window.JokeDBLocal.reorderSetJokes(setId, jokeIds)
        : serverReorderSetJokes(setId, jokeIds);
    },

    deleteSet: function (setId) {
      return getStorageMode() === "local"
        ? window.JokeDBLocal.deleteSet(setId)
        : serverDeleteSet(setId);
    },

    importFromWeb: importFromWebFixed
  };
})();
