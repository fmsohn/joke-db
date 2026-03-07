-- Joke Management Database for Comedians
-- SQLite schema

-- Users (login)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Comedians (one per user; data is scoped by comedian_id)
CREATE TABLE IF NOT EXISTS comedians (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    user_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Ideas: one-line seeds that convert to jokes later
CREATE TABLE IF NOT EXISTS ideas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comedian_id INTEGER NOT NULL DEFAULT 1,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (comedian_id) REFERENCES comedians(id)
);

-- Tags for categorizing jokes (e.g. "observational", "self-deprecating", "crowd work")
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Core jokes table
CREATE TABLE IF NOT EXISTS jokes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comedian_id INTEGER NOT NULL DEFAULT 1,
    title TEXT,
    premise TEXT NOT NULL,
    punchline TEXT,
    setup_notes TEXT,
    word_count INTEGER,
    estimated_duration_seconds INTEGER,
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'testing', 'active', 'retired', 'archived')),
    last_performed_at TEXT,
    times_performed INTEGER DEFAULT 0,
    avg_rating REAL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (comedian_id) REFERENCES comedians(id)
);

-- Many-to-many: jokes <-> tags
CREATE TABLE IF NOT EXISTS joke_tags (
    joke_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (joke_id, tag_id),
    FOREIGN KEY (joke_id) REFERENCES jokes(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Sets/routines (ordered list of jokes for a show)
CREATE TABLE IF NOT EXISTS sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comedian_id INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    description TEXT,
    total_duration_seconds INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (comedian_id) REFERENCES comedians(id)
);

-- Order of jokes within a set
CREATE TABLE IF NOT EXISTS set_jokes (
    set_id INTEGER NOT NULL,
    joke_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (set_id, joke_id),
    FOREIGN KEY (set_id) REFERENCES sets(id) ON DELETE CASCADE,
    FOREIGN KEY (joke_id) REFERENCES jokes(id) ON DELETE CASCADE
);

-- Venues
CREATE TABLE IF NOT EXISTS venues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    city TEXT,
    capacity INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Performances (when/where a set was performed)
CREATE TABLE IF NOT EXISTS performances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id INTEGER,
    venue_id INTEGER,
    performed_at TEXT NOT NULL,
    duration_seconds INTEGER,
    notes TEXT,
    overall_rating REAL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (set_id) REFERENCES sets(id),
    FOREIGN KEY (venue_id) REFERENCES venues(id)
);

-- Per-joke notes from a specific performance (what landed, what to change)
CREATE TABLE IF NOT EXISTS performance_joke_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    performance_id INTEGER NOT NULL,
    joke_id INTEGER NOT NULL,
    rating REAL,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (performance_id) REFERENCES performances(id) ON DELETE CASCADE,
    FOREIGN KEY (joke_id) REFERENCES jokes(id)
);

-- Trigger to update jokes.updated_at
CREATE TRIGGER IF NOT EXISTS jokes_updated_at
AFTER UPDATE ON jokes
BEGIN
    UPDATE jokes SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- Trigger to update sets.updated_at
CREATE TRIGGER IF NOT EXISTS sets_updated_at
AFTER UPDATE ON sets
BEGIN
    UPDATE sets SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_jokes_comedian ON jokes(comedian_id);
CREATE INDEX IF NOT EXISTS idx_jokes_status ON jokes(status);
CREATE INDEX IF NOT EXISTS idx_joke_tags_joke ON joke_tags(joke_id);
CREATE INDEX IF NOT EXISTS idx_joke_tags_tag ON joke_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_set_jokes_set ON set_jokes(set_id);
CREATE INDEX IF NOT EXISTS idx_performances_set ON performances(set_id);
CREATE INDEX IF NOT EXISTS idx_performances_venue ON performances(venue_id);
CREATE INDEX IF NOT EXISTS idx_performances_performed_at ON performances(performed_at);
CREATE INDEX IF NOT EXISTS idx_ideas_comedian ON ideas(comedian_id);
