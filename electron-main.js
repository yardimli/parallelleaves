const {app, BrowserWindow, Menu, MenuItem, ipcMain, dialog} = require('electron');
const path = require('path');
const url = require('url');
const fetch = require('node-fetch');
const fs = require('fs');
const mammoth = require('mammoth');

require('dotenv').config();

const {initializeDatabase} = require('./src/database/database.js');
const aiService = require('./src/ai/ai.js');
const imageHandler = require('./src/utils/image-handler.js');

let db;
let mainWindow;
let chapterEditorWindows = new Map();
let outlineWindows = new Map();
let codexEditorWindows = new Map();
let importWindow = null;

// --- Template and HTML Helper Functions (No changes here, skipped for brevity) ---
function getTemplate(templateName) {
	const templatePath = path.join(__dirname, 'public', 'templates', `${templateName}.html`);
	try {
		return fs.readFileSync(templatePath, 'utf8');
	} catch (error) {
		console.error(`Failed to read template: ${templateName}`, error);
		return `<p class="text-error">Error: Could not load template ${templateName}.</p>`;
	}
}

function countWordsInHtml(html) {
	if (!html) return 0;
	const text = html.replace(/<[^>]*>/g, ' ');
	const words = text.trim().split(/\s+/).filter(Boolean);
	return words.length;
}

