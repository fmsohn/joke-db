/**
 * data.js – Stagetime PWA data layer.
 * IndexedDB-backed: addJoke, listJokes, createSet, ideas, sets, set_jokes.
 * Exposes window.dataLayer for the SPA (app.js).
 * 1.1: appConfig provides defaultItem and masterTopics for graceful migration.
 */
(function () {
  "use strict";

  var DB_NAME = "joke_db_local";
  var DB_VERSION = 2;
  var COMEDIAN_ID = 1;

  var appConfig = {
    masterTopics: ["Work", "Relationships", "Travel", "Politics", "General Observations", "Uncategorized"],
    defaultItem: { type: "joke", title: "", content: "", topic: "Uncategorized", tags: [], rating: 0, notes: "", createdAt: new Date().toISOString() }
  };

  function toLoadedShape(row, type) {
    if (!row) return null;
    var notes = row.setup_notes != null ? row.setup_notes : (row.notes != null ? row.notes : "");
    var createdAt = row.created_at || row.createdAt || "";
    var title = row.title != null ? row.title : "";
    var content = type === "idea" ? (row.content != null ? row.content : "") : (row.premise != null ? row.premise : (row.title != null ? row.title : ""));
    return {
      id: row.id,
      type: type || row.type || "joke",
      title: title,
      content: content,
      topic: row.topic != null ? row.topic : "Uncategorized",
      tags: Array.isArray(row.tags) ? row.tags.slice() : [],
      rating: row.rating != null && row.rating >= 1 && row.rating <= 5 ? row.rating : 0,
      notes: notes,
      createdAt: createdAt,
      premise: row.premise,
      punchline: row.punchline,
      setup_notes: row.setup_notes,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      comedian_id: row.comedian_id
    };
  }

  function normalizeJoke(row) {
    if (!row) return null;
    var loaded = toLoadedShape(row, "joke");
    return Object.assign({}, appConfig.defaultItem, loaded);
  }

  function normalizeIdea(row) {
    if (!row) return null;
    var loaded = toLoadedShape(row, "idea");
    return Object.assign({}, appConfig.defaultItem, loaded);
  }

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
        if (!db.objectStoreNames.contains("config")) {
          db.createObjectStore("config", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("set_items")) {
          var si = db.createObjectStore("set_items", { keyPath: "id", autoIncrement: true });
          si.createIndex("set_id", "set_id", { unique: false });
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
        var rows = (req.result || []).filter(function (r) { return r.comedian_id === COMEDIAN_ID; }).map(normalizeJoke);
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
        resolve(row && row.comedian_id === COMEDIAN_ID ? normalizeJoke(row) : null);
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function addJoke(store, tx, data) {
    return new Promise(function (resolve, reject) {
      var t = now();
      var obj = {
        comedian_id: COMEDIAN_ID,
        type: "joke",
        title: data.title || null,
        premise: (data.premise || "").trim(),
        punchline: (data.punchline || "").trim() || null,
        setup_notes: data.setup_notes || null,
        status: data.status || "draft",
        topic: data.topic != null ? data.topic : null,
        tags: Array.isArray(data.tags) ? data.tags.slice() : [],
        rating: data.rating != null && data.rating >= 1 && data.rating <= 5 ? data.rating : null,
        created_at: t,
        updated_at: t
      };
      var req = store.add(obj);
      req.onsuccess = function () {
        obj.id = req.result;
        resolve(normalizeJoke(obj));
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
        var allowed = ["title", "premise", "punchline", "setup_notes", "status", "topic", "tags", "rating"];
        allowed.forEach(function (k) {
          if (updates[k] !== undefined) row[k] = k === "tags" ? (Array.isArray(updates[k]) ? updates[k].slice() : []) : (k === "rating" && updates[k] != null ? (updates[k] >= 1 && updates[k] <= 5 ? updates[k] : null) : updates[k]);
        });
        row.updated_at = now();
        var putReq = store.put(row);
        putReq.onsuccess = function () { resolve(normalizeJoke(row)); };
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
        var rows = (req.result || []).filter(function (r) { return r.comedian_id === COMEDIAN_ID; }).map(normalizeIdea);
        rows.sort(function (a, b) {
          return (b.created_at || "").localeCompare(a.created_at || "");
        });
        resolve(rows);
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function addIdea(store, contentOrObj) {
    var content = "";
    var topic = null;
    var tags = [];
    var rating = null;
    var notes = "";
    if (typeof contentOrObj === "string") {
      content = (contentOrObj || "").trim();
    } else if (contentOrObj && typeof contentOrObj === "object") {
      content = (contentOrObj.content || "").trim();
      topic = contentOrObj.topic != null ? contentOrObj.topic : null;
      tags = Array.isArray(contentOrObj.tags) ? contentOrObj.tags.slice() : [];
      rating = contentOrObj.rating != null && contentOrObj.rating >= 1 && contentOrObj.rating <= 5 ? contentOrObj.rating : null;
      notes = (contentOrObj.notes != null ? contentOrObj.notes : "") || "";
    }
    return new Promise(function (resolve, reject) {
      var obj = {
        comedian_id: COMEDIAN_ID,
        type: "idea",
        content: content,
        topic: topic,
        tags: tags,
        rating: rating,
        notes: notes,
        created_at: now()
      };
      var req = store.add(obj);
      req.onsuccess = function () {
        obj.id = req.result;
        resolve(normalizeIdea(obj));
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function getIdea(store, id) {
    return new Promise(function (resolve, reject) {
      var req = store.get(parseInt(id, 10));
      req.onsuccess = function () {
        var row = req.result;
        resolve(row && row.comedian_id === COMEDIAN_ID ? normalizeIdea(row) : null);
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function updateIdea(store, id, contentOrUpdates) {
    return new Promise(function (resolve, reject) {
      var req = store.get(parseInt(id, 10));
      req.onsuccess = function () {
        var row = req.result;
        if (!row || row.comedian_id !== COMEDIAN_ID) {
          resolve(null);
          return;
        }
        if (typeof contentOrUpdates === "string") {
          row.content = (contentOrUpdates || "").trim();
        } else if (contentOrUpdates && typeof contentOrUpdates === "object") {
          if (contentOrUpdates.content !== undefined) row.content = (contentOrUpdates.content || "").trim();
          if (contentOrUpdates.topic !== undefined) row.topic = contentOrUpdates.topic;
          if (contentOrUpdates.tags !== undefined) row.tags = Array.isArray(contentOrUpdates.tags) ? contentOrUpdates.tags.slice() : [];
          if (contentOrUpdates.rating !== undefined) row.rating = contentOrUpdates.rating >= 1 && contentOrUpdates.rating <= 5 ? contentOrUpdates.rating : null;
          if (contentOrUpdates.notes !== undefined) row.notes = contentOrUpdates.notes != null ? String(contentOrUpdates.notes) : "";
        }
        var putReq = store.put(row);
        putReq.onsuccess = function () { resolve(normalizeIdea(row)); };
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

  function getMasterTopics(db) {
    return new Promise(function (resolve, reject) {
      var store = db.transaction("config", "readonly").objectStore("config");
      var req = store.get("masterTopics");
      req.onsuccess = function () {
        var row = req.result;
        var list = Array.isArray(row && row.value) ? row.value.slice() : [];
        if (list.length === 0 && appConfig.masterTopics && appConfig.masterTopics.length) {
          setMasterTopics(db, appConfig.masterTopics).then(function () {
            resolve(appConfig.masterTopics.slice());
          }).catch(reject);
          return;
        }
        resolve(list);
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function setMasterTopics(db, arr) {
    return new Promise(function (resolve, reject) {
      var store = db.transaction("config", "readwrite").objectStore("config");
      var req = store.put({ key: "masterTopics", value: Array.isArray(arr) ? arr.slice() : [] });
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function getSetWithItems(db, setId) {
    var setIdNum = parseInt(setId, 10);
    return new Promise(function (resolve, reject) {
      var setStore = db.transaction("sets", "readonly").objectStore("sets");
      var setReq = setStore.get(setIdNum);
      setReq.onsuccess = function () {
        var setRow = setReq.result;
        if (!setRow || setRow.comedian_id !== COMEDIAN_ID) {
          resolve(null);
          return;
        }
        var siStore = db.transaction("set_items", "readonly").objectStore("set_items");
        var idx = siStore.index("set_id");
        var siReq = idx.getAll(setIdNum);
        siReq.onsuccess = function () {
          var links = siReq.result || [];
          links.sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
          if (links.length === 0) {
            var sjStore = db.transaction("set_jokes", "readonly").objectStore("set_jokes");
            var sjIdx = sjStore.index("set_id");
            var sjReq = sjIdx.getAll(setIdNum);
            sjReq.onsuccess = function () {
              var legacy = sjReq.result || [];
              legacy.sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
              if (legacy.length === 0) {
                resolve({ set: setRow, items: [] });
                return;
              }
              var jokeStore = db.transaction("jokes", "readonly").objectStore("jokes");
              var items = [];
              var i = 0;
              function next() {
                if (i >= legacy.length) {
                  var siWrite = db.transaction("set_items", "readwrite").objectStore("set_items");
                  legacy.forEach(function (link, pos) {
                    siWrite.add({ set_id: setIdNum, item_type: "joke", item_id: link.joke_id, position: pos });
                  });
                  resolve({ set: setRow, items: items });
                  return;
                }
                var jReq = jokeStore.get(legacy[i].joke_id);
                jReq.onsuccess = function () {
                  if (jReq.result) items.push(normalizeJoke(jReq.result));
                  i++;
                  next();
                };
                jReq.onerror = function () { reject(jReq.error); };
              }
              next();
            };
            sjReq.onerror = function () { reject(sjReq.error); };
            return;
          }
          var items = [];
          var pos = 0;
          function fetchNext() {
            if (pos >= links.length) {
              resolve({ set: setRow, items: items });
              return;
            }
            var link = links[pos];
            var storeName = link.item_type === "idea" ? "ideas" : "jokes";
            var fetchStore = db.transaction(storeName, "readonly").objectStore(storeName);
            var fReq = fetchStore.get(link.item_id);
            fReq.onsuccess = function () {
              if (fReq.result && fReq.result.comedian_id === COMEDIAN_ID) {
                items.push(link.item_type === "idea" ? normalizeIdea(fReq.result) : normalizeJoke(fReq.result));
              }
              pos++;
              fetchNext();
            };
            fReq.onerror = function () { reject(fReq.error); };
          }
          fetchNext();
        };
        siReq.onerror = function () { reject(siReq.error); };
      };
      setReq.onerror = function () { reject(setReq.error); };
    });
  }

  function addItemToSet(store, setId, itemType, itemId, position) {
    return new Promise(function (resolve, reject) {
      var obj = {
        set_id: parseInt(setId, 10),
        item_type: itemType === "idea" ? "idea" : "joke",
        item_id: parseInt(itemId, 10),
        position: parseInt(position, 10) || 0
      };
      var req = store.add(obj);
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function reorderSetItems(db, setId, orderedRefs) {
    return new Promise(function (resolve, reject) {
      var store = db.transaction("set_items", "readwrite").objectStore("set_items");
      var idx = store.index("set_id");
      var req = idx.getAll(parseInt(setId, 10));
      req.onsuccess = function () {
        var existing = req.result || [];
        existing.forEach(function (e) { store.delete(e.id); });
        orderedRefs.forEach(function (ref, pos) {
          var t = ref.type != null ? ref.type : ref.item_type;
          var id = ref.id != null ? ref.id : ref.item_id;
          store.add({
            set_id: parseInt(setId, 10),
            item_type: t === "idea" ? "idea" : "joke",
            item_id: parseInt(id, 10),
            position: pos
          });
        });
        resolve();
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function removeSetItemsForSet(db, setId) {
    return new Promise(function (resolve, reject) {
      var si = db.transaction("set_items", "readwrite").objectStore("set_items");
      var idx = si.index("set_id");
      var req = idx.openCursor(IDBKeyRange.only(parseInt(setId, 10)));
      req.onsuccess = function () {
        var c = req.result;
        if (c) { c.delete(); c.continue(); }
        else resolve();
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function removeItemFromSet(db, setId, itemType, itemId) {
    var setIdNum = parseInt(setId, 10);
    var itemIdNum = parseInt(itemId, 10);
    var typeStr = itemType === "idea" ? "idea" : "joke";
    return new Promise(function (resolve, reject) {
      var si = db.transaction("set_items", "readwrite").objectStore("set_items");
      var idx = si.index("set_id");
      var req = idx.getAll(setIdNum);
      req.onsuccess = function () {
        var rows = req.result || [];
        var found = rows.find(function (r) { return r.item_type === typeStr && r.item_id === itemIdNum; });
        if (found) {
          si.delete(found.id);
        }
        if (typeStr === "joke") {
          var sj = db.transaction("set_jokes", "readwrite").objectStore("set_jokes");
          var delReq = sj.delete([setIdNum, itemIdNum]);
          delReq.onsuccess = function () { resolve(); };
          delReq.onerror = function () { reject(delReq.error); };
        } else {
          resolve();
        }
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  function clearAll(db) {
    return new Promise(function (resolve, reject) {
      var stores = ["jokes", "ideas", "sets", "set_jokes", "set_items", "config"];
      var tx = db.transaction(stores, "readwrite");
      stores.forEach(function (s) {
        if (db.objectStoreNames.contains(s)) tx.objectStore(s).clear();
      });
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

  function removeSetJokesForSet(db, setId) {
    var setIdNum = parseInt(setId, 10);
    return removeSetItemsForSet(db, setId).then(function () {
      return new Promise(function (resolve, reject) {
        var sj = db.transaction("set_jokes", "readwrite").objectStore("set_jokes");
        var idx = sj.index("set_id");
        var req = idx.openCursor(IDBKeyRange.only(setIdNum));
        req.onsuccess = function () {
          var c = req.result;
          if (c) { c.delete(); c.continue(); }
          else resolve();
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // --- dataLayer API (pure PWA: local only, no server) ---
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
            if (ok) return removeSetJokesForJoke(db, id);
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

    addIdea: function (contentOrObj) {
      return openDB().then(function (db) {
        return withStore(db, "ideas", "readwrite", function (store) {
          return addIdea(store, contentOrObj);
        });
      });
    },

    saveItem: function (item) {
      var self = this;
      var full = Object.assign({}, appConfig.defaultItem, item);
      var type = full.type === "idea" ? "idea" : "joke";
      if (type === "idea") {
        var content = (full.content != null && full.content !== "") ? full.content : (full.title || "");
        var payload = content.trim() ? content : full.title || "";
        if (typeof payload === "string") {
          return self.addIdea(payload).then(function (created) { return Object.assign({ type: "idea" }, created); });
        }
        return self.addIdea({ content: payload.content || full.title || "", topic: full.topic, tags: full.tags || [], rating: full.rating || null, notes: full.notes || "" }).then(function (created) { return Object.assign({ type: "idea" }, created); });
      }
      return self.addJoke({
        title: full.title || "",
        premise: (full.content != null ? full.content : "").trim(),
        punchline: "",
        status: "draft",
        topic: full.topic || null,
        tags: full.tags || [],
        rating: full.rating != null && full.rating >= 1 && full.rating <= 5 ? full.rating : null,
        setup_notes: full.notes || null
      }).then(function (created) { return Object.assign({ type: "joke" }, created); });
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
      return this.getSetWithItems(setId).then(function (data) {
        if (!data) return null;
        return { set: data.set, jokes: (data.items || []).filter(function (i) { return i.type === "joke"; }) };
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
      var self = this;
      return openDB().then(function (db) {
        return withStore(db, "set_jokes", "readwrite", function (store) {
          return addJokeToSet(store, setId, jokeId, position);
        }).then(function () {
          return openDB().then(function (db2) {
            return withStore(db2, "set_items", "readwrite", function (store) {
              return addItemToSet(store, setId, "joke", jokeId, position);
            });
          });
        });
      });
    },

    addItemToSet: function (setId, itemType, itemId, position) {
      return openDB().then(function (db) {
        return withStore(db, "set_items", "readwrite", function (store) {
          return addItemToSet(store, setId, itemType, itemId, position);
        });
      });
    },

    removeItemFromSet: function (setId, itemType, itemId) {
      return openDB().then(function (db) {
        return removeItemFromSet(db, setId, itemType, itemId);
      });
    },

    getSetWithItems: function (setId) {
      return openDB().then(function (db) {
        return getSetWithItems(db, setId);
      });
    },

    reorderSetJokes: function (setId, jokeIds) {
      return openDB().then(function (db) {
        var refs = (jokeIds || []).map(function (id) { return { type: "joke", id: id }; });
        return reorderSetItems(db, setId, refs).then(function () {
          return window.dataLayer.getSetWithItems(setId);
        });
      });
    },

    reorderSetItems: function (setId, orderedRefs) {
      return openDB().then(function (db) {
        return reorderSetItems(db, setId, orderedRefs || []).then(function () {
          return window.dataLayer.getSetWithItems(setId);
        });
      });
    },

    getMasterTopics: function () {
      return openDB().then(getMasterTopics);
    },

    setMasterTopics: function (arr) {
      return openDB().then(function (db) {
        return setMasterTopics(db, arr);
      });
    },

    getItemsByTopic: function (topic) {
      var self = this;
      return Promise.all([self.listJokes(), self.listIdeas()]).then(function (res) {
        var jokes = res[0] || [];
        var ideas = res[1] || [];
        var t = topic == null ? "" : String(topic).trim();
        return jokes.filter(function (j) { return (j.topic || "") === t; }).concat(ideas.filter(function (i) { return (i.topic || "") === t; }));
      });
    },

    getAllTags: function () {
      var self = this;
      return Promise.all([self.listJokes(), self.listIdeas()]).then(function (res) {
        var jokes = res[0] || [];
        var ideas = res[1] || [];
        var set = {};
        function add(tags) {
          if (Array.isArray(tags)) tags.forEach(function (t) { if (t != null && String(t).trim()) set[String(t).trim().toLowerCase()] = String(t).trim(); });
        }
        jokes.forEach(function (j) { add(j.tags); });
        ideas.forEach(function (i) { add(i.tags); });
        return Object.keys(set).sort().map(function (k) { return set[k]; });
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

    clearAll: function () {
      return openDB().then(clearAll);
    }
  };
})();
