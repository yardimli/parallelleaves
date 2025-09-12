const {app, BrowserWindow, Menu, MenuItem, ipcMain, dialog} = require('electron');
const path = require('path');
const url = require('url');
const fetch = require('node-fetch');
const fs = require('fs');
const mammoth = require('mammoth'); // NEW: For reading .docx files

require('dotenv').config();

const {initializeDatabase} = require('./src/database/database.js');
const aiService = require('./src/ai/ai.js');
const imageHandler = require('./src/utils/image-handler.js');

let db;
let mainWindow;
let editorWindows = new Map();
let chapterEditorWindows = new Map();
let outlineWindows = new Map();
let codexEditorWindows = new Map();
let importWindow = null; // NEW: To hold the import window instance

// --- Template and HTML Helper Functions ---

/**
 * Reads an HTML template file from the public/templates directory.
 * @param {string} templateName - The name of the template file (without extension).
 * @returns {string} The content of the template file.
 */
function getTemplate(templateName) {
	const templatePath = path.join(__dirname, 'public', 'templates', `${templateName}.html`);
	try {
		return fs.readFileSync(templatePath, 'utf8');
	} catch (error) {
		console.error(`Failed to read template: ${templateName}`, error);
		return `<p class="text-error">Error: Could not load template ${templateName}.</p>`;
	}
}

/**
 * Sanitizes text to be safely included in HTML attributes.
 * @param {string | null} text
 * @returns {string}
 */
function escapeAttr(text) {
	if (text === null || typeof text === 'undefined') return '';
	return String(text)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

/**
 * Counts the words in an HTML string by stripping tags.
 * @param {string | null} html The HTML content.
 * @returns {number} The number of words.
 */
function countWordsInHtml(html) {
	if (!html) return 0;
	// Remove HTML tags, then count words based on whitespace.
	const text = html.replace(/<[^>]*>/g, ' ');
	const words = text.trim().split(/\s+/).filter(Boolean);
	return words.length;
}

// --- Window Creation Functions ---

/**
 * Creates the main application window (Dashboard).
 */
function createMainWindow() {
	mainWindow = new BrowserWindow({
		width: 1400,
		height: 1000,
		icon: path.join(__dirname, 'assets/icon.png'),
		title: 'Parallel Leaves',
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false
		}
	});
	
	mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
		callback({
			responseHeaders: {
				...details.responseHeaders,
				'Content-Security-Policy': ["default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' file: data: https:;"]
			}
		});
	});
	
	mainWindow.webContents.on('context-menu', (event, params) => {
		const menu = new Menu();
		
		for (const suggestion of params.dictionarySuggestions) {
			menu.append(new MenuItem({
				label: suggestion,
				click: () => mainWindow.webContents.replaceMisspelling(suggestion)
			}));
		}
		
		if (params.misspelledWord) {
			menu.append(
				new MenuItem({
					label: 'Add to dictionary',
					click: () => mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
				})
			);
		}
		
		if (params.isEditable) {
			if (menu.items.length > 0) {
				menu.append(new MenuItem({type: 'separator'}));
			}
			
			menu.append(new MenuItem({label: 'Cut', role: 'cut', enabled: params.selectionText}));
			menu.append(new MenuItem({label: 'Copy', role: 'copy', enabled: params.selectionText}));
			menu.append(new MenuItem({label: 'Paste', role: 'paste'}));
			menu.append(new MenuItem({type: 'separator'}));
			menu.append(new MenuItem({label: 'Select All', role: 'selectAll'}));
		}
		
		menu.popup();
	});
	
	
	mainWindow.loadFile('public/index.html');
	
	mainWindow.on('closed', () => {
		mainWindow = null;
	});
	
	// mainWindow.webContents.openDevTools();
	
}

/**
 * Creates a new novel editor window for a given novel.
 * @param {number} novelId - The ID of the novel to load.
 */
function createEditorWindow(novelId) {
	if (editorWindows.has(novelId)) {
		const existingWin = editorWindows.get(novelId);
		if (existingWin) {
			existingWin.focus();
			return;
		}
	}
	
	const editorWindow = new BrowserWindow({
		width: 1600,
		height: 900,
		icon: path.join(__dirname, 'assets/icon.png'),
		title: 'Parallel Leaves - Editor',
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false
		}
	});
	
	editorWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
		callback({
			responseHeaders: {
				...details.responseHeaders,
				'Content-Security-Policy': ["default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' file: data: https:;"]
			}
		});
	});
	
	editorWindow.loadFile('public/novel-planner.html', {query: {novelId: novelId}});
	editorWindows.set(novelId, editorWindow);
	
	editorWindow.webContents.on('context-menu', (event, params) => {
		const menu = new Menu();
		
		for (const suggestion of params.dictionarySuggestions) {
			menu.append(new MenuItem({
				label: suggestion,
				click: () => editorWindow.webContents.replaceMisspelling(suggestion)
			}));
		}
		
		if (params.misspelledWord) {
			menu.append(
				new MenuItem({
					label: 'Add to dictionary',
					click: () => editorWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
				})
			);
		}
		
		if (params.isEditable) {
			if (menu.items.length > 0) {
				menu.append(new MenuItem({type: 'separator'}));
			}
			
			menu.append(new MenuItem({label: 'Cut', role: 'cut', enabled: params.selectionText}));
			menu.append(new MenuItem({label: 'Copy', role: 'copy', enabled: params.selectionText}));
			menu.append(new MenuItem({label: 'Paste', role: 'paste'}));
			menu.append(new MenuItem({type: 'separator'}));
			menu.append(new MenuItem({label: 'Select All', role: 'selectAll'}));
		}
		
		menu.popup();
	});
	
	
	editorWindow.on('closed', () => {
		editorWindows.delete(novelId);
	});
	
	// editorWindow.webContents.openDevTools();
	
}

/**
 * Creates a new dedicated chapter editor window.
 * @param {object} options - Options for opening the window.
 * @param {number} options.novelId - The ID of the novel.
 * @param {number} options.chapterId - The ID of the chapter to scroll to.
 */
