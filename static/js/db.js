/**
 * db.js – Dexie.js-backed data layer for Stagetime PWA.
 * Replaces raw IndexedDB (data.js) with same API: window.dataLayer.
 * Requires Dexie loaded before this script (e.g. <script src=".../dexie.min.js">).
 */
(function () {
  "use strict";

  var COMEDIAN_ID = 1;
  var DB_NAME = "joke_db_local";

  var appConfig = {
    masterTopics: ["Work", "Relationships", "Travel", "Politics", "Observation", "Uncategorized"],
    statusLabels: { active: "Show", testing: "Testing", draft: "Draft", retired: "Retired" },
    defaultItem: { type: "joke", title: "", content: "", topic: "Uncategorized", tags: [], rating: 0, notes: "", createdAt: new Date().toISOString() }
  };

  function now() {
    return new Date().toISOString().replace("Z", "");
  }

  function toLoadedShape(row, type) {
    if (!row) return null;
    var resolvedType = type || row.type || "joke";
    var title = row.title != null ? String(row.title) : "";
    var topic = row.topic != null ? row.topic : "Uncategorized";
    var tags = Array.isArray(row.tags) ? row.tags.slice() : [];
    if (resolvedType === "idea") {
      return {
        id: row.id,
        type: "idea",
        title: title,
        content: row.content != null ? String(row.content) : "",
        notes: row.notes != null ? String(row.notes) : "",
        topic: topic,
        tags: tags,
        created_at: row.created_at,
        updated_at: row.updated_at,
        comedian_id: row.comedian_id
      };
    }
    return {
      id: row.id,
      type: "joke",
      title: title,
      content: row.content != null ? String(row.content) : (row.premise != null ? String(row.premise) : ""),
      act_out: row.act_out != null ? String(row.act_out) : (row.punchline != null ? String(row.punchline) : ""),
      notes: row.setup_notes != null ? String(row.setup_notes) : (row.notes != null ? String(row.notes) : ""),
      duration: row.duration != null ? row.duration : null,
      topic: topic,
      status: row.status != null ? row.status : "draft",
      rating: row.rating != null && row.rating >= 1 && row.rating <= 5 ? row.rating : 0,
      tags: tags,
      created_at: row.created_at,
      updated_at: row.updated_at,
      comedian_id: row.comedian_id
    };
  }

  function normalizeJoke(row) {
    if (!row) return null;
    return Object.assign({}, appConfig.defaultItem, toLoadedShape(row, "joke"));
  }

  function normalizeIdea(row) {
    if (!row) return null;
    return Object.assign({}, appConfig.defaultItem, toLoadedShape(row, "idea"));
  }

  var db = new Dexie(DB_NAME);
  db.version(4).stores({
    jokes: "++id, comedian_id, status, updated_at, duration",
    ideas: "++id, comedian_id, created_at",
    sets: "++id, comedian_id, updated_at",
    set_jokes: "[set_id+joke_id], set_id, joke_id",
    set_items: "++id, set_id",
    config: "key"
  });
  db.version(5).stores({
    jokes: "++id, comedian_id, status, topic, rating, updated_at, duration",
    ideas: "++id, comedian_id, created_at",
    sets: "++id, comedian_id, updated_at",
    set_jokes: "[set_id+joke_id], set_id, joke_id",
    set_items: "++id, set_id",
    config: "key"
  });
  db.version(6).stores({
    jokes: "++id, comedian_id, title, content, act_out, status, *tags, created_at, updated_at, topic, rating, duration",
    ideas: "++id, comedian_id, created_at",
    sets: "++id, comedian_id, updated_at",
    set_jokes: "[set_id+joke_id], set_id, joke_id",
    set_items: "++id, set_id",
    config: "key"
  });
  window.db = db;

  // --- Jokes ---
  function listJokes(status) {
    var table = db.jokes.where("comedian_id").equals(COMEDIAN_ID);
    if (status) table = table.filter(function (j) { return j.status === status; });
    return table.toArray().then(function (rows) {
      rows = (rows || []).map(normalizeJoke);
      rows.sort(function (a, b) {
        var ta = (a.updated_at || a.created_at || "").replace("Z", "");
        var tb = (b.updated_at || b.created_at || "").replace("Z", "");
        return tb.localeCompare(ta);
      });
      return rows;
    });
  }

  function getJoke(id) {
    return db.jokes.get(parseInt(id, 10)).then(function (row) {
      return row && row.comedian_id === COMEDIAN_ID ? normalizeJoke(row) : null;
    });
  }

  function addJoke(data) {
    data = data || {};
    var t = now();
    var content = data.content != null ? data.content : data.premise;
    var actOut = data.act_out != null ? data.act_out : data.punchline;
    var notes = data.notes != null ? data.notes : data.setup_notes;
    var rating = data.rating != null ? Number(data.rating) : null;
    var obj = {
      comedian_id: COMEDIAN_ID,
      type: "joke",
      title: data.title != null ? String(data.title).trim() : null,
      content: (content != null ? String(content) : "").trim(),
      act_out: (actOut != null ? String(actOut) : "").trim() || null,
      setup_notes: notes != null ? String(notes) : null,
      status: data.status || "draft",
      topic: data.topic != null ? data.topic : null,
      tags: Array.isArray(data.tags) ? data.tags.slice() : [],
      rating: rating != null && rating >= 1 && rating <= 5 ? rating : null,
      created_at: t,
      updated_at: t,
      duration: data.duration != null ? data.duration : null
    };
    return db.jokes.add(obj).then(function (id) {
      obj.id = id;
      return normalizeJoke(obj);
    });
  }

  function updateJoke(id, updates) {
    return db.jokes.get(parseInt(id, 10)).then(function (row) {
      if (!row || row.comedian_id !== COMEDIAN_ID) return null;
      updates = updates || {};
      var mapped = {};
      if (updates.title !== undefined) mapped.title = updates.title != null ? String(updates.title).trim() : null;
      if (updates.content !== undefined || updates.premise !== undefined) {
        var content = updates.content !== undefined ? updates.content : updates.premise;
        mapped.content = (content != null ? String(content) : "").trim();
        mapped.premise = (content != null ? String(content) : "").trim();
      }
      if (updates.act_out !== undefined || updates.punchline !== undefined) {
        var actOut = updates.act_out !== undefined ? updates.act_out : updates.punchline;
        mapped.act_out = (actOut != null ? String(actOut) : "").trim() || null;
        mapped.punchline = (actOut != null ? String(actOut) : "").trim() || null;
      }
      if (updates.notes !== undefined || updates.setup_notes !== undefined) {
        var notes = updates.notes !== undefined ? updates.notes : updates.setup_notes;
        mapped.setup_notes = notes != null ? String(notes) : null;
      }
      if (updates.status !== undefined) mapped.status = updates.status;
      if (updates.topic !== undefined) mapped.topic = updates.topic;
      if (updates.tags !== undefined) mapped.tags = Array.isArray(updates.tags) ? updates.tags.slice() : [];
      if (updates.rating !== undefined) {
        var rating = updates.rating != null ? Number(updates.rating) : null;
        mapped.rating = rating != null && rating >= 1 && rating <= 5 ? rating : null;
      }
      if (updates.duration !== undefined) mapped.duration = updates.duration != null ? updates.duration : null;

      Object.keys(mapped).forEach(function (key) {
        row[key] = mapped[key];
      });
      row.updated_at = now();
      return db.jokes.put(row).then(function () { return normalizeJoke(row); });
    });
  }

  function deleteJoke(id) {
    var idNum = parseInt(id, 10);
    return db.jokes.get(idNum).then(function (row) {
      if (!row || row.comedian_id !== COMEDIAN_ID) return false;
      return db.set_jokes.where("joke_id").equals(idNum).delete().then(function () {
        return db.jokes.delete(idNum);
      }).then(function () { return true; });
    });
  }

  // --- Ideas ---
  function listIdeas() {
    return db.ideas.where("comedian_id").equals(COMEDIAN_ID).toArray().then(function (rows) {
      rows = (rows || []).map(normalizeIdea);
      rows.sort(function (a, b) {
        return (b.created_at || "").localeCompare(a.created_at || "");
      });
      return rows;
    });
  }

  function getIdea(id) {
    return db.ideas.get(parseInt(id, 10)).then(function (row) {
      return row && row.comedian_id === COMEDIAN_ID ? normalizeIdea(row) : null;
    });
  }

  function addIdea(contentOrObj) {
    var title = "";
    var content = "";
    var topic = null;
    var tags = [];
    var notes = "";
    if (typeof contentOrObj === "string") {
      title = (contentOrObj || "").trim();
    } else if (contentOrObj && typeof contentOrObj === "object") {
      title = (contentOrObj.title != null ? String(contentOrObj.title) : "").trim();
      content = (contentOrObj.content != null ? String(contentOrObj.content) : "").trim();
      topic = contentOrObj.topic != null ? contentOrObj.topic : null;
      tags = Array.isArray(contentOrObj.tags) ? contentOrObj.tags.slice() : [];
      notes = contentOrObj.notes != null ? String(contentOrObj.notes) : "";
    }
    var obj = {
      comedian_id: COMEDIAN_ID,
      type: "idea",
      title: title,
      content: content,
      topic: topic,
      tags: tags,
      notes: notes,
      created_at: now()
    };
    return db.ideas.add(obj).then(function (id) {
      obj.id = id;
      return normalizeIdea(obj);
    });
  }

  function updateIdea(id, contentOrUpdates) {
    return db.ideas.get(parseInt(id, 10)).then(function (row) {
      if (!row || row.comedian_id !== COMEDIAN_ID) return null;
      if (typeof contentOrUpdates === "string") {
        row.content = (contentOrUpdates || "").trim();
      } else if (contentOrUpdates && typeof contentOrUpdates === "object") {
        if (contentOrUpdates.title !== undefined) row.title = (contentOrUpdates.title != null ? String(contentOrUpdates.title) : "").trim();
        if (contentOrUpdates.content !== undefined) row.content = (contentOrUpdates.content != null ? String(contentOrUpdates.content) : "").trim();
        if (contentOrUpdates.topic !== undefined) row.topic = contentOrUpdates.topic;
        if (contentOrUpdates.tags !== undefined) row.tags = Array.isArray(contentOrUpdates.tags) ? contentOrUpdates.tags.slice() : [];
        if (contentOrUpdates.notes !== undefined) row.notes = contentOrUpdates.notes != null ? String(contentOrUpdates.notes) : "";
      }
      return db.ideas.put(row).then(function () { return normalizeIdea(row); });
    });
  }

  function deleteIdea(id) {
    return db.ideas.get(parseInt(id, 10)).then(function (row) {
      if (!row || row.comedian_id !== COMEDIAN_ID) return false;
      return db.ideas.delete(parseInt(id, 10)).then(function () { return true; });
    });
  }

  function convertIdeaToJoke(ideaId, title) {
    return getIdea(ideaId).then(function (idea) {
      if (!idea) return Promise.reject(new Error("Idea not found"));
      var t = (title || idea.title || "").trim();
      return addJoke({ title: t, content: "", act_out: "", status: "draft" }).then(function (joke) {
        return deleteIdea(ideaId).then(function () { return joke; });
      });
    });
  }

  // --- Sets ---
  function listSets() {
    return db.sets.where("comedian_id").equals(COMEDIAN_ID).toArray().then(function (rows) {
      rows = rows || [];
      rows.sort(function (a, b) {
        return (b.updated_at || b.created_at || "").localeCompare(a.updated_at || a.created_at || "");
      });
      return rows;
    });
  }

  function createSet(name, description) {
    var t = now();
    var obj = {
      comedian_id: COMEDIAN_ID,
      name: (name || "").trim(),
      description: (description || "").trim() || null,
      created_at: t,
      updated_at: t
    };
    return db.sets.add(obj).then(function (id) {
      obj.id = id;
      return { set: obj, jokes: [] };
    });
  }

  function updateSet(setId, fields) {
    fields = fields || {};
    var setNum = parseInt(setId, 10);
    var t = now();
    return db.sets.get(setNum).then(function (row) {
      if (!row || row.comedian_id !== COMEDIAN_ID) return Promise.reject(new Error("Set not found"));
      var next = Object.assign({}, row);
      if (fields.name != null) next.name = String(fields.name).trim() || "Untitled";
      if (fields.description !== undefined) {
        next.description = fields.description === null || fields.description === "" ? null : String(fields.description).trim();
      }
      next.updated_at = t;
      return db.sets.put(next).then(function () { return { set: next }; });
    });
  }

  function addJokeToSet(setId, jokeId, position) {
    var setNum = parseInt(setId, 10);
    var jokeNum = parseInt(jokeId, 10);
    var pos = parseInt(position, 10) || 0;
    return db.set_jokes.put({ set_id: setNum, joke_id: jokeNum, position: pos }).then(function () {
      return db.set_items.add({ set_id: setNum, item_type: "joke", item_id: jokeNum, position: pos });
    });
  }

  function addItemToSetStore(setId, itemType, itemId, position) {
    return db.set_items.add({
      set_id: parseInt(setId, 10),
      item_type: itemType === "idea" ? "idea" : "joke",
      item_id: parseInt(itemId, 10),
      position: parseInt(position, 10) || 0
    });
  }

  function getSetWithItems(setId) {
    var setNum = parseInt(setId, 10);
    return db.sets.get(setNum).then(function (setRow) {
      if (!setRow || setRow.comedian_id !== COMEDIAN_ID) return null;
      return db.set_items.where("set_id").equals(setNum).sortBy("position").then(function (links) {
        if (links.length === 0) {
          return db.set_jokes.where("set_id").equals(setNum).sortBy("position").then(function (legacy) {
            if (legacy.length === 0) return { set: setRow, items: [] };
            var items = [];
            var migrate = legacy.reduce(function (p, link, idx) {
              return p.then(function () {
                return db.jokes.get(link.joke_id).then(function (j) {
                  if (j) items.push(normalizeJoke(j));
                  return db.set_items.add({ set_id: setNum, item_type: "joke", item_id: link.joke_id, position: idx });
                });
              });
            }, Promise.resolve());
            return migrate.then(function () { return { set: setRow, items: items }; });
          });
        }
        return Promise.all(links.map(function (link) {
          var store = link.item_type === "idea" ? db.ideas : db.jokes;
          return store.get(link.item_id).then(function (row) {
            if (row && row.comedian_id === COMEDIAN_ID) {
              return link.item_type === "idea" ? normalizeIdea(row) : normalizeJoke(row);
            }
            return null;
          });
        })).then(function (itemRows) {
          var items = itemRows.filter(Boolean);
          return { set: setRow, items: items };
        });
      });
    });
  }

  function removeItemFromSet(setId, itemType, itemId) {
    var setNum = parseInt(setId, 10);
    var itemIdNum = parseInt(itemId, 10);
    var typeStr = itemType === "idea" ? "idea" : "joke";
    return db.set_items.where("set_id").equals(setNum).toArray().then(function (rows) {
      var found = rows.find(function (r) { return r.item_type === typeStr && r.item_id === itemIdNum; });
      if (found) return db.set_items.delete(found.id);
      return Promise.resolve();
    }).then(function () {
      if (typeStr === "joke") return db.set_jokes.where("[set_id+joke_id]").equals([setNum, itemIdNum]).delete();
      return Promise.resolve();
    });
  }

  function reorderSetItems(setId, orderedRefs) {
    var setNum = parseInt(setId, 10);
    return db.set_items.where("set_id").equals(setNum).delete().then(function () {
      var adds = (orderedRefs || []).map(function (ref, pos) {
        var t = ref.type != null ? ref.type : ref.item_type;
        var id = ref.id != null ? ref.id : ref.item_id;
        return db.set_items.add({
          set_id: setNum,
          item_type: t === "idea" ? "idea" : "joke",
          item_id: parseInt(id, 10),
          position: pos
        });
      });
      return Promise.all(adds);
    });
  }

  function deleteSet(setId) {
    var setNum = parseInt(setId, 10);
    return db.sets.get(setNum).then(function (row) {
      if (!row || row.comedian_id !== COMEDIAN_ID) return false;
      return db.sets.delete(setNum).then(function () {
        return db.set_items.where("set_id").equals(setNum).delete();
      }).then(function () {
        return db.set_jokes.where("set_id").equals(setNum).delete();
      }).then(function () { return true; });
    });
  }

  function getMasterTopics() {
    return db.config.get("masterTopics").then(function (row) {
      var list = Array.isArray(row && row.value) ? row.value.slice() : [];
      if (list.length === 0 && appConfig.masterTopics && appConfig.masterTopics.length) {
        return db.config.put({ key: "masterTopics", value: appConfig.masterTopics.slice() }).then(function () {
          return appConfig.masterTopics.slice();
        });
      }
      return list;
    });
  }

  function setMasterTopics(arr) {
    return db.config.put({ key: "masterTopics", value: Array.isArray(arr) ? arr.slice() : [] });
  }

  function getItemsByTopic(topic) {
    var t = topic == null ? "" : String(topic).trim();
    return Promise.all([listJokes(), listIdeas()]).then(function (res) {
      var jokes = res[0] || [];
      var ideas = res[1] || [];
      return jokes.filter(function (j) { return (j.topic || "") === t; }).concat(ideas.filter(function (i) { return (i.topic || "") === t; }));
    });
  }

  function getAllTags() {
    return Promise.all([listJokes(), listIdeas()]).then(function (res) {
      var jokes = res[0] || [];
      var ideas = res[1] || [];
      var set = {};
      function add(tags) {
        if (Array.isArray(tags)) tags.forEach(function (tag) { if (tag != null && String(tag).trim()) set[String(tag).trim().toLowerCase()] = String(tag).trim(); });
      }
      jokes.forEach(function (j) { add(j.tags); });
      ideas.forEach(function (i) { add(i.tags); });
      return Object.keys(set).sort().map(function (k) { return set[k]; });
    });
  }

  function saveItem(item) {
    var full = Object.assign({}, appConfig.defaultItem, item);
    var type = full.type === "idea" ? "idea" : "joke";
    if (type === "idea") {
      var payload = {
        title: full.title != null ? full.title : "",
        content: full.content != null ? full.content : "",
        topic: full.topic,
        tags: full.tags || [],
        notes: full.notes || ""
      };
      return addIdea(payload).then(function (created) { return Object.assign({ type: "idea" }, created); });
    }
    return addJoke({
      title: full.title || "",
      content: (full.content != null ? full.content : "").trim(),
      act_out: full.act_out != null ? full.act_out : "",
      status: "draft",
      topic: full.topic || null,
      tags: full.tags || [],
      rating: full.rating != null && full.rating >= 1 && full.rating <= 5 ? full.rating : null,
      notes: full.notes || null,
      duration: full.duration != null ? full.duration : null
    }).then(function (created) { return Object.assign({ type: "joke" }, created); });
  }

  function getSetWithJokesFromItems(setId) {
    return getSetWithItems(setId).then(function (data) {
      if (!data) return null;
      return { set: data.set, jokes: (data.items || []).filter(function (i) { return i.type === "joke"; }) };
    });
  }

  function reorderSetJokes(setId, jokeIds) {
    var refs = (jokeIds || []).map(function (id) { return { type: "joke", id: id }; });
    return reorderSetItems(setId, refs).then(function () { return getSetWithItems(setId); });
  }

  function clearAll() {
    return db.transaction("rw", db.jokes, db.ideas, db.sets, db.set_jokes, db.set_items, db.config, function () {
      return Promise.all([
        db.jokes.clear(),
        db.ideas.clear(),
        db.sets.clear(),
        db.set_jokes.clear(),
        db.set_items.clear(),
        db.config.clear()
      ]);
    });
  }

  /** Collects core backup data from Dexie stores and returns a fresh JSON object. */
  function exportDatabaseToJson() {
    return db.transaction("r", db.jokes, db.ideas, db.sets, function () {
      return Promise.all([
        db.jokes.toArray(),
        db.ideas.toArray(),
        db.sets.toArray()
      ]).then(function (res) {
        return {
          jokes: res[0] || [],
          ideas: res[1] || [],
          sets: res[2] || []
        };
      });
    });
  }

  function importStagetimeBackup(file) {
    if (!file) return Promise.reject(new Error("No backup file selected."));
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var text = typeof reader.result === "string" ? reader.result : "";
          var data = JSON.parse(text);
          if (!data || data.version !== 1) {
            throw new Error("Incompatible backup version.");
          }
          clearAll().then(function () {
            return db.transaction("rw", db.jokes, db.ideas, db.sets, db.set_items, db.config, function () {
              return Promise.resolve()
                .then(function () { return db.jokes.bulkAdd(data.jokes || []); })
                .then(function () { return db.ideas.bulkAdd(data.ideas || []); })
                .then(function () { return db.sets.bulkAdd(data.sets || []); })
                .then(function () { return db.set_items.bulkAdd(data.set_items || []); })
                .then(function () {
                  if (data.config) {
                    return (data.config || []).reduce(function (p, c) {
                      return p.then(function () { return db.config.put(c); });
                    }, Promise.resolve());
                  }
                  return Promise.resolve();
                });
            });
          }).then(function () {
            resolve(data);
          }).catch(function (err) {
            reject(err);
          });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = function () { reject(new Error("Could not read file.")); };
      reader.readAsText(file, "UTF-8");
    });
  }

  window.dataLayer = {
    appConfig: appConfig,
    getStorageMode: function () { return "local"; },
    setStorageMode: function () {},
    getBaseUrl: function () { return window.location.origin; },
    apiFetch: function () { return Promise.reject(new Error("Offline-only app")); },

    listJokes: listJokes,
    getJoke: getJoke,
    addJoke: addJoke,
    updateJoke: updateJoke,
    deleteJoke: deleteJoke,

    listIdeas: listIdeas,
    getIdea: getIdea,
    addIdea: addIdea,
    updateIdea: updateIdea,
    deleteIdea: deleteIdea,
    convertIdeaToJoke: convertIdeaToJoke,

    saveItem: saveItem,

    listSets: listSets,
    getSetWithJokes: getSetWithJokesFromItems,
    getSetWithItems: getSetWithItems,
    createSet: createSet,
    updateSet: updateSet,
    addJokeToSet: addJokeToSet,
    addItemToSet: addItemToSetStore,
    removeItemFromSet: removeItemFromSet,
    reorderSetJokes: reorderSetJokes,
    reorderSetItems: function (setId, orderedRefs) {
      return reorderSetItems(setId, orderedRefs || []).then(function () { return getSetWithItems(setId); });
    },
    deleteSet: deleteSet,

    getMasterTopics: getMasterTopics,
    setMasterTopics: setMasterTopics,
    getItemsByTopic: getItemsByTopic,
    getAllTags: getAllTags,

    clearAll: clearAll,
    exportDatabaseToJson: exportDatabaseToJson,
    importStagetimeBackup: importStagetimeBackup
  };
})();
