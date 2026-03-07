#!/usr/bin/env python3
"""Initialize the joke management database and optionally seed sample data."""

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "jokes.db")
SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "schema.sql")


def init_db(seed_sample: bool = False) -> None:
    """Create database and tables from schema.sql. Optionally seed sample data."""
    with open(SCHEMA_PATH, encoding="utf-8") as f:
        schema = f.read()

    conn = sqlite3.connect(DB_PATH)
    conn.executescript(schema)
    conn.commit()

    if seed_sample:
        _seed_sample_data(conn)

    conn.close()
    print("Database initialized at {}".format(DB_PATH))


def _seed_sample_data(conn: sqlite3.Connection) -> None:
    """Insert a default comedian and some common tags."""
    conn.execute(
        "INSERT OR IGNORE INTO comedians (id, name) VALUES (1, 'Me')"
    )
    for tag in (
        "observational",
        "self-deprecating",
        "crowd work",
        "story",
        "one-liner",
        "callback",
        "political",
        "absurd",
    ):
        conn.execute(
            "INSERT OR IGNORE INTO tags (name) VALUES (?)", (tag,)
        )
    conn.commit()
    print("Sample comedian and tags seeded.")


if __name__ == "__main__":
    import sys
    init_db(seed_sample="--seed" in sys.argv)
