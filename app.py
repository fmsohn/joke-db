"""Flask web app for joke management - mobile-friendly, access from phone on same WiFi."""
from __future__ import absolute_import

import os
import sys

# Run from project directory so joke_db and schema resolve
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, jsonify, request, send_from_directory, session

app = Flask(__name__, static_folder="static", static_url_path="")
app.config["JSON_AS_ASCII"] = False
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "joke-db-dev-change-in-production")


def get_current_comedian_id():
    """Return comedian_id for logged-in user, or None."""
    import joke_db as db
    user_id = session.get("user_id")
    if not user_id:
        return None
    return db.get_comedian_id_for_user(user_id)


def require_auth():
    """Return (comedian_id, None) or (None, 401_response)."""
    cid = get_current_comedian_id()
    if cid is None:
        return None, (jsonify({"error": "Login required"}), 401)
    return cid, None


@app.after_request
def after_request(response):
    """Cache control for static; CORS for API when page is served from another origin."""
    if request.path == "/" or request.path.startswith("/css/") or request.path.startswith("/js/") or request.path.endswith(".html"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
    if request.path.startswith("/api/"):
        origin = request.headers.get("Origin")
        if origin:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@app.route("/api/<path:subpath>", methods=["OPTIONS"])
def api_options(subpath):
    """CORS preflight for API."""
    return "", 204

# --- API: Auth (no login required) ---

@app.route("/api/me", methods=["GET"])
def api_me():
    import joke_db as db
    cid = get_current_comedian_id()
    if cid is None:
        return jsonify({"logged_in": False})
    user_id = session.get("user_id")
    conn = db.get_conn()
    row = conn.execute("SELECT username FROM users WHERE id = ?", (user_id,)).fetchone()
    username = row["username"] if row else None
    conn.close()
    return jsonify({"logged_in": True, "username": username, "comedian_id": cid})


@app.route("/api/register", methods=["POST"])
def api_register():
    data = request.get_json() or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400
    import joke_db as db
    user_id = db.create_user(username, password)
    if user_id is None:
        return jsonify({"error": "Username already taken"}), 400
    session["user_id"] = user_id
    session.permanent = True
    return jsonify({"ok": True, "username": username}), 201


@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json() or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400
    import joke_db as db
    user = db.get_user_by_username(username)
    if not user or not db.verify_password(user, password):
        return jsonify({"error": "Invalid username or password"}), 401
    session["user_id"] = user["id"]
    session.permanent = True
    return jsonify({"ok": True, "username": user["username"]}), 200


@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.pop("user_id", None)
    return jsonify({"ok": True}), 200


# --- API: Jokes (require login) ---

@app.route("/api/jokes", methods=["GET"])
def api_list_jokes():
    cid, err = require_auth()
    if err:
        return err
    status = request.args.get("status")
    import joke_db as db
    jokes = db.list_jokes(comedian_id=cid, status=status)
    return jsonify(jokes)


def _premise_equals_title(joke):
    """True if body (premise) is the same as title after normalizing whitespace."""
    p = " ".join((joke.get("premise") or "").split())
    t = " ".join((joke.get("title") or "").split())
    return bool(p and t and p == t)


def _force_empty_body_if_same_as_title(joke):
    """Return a copy of joke with premise cleared when it equals title (for idea-converted jokes)."""
    if not joke:
        return joke
    joke = dict(joke)
    p = " ".join((joke.get("premise") or "").split())
    t = " ".join((joke.get("title") or "").split())
    if p and t and p == t:
        joke["premise"] = ""
    return joke


@app.route("/api/jokes/<int:joke_id>", methods=["GET"])
def api_get_joke(joke_id):
    cid, err = require_auth()
    if err:
        return err
    import joke_db as db
    joke = db.get_joke(joke_id)
    if not joke or joke["comedian_id"] != cid:
        return jsonify({"error": "Not found"}), 404
    joke = _force_empty_body_if_same_as_title(joke)
    return jsonify(joke)


@app.route("/api/jokes", methods=["POST"])
def api_create_joke():
    cid, err = require_auth()
    if err:
        return err
    data = request.get_json() or {}
    title = data.get("title", "").strip()
    premise = data.get("premise", "").strip()
    if not title:
        return jsonify({"error": "title required"}), 400
    import joke_db as db
    jid = db.add_joke(
        premise=premise,
        punchline=data.get("punchline", "").strip(),
        title=title,
        status=data.get("status", "draft"),
        setup_notes=data.get("setup_notes") or None,
        comedian_id=cid,
    )
    joke = db.get_joke(jid)
    return jsonify(joke), 201


@app.route("/api/jokes/<int:joke_id>", methods=["PATCH"])
def api_update_joke(joke_id):
    cid, err = require_auth()
    if err:
        return err
    import joke_db as db
    joke = db.get_joke(joke_id)
    if not joke or joke["comedian_id"] != cid:
        return jsonify({"error": "Not found"}), 404
    data = request.get_json() or {}
    allowed = ["title", "premise", "punchline", "setup_notes", "status"]
    updates = {k: v for k, v in data.items() if k in allowed}
    if updates:
        db.update_joke(joke_id, **updates)
    return jsonify(db.get_joke(joke_id))


@app.route("/api/jokes/<int:joke_id>", methods=["DELETE"])
def api_delete_joke(joke_id):
    cid, err = require_auth()
    if err:
        return err
    import joke_db as db
    joke = db.get_joke(joke_id)
    if not joke or joke["comedian_id"] != cid:
        return jsonify({"error": "Not found"}), 404
    db.delete_joke(joke_id)
    return jsonify({"ok": True}), 200


@app.route("/api/jokes/<int:joke_id>/tags", methods=["POST"])
def api_add_tag(joke_id):
    cid, err = require_auth()
    if err:
        return err
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "tag name required"}), 400
    import joke_db as db
    joke = db.get_joke(joke_id)
    if not joke or joke["comedian_id"] != cid:
        return jsonify({"error": "Not found"}), 404
    db.add_tag_to_joke(joke_id, name)
    return jsonify({"ok": True}), 201


