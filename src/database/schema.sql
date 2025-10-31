CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS novels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    source_language TEXT DEFAULT 'English',
    target_language TEXT DEFAULT 'English',
    rephrase_settings TEXT,
    translate_settings TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chapters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    source_content TEXT,
    target_content TEXT,
    status TEXT,
    chapter_order INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed a default user if none exists
INSERT INTO users (id, name, email)
SELECT 1, 'Default User', 'user@example.com'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = 1);

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