// --- Window Creation Functions (No changes here, skipped for brevity) ---
function createMainWindow() {
	mainWindow = new BrowserWindow({
		width: 1400,
		height: 1000,
		icon: path.join(__dirname, 'assets/icon.png'),
		title: 'Parallel Leaves - Translation Editor',
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
}

function createChapterEditorWindow({ novelId, chapterId }) {
	const windowKey = `chapter-editor-${novelId}`;
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
		title: 'Parallel Leaves - Translation Editor',
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
}

function createCodexEditorWindow(options) {
	const { mode, entryId, novelId, selectedText } = options;
	
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

function setupIpcHandlers() {
	// MODIFIED: Helper function to extract all translation pairs from chapter content.
	// This version correctly parses the target_content HTML, which is serialized from ProseMirror
	// and uses the text content of the note block for identification instead of a data-attribute.
	const extractAllPairs = (sourceContent, targetContent) => {
		if (!sourceContent || !targetContent) {
			return [];
		}
		
		// Find all translation block markers in the source content.
		const sourceMarkers = [...sourceContent.matchAll(/{{\s*TranslationBlock-(\d+)\s*}}/gi)];
		if (sourceMarkers.length === 0) {
			return [];
		}
		
		const allPairs = [];
		for (let i = 0; i < sourceMarkers.length; i++) {
			const currentMarker = sourceMarkers[i];
			const nextMarker = sourceMarkers[i + 1];
			const blockNumber = parseInt(currentMarker[1], 10);
			
			// Extract the source text for the current block.
			const sourceStart = currentMarker.index + currentMarker[0].length;
			const sourceEnd = nextMarker ? nextMarker.index : sourceContent.length;
			const sourceText = sourceContent.substring(sourceStart, sourceEnd).trim();
			
			// Construct a regex to find the corresponding translated content in the target HTML.
			// It looks for the content between the end of the div for the current block number
			// and the beginning of the next block's div, or the end of the string.
			const targetRegex = new RegExp(
				// Match the start marker for the current block.
				`<div class="note-wrapper not-prose"><p>Translation Block #${blockNumber}</p></div>` +
				// Lazily capture all content (including newlines).
				`([\\s\\S]*?)` +
				// Stop capturing when we see the next block marker (positive lookahead) or the end of the string.
				`(?=<div class="note-wrapper not-prose"><p>Translation Block #\\d+</p></div>|$)`,
				'i'
			);
			
			const targetMatch = targetContent.match(targetRegex);
			const targetText = targetMatch ? targetMatch[1].trim() : '';
			
			if (sourceText && targetText) {
				allPairs.push({ blockNumber, source: sourceText, target: targetText });
			}
		}
		return allPairs;
	};
	
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
		const novel = db.prepare('SELECT id, title, source_language, target_language, rephrase_settings, translate_settings FROM novels WHERE id = ?').get(novelId);
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
                SELECT * FROM codex_entries WHERE codex_category_id = ? ORDER BY title
            `).all(category.id);
		});
		return novel;
	});
	
	ipcMain.handle('novels:updatePromptSettings', (event, { novelId, promptType, settings }) => {
		const allowedTypes = ['rephrase', 'translate'];
		if (!allowedTypes.includes(promptType)) {
			return { success: false, message: 'Invalid prompt type.' };
		}
		const settingsJson = JSON.stringify(settings);
		const fieldName = `${promptType}_settings`;
		
		try {
			db.prepare(`UPDATE novels SET ${fieldName} = ? WHERE id = ?`).run(settingsJson, novelId);
			return { success: true };
		} catch (error) {
			console.error(`Failed to update prompt settings for novel ${novelId}:`, error);
			throw new Error('Failed to update prompt settings.');
		}
	});
	
	ipcMain.handle('novels:getOutlineData', (event, novelId) => {
		try {
			const novel = db.prepare('SELECT title FROM novels WHERE id = ?').get(novelId);
			if (!novel) throw new Error('Novel not found');
			
			const sections = db.prepare('SELECT * FROM sections WHERE novel_id = ? ORDER BY section_order').all(novelId);
			for (const section of sections) {
				section.chapters = db.prepare('SELECT id, title, source_content, target_content, chapter_order FROM chapters WHERE section_id = ? ORDER BY chapter_order').all(section.id);
				
				let sectionTotalWords = 0;
				
				for (const chapter of section.chapters) {
					chapter.word_count = countWordsInHtml(chapter.target_content);
					sectionTotalWords += chapter.word_count;
					
					const contentToUse = chapter.target_content || chapter.source_content;
					if (contentToUse) {
						const textContent = contentToUse.replace(/<[^>]+>/g, ' ').replace(/\s\s+/g, ' ').trim();
						
						const words = textContent.split(/\s+/);
						const wordLimitedText = words.slice(0, 200).join(' ');
						
						const sentences = textContent.match(/[^.!?]+[.!?]+/g) || [];
						const sentenceLimitedText = sentences.slice(0, 5).join(' ');
						
						let truncatedText;
						// Prioritize the shorter of the two truncation methods.
						if (wordLimitedText.length > 0 && (sentenceLimitedText.length === 0 || wordLimitedText.length <= sentenceLimitedText.length)) {
							truncatedText = wordLimitedText;
							if (words.length > 200) truncatedText += '...';
						} else if (sentenceLimitedText.length > 0) {
							truncatedText = sentenceLimitedText;
							if (sentences.length > 5) truncatedText += '...';
						} else {
							// Fallback for very short text without sentence terminators.
							truncatedText = textContent;
						}
						chapter.summary = `<p>${truncatedText}</p>`;
					} else {
						chapter.summary = '<p class="italic text-base-content/60">No content.</p>';
					}
					
					chapter.linked_codex = db.prepare(`
	                    SELECT ce.id, ce.title
	                    FROM codex_entries ce
	                    JOIN chapter_codex_entry cce ON ce.id = cce.codex_entry_id
	                    WHERE cce.chapter_id = ?
	                    ORDER BY ce.title
	                `).all(chapter.id);
				}
				
				section.total_word_count = sectionTotalWords;
				section.chapter_count = section.chapters.length;
			}
			
			const codexCategories = db.prepare(`
	        SELECT id, name FROM codex_categories
	        WHERE novel_id = ? ORDER BY name
	    `).all(novelId);
			
			for (const category of codexCategories) {
				category.entries = db.prepare(`
	            SELECT id, title, content
	            FROM codex_entries
	            WHERE codex_category_id = ? ORDER BY title
	        `).all(category.id);
			}
			
			return {
				novel_title: novel.title,
				sections: sections,
				codex_categories: codexCategories
			};
		} catch (error) {
			console.error(`Error in getOutlineData for novelId ${novelId}:`, error);
			throw error; // Re-throw the error so the renderer process receives it
		}
	});
	
	ipcMain.handle('novels:getFullManuscript', (event, novelId) => {
		try {
			const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(novelId);
			if (!novel) {
				return { id: novelId, title: 'Not Found', sections: [] };
			}
			
			novel.sections = db.prepare('SELECT * FROM sections WHERE novel_id = ? ORDER BY section_order').all(novelId);
			for (const section of novel.sections) {
				section.chapters = db.prepare('SELECT id, title, source_content, target_content, chapter_order FROM chapters WHERE section_id = ? ORDER BY `chapter_order`').all(section.id);
				for (const chapter of section.chapters) {
					chapter.source_word_count = countWordsInHtml(chapter.source_content);
					chapter.target_word_count = countWordsInHtml(chapter.target_content);
					
					chapter.linked_codex = db.prepare(`
	                    SELECT ce.id, ce.title
	                    FROM codex_entries ce
	                    JOIN chapter_codex_entry cce ON ce.id = cce.codex_entry_id
	                    WHERE cce.chapter_id = ? ORDER BY ce.title
	                `).all(chapter.id);
				}
			}
			return novel;
		} catch(error) {
			console.error(`Error in getFullManuscript for novelId ${novelId}:`, error);
			return { id: novelId, title: 'Error Loading', sections: [] };
		}
	});
	
	ipcMain.handle('novels:updateProseSettings', (event, {novelId, source_language, target_language}) => {
		try {
			db.prepare(`
                UPDATE novels
                SET source_language = ?, target_language = ?
                WHERE id = ?
            `).run(source_language, target_language, novelId);
			return {success: true};
		} catch (error) {
			console.error('Failed to update language settings:', error);
			throw new Error('Failed to update language settings.');
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
		
		const transaction = db.transaction(() => {
			const oldImage = db.prepare("SELECT * FROM images WHERE novel_id = ?").get(novelId);
			if (oldImage && oldImage.image_local_path) {
				const oldFullPath = path.join(imageHandler.IMAGES_DIR, oldImage.image_local_path);
				if (fs.existsSync(oldFullPath)) {
					fs.unlinkSync(oldFullPath);
				}
			}
			db.prepare("DELETE FROM images WHERE novel_id = ?").run(novelId);
			
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
		createChapterEditorWindow({ novelId, chapterId: null });
	});
	
	ipcMain.on('novels:openOutline', (event, novelId) => {
		createOutlineWindow(novelId);
	});
	
	ipcMain.on('chapters:openEditor', (event, { novelId, chapterId }) => {
		createChapterEditorWindow({ novelId, chapterId });
	});
	
	// --- Chapter Handlers ---
	ipcMain.handle('chapters:updateField', (event, { chapterId, field, value }) => {
		const allowedFields = ['title', 'target_content', 'source_content'];
		if (!allowedFields.includes(field)) {
			return { success: false, message: 'Invalid field specified.' };
		}
		try {
			db.prepare(`UPDATE chapters SET ${field} = ? WHERE id = ?`).run(value, chapterId);
			return { success: true };
		} catch (error) {
			console.error(`Failed to update ${field} for chapter ${chapterId}:`, error);
			return { success: false, message: `Failed to save ${field}.` };
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
	
	// MODIFIED: This handler is now more powerful, fetching from the previous chapter if needed.
	ipcMain.handle('chapters:getTranslationContext', (event, { chapterId, endBlockNumber, pairCount }) => {
		if (pairCount <= 0) {
			return [];
		}
		
		try {
			// 1. Get current chapter data
			const currentChapter = db.prepare('SELECT source_content, target_content, novel_id, chapter_order FROM chapters WHERE id = ?').get(chapterId);
			if (!currentChapter) {
				throw new Error('Current chapter not found.');
			}
			
			// 2. Extract all pairs from the current chapter
			const allPairsCurrent = extractAllPairs(currentChapter.source_content, currentChapter.target_content);
			
			// 3. Filter for pairs before the endBlockNumber
			const relevantPairsCurrent = allPairsCurrent.filter(p => p.blockNumber < endBlockNumber);
			
			let collectedPairs = relevantPairsCurrent.slice(-pairCount); // Get the last `pairCount` items
			
			// 4. Check if we need more pairs
			let remainingPairsNeeded = pairCount - collectedPairs.length;
			
			if (remainingPairsNeeded > 0) {
				// 5. Find the previous chapter
				const previousChapter = db.prepare(`
                    SELECT source_content, target_content
                    FROM chapters
                    WHERE novel_id = ? AND chapter_order < ?
                    ORDER BY chapter_order DESC
                    LIMIT 1
                `).get(currentChapter.novel_id, currentChapter.chapter_order);
				
				if (previousChapter) {
					// 6. Extract all pairs from the previous chapter
					const allPairsPrevious = extractAllPairs(previousChapter.source_content, previousChapter.target_content);
					
					// 7. Get the last `remainingPairsNeeded` from the previous chapter
					const pairsFromPrevious = allPairsPrevious.slice(-remainingPairsNeeded);
					
					// 8. Prepend them to the collected pairs
					collectedPairs = [...pairsFromPrevious, ...collectedPairs];
				}
			}
			
			return collectedPairs;
			
		} catch (error) {
			console.error(`Failed to get translation context for chapter ${chapterId}:`, error);
			throw new Error('Failed to retrieve translation context from the database.');
		}
	});
	
	
	// --- Editor & Template Handlers ---
	
	ipcMain.handle('templates:get', (event, templateName) => {
		return getTemplate(templateName);
	});
	
	// NEW SECTION START: Session/Spellchecker handlers
	ipcMain.handle('session:getAvailableSpellCheckerLanguages', (event) => {
		// The session is associated with the window that sent the event.
		return event.sender.session.availableSpellCheckerLanguages;
	});
	
	ipcMain.handle('session:getCurrentSpellCheckerLanguage', (event) => {
		const languages = event.sender.session.getSpellCheckerLanguages();
		// Return the first language in the array, or null if it's empty.
		return languages.length > 0 ? languages[0] : null;
	});
	
	ipcMain.handle('session:setSpellCheckerLanguage', (event, lang) => {
		try {
			const session = event.sender.session;
			if (lang) {
				// Set the spellchecker to a specific language.
				// Electron will automatically download the dictionary if needed.
				session.setSpellCheckerLanguages([lang]);
				console.log(`Spellchecker language set to: ${lang}`);
				return { success: true };
			} else {
				// To disable the spellchecker, pass an empty array.
				session.setSpellCheckerLanguages([]);
				console.log('Spellchecker disabled.');
				return { success: true };
			}
		} catch (error) {
			console.error('Failed to set spellchecker language:', error);
			return { success: false, message: error.message };
		}
	});
	// NEW SECTION END
	
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
			
			const novel = db.prepare('SELECT target_language FROM novels WHERE id = ?').get(novelId);
			const targetLanguage = novel ? novel.target_language : 'English';
			
			const suggestion = await aiService.suggestCodexDetails({
				text,
				categories: categoryNames,
				targetLanguage: targetLanguage,
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
		const { title, content, codex_category_id, new_category_name } = formData;
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
			
			const newEntry = db.prepare('SELECT * FROM codex_entries WHERE id = ?')
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
	
	ipcMain.on('codex-entries:process-text-stream', (event, {data, channel}) => {
		const controller = new AbortController();
		let streamActive = true;
		
		// Listen for the 'destroyed' event on the sender's WebContents.
		// If the window is closed mid-stream, we abort the request.
		event.sender.once('destroyed', () => {
			if (streamActive) {
				console.log('Window closed during AI stream. Aborting request.');
				controller.abort();
			}
		});
		
		const onChunk = (chunk) => {
			if (event.sender.isDestroyed()) return;
			event.sender.send(channel, {chunk});
		};
		
		const onComplete = () => {
			streamActive = false; // Mark stream as complete.
			if (event.sender.isDestroyed()) return;
			event.sender.send(channel, {done: true});
		};
		
		const onError = (error) => {
			streamActive = false; // Mark stream as complete.
			// Don't log "AbortError" as a critical error, it's expected.
			if (error.name !== 'AbortError') {
				console.error('Streaming AI Error:', error);
			}
			if (event.sender.isDestroyed()) return;
			event.sender.send(channel, {error: error.message});
		};
		
		// MODIFIED: Pass the AbortController's signal to the AI service.
		aiService.streamProcessCodexText(data, onChunk, controller.signal)
			.then(onComplete)
			.catch(onError);
	});
	// MODIFIED SECTION END
	
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
	
	// --- Document Import Handlers ---
	
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
				return result.value;
			} else {
				throw new Error('Unsupported file type.');
			}
		} catch (error) {
			console.error('Failed to read document:', error);
			throw error;
		}
	});
	
	ipcMain.handle('document:import', async (event, { title, source_language, target_language, acts }) => {
		if (!title || !source_language || !target_language || !acts || acts.length === 0) {
			throw new Error('Invalid data provided for import.');
		}
		
		const userId = 1;
		
		const importTransaction = db.transaction(() => {
			const novelResult = db.prepare(
				'INSERT INTO novels (user_id, title, source_language, target_language, status) VALUES (?, ?, ?, ?, ?)'
			).run(userId, title, source_language, target_language, 'draft');
			const novelId = novelResult.lastInsertRowid;
			
			let sectionOrder = 1;
			for (const act of acts) {
				const sectionResult = db.prepare(
					'INSERT INTO sections (novel_id, title, description, section_order) VALUES (?, ?, ?, ?)'
				).run(novelId, act.title, `Act ${sectionOrder}`, sectionOrder++);
				const sectionId = sectionResult.lastInsertRowid;
				
				let chapterOrder = 1;
				for (const chapter of act.chapters) {
					db.prepare(
						'INSERT INTO chapters (novel_id, section_id, title, source_content, status, chapter_order) VALUES (?, ?, ?, ?, ?, ?)'
					).run(novelId, sectionId, chapter.title, chapter.content, 'in_progress', chapterOrder++);
				}
			}
			
			return { novelId };
		});
		
		try {
			const { novelId } = importTransaction();
			if (importWindow) {
				importWindow.close();
			}
			createChapterEditorWindow({ novelId, chapterId: null });
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
			JOIN novels n ON ce.novel_id = n.id
			WHERE ce.id = ?
		`).get(entryId);
		
		if (!entry) {
			throw new Error('Codex entry not found for editor.');
		}
		
		return entry;
	});
	
}

// --- App Lifecycle Events ---
app.on('ready', () => {
	db = initializeDatabase();
	setupIpcHandlers();
	
	// NEW SECTION START
	// Refresh the AI models list from OpenRouter on application startup.
	// This ensures the cache is up-to-date for the session.
	aiService.getOpenRouterModels(true)
		.then(() => {
			console.log('AI models list refreshed from OpenRouter on startup.');
		})
		.catch(error => {
			// Log the error but don't prevent the app from starting.
			// The app can still function with a stale cache or fail gracefully if no cache exists.
			console.error('Failed to refresh AI models on startup:', error.message);
		});
	// NEW SECTION END
	
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