# --- API: Ideas ---

@app.route("/api/ideas", methods=["GET"])
def api_list_ideas():
    cid, err = require_auth()
    if err:
        return err
    import joke_db as db
    return jsonify(db.list_ideas(comedian_id=cid))


@app.route("/api/ideas", methods=["POST"])
def api_create_idea():
    cid, err = require_auth()
    if err:
        return err
    data = request.get_json() or {}
    content = (data.get("content") or "").strip()
    if not content:
        return jsonify({"error": "content required"}), 400
    import joke_db as db
    iid = db.add_idea(content, comedian_id=cid)
    idea = db.get_idea(iid)
    return jsonify(idea), 201


@app.route("/api/ideas/<int:idea_id>/convert", methods=["POST"])
def api_convert_idea_to_joke(idea_id):
    cid, err = require_auth()
    if err:
        return err
    import joke_db as db
    idea = db.get_idea(idea_id)
    if not idea or idea["comedian_id"] != cid:
        return jsonify({"error": "Idea not found"}), 404
    data = request.get_json() or {}
    title = (data.get("title") or "").strip() or idea["content"]
    joke_id = db.convert_idea_to_joke(
        idea_id,
        punchline="",
        title=title,
        status="draft",
        premise="",
    )
    joke = db.get_joke(joke_id)
    if joke:
        joke = dict(joke)
        joke["premise"] = ""
        joke["punchline"] = joke.get("punchline") or ""
    return jsonify(joke), 201


@app.route("/api/ideas/<int:idea_id>", methods=["PATCH"])
def api_update_idea(idea_id):
    cid, err = require_auth()
    if err:
        return err
    import joke_db as db
    idea = db.get_idea(idea_id)
    if not idea or idea["comedian_id"] != cid:
        return jsonify({"error": "Not found"}), 404
    data = request.get_json() or {}
    content = (data.get("content") or "").strip()
    if not content:
        return jsonify({"error": "content required"}), 400
    if not db.update_idea(idea_id, content):
        return jsonify({"error": "Update failed"}), 400
    return jsonify(db.get_idea(idea_id))


@app.route("/api/ideas/<int:idea_id>", methods=["DELETE"])
def api_delete_idea(idea_id):
    cid, err = require_auth()
    if err:
        return err
    import joke_db as db
    idea = db.get_idea(idea_id)
    if not idea or idea["comedian_id"] != cid:
        return jsonify({"error": "Not found"}), 404
    db.delete_idea(idea_id)
    return jsonify({"ok": True}), 200


# --- API: Tags ---

@app.route("/api/tags", methods=["GET"])
def api_list_tags():
    import joke_db as db
    return jsonify(db.list_tags())


# --- API: Sets ---

@app.route("/api/sets", methods=["GET"])
def api_list_sets():
    cid, err = require_auth()
    if err:
        return err
    import joke_db as db
    conn = db.get_conn()
    rows = conn.execute(
        "SELECT * FROM sets WHERE comedian_id = ? ORDER BY updated_at DESC",
        (cid,),
    ).fetchall()
    conn.close()
    out = [db._row_dict(r) for r in rows]
    return jsonify(out)


@app.route("/api/sets/<int:set_id>", methods=["GET"])
def api_get_set(set_id):
    cid, err = require_auth()
    if err:
        return err
    import joke_db as db
    data = db.get_set_with_jokes(set_id)
    if not data or data["set"]["comedian_id"] != cid:
        return jsonify({"error": "Not found"}), 404
    return jsonify(data)


