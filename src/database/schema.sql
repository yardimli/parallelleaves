-- This schema is a simplified version based on the Laravel models provided.
-- It uses INTEGER for foreign keys and TEXT for JSON data.


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
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    source_language TEXT DEFAULT 'English',
    target_language TEXT DEFAULT 'English',
    rephrase_settings TEXT,
    translate_settings TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    section_order INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chapters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id INTEGER NOT NULL,
    section_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    source_content TEXT,
    target_content TEXT,
    status TEXT,
    chapter_order INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS codex_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS codex_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id INTEGER NOT NULL,
    codex_category_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    target_content TEXT,
    document_phrases TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ALTER statements for existing databases:
-- ALTER TABLE codex_entries ADD COLUMN target_content TEXT;
-- ALTER TABLE codex_entries ADD COLUMN document_phrases TEXT;

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
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed a default user if none exists
INSERT INTO users (id, name, email)
SELECT 1, 'Default User', 'user@example.com'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = 1);

-- MODIFICATION START: Added triggers to automatically update the 'updated_at' timestamp on the 'novels' table.
-- This ensures the "Last Edit" date on the dashboard is always accurate when related content changes.

-- When a novel's own details are updated
CREATE TRIGGER IF NOT EXISTS update_novel_timestamp_on_update
    AFTER UPDATE ON novels
    FOR EACH ROW
BEGIN
    UPDATE novels
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = OLD.id;
END;

-- When a chapter is changed
CREATE TRIGGER IF NOT EXISTS update_novel_on_chapter_update
    AFTER UPDATE ON chapters
    FOR EACH ROW
BEGIN
    UPDATE novels
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.novel_id;
END;

CREATE TRIGGER IF NOT EXISTS update_novel_on_chapter_insert
    AFTER INSERT ON chapters
    FOR EACH ROW
BEGIN
    UPDATE novels
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.novel_id;
END;

CREATE TRIGGER IF NOT EXISTS update_novel_on_chapter_delete
    AFTER DELETE ON chapters
    FOR EACH ROW
BEGIN
    UPDATE novels
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = OLD.novel_id;
END;

-- When a section is changed
CREATE TRIGGER IF NOT EXISTS update_novel_on_section_update
    AFTER UPDATE ON sections
    FOR EACH ROW
BEGIN
    UPDATE novels
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.novel_id;
END;

CREATE TRIGGER IF NOT EXISTS update_novel_on_section_insert
    AFTER INSERT ON sections
    FOR EACH ROW
BEGIN
    UPDATE novels
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.novel_id;
END;

CREATE TRIGGER IF NOT EXISTS update_novel_on_section_delete
    AFTER DELETE ON sections
    FOR EACH ROW
BEGIN
    UPDATE novels
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = OLD.novel_id;
END;

-- When a codex entry is changed
CREATE TRIGGER IF NOT EXISTS update_novel_on_codex_entry_update
    AFTER UPDATE ON codex_entries
    FOR EACH ROW
BEGIN
    UPDATE novels
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.novel_id;
END;

CREATE TRIGGER IF NOT EXISTS update_novel_on_codex_entry_insert
    AFTER INSERT ON codex_entries
    FOR EACH ROW
BEGIN
    UPDATE novels
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.novel_id;
END;

CREATE TRIGGER IF NOT EXISTS update_novel_on_codex_entry_delete
    AFTER DELETE ON codex_entries
    FOR EACH ROW
BEGIN
    UPDATE novels
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = OLD.novel_id;
END;
-- MODIFICATION END
