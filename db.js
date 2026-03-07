/**
 * db.js – Pure static PWA backend (replaces joke_db.py + app.py).
 * IndexedDB: jokes, sets, tags, ideas, set_jokes, joke_tags.
 * Exposes window.dataLayer for the SPA (app.js).
 */
(function () {
  "use strict";

  var DB_NAME = "joke_db_local";
  var DB_VERSION = 2;
  var COMEDIAN_ID = 1;

  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = function () { reject(req.error); };
      req.onsuccess = function () { resolve(req.result); };
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains("jokes")) {
          var js = db.createObjectStore("jokes", { keyPath: "id", autoIncrement: true });
          js.createIndex("comedian_id", "comedian_id", { unique: false });
          js.createIndex("status", "status", { unique: false });
          js.createIndex("updated_at", "updated_at", { unique: false });
        }
        if (!db.objectStoreNames.contains("ideas")) {
          var is_ = db.createObjectStore("ideas", { keyPath: "id", autoIncrement: true });
          is_.createIndex("comedian_id", "comedian_id", { unique: false });
          is_.createIndex("created_at", "created_at", { unique: false });
        }
        if (!db.objectStoreNames.contains("sets")) {
          var ss = db.createObjectStore("sets", { keyPath: "id", autoIncrement: true });
          ss.createIndex("comedian_id", "comedian_id", { unique: false });
          ss.createIndex("updated_at", "updated_at", { unique: false });
        }
        if (!db.objectStoreNames.contains("set_jokes")) {
          var sj = db.createObjectStore("set_jokes", { keyPath: ["set_id", "joke_id"] });
          sj.createIndex("set_id", "set_id", { unique: false });
        }
        if (!db.objectStoreNames.contains("tags")) {
          var ts = db.createObjectStore("tags", { keyPath: "id", autoIncrement: true });
          ts.createIndex("name", "name", { unique: true });
        }
        if (!db.objectStoreNames.contains("joke_tags")) {
          var jt = db.createObjectStore("joke_tags", { keyPath: ["joke_id", "tag_id"] });
          jt.createIndex("joke_id", "joke_id", { unique: false });
          jt.createIndex("tag_id", "tag_id", { unique: false });
        }
      };
    });
  }

  function now() {
    return new Date().toISOString().replace("Z", "");
  }

  function withStore(db, storeName, mode, fn) {
    var tx = db.transaction(storeName, mode);
    var store = tx.objectStore(storeName);
    return fn(store, tx);
  }

  function listJokes(store, status) {
    return new Promise(function (resolve, reject) {
      var req = status
        ? store.index("status").getAll(IDBKeyRange.only(status))
        : store.getAll();
      req.onsuccess = function () {
        var rows = (req.result || []).filter(function (r) { return r.comedian_id === COMEDIAN_ID; });
        rows.sort(function (a, b) {
          var ta = (a.updated_at || a.created_at || "").replace("Z", "");
          var tb = (b.updated_at || b.created_at || "").replace("Z", "");
          return tb.localeCompare(ta);
        });
        resolve(rows);
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function getJoke(store, id) {
    return new Promise(function (resolve, reject) {
      var req = store.get(parseInt(id, 10));
      req.onsuccess = function () {
        var row = req.result;
        resolve(row && row.comedian_id === COMEDIAN_ID ? row : null);
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function addJoke(store, tx, data) {
    return new Promise(function (resolve, reject) {
      var t = now();
      var obj = {
        comedian_id: COMEDIAN_ID,
        title: data.title || null,
        premise: (data.premise || "").trim(),
        punchline: (data.punchline || "").trim() || null,
        setup_notes: data.setup_notes || null,
        status: data.status || "draft",
        created_at: t,
        updated_at: t
      };
      var req = store.add(obj);
      req.onsuccess = function () {
        obj.id = req.result;
        resolve(obj);
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function updateJoke(store, id, updates) {
    return new Promise(function (resolve, reject) {
      var req = store.get(parseInt(id, 10));
      req.onsuccess = function () {
        var row = req.result;
        if (!row || row.comedian_id !== COMEDIAN_ID) {
          resolve(null);
          return;
        }
        var allowed = ["title", "premise", "punchline", "setup_notes", "status"];
        allowed.forEach(function (k) {
          if (updates[k] !== undefined) row[k] = updates[k];
        });
        row.updated_at = now();
        var putReq = store.put(row);
        putReq.onsuccess = function () { resolve(row); };
        putReq.onerror = function () { reject(putReq.error); };
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function deleteJoke(store, tx, id) {
    return new Promise(function (resolve, reject) {
      var req = store.get(parseInt(id, 10));
      req.onsuccess = function () {
        var row = req.result;
        if (!row || row.comedian_id !== COMEDIAN_ID) {
          resolve(false);
          return;
        }
        store.delete(parseInt(id, 10));
        resolve(true);
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function listIdeas(store) {
    return new Promise(function (resolve, reject) {
      var req = store.getAll();
      req.onsuccess = function () {
        var rows = (req.result || []).filter(function (r) { return r.comedian_id === COMEDIAN_ID; });
        rows.sort(function (a, b) {
          return (b.created_at || "").localeCompare(a.created_at || "");
        });
        resolve(rows);
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function addIdea(store, content) {
    return new Promise(function (resolve, reject) {
      var obj = {
        comedian_id: COMEDIAN_ID,
        content: (content || "").trim(),
        created_at: now()
      };
      var req = store.add(obj);
      req.onsuccess = function () {
        obj.id = req.result;
        resolve(obj);
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function getIdea(store, id) {
    return new Promise(function (resolve, reject) {
      var req = store.get(parseInt(id, 10));
      req.onsuccess = function () {
        var row = req.result;
        resolve(row && row.comedian_id === COMEDIAN_ID ? row : null);
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function updateIdea(store, id, content) {
    return new Promise(function (resolve, reject) {
      var req = store.get(parseInt(id, 10));
      req.onsuccess = function () {
        var row = req.result;
        if (!row || row.comedian_id !== COMEDIAN_ID) {
          resolve(null);
          return;
        }
        row.content = (content || "").trim();
        var putReq = store.put(row);
        putReq.onsuccess = function () { resolve(row); };
        putReq.onerror = function () { reject(putReq.error); };
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function deleteIdea(store, id) {
    return new Promise(function (resolve, reject) {
      var req = store.get(parseInt(id, 10));
      req.onsuccess = function () {
        var row = req.result;
        if (!row || row.comedian_id !== COMEDIAN_ID) {
          resolve(false);
          return;
        }
        store.delete(parseInt(id, 10));
        resolve(true);
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function listSets(store) {
    return new Promise(function (resolve, reject) {
      var req = store.getAll();
      req.onsuccess = function () {
        var rows = (req.result || []).filter(function (r) { return r.comedian_id === COMEDIAN_ID; });
        rows.sort(function (a, b) {
          return (b.updated_at || b.created_at || "").localeCompare(a.updated_at || a.created_at || "");
        });
        resolve(rows);
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function getSetWithJokes(db, setId) {
    return new Promise(function (resolve, reject) {
      var setStore = db.transaction("sets", "readonly").objectStore("sets");
      var setReq = setStore.get(parseInt(setId, 10));
      setReq.onsuccess = function () {
        var setRow = setReq.result;
        if (!setRow || setRow.comedian_id !== COMEDIAN_ID) {
          resolve(null);
          return;
        }
        var sjStore = db.transaction("set_jokes", "readonly").objectStore("set_jokes");
        var idx = sjStore.index("set_id");
        var sjReq = idx.getAll(parseInt(setId, 10));
        sjReq.onsuccess = function () {
          var links = sjReq.result || [];
          links.sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
          var jokeStore = db.transaction("jokes", "readonly").objectStore("jokes");
          var jokes = [];
          var i = 0;
          function next() {
            if (i >= links.length) {
              resolve({ set: setRow, jokes: jokes });
              return;
            }
            var jReq = jokeStore.get(links[i].joke_id);
            jReq.onsuccess = function () {
              if (jReq.result) jokes.push(jReq.result);
              i++;
              next();
            };
            jReq.onerror = function () { reject(jReq.error); };
          };
          next();
        };
        sjReq.onerror = function () { reject(sjReq.error); };
      };
      setReq.onerror = function () { reject(setReq.error); };
    });
  }

  function createSet(store, name, description) {
    return new Promise(function (resolve, reject) {
      var t = now();
      var obj = {
        comedian_id: COMEDIAN_ID,
        name: (name || "").trim(),
        description: (description || "").trim() || null,
        created_at: t,
        updated_at: t
      };
      var req = store.add(obj);
      req.onsuccess = function () {
        obj.id = req.result;
        resolve({ set: obj, jokes: [] });
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function addJokeToSet(store, setId, jokeId, position) {
    return new Promise(function (resolve, reject) {
      var obj = { set_id: parseInt(setId, 10), joke_id: parseInt(jokeId, 10), position: parseInt(position, 10) || 0 };
      var req = store.put(obj);
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function reorderSetJokes(db, setId, jokeIds) {
    return new Promise(function (resolve, reject) {
      var store = db.transaction("set_jokes", "readwrite").objectStore("set_jokes");
      var setIdNum = parseInt(setId, 10);
      var idx = store.index("set_id");
      var req = idx.getAll(setIdNum);
      req.onsuccess = function () {
        var existing = req.result || [];
        existing.forEach(function (e) { store.delete([e.set_id, e.joke_id]); });
        jokeIds.forEach(function (jokeId, pos) {
          store.put({ set_id: setIdNum, joke_id: parseInt(jokeId, 10), position: pos });
        });
        resolve();
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function deleteSet(store, setId) {
    return new Promise(function (resolve, reject) {
      var req = store.get(parseInt(setId, 10));
      req.onsuccess = function () {
        var row = req.result;
        if (!row || row.comedian_id !== COMEDIAN_ID) {
          resolve(false);
          return;
        }
        store.delete(parseInt(setId, 10));
        resolve(true);
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function listTags(store) {
    return new Promise(function (resolve, reject) {
      var req = store.getAll();
      req.onsuccess = function () {
        var rows = req.result || [];
        rows.sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
        resolve(rows);
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function addTagToJoke(store, jokeId, tagName) {
    return new Promise(function (resolve, reject) {
      var name = (tagName || "").trim();
      if (!name) {
        resolve();
        return;
      }
      var jokeIdNum = parseInt(jokeId, 10);
      store.put({ joke_id: jokeIdNum, tag_id: name });
      resolve();
    });
  }

  function getOrCreateTag(db, name) {
    return new Promise(function (resolve, reject) {
      var store = db.transaction("tags", "readwrite").objectStore("tags");
      var idx = store.index("name");
      var req = idx.get((name || "").trim());
      req.onsuccess = function () {
        if (req.result) {
          resolve(req.result.id);
          return;
        }
        var t = now();
        var obj = { name: (name || "").trim(), created_at: t };
        var addReq = store.add(obj);
        addReq.onsuccess = function () {
          obj.id = addReq.result;
          resolve(obj.id);
        };
        addReq.onerror = function () { reject(addReq.error); };
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function addJokeTagLink(store, jokeId, tagId) {
    return new Promise(function (resolve, reject) {
      var obj = { joke_id: parseInt(jokeId, 10), tag_id: parseInt(tagId, 10) };
      var req = store.put(obj);
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function getTagsForJoke(db, jokeId) {
    return new Promise(function (resolve, reject) {
      var jtStore = db.transaction("joke_tags", "readonly").objectStore("joke_tags");
      var idx = jtStore.index("joke_id");
      var req = idx.getAll(parseInt(jokeId, 10));
      req.onsuccess = function () {
        var links = req.result || [];
        if (links.length === 0) {
          resolve([]);
          return;
        }
        var tagStore = db.transaction("tags", "readonly").objectStore("tags");
        var tagIds = links.map(function (l) { return l.tag_id; });
        var names = [];
        var i = 0;
        function next() {
          if (i >= tagIds.length) {
            resolve(names);
            return;
          }
          var r = tagStore.get(tagIds[i]);
          r.onsuccess = function () {
            if (r.result) names.push(r.result.name);
            i++;
            next();
          };
          r.onerror = function () { reject(r.error); };
        };
        next();
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function clearAll(db) {
    return new Promise(function (resolve, reject) {
      var stores = ["jokes", "ideas", "sets", "set_jokes", "tags", "joke_tags"];
      var tx = db.transaction(stores, "readwrite");
      stores.forEach(function (s) { tx.objectStore(s).clear(); });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  function removeSetJokesForJoke(db, jokeId) {
    return new Promise(function (resolve, reject) {
      var sj = db.transaction("set_jokes", "readwrite").objectStore("set_jokes");
      var req = sj.openCursor();
      req.onsuccess = function () {
        var c = req.result;
        if (c && c.value.joke_id === parseInt(jokeId, 10)) c.delete();
        if (c) c.continue();
        else resolve();
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function removeJokeTagsForJoke(db, jokeId) {
    return new Promise(function (resolve, reject) {
      var jt = db.transaction("joke_tags", "readwrite").objectStore("joke_tags");
      var idx = jt.index("joke_id");
      var req = idx.openCursor(IDBKeyRange.only(parseInt(jokeId, 10)));
      req.onsuccess = function () {
        var c = req.result;
        if (c) { c.delete(); c.continue(); }
        else resolve();
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function removeSetJokesForSet(db, setId) {
    return new Promise(function (resolve, reject) {
      var sj = db.transaction("set_jokes", "readwrite").objectStore("set_jokes");
      var idx = sj.index("set_id");
      var req = idx.openCursor(IDBKeyRange.only(parseInt(setId, 10)));
      req.onsuccess = function () {
        var c = req.result;
        if (c) { c.delete(); c.continue(); }
        else resolve();
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function importFromMigrationJson(data) {
    data = data || {};
    var ideas = data.ideas || [];
    var jokes = data.jokes || [];
    var sets = data.sets || [];
    var setJokes = data.set_jokes || [];
    var tags = data.tags || [];
    var jokeTags = data.joke_tags || [];

    return openDB().then(function (db) {
      return clearAll(db).then(function () {
        var jokeIdMap = {};
        var setIdMap = {};
        var tagIdMap = {};

        function addIdeas() {
          return ideas.reduce(function (p, i) {
            return p.then(function () {
              return withStore(db, "ideas", "readwrite", function (store) {
                return addIdea(store, i.content || "");
              });
            });
          }, Promise.resolve());
        }

        function addJokes() {
          return jokes.reduce(function (p, j) {
            return p.then(function () {
              return withStore(db, "jokes", "readwrite", function (store, tx) {
                var t = (j.updated_at || j.created_at || now()).toString().replace("Z", "");
                var obj = {
                  comedian_id: COMEDIAN_ID,
                  title: j.title || null,
                  premise: (j.premise || "").trim(),
                  punchline: (j.punchline || "").trim() || null,
                  setup_notes: j.setup_notes || null,
                  status: j.status || "draft",
                  created_at: j.created_at || t,
                  updated_at: t
                };
                return new Promise(function (resolve, reject) {
                  var req = store.add(obj);
                  req.onsuccess = function () {
                    obj.id = req.result;
                    if (j.id != null) jokeIdMap[j.id] = obj.id;
                    resolve(obj);
                  };
                  req.onerror = function () { reject(req.error); };
                });
              });
            });
          }, Promise.resolve());
        }

        function addTags() {
          return tags.reduce(function (p, t) {
            return p.then(function () {
              return getOrCreateTag(db, t.name || "").then(function (newId) {
                if (t.id != null) tagIdMap[t.id] = newId;
                return newId;
              });
            });
          }, Promise.resolve());
        }

        function addSets() {
          return sets.reduce(function (p, s) {
            return p.then(function () {
              return withStore(db, "sets", "readwrite", function (store) {
                return new Promise(function (resolve, reject) {
                  var t = (s.updated_at || s.created_at || now()).toString().replace("Z", "");
                  var obj = {
                    comedian_id: COMEDIAN_ID,
                    name: (s.name || "").trim(),
                    description: (s.description || "").trim() || null,
                    created_at: s.created_at || t,
                    updated_at: t
                  };
                  var req = store.add(obj);
                  req.onsuccess = function () {
                    obj.id = req.result;
                    if (s.id != null) setIdMap[s.id] = obj.id;
                    resolve(obj);
                  };
                  req.onerror = function () { reject(req.error); };
                });
              });
            });
          }, Promise.resolve());
        }

        function addSetJokes() {
          return setJokes.reduce(function (p, sj) {
            return p.then(function () {
              var newSetId = setIdMap[sj.set_id];
              var newJokeId = jokeIdMap[sj.joke_id];
              if (newSetId == null || newJokeId == null) return;
              return withStore(db, "set_jokes", "readwrite", function (store) {
                return addJokeToSet(store, newSetId, newJokeId, sj.position != null ? sj.position : 0);
              });
            });
          }, Promise.resolve());
        }

        function addJokeTags() {
          return jokeTags.reduce(function (p, jt) {
            return p.then(function () {
              var newJokeId = jokeIdMap[jt.joke_id];
              var newTagId = tagIdMap[jt.tag_id];
              if (newJokeId == null || newTagId == null) return;
              return withStore(db, "joke_tags", "readwrite", function (store) {
                return addJokeTagLink(store, newJokeId, newTagId);
              });
            });
          }, Promise.resolve());
        }

        return addIdeas()
          .then(addJokes)
          .then(addTags)
          .then(addSets)
          .then(addSetJokes)
          .then(addJokeTags);
      });
    });
  }

  window.dataLayer = {
    getStorageMode: function () { return "local"; },
    setStorageMode: function () {},
    getBaseUrl: function () { return window.location.origin; },
    apiFetch: function () { return Promise.reject(new Error("Offline-only app")); },

    listJokes: function (status) {
      return openDB().then(function (db) {
        return withStore(db, "jokes", "readonly", function (store) {
          return listJokes(store, status);
        });
      });
    },

    getJoke: function (id) {
      return openDB().then(function (db) {
        return withStore(db, "jokes", "readonly", function (store) {
          return getJoke(store, id);
        });
      });
    },

    addJoke: function (data) {
      return openDB().then(function (db) {
        return withStore(db, "jokes", "readwrite", function (store, tx) {
          return addJoke(store, tx, data);
        });
      });
    },

    updateJoke: function (id, updates) {
      return openDB().then(function (db) {
        return withStore(db, "jokes", "readwrite", function (store) {
          return updateJoke(store, id, updates);
        });
      });
    },

    deleteJoke: function (id) {
      return openDB().then(function (db) {
        return withStore(db, "jokes", "readwrite", function (store, tx) {
          return deleteJoke(store, tx, id).then(function (ok) {
            if (ok) {
              return Promise.all([
                removeSetJokesForJoke(db, id),
                removeJokeTagsForJoke(db, id)
              ]).then(function () { return ok; });
            }
            return ok;
          });
        });
      });
    },

    listIdeas: function () {
      return openDB().then(function (db) {
        return withStore(db, "ideas", "readonly", listIdeas);
      });
    },

    addIdea: function (content) {
      return openDB().then(function (db) {
        return withStore(db, "ideas", "readwrite", function (store) {
          return addIdea(store, content);
        });
      });
    },

    getIdea: function (id) {
      return openDB().then(function (db) {
        return withStore(db, "ideas", "readonly", function (store) {
          return getIdea(store, id);
        });
      });
    },

    updateIdea: function (id, content) {
      return openDB().then(function (db) {
        return withStore(db, "ideas", "readwrite", function (store) {
          return updateIdea(store, id, content);
        });
      });
    },

    deleteIdea: function (id) {
      return openDB().then(function (db) {
        return withStore(db, "ideas", "readwrite", function (store) {
          return deleteIdea(store, id);
        });
      });
    },

    convertIdeaToJoke: function (ideaId, title) {
      var self = this;
      return this.getIdea(ideaId).then(function (idea) {
        if (!idea) return Promise.reject(new Error("Idea not found"));
        var t = (title || idea.content || "").trim();
        return self.addJoke({ title: t, premise: "", punchline: "", status: "draft" })
          .then(function (joke) {
            return self.deleteIdea(ideaId).then(function () { return joke; });
          });
      });
    },

    listSets: function () {
      return openDB().then(function (db) {
        return withStore(db, "sets", "readonly", listSets);
      });
    },

    getSetWithJokes: function (setId) {
      return openDB().then(function (db) {
        return getSetWithJokes(db, setId);
      });
    },

    createSet: function (name, description) {
      return openDB().then(function (db) {
        return withStore(db, "sets", "readwrite", function (store) {
          return createSet(store, name, description);
        });
      });
    },

    addJokeToSet: function (setId, jokeId, position) {
      return openDB().then(function (db) {
        return withStore(db, "set_jokes", "readwrite", function (store) {
          return addJokeToSet(store, setId, jokeId, position);
        });
      });
    },

    reorderSetJokes: function (setId, jokeIds) {
      return openDB().then(function (db) {
        return reorderSetJokes(db, setId, jokeIds).then(function () {
          return window.dataLayer.getSetWithJokes(setId);
        });
      });
    },

    deleteSet: function (setId) {
      return openDB().then(function (db) {
        return withStore(db, "sets", "readwrite", function (store) {
          return deleteSet(store, setId).then(function (ok) {
            if (ok) return removeSetJokesForSet(db, setId);
            return ok;
          });
        });
      });
    },

    listTags: function () {
      return openDB().then(function (db) {
        return withStore(db, "tags", "readonly", listTags);
      });
    },

    getTagsForJoke: function (jokeId) {
      return openDB().then(function (db) {
        return getTagsForJoke(db, jokeId);
      });
    },

    addTagToJoke: function (jokeId, tagName) {
      var self = this;
      return openDB().then(function (db) {
        return getOrCreateTag(db, tagName).then(function (tagId) {
          return withStore(db, "joke_tags", "readwrite", function (store) {
            return addJokeTagLink(store, jokeId, tagId);
          });
        });
      });
    },

    clearAll: function () {
      return openDB().then(clearAll);
    },

    importFromMigrationJson: importFromMigrationJson
  };
})();