@app.route("/api/sets", methods=["POST"])
def api_create_set():
    cid, err = require_auth()
    if err:
        return err
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    import joke_db as db
    sid = db.create_set(name, description=data.get("description", ""), comedian_id=cid)
    return jsonify(db.get_set_with_jokes(sid)), 201


@app.route("/api/sets/<int:set_id>/jokes", methods=["POST"])
def api_add_joke_to_set(set_id):
    cid, err = require_auth()
    if err:
        return err
    data = request.get_json() or {}
    joke_id = data.get("joke_id")
    position = data.get("position", 0)
    if joke_id is None:
        return jsonify({"error": "joke_id required"}), 400
    import joke_db as db
    data_set = db.get_set_with_jokes(set_id)
    if not data_set or data_set["set"]["comedian_id"] != cid:
        return jsonify({"error": "Set not found"}), 404
    joke = db.get_joke(int(joke_id))
    if not joke or joke["comedian_id"] != cid:
        return jsonify({"error": "Joke not found"}), 404
    db.add_joke_to_set(set_id, int(joke_id), int(position))
    return jsonify({"ok": True}), 201


def _reorder_set_jokes_impl(set_id):
    """Shared logic for reorder endpoints."""
    cid, err = require_auth()
    if err:
        return err
    if getattr(request, "_reorder_joke_ids", None) is not None:
        joke_ids = request._reorder_joke_ids
    else:
        data = request.get_json(force=True, silent=True) or {}
        joke_ids = data.get("joke_ids")
    if not isinstance(joke_ids, list):
        return jsonify({"error": "joke_ids array required"}), 400
    import joke_db as db
    data_set = db.get_set_with_jokes(set_id)
    if not data_set or data_set["set"]["comedian_id"] != cid:
        return jsonify({"error": "Set not found"}), 404
    try:
        joke_ids = [int(x) for x in joke_ids]
    except (TypeError, ValueError):
        return jsonify({"error": "joke_ids must be integers"}), 400
    db.reorder_set_jokes(set_id, joke_ids)
    return jsonify(db.get_set_with_jokes(set_id))


@app.route("/api/sets/<int:set_id>/reorder", methods=["GET", "POST"])
def api_reorder_set(set_id):
    """Reorder jokes in a set. POST body: { \"joke_ids\": [1,2,3] }. GET: ?joke_ids=1,2,3."""
    if request.method == "GET":
        raw = request.args.get("joke_ids", "")
        joke_ids = [x.strip() for x in raw.split(",") if x.strip()]
        try:
            joke_ids = [int(x) for x in joke_ids]
        except (TypeError, ValueError):
            return jsonify({"error": "joke_ids must be comma-separated integers"}), 400
        # Inject into request so _reorder_set_jokes_impl can use it
        request._reorder_joke_ids = joke_ids
    return _reorder_set_jokes_impl(set_id)


@app.route("/api/sets/<int:set_id>/jokes/order", methods=["GET", "PUT", "POST"])
def api_reorder_set_jokes(set_id):
    """Reorder jokes. POST/PUT body: { \"joke_ids\": [1,2,3] }. GET: ?joke_ids=1,2,3."""
    if request.method == "GET":
        raw = request.args.get("joke_ids", "")
        joke_ids = [x.strip() for x in raw.split(",") if x.strip()]
        try:
            joke_ids = [int(x) for x in joke_ids]
        except (TypeError, ValueError):
            return jsonify({"error": "joke_ids must be comma-separated integers"}), 400
        request._reorder_joke_ids = joke_ids
    return _reorder_set_jokes_impl(set_id)


@app.route("/api/sets/<int:set_id>", methods=["DELETE"])
def api_delete_set(set_id):
    cid, err = require_auth()
    if err:
        return err
    import joke_db as db
    data = db.get_set_with_jokes(set_id)
    if not data or data["set"]["comedian_id"] != cid:
        return jsonify({"error": "Not found"}), 404
    db.delete_set(set_id)
    return jsonify({"ok": True}), 200


# --- Serve app ---

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


if __name__ == "__main__":
    db_path = os.path.join(os.path.dirname(__file__), "jokes.db")
    if not os.path.exists(db_path):
        from init_db import init_db
        init_db(seed_sample=True)
    import joke_db as db
    conn = db.get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    # Add user_id to comedians if missing (migration for existing DBs)
    info = conn.execute("PRAGMA table_info(comedians)").fetchall()
    col_names = [row[1] for row in info]
    if "user_id" not in col_names:
        conn.execute("ALTER TABLE comedians ADD COLUMN user_id INTEGER REFERENCES users(id)")
    conn.execute("CREATE TABLE IF NOT EXISTS ideas (id INTEGER PRIMARY KEY AUTOINCREMENT, comedian_id INTEGER NOT NULL DEFAULT 1, content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (comedian_id) REFERENCES comedians(id))")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ideas_comedian ON ideas(comedian_id)")
    conn.commit()
    conn.close()
    app.run(host="0.0.0.0", port=5000, debug=False)
