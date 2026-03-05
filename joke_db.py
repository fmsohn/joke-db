"""Simple CRUD helpers for the joke management database."""

import os
import sqlite3
from contextlib import contextmanager
from typing import Any, Dict, List, Optional

DB_PATH = os.path.join(os.path.dirname(__file__), "jokes.db")


def _row_dict(row: sqlite3.Row) -> Dict[str, Any]:
    """Convert sqlite3.Row to dict for easier access."""
    return {key: row[key] for key in row.keys()}


def get_conn() -> sqlite3.Connection:
    """Return a connection with row factory for dict-like access."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def with_conn():
    """Context manager that yields a connection and always closes it."""
    conn = get_conn()
    try:
        yield conn
    finally:
        conn.close()


# --- Users (multi-user auth) ---

def create_user(username: str, password: str) -> Optional[int]:
    """Create a user and a comedian profile. Returns user id or None if username taken."""
    from werkzeug.security import generate_password_hash
    username = (username or "").strip().lower()
    if not username or not password:
        return None
    with with_conn() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (username, generate_password_hash(password)),
            )
            user_id = cur.lastrowid
            conn.execute(
                "INSERT INTO comedians (name, user_id) VALUES (?, ?)",
                (username, user_id),
            )
            conn.commit()
            return user_id
        except sqlite3.IntegrityError:
            conn.rollback()
            return None


def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    """Get user row by username (case-insensitive)."""
    with with_conn() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE LOWER(username) = ?",
            ((username or "").strip().lower(),),
        ).fetchone()
        return _row_dict(row) if row else None


def verify_password(user: Dict[str, Any], password: str) -> bool:
    """Check password against user's hash."""
    from werkzeug.security import check_password_hash
    return bool(user and check_password_hash(user.get("password_hash") or "", password))


def get_comedian_id_for_user(user_id: int) -> Optional[int]:
    """Get comedian_id for this user (one comedian per user)."""
    with with_conn() as conn:
        row = conn.execute(
            "SELECT id FROM comedians WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        return row["id"] if row else None


# --- Jokes ---

def add_joke(
    premise: str,
    punchline: str = "",
    title: str = "",
    status: str = "draft",
    comedian_id: int = 1,
    **kwargs
) -> int:
    """Insert a joke. Returns new joke id."""
    if premise == (title or ""):
        premise = ""
    with with_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO jokes (comedian_id, title, premise, punchline, status, setup_notes, word_count, estimated_duration_seconds)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                comedian_id,
                title or None,
                premise or "",
                punchline or None,
                status,
                kwargs.get("setup_notes"),
                kwargs.get("word_count"),
                kwargs.get("estimated_duration_seconds"),
            ),
        )
        conn.commit()
        return cur.lastrowid or 0