function createChapterEditorWindow({ novelId, chapterId }) {
	const windowKey = `chapter-editor-${novelId}`; // Only one manuscript editor per novel
	if (chapterEditorWindows.has(windowKey)) {
		const existingWin = chapterEditorWindows.get(windowKey);
		if (existingWin) {
			existingWin.focus();
			existingWin.webContents.send('manuscript:scrollToChapter', chapterId);
			return;
		}
	}
	
	const chapterEditorWindow = new BrowserWindow({
		width: 1600,
		height: 1000,
		icon: path.join(__dirname, 'assets/icon.png'),
		title: 'Parallel Leaves - Manuscript Editor',
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	
	chapterEditorWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
		callback({
			responseHeaders: {
				...details.responseHeaders,
				"Content-Security-Policy": ["default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' file: data: https:;"],
			},
		});
	});
	
	chapterEditorWindow.loadFile('public/chapter-editor.html', { query: { novelId, chapterId } });
	chapterEditorWindows.set(windowKey, chapterEditorWindow);
	
	chapterEditorWindow.webContents.on('context-menu', (event, params) => {
		const menu = new Menu();
		for (const suggestion of params.dictionarySuggestions) {
			menu.append(new MenuItem({
				label: suggestion,
				click: () => chapterEditorWindow.webContents.replaceMisspelling(suggestion)
			}));
		}
		if (params.misspelledWord) {
			menu.append(new MenuItem({
				label: 'Add to dictionary',
				click: () => chapterEditorWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
			}));
		}
		if (params.isEditable) {
			if (menu.items.length > 0) menu.append(new MenuItem({type: 'separator'}));
			menu.append(new MenuItem({label: 'Cut', role: 'cut', enabled: params.selectionText}));
			menu.append(new MenuItem({label: 'Copy', role: 'copy', enabled: params.selectionText}));
			menu.append(new MenuItem({label: 'Paste', role: 'paste'}));
			menu.append(new MenuItem({type: 'separator'}));
			menu.append(new MenuItem({label: 'Select All', role: 'selectAll'}));
		}
		menu.popup();
	});
	
	chapterEditorWindow.on('closed', () => {
		chapterEditorWindows.delete(windowKey);
	});
}

function createOutlineWindow(novelId) {
	if (outlineWindows.has(novelId)) {
		const existingWin = outlineWindows.get(novelId);
		if (existingWin) {
			existingWin.focus();
			return;
		}
	}
	
	const outlineWindow = new BrowserWindow({
		width: 1800,
		height: 1000,
		icon: path.join(__dirname, 'assets/icon.png'),
		title: 'Parallel Leaves - Outline Viewer',
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	
	outlineWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
		callback({
			responseHeaders: {
				...details.responseHeaders,
				"Content-Security-Policy": ["default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' file: data: https:;"],
			},
		});
	});
	
	outlineWindow.loadFile('public/outline-viewer.html', {query: {novelId: novelId}});
	outlineWindows.set(novelId, outlineWindow);
	
	outlineWindow.on('closed', () => {
		outlineWindows.delete(novelId);
	});
	
	// outlineWindow.webContents.openDevTools();
}

function createCodexEditorWindow(options) {
	const { mode, entryId, novelId, selectedText } = options;
	
	// Use a unique key to prevent opening multiple identical windows.
	const windowKey = mode === 'edit' ? `edit-${entryId}` : `new-${novelId}`;
	if (codexEditorWindows.has(windowKey)) {
		codexEditorWindows.get(windowKey).focus();
		return;
	}
	
	const codexEditorWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		icon: path.join(__dirname, 'assets/icon.png'),
		title: 'Parallel Leaves - Codex Editor',
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	
	codexEditorWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
		callback({
			responseHeaders: {
				...details.responseHeaders,
				"Content-Security-Policy": ["default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' file: data: https:;"],
			},
		});
	});
	
	// Build the query string for the renderer process.
	const query = { mode };
	if (mode === 'edit') {
		query.entryId = entryId;
	} else {
		query.novelId = novelId;
		query.selectedText = encodeURIComponent(selectedText || '');
	}
	
	codexEditorWindow.loadFile('public/codex-entry-editor.html', { query });
	codexEditorWindows.set(windowKey, codexEditorWindow);
	
	codexEditorWindow.webContents.on('context-menu', (event, params) => {
		const menu = new Menu();
		for (const suggestion of params.dictionarySuggestions) {
			menu.append(new MenuItem({
				label: suggestion,
				click: () => codexEditorWindow.webContents.replaceMisspelling(suggestion)
			}));
		}
		if (params.misspelledWord) {
			menu.append(new MenuItem({
				label: 'Add to dictionary',
				click: () => codexEditorWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
			}));
		}
		if (params.isEditable) {
			if (menu.items.length > 0) menu.append(new MenuItem({ type: 'separator' }));
			menu.append(new MenuItem({ label: 'Cut', role: 'cut', enabled: params.selectionText }));
			menu.append(new MenuItem({ label: 'Copy', role: 'copy', enabled: params.selectionText }));
			menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
			menu.append(new MenuItem({ type: 'separator' }));
			menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));
		}
		menu.popup();
	});
	
	codexEditorWindow.on('closed', () => {
		codexEditorWindows.delete(windowKey);
	});
}

// NEW: Function to create the document import window.
function createImportWindow() {
	if (importWindow) {
		importWindow.focus();
		return;
	}
	
	importWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		icon: path.join(__dirname, 'assets/icon.png'),
		title: 'Parallel Leaves - Import Document',
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	
	importWindow.loadFile('public/import-document.html');
	
	importWindow.on('closed', () => {
		importWindow = null;
	});
}


/**
 * Wraps all IPC handler registrations in a single function.
 */
