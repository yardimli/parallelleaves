-- This schema is a simplified version based on the Laravel models provided.
-- It uses INTEGER for foreign keys and TEXT for JSON data.

-- For existing databases, run the following ALTER TABLE statements:
-- ALTER TABLE novels RENAME COLUMN prose_language TO target_language;
-- ALTER TABLE novels ADD COLUMN source_language TEXT DEFAULT 'English';
-- ALTER TABLE novels DROP COLUMN prose_tense;
-- ALTER TABLE novels DROP COLUMN prose_pov;
-- ALTER TABLE chapters RENAME COLUMN content TO source_content;
-- ALTER TABLE chapters ADD COLUMN target_content TEXT;
-- ALTER TABLE chapters RENAME COLUMN summary TO source_summary;
-- ALTER TABLE chapters ADD COLUMN target_summary TEXT;
-- ALTER TABLE chapters DROP COLUMN pov;
-- ALTER TABLE chapters DROP COLUMN pov_character_id;
-- ALTER TABLE novels DROP COLUMN editor_state;
-- ALTER TABLE codex_entries DROP COLUMN image_path;
-- ALTER TABLE images DROP COLUMN codex_entry_id;


CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS series (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS novels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    series_id INTEGER,
    title TEXT NOT NULL,
    author TEXT,
    genre TEXT,
    logline TEXT,
    synopsis TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    order_in_series INTEGER,
    -- NEW: Added source language for the translation project.
    source_language TEXT DEFAULT 'English',
    -- MODIFIED: Renamed prose_language to target_language.
    target_language TEXT DEFAULT 'English',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    section_order INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chapters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id INTEGER NOT NULL,
    section_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    -- MODIFIED: Renamed summary to source_summary.
    source_summary TEXT,
    -- NEW: Added target_summary for the translated summary.
    target_summary TEXT,
    -- MODIFIED: Renamed content to source_content.
    source_content TEXT,
    -- NEW: Added target_content for the translated text.
    target_content TEXT,
    status TEXT,
    chapter_order INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
    FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS codex_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS codex_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id INTEGER NOT NULL,
    codex_category_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
    FOREIGN KEY (codex_category_id) REFERENCES codex_categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    novel_id INTEGER,
    image_local_path TEXT,
    thumbnail_local_path TEXT,
    remote_url TEXT,
    prompt TEXT,
    image_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
);

-- Pivot table for Chapter <-> CodexEntry
CREATE TABLE IF NOT EXISTS chapter_codex_entry (
    chapter_id INTEGER NOT NULL,
    codex_entry_id INTEGER NOT NULL,
    PRIMARY KEY (chapter_id, codex_entry_id),
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
    FOREIGN KEY (codex_entry_id) REFERENCES codex_entries(id) ON DELETE CASCADE
);

-- Pivot table for CodexEntry <-> CodexEntry (self-referencing)
CREATE TABLE IF NOT EXISTS codex_entry_links (
    codex_entry_id INTEGER NOT NULL,
    linked_codex_entry_id INTEGER NOT NULL,
    PRIMARY KEY (codex_entry_id, linked_codex_entry_id),
    FOREIGN KEY (codex_entry_id) REFERENCES codex_entries(id) ON DELETE CASCADE,
    FOREIGN KEY (linked_codex_entry_id) REFERENCES codex_entries(id) ON DELETE CASCADE
);

-- Seed a default user if none exists
INSERT INTO users (id, name, email)
SELECT 1, 'Default User', 'user@example.com'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = 1);