def add_joke_from_idea(comedian_id: int, title: str) -> int:
    """Insert a joke with only title set (for idea conversion). Body/premise and punchline are always blank."""
    # Use literal '' in SQL for premise and punchline so no Python variable can ever populate them.
    with with_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO jokes (comedian_id, title, premise, punchline, status, setup_notes, word_count, estimated_duration_seconds)
            VALUES (?, ?, '', '', 'draft', NULL, NULL, NULL)
            """,
            (comedian_id, title or None),
        )
        conn.commit()
        return cur.lastrowid or 0


def _normalize(s: str) -> str:
    """Normalize for comparison: strip and collapse all whitespace to single space."""
    return " ".join((s or "").split())


def _sanitize_joke(j: Dict[str, Any]) -> Dict[str, Any]:
    """Ensure premise (body) is not a duplicate of title. Clear body when it matches title."""
    p = _normalize(j.get("premise"))
    t = _normalize(j.get("title"))
    if p and t and p == t:
        j = dict(j)
        j["premise"] = ""
    return j


def get_joke(joke_id: int) -> Optional[Dict[str, Any]]:
    """Get a single joke by id. Never return title text in premise (body)."""
    with with_conn() as conn:
        row = conn.execute("SELECT * FROM jokes WHERE id = ?", (joke_id,)).fetchone()
        if not row:
            return None
        return _sanitize_joke(_row_dict(row))


def list_jokes(
    comedian_id: int = 1, status: Optional[str] = None
) -> List[Dict[str, Any]]:
    """List jokes, optionally filtered by status."""
    with with_conn() as conn:
        if status:
            rows = conn.execute(
                "SELECT * FROM jokes WHERE comedian_id = ? AND status = ? ORDER BY updated_at DESC",
                (comedian_id, status),
            ).fetchall()
            return [_sanitize_joke(_row_dict(r)) for r in rows]
        else:
            rows = conn.execute(
                "SELECT * FROM jokes WHERE comedian_id = ? ORDER BY updated_at DESC",
                (comedian_id,),
            ).fetchall()
        return [_sanitize_joke(_row_dict(r)) for r in rows]


def update_joke(joke_id: int, **kwargs) -> bool:
    """Update joke fields. Only provided keys are updated. Never store title in premise."""
    allowed = {"title", "premise", "punchline", "setup_notes", "status", "word_count", "estimated_duration_seconds"}
    premise = kwargs.get("premise")
    title = kwargs.get("title")
    if premise is not None and premise == (title or ""):
        kwargs = dict(kwargs)
        kwargs["premise"] = ""
    updates = [(k, v) for k, v in kwargs.items() if k in allowed]
    if not updates:
        return False
    set_clause = ", ".join("{0} = ?".format(k) for k, _ in updates)
    values = [v for _, v in updates] + [joke_id]
    with with_conn() as conn:
        conn.execute("UPDATE jokes SET " + set_clause + " WHERE id = ?", values)
        conn.commit()
    return True


def add_tag_to_joke(joke_id: int, tag_name: str) -> None:
    """Add a tag to a joke (creates tag if missing)."""
    with with_conn() as conn:
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (tag_name,))
        tag_id = conn.execute("SELECT id FROM tags WHERE name = ?", (tag_name,)).fetchone()["id"]
        conn.execute("INSERT OR IGNORE INTO joke_tags (joke_id, tag_id) VALUES (?, ?)", (joke_id, tag_id))
        conn.commit()


def delete_joke(joke_id: int) -> bool:
    """Delete a joke and its tag/set links. Returns True if deleted."""
    with with_conn() as conn:
        cur = conn.execute("DELETE FROM jokes WHERE id = ?", (joke_id,))
        conn.commit()
        return cur.rowcount > 0


# --- Ideas ---

def add_idea(content: str, comedian_id: int = 1) -> int:
    """Add a one-line idea. Returns idea id."""
    content = (content or "").strip()
    if not content:
        return 0
    with with_conn() as conn:
        cur = conn.execute(
            "INSERT INTO ideas (comedian_id, content) VALUES (?, ?)",
            (comedian_id, content),
        )
        conn.commit()
        return cur.lastrowid or 0


def list_ideas(comedian_id: int = 1) -> List[Dict[str, Any]]:
    """List all ideas, newest first."""
    with with_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM ideas WHERE comedian_id = ? ORDER BY created_at DESC",
            (comedian_id,),
        ).fetchall()
        return [_row_dict(r) for r in rows]


def get_idea(idea_id: int) -> Optional[Dict[str, Any]]:
    """Get a single idea by id."""
    with with_conn() as conn:
        row = conn.execute("SELECT * FROM ideas WHERE id = ?", (idea_id,)).fetchone()
        return _row_dict(row) if row else None


def update_idea(idea_id: int, content: str) -> bool:
    """Update an idea's content. Returns True if updated."""
    content = (content or "").strip()
    if not content:
        return False
    with with_conn() as conn:
        cur = conn.execute("UPDATE ideas SET content = ? WHERE id = ?", (content, idea_id))
        conn.commit()
        return cur.rowcount > 0


def delete_idea(idea_id: int) -> bool:
    """Delete an idea. Returns True if deleted."""
    with with_conn() as conn:
        cur = conn.execute("DELETE FROM ideas WHERE id = ?", (idea_id,))
        conn.commit()
        return cur.rowcount > 0