function setupIpcHandlers() {
	// --- App-level Handlers ---
	
	// NEW: IPC listener to open the import window.
	ipcMain.on('app:open-import-window', () => {
		createImportWindow();
	});
	
	// --- Novel Handlers ---
	
	ipcMain.handle('novels:getAllWithCovers', () => {
		const stmt = db.prepare(`
            SELECT
                n.*,
                i.image_local_path as cover_path,
                (SELECT COUNT(id) FROM chapters WHERE novel_id = n.id) as chapter_count
            FROM novels n
            LEFT JOIN (
                SELECT novel_id, image_local_path, ROW_NUMBER() OVER(PARTITION BY novel_id ORDER BY created_at DESC) as rn
                FROM images
				WHERE codex_entry_id IS NULL
            ) i ON n.id = i.novel_id AND i.rn = 1
            ORDER BY n.created_at DESC
        `);
		const novels = stmt.all();
		
		novels.forEach(novel => {
			if (novel.cover_path) {
				novel.cover_path = path.join(imageHandler.IMAGES_DIR, novel.cover_path);
			}
		});
		return novels;
	});
	
	ipcMain.handle('novels:getOne', (event, novelId) => {
		const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(novelId);
		if (!novel) return null;
		
		novel.sections = db.prepare('SELECT * FROM sections WHERE novel_id = ? ORDER BY section_order').all(novelId);
		novel.sections.forEach(section => {
			section.chapters = db.prepare('SELECT * FROM chapters WHERE section_id = ? ORDER BY `chapter_order`').all(section.id);
		});
		
		novel.codexCategories = db.prepare(`
            SELECT cc.*, COUNT(ce.id) as entries_count FROM codex_categories cc
            LEFT JOIN codex_entries ce ON ce.codex_category_id = cc.id
            WHERE cc.novel_id = ? GROUP BY cc.id ORDER BY cc.name
        `).all(novelId);
		
		novel.codexCategories.forEach(category => {
			category.entries = db.prepare(`
                SELECT ce.*, i.thumbnail_local_path
                FROM codex_entries ce
                LEFT JOIN images i ON i.codex_entry_id = ce.id
                WHERE ce.codex_category_id = ? ORDER BY ce.title
            `).all(category.id);
		});
		
		if (novel.editor_state) {
			try {
				novel.editor_state = JSON.parse(novel.editor_state);
			} catch (e) {
				console.error('Failed to parse editor state for novel:', novelId);
				novel.editor_state = null;
			}
		}
		return novel;
	});
	
	ipcMain.handle('novels:getOutlineData', (event, novelId) => {
		const novel = db.prepare('SELECT title, prose_pov FROM novels WHERE id = ?').get(novelId);
		if (!novel) throw new Error('Novel not found');
		
		const povDisplayMap = {
			'first_person': '1st Person',
			'second_person': '2nd Person',
			'third_person': '3rd Person',
			'third_person_limited': '3rd Person (Limited)',
			'third_person_omniscient': '3rd Person (Omniscient)',
		};
		
		// 1. Get Outline Structure
		const sections = db.prepare('SELECT * FROM sections WHERE novel_id = ? ORDER BY section_order').all(novelId);
		sections.forEach(section => {
			section.chapters = db.prepare('SELECT id, title, summary, content, pov, pov_character_id, chapter_order FROM chapters WHERE section_id = ? ORDER BY chapter_order').all(section.id);
			
			let sectionTotalWords = 0;
			
			section.chapters.forEach(chapter => {
				chapter.word_count = countWordsInHtml(chapter.content);
				sectionTotalWords += chapter.word_count;
				
				// Get POV info
				const povType = chapter.pov || novel.prose_pov;
				const povCharacter = chapter.pov_character_id ? db.prepare('SELECT title FROM codex_entries WHERE id = ?').get(chapter.pov_character_id) : null;
				chapter.pov_display = {
					type: povDisplayMap[povType] || 'Not Set',
					character_name: povCharacter ? povCharacter.title : null
				};
				
				// Get linked codex entries
				chapter.linked_codex = db.prepare(`
                SELECT ce.id, ce.title, i.thumbnail_local_path
                FROM codex_entries ce
                JOIN chapter_codex_entry cce ON ce.id = cce.codex_entry_id
                LEFT JOIN images i ON ce.id = i.codex_entry_id
                WHERE cce.chapter_id = ?
                ORDER BY ce.title
            `).all(chapter.id);
			});
			
			section.total_word_count = sectionTotalWords;
			section.chapter_count = section.chapters.length;
		});
		
		// 2. Get All Codex Entries
		const codexCategories = db.prepare(`
        SELECT id, name FROM codex_categories
        WHERE novel_id = ? ORDER BY name
    `).all(novelId);
		
		codexCategories.forEach(category => {
			category.entries = db.prepare(`
            SELECT ce.id, ce.title, ce.content, i.thumbnail_local_path
            FROM codex_entries ce
            LEFT JOIN images i ON i.codex_entry_id = ce.id
            WHERE ce.codex_category_id = ? ORDER BY ce.title
        `).all(category.id);
		});
		
		return {
			novel_title: novel.title,
			sections: sections,
			codex_categories: codexCategories
		};
	});
	
	ipcMain.handle('novels:getFullManuscript', (event, novelId) => {
		const novel = db.prepare('SELECT id, title FROM novels WHERE id = ?').get(novelId);
		if (!novel) return null;
		
		novel.sections = db.prepare('SELECT * FROM sections WHERE novel_id = ? ORDER BY section_order').all(novelId);
		novel.sections.forEach(section => {
			section.chapters = db.prepare('SELECT id, title, content, summary, chapter_order FROM chapters WHERE section_id = ? ORDER BY chapter_order').all(section.id);
			section.chapters.forEach(chapter => {
				chapter.word_count = countWordsInHtml(chapter.content);
				
				chapter.linked_codex = db.prepare(`
                    SELECT ce.id, ce.title, i.thumbnail_local_path
                    FROM codex_entries ce
                    JOIN chapter_codex_entry cce ON ce.id = cce.codex_entry_id
                    LEFT JOIN images i ON ce.id = i.codex_entry_id
                    WHERE cce.chapter_id = ? ORDER BY ce.title
                `).all(chapter.id);
			});
		});
		return novel;
	});
	
	ipcMain.handle('novels:store', async (event, data) => {
		const userId = 1;
		const stmt = db.prepare(`
            INSERT INTO novels (user_id, title, author, status)
            VALUES (?, ?, ?, 'draft')
        `);
		const result = stmt.run(userId, data.title, data.author);
		const novelId = result.lastInsertRowid;
		
		return {id: novelId, ...data};
	});
	
	ipcMain.handle('novels:updateProseSettings', (event, {novelId, prose_tense, prose_language, prose_pov}) => {
		try {
			db.prepare(`
                UPDATE novels
                SET prose_tense = ?, prose_language = ?, prose_pov = ?
                WHERE id = ?
            `).run(prose_tense, prose_language, prose_pov, novelId);
			return {success: true};
		} catch (error) {
			console.error('Failed to update prose settings:', error);
			throw new Error('Failed to update prose settings.');
		}
	});
	
	ipcMain.handle('novels:updateMeta', (event, {novelId, title, author}) => {
		try {
			db.prepare(`
                UPDATE novels
                SET title = ?, author = ?
                WHERE id = ?
            `).run(title, author, novelId);
			return {success: true};
		} catch (error) {
			console.error('Failed to update novel meta:', error);
			throw new Error('Failed to update novel metadata.');
		}
	});
	
	ipcMain.handle('novels:updateCover', async (event, {novelId, coverInfo}) => {
		let localPath;
		let imageType = 'unknown';
		
		if (coverInfo.type === 'remote') {
			localPath = await imageHandler.storeImageFromUrl(coverInfo.data, novelId, 'cover');
			imageType = 'generated';
		} else if (coverInfo.type === 'local') {
			const paths = await imageHandler.storeImageFromPath(coverInfo.data, novelId, null, 'cover-upload');
			localPath = paths.original_path;
			imageType = 'upload';
		}
		
		if (!localPath) {
			throw new Error('Failed to store the new cover image.');
		}
		
		// This transaction ensures we delete the old file and DB record before adding the new one.
		const transaction = db.transaction(() => {
			const oldImage = db.prepare("SELECT * FROM images WHERE novel_id = ? AND codex_entry_id IS NULL").get(novelId);
			if (oldImage && oldImage.image_local_path) {
				const oldFullPath = path.join(imageHandler.IMAGES_DIR, oldImage.image_local_path);
				if (fs.existsSync(oldFullPath)) {
					fs.unlinkSync(oldFullPath);
				}
			}
			db.prepare("DELETE FROM images WHERE novel_id = ? AND codex_entry_id IS NULL").run(novelId);
			
			db.prepare(`
                INSERT INTO images (user_id, novel_id, image_local_path, thumbnail_local_path, image_type)
                VALUES (?, ?, ?, ?, ?)
            `).run(1, novelId, localPath, localPath, imageType);
		});
		
		transaction();
		
		const absolutePath = path.join(imageHandler.IMAGES_DIR, localPath);
		BrowserWindow.getAllWindows().forEach(win => {
			win.webContents.send('novels:cover-updated', {novelId, imagePath: absolutePath});
		});
		
		return {success: true};
	});
	
	ipcMain.handle('novels:delete', (event, novelId) => {
		const deleteTransaction = db.transaction(() => {
			// 1. Find all image files associated with the novel to delete them from disk.
			const imagesToDelete = db.prepare('SELECT image_local_path, thumbnail_local_path FROM images WHERE novel_id = ?').all(novelId);
			
			for (const image of imagesToDelete) {
				if (image.image_local_path) {
					const fullPath = path.join(imageHandler.IMAGES_DIR, image.image_local_path);
					if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
				}
				if (image.thumbnail_local_path) {
					const thumbPath = path.join(imageHandler.IMAGES_DIR, image.thumbnail_local_path);
					if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
				}
			}
			
			// 2. Delete the novel from the database.
			// ON DELETE CASCADE in schema.sql will handle deleting related records in other tables.
			db.prepare('DELETE FROM novels WHERE id = ?').run(novelId);
		});
		
		try {
			deleteTransaction();
			return {success: true};
		} catch (error) {
			console.error(`Failed to delete novel ${novelId}:`, error);
			throw new Error('Failed to delete the novel.');
		}
	});
	
	ipcMain.on('novels:openEditor', (event, novelId) => {
		createEditorWindow(novelId);
	});
	
	ipcMain.on('novels:openOutline', (event, novelId) => {
		createOutlineWindow(novelId);
	});
	
	ipcMain.on('chapters:openEditor', (event, { novelId, chapterId }) => {
		createChapterEditorWindow({ novelId, chapterId });
	});
	
	// --- Chapter Handlers ---
	ipcMain.handle('chapters:store', (event, novelId, data) => {
		const {title, summary, position} = data;
		
		if (!title || !position) {
			throw new Error('Title and position are required to create a chapter.');
		}
		
		const [type, id] = position.split('-');
		const targetId = parseInt(id, 10);
		
		let sectionId;
		let newOrder;
		let reorderedChapters = [];
		
		const transaction = db.transaction(() => {
			if (type === 'section') {
				// Logic to insert a chapter at the beginning of a section.
				sectionId = targetId;
				newOrder = 1; // This will be the first chapter.
				
				// Shift all existing chapters in this section down by one.
				db.prepare('UPDATE chapters SET chapter_order = chapter_order + 1 WHERE section_id = ?')
					.run(sectionId);
				
				// Get the list of all chapters in the section that were reordered.
				reorderedChapters = db.prepare('SELECT id, title, chapter_order FROM chapters WHERE section_id = ? AND chapter_order > 1 ORDER BY chapter_order ASC')
					.all(sectionId);
				
			} else if (type === 'chapter') {
				const targetChapter = db.prepare('SELECT section_id, chapter_order FROM chapters WHERE id = ?').get(targetId);
				if (!targetChapter) throw new Error('Target chapter for insertion not found.');
				
				sectionId = targetChapter.section_id;
				newOrder = targetChapter.chapter_order + 1;
				
				// Shift subsequent chapters
				db.prepare('UPDATE chapters SET chapter_order = chapter_order + 1 WHERE section_id = ? AND chapter_order >= ?')
					.run(sectionId, newOrder);
				
				// Get the list of chapters that were reordered to send back to the UI
				reorderedChapters = db.prepare('SELECT id, title, chapter_order FROM chapters WHERE section_id = ? AND chapter_order >= ? ORDER BY chapter_order ASC')
					.all(sectionId, newOrder);
			} else {
				throw new Error('Invalid position type for new chapter.');
			}
			
			// Insert the new chapter
			const result = db.prepare('INSERT INTO chapters (novel_id, section_id, title, summary, status, chapter_order) VALUES (?, ?, ?, ?, ?, ?)')
				.run(novelId, sectionId, title, summary || null, 'in_progress', newOrder);
			
			const newChapterId = result.lastInsertRowid;
			const newChapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(newChapterId);
			
			return {newChapter, reorderedChapters};
		});
		
		try {
			const {newChapter, reorderedChapters} = transaction();
			return {success: true, chapter: newChapter, reorderedChapters};
		} catch (error) {
			console.error('Failed to create chapter:', error);
			return {success: false, message: error.message};
		}
	});
	
	ipcMain.handle('chapters:updateField', (event, { chapterId, field, value }) => {
		const allowedFields = ['title', 'content', 'summary'];
		if (!allowedFields.includes(field)) {
			return { success: false, message: 'Invalid field specified.' };
		}
		try {
			// Use a template literal safely as the field name is whitelisted.
			db.prepare(`UPDATE chapters SET ${field} = ? WHERE id = ?`).run(value, chapterId);
			return { success: true };
		} catch (error) {
			console.error(`Failed to update ${field} for chapter ${chapterId}:`, error);
			return { success: false, message: `Failed to save ${field}.` };
		}
	});
	
	ipcMain.handle('chapters:getOneHtml', (event, chapterId) => {
		const chapter = db.prepare(`
			SELECT
				c.*,
				s.title as section_title,
				s.section_order as section_order,
				n.prose_pov as novel_default_pov,
				pov_char.title as pov_character_name
			FROM
				chapters c
			LEFT JOIN
				sections s ON c.section_id = s.id
			LEFT JOIN
				novels n ON c.novel_id = n.id
			LEFT JOIN
				codex_entries pov_char ON c.pov_character_id = pov_char.id
			WHERE
				c.id = ?
		`).get(chapterId);
		
		if (!chapter) throw new Error('Chapter not found');
		
		chapter.codexEntries = db.prepare(`
        SELECT ce.*, i.thumbnail_local_path
        FROM codex_entries ce
        JOIN chapter_codex_entry cce ON ce.id = cce.codex_entry_id
        LEFT JOIN images i ON ce.id = i.codex_entry_id
        WHERE cce.chapter_id = ?
        ORDER BY ce.title
    `).all(chapterId);

		const chapterCodexTagTemplate = getTemplate('chapter/chapter-codex-tag');
		
		const codexTagsHtml = chapter.codexEntries.map(entry => {
			return chapterCodexTagTemplate
				.replace(/{{ENTRY_ID}}/g, entry.id)
				.replace(/{{ENTRY_TITLE}}/g, escapeAttr(entry.title))
				.replace(/{{CHAPTER_ID}}/g, chapter.id);
		}).join('');
		
		const sectionInfoHtml = chapter.section_order ? `<h3 class="text-sm font-semibold uppercase tracking-wider text-indigo-500 dark:text-indigo-400">${chapter.section_order}. ${escapeAttr(chapter.section_title)} &ndash; Chapter ${chapter.chapter_order}</h3>` : '';
		
		// Prepare POV display data.
		const povDisplayMap = {
			'first_person': '1st Person',
			'second_person': '2nd Person',
			'third_person': '3rd Person',
			'third_person_limited': '3rd Person (Limited)',
			'third_person_omniscient': '3rd Person (Omniscient)',
		};
		
		const povType = chapter.pov || chapter.novel_default_pov;
		const povTypeDisplay = povDisplayMap[povType] || 'Not Set';
		const povCharacterHtml = chapter.pov_character_name ? ` &ndash; <span class="italic">${escapeAttr(chapter.pov_character_name)}</span>` : '';
		const povSourceText = chapter.pov ? 'This chapter has a custom POV.' : ""; // "Using novel's default POV setting.";
		
		const povDisplayTemplate = getTemplate('chapter/chapter-pov-display');
		const povSettingsHtml = povDisplayTemplate
			.replace('{{POV_TYPE_DISPLAY}}', povTypeDisplay)
			.replace('{{POV_CHARACTER_HTML}}', povCharacterHtml)
			.replace('{{POV_SOURCE_TEXT}}', povSourceText)
			.replace('{{CHAPTER_ID}}', chapter.id);
		
		let template = getTemplate('chapter/chapter-window');
		template = template.replace('{{CHAPTER_ID}}', chapter.id);
		template = template.replace('{{SECTION_INFO_HTML}}', sectionInfoHtml);
		template = template.replace('{{CHAPTER_TITLE_ATTR}}', escapeAttr(chapter.title));
		template = template.replace('{{CHAPTER_SUMMARY_HTML}}', chapter.summary || '');
		template = template.replace('{{TAGS_WRAPPER_HIDDEN}}', chapter.codexEntries.length === 0 ? 'hidden' : '');
		template = template.replace('{{CODEX_TAGS_HTML}}', codexTagsHtml);
		template = template.replace('{{POV_SETTINGS_HTML}}', povSettingsHtml);
		
		return template;
	});
	
	ipcMain.handle('chapters:updateContent', (event, chapterId, data) => {
		try {
			// The SQL query no longer updates the 'content' field.
			db.prepare('UPDATE chapters SET title = ?, summary = ? WHERE id = ?')
				.run(data.title, data.summary, chapterId);
			return {success: true, message: 'Chapter content updated.'};
		} catch (error) {
			console.error(`Failed to update chapter ${chapterId}:`, error);
			return {success: false, message: 'Failed to save chapter content.'};
		}
	});
	
	ipcMain.handle('chapters:getPovData', (event, chapterId) => {
		const chapter = db.prepare('SELECT novel_id, pov, pov_character_id FROM chapters WHERE id = ?').get(chapterId);
		if (!chapter) throw new Error('Chapter not found.');
		
		const novel = db.prepare('SELECT prose_pov FROM novels WHERE id = ?').get(chapter.novel_id);
		
		// Find the 'Characters' category ID, case-insensitively.
		const charactersCategory = db.prepare(`
            SELECT id FROM codex_categories
            WHERE novel_id = ? AND lower(name) = 'characters'
        `).get(chapter.novel_id);
		
		let characters = [];
		if (charactersCategory) {
			characters = db.prepare(`
                SELECT id, title FROM codex_entries
                WHERE codex_category_id = ? ORDER BY title
            `).all(charactersCategory.id);
		}
		
		return {
			currentPov: chapter.pov || novel.prose_pov,
			currentCharacterId: chapter.pov_character_id,
			isOverride: !!chapter.pov,
			characters: characters
		};
	});
	
	ipcMain.handle('chapters:updatePov', (event, {chapterId, pov, pov_character_id}) => {
		try {
			db.prepare('UPDATE chapters SET pov = ?, pov_character_id = ? WHERE id = ?')
				.run(pov, pov_character_id || null, chapterId);
			
			// Fetch the updated display info to send back to the renderer for UI updates.
			const updatedChapter = db.prepare(`
                SELECT c.pov, pov_char.title as pov_character_name, n.prose_pov as novel_default_pov
                FROM chapters c
                LEFT JOIN novels n ON c.novel_id = n.id
                LEFT JOIN codex_entries pov_char ON c.pov_character_id = pov_char.id
                WHERE c.id = ?
            `).get(chapterId);
			
			return {success: true, updatedChapter};
		} catch (error) {
			console.error('Failed to update chapter POV:', error);
			return {success: false, message: error.message};
		}
	});
	
	ipcMain.handle('chapters:deletePovOverride', (event, chapterId) => {
		try {
			db.prepare('UPDATE chapters SET pov = NULL, pov_character_id = NULL WHERE id = ?')
				.run(chapterId);
			
			// Fetch the updated display info to send back.
			const updatedChapter = db.prepare(`
                SELECT c.pov, pov_char.title as pov_character_name, n.prose_pov as novel_default_pov
                FROM chapters c
                LEFT JOIN novels n ON c.novel_id = n.id
                LEFT JOIN codex_entries pov_char ON c.pov_character_id = pov_char.id
                WHERE c.id = ?
            `).get(chapterId);
			
			return {success: true, updatedChapter};
		} catch (error) {
			console.error('Failed to delete chapter POV override:', error);
			return {success: false, message: error.message};
		}
	});
	
	ipcMain.handle('chapters:getLinkedCodexIds', (event, chapterId) => {
		try {
			const results = db.prepare('SELECT codex_entry_id FROM chapter_codex_entry WHERE chapter_id = ?').all(chapterId);
			return results.map(row => row.codex_entry_id);
		} catch (error) {
			console.error('Failed to get linked codex IDs:', error);
			return [];
		}
	});
	
	
	// --- File System Handlers ---
	ipcMain.handle('files:getStructureFiles', () => {
		try {
			const structuresDir = path.join(__dirname, 'structures');
			const files = fs.readdirSync(structuresDir);
			return files
				.filter(file => file.endsWith('.txt'))
				.map(file => {
					const name = path.basename(file, '.txt')
						.replace(/-/g, ' ')
						.replace(/\b\w/g, l => l.toUpperCase());
					return {name: name, value: file};
				});
		} catch (error) {
			console.error('Could not read structure files:', error);
			return [];
		}
	});
	
	// --- Editor IPC Handlers ---
	
	ipcMain.handle('templates:get', (event, templateName) => {
		return getTemplate(templateName);
	});
	
	ipcMain.handle('editor:saveState', (event, novelId, state) => {
		try {
			const jsonState = JSON.stringify(state);
			db.prepare('UPDATE novels SET editor_state = ? WHERE id = ?').run(jsonState, novelId);
			return {success: true};
		} catch (error) {
			console.error('Failed to save editor state:', error);
			throw error;
		}
	});
	
	ipcMain.handle('codex-entries:getOneHtml', (event, entryId) => {
		const codexEntry = db.prepare('SELECT * FROM codex_entries WHERE id = ?').get(entryId);
		if (!codexEntry) throw new Error('Codex Entry not found');
		
		const image = db.prepare('SELECT * FROM images WHERE codex_entry_id = ?').get(entryId);
		codexEntry.image_url = image
			? `file://${path.join(imageHandler.IMAGES_DIR, image.image_local_path)}`
			: './assets/codex-placeholder.png';
		
		codexEntry.linkedEntries = db.prepare(`
            SELECT ce.*, i.thumbnail_local_path
            FROM codex_entries ce
            JOIN codex_entry_links cel ON ce.id = cel.linked_codex_entry_id
            LEFT JOIN images i ON ce.id = i.codex_entry_id
            WHERE cel.codex_entry_id = ?
            ORDER BY ce.title
        `).all(entryId);
		
		const codexLinkTagTemplate = getTemplate('planner/codex-link-tag');
		
		const linkedTagsHtml = codexEntry.linkedEntries.map(entry => {
			return codexLinkTagTemplate
				.replace(/{{ENTRY_ID}}/g, entry.id)
				.replace(/{{ENTRY_TITLE}}/g, escapeAttr(entry.title))
				.replace(/{{PARENT_ENTRY_ID}}/g, codexEntry.id);
		}).join('');
		
		let template = getTemplate('planner/codex-entry-window');
		template = template.replace(/{{ENTRY_ID}}/g, codexEntry.id);
		template = template.replace(/{{ENTRY_TITLE_ATTR}}/g, escapeAttr(codexEntry.title));
		template = template.replace('{{IMAGE_URL}}', escapeAttr(codexEntry.image_url));
		template = template.replace('{{CONTENT_HTML}}', codexEntry.content || '');
		template = template.replace('{{LINKED_TAGS_WRAPPER_HIDDEN}}', codexEntry.linkedEntries.length === 0 ? 'hidden' : '');
		template = template.replace('{{LINKED_TAGS_HTML}}', linkedTagsHtml);
		
		return template;
	});
	
	ipcMain.handle('codex:getAllForNovel', (event, novelId) => {
		try {
			const categories = db.prepare('SELECT id, name FROM codex_categories WHERE novel_id = ? ORDER BY name ASC').all(novelId);
			categories.forEach(category => {
				category.entries = db.prepare('SELECT id, title, content FROM codex_entries WHERE codex_category_id = ? ORDER BY title ASC').all(category.id);
			});
			return categories;
		} catch (error) {
			console.error('Failed to get all codex entries for novel:', error);
			return [];
		}
	});
	
	ipcMain.handle('codex-categories:getAllForNovel', (event, novelId) => {
		try {
			return db.prepare('SELECT id, name FROM codex_categories WHERE novel_id = ? ORDER BY name ASC').all(novelId);
		} catch (error) {
			console.error('Failed to get categories for novel:', error);
			return [];
		}
	});
	
	ipcMain.handle('chapters:codex:attach', (event, chapterId, codexEntryId) => {
		db.prepare('INSERT OR IGNORE INTO chapter_codex_entry (chapter_id, codex_entry_id) VALUES (?, ?)')
			.run(chapterId, codexEntryId);
		
		const codexEntry = db.prepare('SELECT ce.*, i.thumbnail_local_path FROM codex_entries ce LEFT JOIN images i ON ce.id = i.codex_entry_id WHERE ce.id = ?')
			.get(codexEntryId);
		
		return {
			success: true,
			message: 'Codex entry linked successfully.',
			codexEntry: {
				id: codexEntry.id,
				title: codexEntry.title,
			}
		};
	});
	
	ipcMain.handle('chapters:codex:detach', (event, chapterId, codexEntryId) => {
		db.prepare('DELETE FROM chapter_codex_entry WHERE chapter_id = ? AND codex_entry_id = ?')
			.run(chapterId, codexEntryId);
		return {success: true, message: 'Codex entry unlinked.'};
	});
	
	ipcMain.handle('codex-entries:suggest-details', async (event, { novelId, text }) => {
		try {
			const categories = db.prepare('SELECT id, name FROM codex_categories WHERE novel_id = ? ORDER BY name').all(novelId);
			const categoryNames = categories.map(c => c.name);
			
			if (categoryNames.length === 0) {
				categoryNames.push('Characters', 'Locations', 'Items', 'Lore');
			}
			
			const model = process.env.OPEN_ROUTER_MODEL || 'openai/gpt-4o-mini';
			
			const suggestion = await aiService.suggestCodexDetails({
				text,
				categories: categoryNames,
				model,
			});
			
			let categoryId = null;
			if (suggestion.category_name) {
				const matchedCategory = categories.find(c => c.name.toLowerCase() === suggestion.category_name.toLowerCase());
				if (matchedCategory) {
					categoryId = matchedCategory.id;
				}
			}
			
			return {
				success: true,
				title: suggestion.title || '',
				categoryId: categoryId,
			};
		} catch (error) {
			console.error('Failed to suggest codex details:', error);
			return { success: false, message: error.message };
		}
	});
	
	ipcMain.handle('codex-entries:store', async (event, novelId, formData) => {
		const { title, content, codex_category_id, new_category_name, imagePath } = formData;
		const userId = 1;
		let categoryId = codex_category_id;
		let newCategoryData = null;
		let entryId;
		
		try {
			const runSyncTransaction = db.transaction(() => {
				if (new_category_name) {
					const result = db.prepare('INSERT INTO codex_categories (novel_id, name) VALUES (?, ?)')
						.run(novelId, new_category_name);
					categoryId = result.lastInsertRowid;
					newCategoryData = { id: categoryId, name: new_category_name };
				}
				
				const entryResult = db.prepare('INSERT INTO codex_entries (novel_id, codex_category_id, title, content) VALUES (?, ?, ?, ?)')
					.run(novelId, categoryId, title, content);
				entryId = entryResult.lastInsertRowid;
			});
			
			runSyncTransaction();
			
			if (imagePath) {
				const paths = await imageHandler.storeImageFromPath(imagePath, novelId, entryId, 'codex-image-upload');
				db.prepare('INSERT INTO images (user_id, novel_id, codex_entry_id, image_local_path, thumbnail_local_path, image_type) VALUES (?, ?, ?, ?, ?, ?)')
					.run(userId, novelId, entryId, paths.original_path, paths.thumbnail_path, 'upload');
			}
			
			const newEntry = db.prepare('SELECT ce.*, i.thumbnail_local_path FROM codex_entries ce LEFT JOIN images i ON ce.id = i.codex_entry_id WHERE ce.id = ?')
				.get(entryId);
			
			return {
				success: true,
				message: 'Codex entry created successfully.',
				codexEntry: {
					id: newEntry.id,
					title: newEntry.title,
					category_id: newEntry.codex_category_id,
				},
				newCategory: newCategoryData,
			};
		} catch (error) {
			console.error("Error in 'codex-entries:store':", error);
			throw error;
		}
	});
	
	ipcMain.handle('codex-entries:update', (event, entryId, data) => {
		db.prepare('UPDATE codex_entries SET title = ?, content = ? WHERE id = ?')
			.run(data.title, data.content, entryId);
		return {success: true, message: 'Codex entry updated successfully.'};
	});
	
	ipcMain.handle('codex-entries:link:attach', (event, parentEntryId, linkedEntryId) => {
		db.prepare('INSERT OR IGNORE INTO codex_entry_links (codex_entry_id, linked_codex_entry_id) VALUES (?, ?)')
			.run(parentEntryId, linkedEntryId);
		
		const linkedEntry = db.prepare('SELECT ce.*, i.thumbnail_local_path FROM codex_entries ce LEFT JOIN images i ON ce.id = i.codex_entry_id WHERE ce.id = ?')
			.get(linkedEntryId);
		
		return {
			success: true,
			message: 'Codex entry linked successfully.',
			codexEntry: {
				id: linkedEntry.id,
				title: linkedEntry.title,
			}
		};
	});
	
	ipcMain.handle('codex-entries:link:detach', (event, parentEntryId, linkedEntryId) => {
		db.prepare('DELETE FROM codex_entry_links WHERE codex_entry_id = ? AND linked_codex_entry_id = ?')
			.run(parentEntryId, linkedEntryId);
		return {success: true, message: 'Codex entry unlinked.'};
	});
	
	ipcMain.on('codex-entries:process-text-stream', (event, {data, channel}) => {
		const onChunk = (chunk) => {
			if (event.sender.isDestroyed()) return;
			event.sender.send(channel, {chunk});
		};
		
		const onComplete = () => {
			if (event.sender.isDestroyed()) return;
			event.sender.send(channel, {done: true});
		};
		
		const onError = (error) => {
			console.error('Streaming AI Error:', error);
			if (event.sender.isDestroyed()) return;
			event.sender.send(channel, {error: error.message});
		};
		
		aiService.streamProcessCodexText(data, onChunk)
			.then(onComplete)
			.catch(onError);
	});
	
	ipcMain.handle('ai:getModels', async () => {
		try {
			const modelsData = await aiService.getOpenRouterModels();
			const processedModels = aiService.processModelsForView(modelsData);
			return {success: true, models: processedModels};
		} catch (error) {
			console.error('Failed to get or process AI models:', error);
			return {success: false, message: error.message};
		}
	});
	
	ipcMain.handle('dialog:showOpenDocument', async () => {
		const { canceled, filePaths } = await dialog.showOpenDialog({
			properties: ['openFile'],
			filters: [
				{ name: 'Documents', extensions: ['txt', 'docx'] }
			]
		});
		if (!canceled) {
			return filePaths[0];
		}
		return null;
	});
	
	ipcMain.handle('document:read', async (event, filePath) => {
		try {
			const extension = path.extname(filePath).toLowerCase();
			if (extension === '.txt') {
				return fs.readFileSync(filePath, 'utf8');
			} else if (extension === '.docx') {
				const result = await mammoth.extractRawText({ path: filePath });
				return result.value; // The raw text
			} else {
				throw new Error('Unsupported file type.');
			}
		} catch (error) {
			console.error('Failed to read document:', error);
			throw error;
		}
	});
	
	ipcMain.handle('document:import', async (event, { title, author, acts }) => {
		if (!title || !author || !acts || acts.length === 0) {
			throw new Error('Invalid data provided for import.');
		}
		
		const userId = 1; // Assuming a single user for now
		
		const importTransaction = db.transaction(() => {
			// 1. Create the novel
			const novelResult = db.prepare(
				'INSERT INTO novels (user_id, title, author, status) VALUES (?, ?, ?, ?)'
			).run(userId, title, author, 'draft');
			const novelId = novelResult.lastInsertRowid;
			
			// 2. Loop through acts to create sections
			let sectionOrder = 1;
			for (const act of acts) {
				const sectionResult = db.prepare(
					'INSERT INTO sections (novel_id, title, description, section_order) VALUES (?, ?, ?, ?)'
				).run(novelId, act.title, `Act ${sectionOrder}`, sectionOrder++);
				const sectionId = sectionResult.lastInsertRowid;
				
				// 3. Loop through chapters within the act to create chapter records
				let chapterOrder = 1;
				for (const chapter of act.chapters) {
					db.prepare(
						'INSERT INTO chapters (novel_id, section_id, title, content, status, chapter_order) VALUES (?, ?, ?, ?, ?, ?)'
					).run(novelId, sectionId, chapter.title, chapter.content, 'in_progress', chapterOrder++);
				}
			}
			
			return { novelId };
		});
		
		try {
			const { novelId } = importTransaction();
			// Close the import window upon success
			if (importWindow) {
				importWindow.close();
			}
			// Optionally, open the editor for the new novel
			createEditorWindow(novelId);
			return { success: true, novelId };
		} catch (error) {
			console.error('Failed to import document:', error);
			throw error;
		}
	});
	
	ipcMain.on('codex-entries:openEditor', (event, entryId) => {
		createCodexEditorWindow({ mode: 'edit', entryId });
	});
	
	ipcMain.on('codex-entries:openNewEditor', (event, { novelId, selectedText }) => {
		createCodexEditorWindow({ mode: 'new', novelId, selectedText });
	});
	
	ipcMain.handle('codex-entries:getOneForEditor', (event, entryId) => {
		const entry = db.prepare(`
			SELECT
				ce.title,
				ce.content,
				ce.novel_id,
				n.title AS novel_title
			FROM codex_entries ce
			LEFT JOIN novels n ON ce.novel_id = n.id
			WHERE ce.id = ?
		`).get(entryId);
		
		if (!entry) {
			throw new Error('Codex entry not found for editor.');
		}
		
		const image = db.prepare('SELECT image_local_path FROM images WHERE codex_entry_id = ?').get(entryId);
		entry.image_url = image
			? `file://${path.join(imageHandler.IMAGES_DIR, image.image_local_path)}`
			: './assets/codex-placeholder.png';
		
		return entry;
	});
	
}

// --- App Lifecycle Events ---
app.on('ready', () => {
	db = initializeDatabase();
	setupIpcHandlers();
	createMainWindow();
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});

app.on('activate', () => {
	if (mainWindow === null) {
		createMainWindow();
	}
});