def convert_idea_to_joke(
    idea_id: int,
    punchline: str = "",
    title: str = "",
    status: str = "draft",
    premise: str = "",
) -> Optional[int]:
    """Create a joke from an idea. Title = idea content; body (premise) and punchline are always blank. Returns new joke id or None."""
    idea = get_idea(idea_id)
    if not idea:
        return None
    joke_title = (title or "").strip() or idea["content"]
    joke_id = add_joke_from_idea(comedian_id=idea["comedian_id"], title=joke_title)
    delete_idea(idea_id)
    return joke_id


# --- Tags ---

def list_tags() -> List[Dict[str, Any]]:
    """List all tags."""
    with with_conn() as conn:
        rows = conn.execute("SELECT * FROM tags ORDER BY name").fetchall()
        return [_row_dict(r) for r in rows]


# --- Sets ---

def create_set(name: str, description: str = "", comedian_id: int = 1) -> int:
    """Create a new set. Returns set id."""
    with with_conn() as conn:
        cur = conn.execute(
            "INSERT INTO sets (comedian_id, name, description) VALUES (?, ?, ?)",
            (comedian_id, name, description or None),
        )
        conn.commit()
        return cur.lastrowid or 0


def add_joke_to_set(set_id: int, joke_id: int, position: int) -> None:
    """Add a joke to a set at the given position."""
    with with_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO set_jokes (set_id, joke_id, position) VALUES (?, ?, ?)",
            (set_id, joke_id, position),
        )
        conn.commit()


def reorder_set_jokes(set_id: int, joke_ids: List[int]) -> None:
    """Set the order of jokes in a set. joke_ids is the desired order (ids in sequence)."""
    with with_conn() as conn:
        for position, joke_id in enumerate(joke_ids):
            conn.execute(
                "INSERT OR REPLACE INTO set_jokes (set_id, joke_id, position) VALUES (?, ?, ?)",
                (set_id, joke_id, position),
            )
        conn.commit()


def get_set_with_jokes(set_id: int) -> Optional[Dict[str, Any]]:
    """Get a set and its jokes in order."""
    with with_conn() as conn:
        row = conn.execute("SELECT * FROM sets WHERE id = ?", (set_id,)).fetchone()
        if not row:
            return None
        jokes = conn.execute(
            """
            SELECT j.* FROM jokes j
            JOIN set_jokes sj ON j.id = sj.joke_id
            WHERE sj.set_id = ?
            ORDER BY sj.position
            """,
            (set_id,),
        ).fetchall()
        return {"set": _row_dict(row), "jokes": [_sanitize_joke(_row_dict(j)) for j in jokes]}


def delete_set(set_id: int) -> bool:
    """Delete a set. Unlinks performances from this set, then deletes set and set_jokes. Returns True if deleted."""
    with with_conn() as conn:
        conn.execute("UPDATE performances SET set_id = NULL WHERE set_id = ?", (set_id,))
        cur = conn.execute("DELETE FROM sets WHERE id = ?", (set_id,))
        conn.commit()
        return cur.rowcount > 0


# --- Venues & Performances ---

def add_venue(
    name: str,
    city: str = "",
    capacity: Optional[int] = None,
    notes: str = "",
) -> int:
    """Add a venue. Returns venue id."""
    with with_conn() as conn:
        cur = conn.execute(
            "INSERT INTO venues (name, city, capacity, notes) VALUES (?, ?, ?, ?)",
            (name, city or None, capacity, notes or None),
        )
        conn.commit()
        return cur.lastrowid or 0


def log_performance(
    performed_at: str,
    set_id: Optional[int] = None,
    venue_id: Optional[int] = None,
    duration_seconds: Optional[int] = None,
    notes: str = "",
    overall_rating: Optional[float] = None,
) -> int:
    """Log a performance. Returns performance id."""
    with with_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO performances (set_id, venue_id, performed_at, duration_seconds, notes, overall_rating)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (set_id, venue_id, performed_at, duration_seconds or None, notes or None, overall_rating),
        )
        conn.commit()
        return cur.lastrowid or 0

