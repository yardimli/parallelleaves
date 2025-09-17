const {app, BrowserWindow, Menu, MenuItem, ipcMain, dialog, shell} = require('electron');
const path = require('path');
const url = require('url');
const fetch = require('node-fetch');
const fs = require('fs');
const mammoth = require('mammoth');

const config = require('./config.js');

const {initializeDatabase} = require('./src/database/database.js');
const aiService = require('./src/ai/ai.js');
const imageHandler = require('./src/utils/image-handler.js');

let db;
let mainWindow;
let chapterEditorWindows = new Map();
let outlineWindows = new Map();
let codexEditorWindows = new Map();
let importWindow = null;
let currentUserSession = null;

const SESSION_FILE_PATH = path.join(app.getPath('userData'), 'session.json');

/**
 * Saves the current user session to a file.
 * @param {object} session - The session object to save.
 */
function saveSession(session) {
	try {
		fs.writeFileSync(SESSION_FILE_PATH, JSON.stringify(session), 'utf8');
	} catch (error) {
		console.error('Failed to save session:', error);
	}
}

/**
 * Loads the user session from a file on startup.
 */
function loadSession() {
	try {
		if (fs.existsSync(SESSION_FILE_PATH)) {
			const sessionData = fs.readFileSync(SESSION_FILE_PATH, 'utf8');
			const session = JSON.parse(sessionData);
			if (session && session.token && session.user) {
				currentUserSession = session;
				console.log('Session loaded successfully for user:', session.user.username);
			}
		}
	} catch (error) {
		console.error('Failed to load session, clearing corrupted file:', error);
		clearSession();
	}
}

/**
 * Deletes the saved session file (on logout).
 */
function clearSession() {
	try {
		if (fs.existsSync(SESSION_FILE_PATH)) {
			fs.unlinkSync(SESSION_FILE_PATH);
		}
	} catch (error) {
		console.error('Failed to clear session file:', error);
	}
}

// --- Template and HTML Helper Functions ---
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
 * Converts an HTML string to a formatted plain text string.
 * @param {string} html - The HTML string to convert.
 * @returns {string} The resulting plain text.
 */
function htmlToPlainText(html) {
	if (!html) return '';
	// 1) Normalize BRs to newlines
	let s = html.replace(/<br\s*\/?>/gi, '\n');
	// 2) Insert newlines around block-level elements to preserve separation
	const block = '(?:p|div|section|article|header|footer|nav|aside|h[1-6]|ul|ol|li|table|thead|tbody|tfoot|tr|th|td|blockquote|pre|hr)';
	s = s
		.replace(new RegExp(`<\\s*${block}[^>]*>`, 'gi'), '\n')
		.replace(new RegExp(`<\\/\\s*${block}\\s*>`, 'gi'), '\n');
	// 3) Drop all remaining tags without adding spaces
	s = s.replace(/<[^>]+>/g, '');
	// 4) Trim accidental spaces before punctuation caused by earlier steps
	s = s
		.replace(/\s+([.,!?;:])/g, '$1')
		.replace(/(\() +/g, '$1')
		.replace(/ +(\))/g, '$1');
	// 5) Collapse whitespace and normalize newlines
	s = s
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n[ \t]+/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.replace(/[ \t]{2,}/g, ' ');
	return s.trim();
}

function countWordsInHtml(html) {
	if (!html) return 0;
	const text = htmlToPlainText(html);
	const words = text.trim().split(/\s+/).filter(Boolean);
	return words.length;
}

/**
 * Generates a cover prompt, creates an image via AI, and saves it for a given novel.
 * This function logs errors but does not throw them, allowing the parent process to continue.
 * @param {number} novelId - The ID of the novel.
 * @param {string} title - The title of the novel.
 * @param {string|null} token - The user's session token.
 * @returns {Promise<void>}
 */
async function generateAndSaveCover(novelId, title, token) {
	try {
		// 1. Generate prompt
		const prompt = await aiService.generateCoverPrompt({ title, token });
		if (!prompt) {
			throw new Error('Failed to generate cover prompt.');
		}
		
		// 2. Generate image
		const falResponse = await aiService.generateCoverImageViaProxy({ prompt, token });
		if (!falResponse || !falResponse.images || !falResponse.images[0]?.url) {
			throw new Error('Image generation failed or did not return a valid URL.');
		}
		const imageUrl = falResponse.images[0].url;
		
		// 3. Store image
		const localPaths = await imageHandler.storeImageFromUrl(imageUrl, novelId, 'cover-autogen');
		if (!localPaths || !localPaths.original_path) {
			throw new Error('Failed to download and save the generated cover.');
		}
		
		// 4. Update DB
		const userId = currentUserSession ? currentUserSession.user.id : 1;
		const transaction = db.transaction(() => {
			// Using image_type to be specific, though a novel should only have one cover.
			db.prepare("DELETE FROM images WHERE novel_id = ? AND image_type LIKE '%cover%'").run(novelId);
			
			db.prepare(`
                INSERT INTO images (user_id, novel_id, image_local_path, thumbnail_local_path, image_type, prompt)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(userId, novelId, localPaths.original_path, localPaths.original_path, 'generated', prompt);
		});
		transaction();
		
		console.log(`Successfully generated and saved cover for novel ${novelId}`);
		
	} catch (error) {
		console.error(`Failed to auto-generate cover for novel ${novelId}:`, error);
		// We log the error but don't re-throw, so the import process can complete.
	}
}


// --- Window Creation Functions ---
function createMainWindow() {
	mainWindow = new BrowserWindow({
		width: 1400,
		height: 1000,
		icon: path.join(__dirname, 'public/assets/icon.png'),
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
		icon: path.join(__dirname, 'public/assets/icon.png'),
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
		icon: path.join(__dirname, 'public/assets/icon.png'),
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
		icon: path.join(__dirname, 'public/assets/icon.png'),
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
		icon: path.join(__dirname, 'public/assets/icon.png'),
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
 * @param {string} sourceHtml - The source HTML content.
 * @param {string} targetHtml - The target HTML content.
 * @param {string|null} [selectedText=null] - The text currently selected by the user for translation, used to truncate the last source segment.
 * @returns {Array<object>} An array of {source, target} text pairs.
 */
const extractMarkerPairsFromHtml = (sourceHtml, targetHtml, selectedText = null) => {
	if (!sourceHtml || !targetHtml) {
		return [];
	}
	
	// Helper to split HTML by markers and return an ordered array of segments.
	const getSegments = (html) => {
		const segments = []; // Use an array to preserve document order.
		const parts = html.split(/(\[\[#\d+\]\])/g);
		for (let i = 1; i < parts.length; i += 2) {
			const marker = parts[i];
			const content = parts[i + 1] || '';
			const match = marker.match(/\[\[#(\d+)\]\]/);
			if (match) {
				const number = parseInt(match[1], 10);
				const plainText = htmlToPlainText(content);
				
				if (plainText) {
					segments.push({ number, text: plainText, isLastSegment: i === parts.length - 2 });
				}
			}
		}
		return segments;
	};
	
	const sourceSegmentsArray = getSegments(sourceHtml);
	const targetSegmentsArray = getSegments(targetHtml);
	
	// If this is the current chapter (indicated by selectedText),
	// truncate the last source segment to not include the selection itself.
	if (selectedText && sourceSegmentsArray.length > 0) {
		const lastSourceSegment = sourceSegmentsArray[sourceSegmentsArray.length - 1];
		// Only truncate if it's the very last segment in the source file.
		if (lastSourceSegment.isLastSegment) {
			const selectionIndex = lastSourceSegment.text.indexOf(selectedText.trim());
			if (selectionIndex !== -1) {
				lastSourceSegment.text = lastSourceSegment.text.substring(0, selectionIndex).trim();
				// If truncation makes the text empty, remove the segment entirely from context.
				if (!lastSourceSegment.text) {
					sourceSegmentsArray.pop();
				}
			}
		}
	}
	
	// Convert source segments to a Map for efficient lookup.
	const sourceSegmentsMap = new Map(sourceSegmentsArray.map(s => [s.number, s.text]));
	
	const pairs = [];
	// Iterate through the target segments IN THEIR ORIGINAL DOCUMENT ORDER.
	// This avoids reordering context based on marker numbers.
	for (const targetSegment of targetSegmentsArray) {
		// Find the matching source segment by its marker number.
		if (sourceSegmentsMap.has(targetSegment.number)) {
			pairs.push({
				source: sourceSegmentsMap.get(targetSegment.number),
				target: targetSegment.text,
			});
		}
	}
	return pairs;
};

function setupIpcHandlers() {
	// --- I18n Handler ---
	ipcMain.handle('i18n:get-lang-file', (event, lang) => {
		const langPath = path.join(__dirname, 'public', 'lang', `${lang}.json`);
		try {
			return fs.readFileSync(langPath, 'utf8');
		} catch (error) {
			console.error(`Failed to read language file: ${lang}`, error);
			throw new Error(`Could not load language file: ${lang}.json`);
		}
	});
	
	// --- Authentication Handlers ---
	const LOGIN_API_URL = config.LOGIN_API_URL;
	const REGISTER_URL = config.REGISTER_URL;
	
	ipcMain.handle('auth:login', async (event, credentials) => {
		try {
			if (!LOGIN_API_URL) throw new Error('Login API URL is not configured in config.js.');
			
			const response = await fetch(LOGIN_API_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(credentials)
			});
			
			const data = await response.json();
			
			if (response.ok && data.success) {
				currentUserSession = {
					token: data.token,
					user: data.user
				};
				saveSession(currentUserSession);
				return { success: true, session: currentUserSession };
			} else {
				return { success: false, message: data.message || 'Login failed' };
			}
		} catch (error) {
			console.error('Login error:', error);
			return { success: false, message: error.message };
		}
	});
	
	ipcMain.handle('auth:logout', () => {
		clearSession();
		currentUserSession = null;
		return { success: true };
	});
	
	ipcMain.handle('auth:get-session', () => {
		return currentUserSession;
	});
	
	ipcMain.on('auth:open-register-url', () => {
		if (REGISTER_URL) {
			shell.openExternal(REGISTER_URL);
		} else {
			console.error('REGISTER_URL is not defined in config.js file.');
		}
	});
	
	ipcMain.on('app:open-import-window', () => {
		createImportWindow();
	});
	
	// --- Novel Handlers ---
	
	ipcMain.handle('novels:getAllWithCovers', () => {
		// This query remains the same as it was already correct.
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
            ORDER BY n.updated_at DESC
        `);
		const novels = stmt.all();
		
		// This logic also remains as it calculates stats without relying on translation blocks.
		for (const novel of novels) {
			const chapters = db.prepare('SELECT source_content, target_content FROM chapters WHERE novel_id = ?').all(novel.id);
			
			let sourceWordCount = 0;
			let targetWordCount = 0;
			
			for (const chapter of chapters) {
				if (chapter.source_content) {
					sourceWordCount += countWordsInHtml(chapter.source_content);
				}
				if (chapter.target_content) {
					targetWordCount += countWordsInHtml(chapter.target_content);
				}
			}
			
			novel.source_word_count = sourceWordCount;
			novel.target_word_count = targetWordCount;
			
			if (novel.cover_path) {
				novel.cover_path = path.join(imageHandler.IMAGES_DIR, novel.cover_path);
			}
		}
		
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
						if (wordLimitedText.length > 0 && (sentenceLimitedText.length === 0 || wordLimitedText.length <= sentenceLimitedText.length)) {
							truncatedText = wordLimitedText;
							if (words.length > 200) truncatedText += '...';
						} else if (sentenceLimitedText.length > 0) {
							truncatedText = sentenceLimitedText;
							if (sentences.length > 5) truncatedText += '...';
						} else {
							truncatedText = textContent;
						}
						chapter.summary = `<p>${truncatedText}</p>`;
					} else {
						chapter.summary = `<p class="italic text-base-content/60" data-i18n="electron.noContent"></p>`;
					}
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
	            SELECT id, title, content, target_content
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
			throw error;
		}
	});
	
	ipcMain.handle('novels:getOutlineState', (event, novelId) => {
		try {
			const chapterCount = db.prepare('SELECT COUNT(id) as count FROM chapters WHERE novel_id = ?').get(novelId).count;
			const codexCount = db.prepare('SELECT COUNT(id) as count FROM codex_entries WHERE novel_id = ?').get(novelId).count;
			return { success: true, chapterCount, codexCount };
		} catch (error) {
			console.error(`Failed to get outline state for novel ${novelId}:`, error);
			return { success: false, message: 'Failed to get outline state.' };
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
				}
			}
			return novel;
		} catch(error) {
			console.error(`Error in getFullManuscript for novelId ${novelId}:`, error);
			return { id: novelId, title: 'Error Loading', sections: [] };
		}
	});
	
	ipcMain.handle('novels:getAllContent', (event, novelId) => {
		try {
			const chapters = db.prepare('SELECT source_content, target_content FROM chapters WHERE novel_id = ?').all(novelId);
			const combinedContent = chapters.map(c => (c.source_content || '') + (c.target_content || '')).join('');
			return { success: true, combinedHtml: combinedContent };
		} catch (error) {
			console.error(`Failed to get all content for novel ${novelId}:`, error);
			return { success: false, message: 'Failed to retrieve novel content.' };
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
	
	ipcMain.handle('novels:updateNovelCover', async (event, {novelId, coverInfo}) => {
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
	
	ipcMain.handle('chapters:getTranslationContext', (event, { chapterId, pairCount, selectedText }) => {
		if (pairCount <= 0) {
			return [];
		}
		
		try {
			// 1. Get context from the current chapter.
			const currentChapter = db.prepare('SELECT novel_id, chapter_order, source_content, target_content FROM chapters WHERE id = ?').get(chapterId);
			if (!currentChapter) {
				throw new Error('Current chapter not found.');
			}
			
			// Pass selectedText to truncate the last segment of the current chapter's source.
			const currentChapterPairs = extractMarkerPairsFromHtml(currentChapter.source_content, currentChapter.target_content, selectedText);
			
			// 2. If we have enough context, return it.
			if (currentChapterPairs.length >= pairCount) {
				return currentChapterPairs.slice(-pairCount);
			}
			
			// 3. If not, calculate how many more pairs we need.
			const neededPairs = pairCount - currentChapterPairs.length;
			
			// 4. Find the previous chapter.
			const previousChapter = db.prepare(`
	            SELECT source_content, target_content
	            FROM chapters
	            WHERE novel_id = ? AND chapter_order < ?
	            ORDER BY chapter_order DESC
	            LIMIT 1
	        `).get(currentChapter.novel_id, currentChapter.chapter_order);
			
			// 5. If there's no previous chapter, just return what we have.
			if (!previousChapter) {
				return currentChapterPairs;
			}
			
			// 6. Get pairs from the previous chapter (no truncation needed here).
			const previousChapterPairs = extractMarkerPairsFromHtml(previousChapter.source_content, previousChapter.target_content);
			
			// 7. Take the last `neededPairs` from the previous chapter.
			const lastPairsFromPrevious = previousChapterPairs.slice(-neededPairs);
			
			// 8. Combine and return.
			return [...lastPairsFromPrevious, ...currentChapterPairs];
			
		} catch (error) {
			console.error(`Failed to get translation context for chapter ${chapterId}:`, error);
			throw new Error('Failed to retrieve translation context from the database.');
		}
	});
	
	
	// --- Editor & Template Handlers ---
	
	ipcMain.handle('templates:get', (event, templateName) => {
		return getTemplate(templateName);
	});
	
	ipcMain.handle('session:getAvailableSpellCheckerLanguages', (event) => {
		return event.sender.session.availableSpellCheckerLanguages;
	});
	
	ipcMain.handle('session:getCurrentSpellCheckerLanguage', (event) => {
		const languages = event.sender.session.getSpellCheckerLanguages();
		return languages.length > 0 ? languages[0] : null;
	});
	
	ipcMain.handle('session:setSpellCheckerLanguage', (event, lang) => {
		try {
			const session = event.sender.session;
			if (lang) {
				session.setSpellCheckerLanguages([lang]);
				console.log(`Spellchecker language set to: ${lang}`);
				return { success: true };
			} else {
				session.setSpellCheckerLanguages([]);
				console.log('Spellchecker disabled.');
				return { success: true };
			}
		} catch (error) {
			console.error('Failed to set spellchecker language:', error);
			return { success: false, message: error.message };
		}
	});
	
	ipcMain.on('autogen:start-codex-generation', async (event, { novelId, model }) => {
		const sender = event.sender;
		const sendProgress = (progress, status, statusKey = null, statusParams = {}) => {
			if (!sender.isDestroyed()) {
				sender.send('autogen:progress-update', { progress, status, statusKey, statusParams });
			}
		};
		
		try {
			sendProgress(0, 'Fetching novel content...');
			
			const chapters = db.prepare('SELECT source_content FROM chapters WHERE novel_id = ? AND source_content IS NOT NULL').all(novelId);
			if (chapters.length === 0) {
				sendProgress(100, 'No source content found to analyze. Process finished.', 'electron.codexGenNoSource');
				return;
			}
			
			const fullText = chapters.map(c => c.source_content).join('\n');
			const cleanedText = htmlToPlainText(fullText);
			
			const words = cleanedText.split(/\s+/);
			const chunkSize = 10000;
			const chunks = [];
			for (let i = 0; i < words.length; i += chunkSize) {
				chunks.push(words.slice(i, i + chunkSize).join(' '));
			}
			
			if (chunks.length === 0) {
				sendProgress(100, 'No text found after cleaning. Process finished.', 'electron.codexGenNoText');
				return;
			}
			
			sendProgress(5, `Found ${words.length.toLocaleString()} words, split into ${chunks.length} chunks.`);
			
			const getExistingCodex = () => {
				const categories = db.prepare('SELECT id, name FROM codex_categories WHERE novel_id = ?').all(novelId);
				const codexData = {};
				for (const category of categories) {
					const entries = db.prepare('SELECT title, content FROM codex_entries WHERE codex_category_id = ?').all(category.id);
					codexData[category.name] = entries;
				}
				return codexData;
			};
			
			const novel = db.prepare('SELECT source_language, target_language FROM novels WHERE id = ?').get(novelId);
			const language = novel ? novel.source_language : 'English';
			const targetLanguage = novel ? novel.target_language : 'English';
			
			for (let i = 0; i < chunks.length; i++) {
				const chunk = chunks[i];
				const progress = 5 + Math.round((i / chunks.length) * 90);
				sendProgress(progress, `Analyzing chunk ${i + 1} of ${chunks.length}...`);
				
				const existingCodex = getExistingCodex();
				const existingCodexJson = JSON.stringify(existingCodex, null, 2);
				
				const token = currentUserSession ? currentUserSession.token : null;
				const result = await aiService.generateCodexFromTextChunk({
					textChunk: chunk,
					existingCodexJson,
					language,
					targetLanguage,
					model,
					token,
				});
				
				const processResultsTransaction = db.transaction(() => {
					const categoriesMap = new Map(db.prepare('SELECT name, id FROM codex_categories WHERE novel_id = ?').all(novelId).map(c => [c.name, c.id]));
					
					if (result.new_entries && Array.isArray(result.new_entries)) {
						for (const entry of result.new_entries) {
							if (!entry.category || !entry.title || !entry.content) continue;
							
							if (!categoriesMap.has(entry.category)) {
								const catResult = db.prepare('INSERT INTO codex_categories (novel_id, name) VALUES (?, ?)').run(novelId, entry.category);
								categoriesMap.set(entry.category, catResult.lastInsertRowid);
							}
							const categoryId = categoriesMap.get(entry.category);
							
							const existing = db.prepare('SELECT id FROM codex_entries WHERE title = ? AND codex_category_id = ?').get(entry.title, categoryId);
							if (!existing) {
								db.prepare('INSERT INTO codex_entries (novel_id, codex_category_id, title, content, target_content, document_phrases) VALUES (?, ?, ?, ?, ?, ?)')
									.run(novelId, categoryId, entry.title, entry.content, entry.target_content || '', entry.document_phrases || '');
							}
						}
					}
					
					if (result.updated_entries && Array.isArray(result.updated_entries)) {
						for (const entry of result.updated_entries) {
							if (!entry.title || !entry.content) continue;
							
							const existingEntry = db.prepare('SELECT document_phrases FROM codex_entries WHERE novel_id = ? AND title = ?').get(novelId, entry.title);
							let newPhrases = entry.document_phrases || '';
							if (existingEntry && existingEntry.document_phrases) {
								const existingSet = new Set(existingEntry.document_phrases.split(',').map(p => p.trim()).filter(Boolean));
								const newSet = new Set(newPhrases.split(',').map(p => p.trim()).filter(Boolean));
								const combined = new Set([...existingSet, ...newSet]);
								newPhrases = Array.from(combined).join(', ');
							}
							
							db.prepare('UPDATE codex_entries SET content = ?, target_content = ?, document_phrases = ? WHERE novel_id = ? AND title = ?')
								.run(entry.content, entry.target_content || '', newPhrases, novelId, entry.title);
						}
					}
				});
				
				processResultsTransaction();
			}
			
			sendProgress(100, 'Codex generation complete! The page will now reload.', 'electron.codexGenComplete');
			
		} catch (error) {
			console.error('Codex auto-generation failed:', error);
			sendProgress(100, `An error occurred: ${error.message}`, 'electron.codexGenError', { message: error.message });
		}
	});
	
	ipcMain.handle('codex:getAllForNovel', (event, novelId) => {
		try {
			const categories = db.prepare('SELECT id, name FROM codex_categories WHERE novel_id = ? ORDER BY name ASC').all(novelId);
			categories.forEach(category => {
				category.entries = db.prepare('SELECT id, title, content, target_content, document_phrases FROM codex_entries WHERE codex_category_id = ? ORDER BY title ASC').all(category.id);
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
	
	ipcMain.handle('codex-entries:suggest-details', async (event, { novelId, text }) => {
		try {
			const categories = db.prepare('SELECT id, name FROM codex_categories WHERE novel_id = ? ORDER BY name').all(novelId);
			const categoryNames = categories.map(c => c.name);
			
			if (categoryNames.length === 0) {
				categoryNames.push('Characters', 'Locations', 'Items', 'Lore');
			}
			
			const model = config.OPEN_ROUTER_MODEL || 'openai/gpt-4o-mini';
			
			const novel = db.prepare('SELECT target_language FROM novels WHERE id = ?').get(novelId);
			const targetLanguage = novel ? novel.target_language : 'English';
			
			const token = currentUserSession ? currentUserSession.token : null;
			const suggestion = await aiService.suggestCodexDetails({
				text,
				categories: categoryNames,
				targetLanguage: targetLanguage,
				model,
				token,
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
		const { title, content, target_content, document_phrases, codex_category_id, new_category_name } = formData;
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
				
				const entryResult = db.prepare('INSERT INTO codex_entries (novel_id, codex_category_id, title, content, target_content, document_phrases) VALUES (?, ?, ?, ?, ?, ?)')
					.run(novelId, categoryId, title, content, target_content, document_phrases);
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
		db.prepare('UPDATE codex_entries SET title = ?, content = ?, target_content = ?, document_phrases = ? WHERE id = ?')
			.run(data.title, data.content, data.target_content, data.document_phrases, entryId);
		return {success: true, message: 'Codex entry updated successfully.'};
	});
	
	ipcMain.handle('codex-entries:delete', (event, entryId) => {
		try {
			const result = db.prepare('DELETE FROM codex_entries WHERE id = ?').run(entryId);
			if (result.changes === 0) {
				return { success: false, message: 'Codex entry not found.' };
			}
			return { success: true, message: 'Codex entry deleted successfully.' };
		} catch (error) {
			console.error(`Failed to delete codex entry ${entryId}:`, error);
			throw new Error('Failed to delete the codex entry from the database.');
		}
	});
	
	// --- LLM Handlers ---
	ipcMain.handle('llm:process-text', async (event, data) => {
		try {
			const token = currentUserSession ? currentUserSession.token : null;
			const result = await aiService.processLLMText({ ...data, token });
			return { success: true, data: result };
		} catch (error) {
			console.error('AI Processing Error in main process:', error);
			return { success: false, error: error.message };
		}
	});
	
	ipcMain.handle('ai:getModels', async () => {
		try {
			const token = currentUserSession ? currentUserSession.token : null;
			const processedModels = await aiService.getOpenRouterModels(false, token);
			return {success: true, models: processedModels};
		} catch (error) {
			console.error('Failed to get or process AI models:', error);
			return {success: false, message: error.message};
		}
	});
	
	ipcMain.handle('ai:generate-cover-prompt', async (event, { novelTitle }) => {
		try {
			const token = currentUserSession ? currentUserSession.token : null;
			const prompt = await aiService.generateCoverPrompt({ title: novelTitle, token });
			return { success: true, prompt };
		} catch (error) {
			console.error('Failed to generate cover prompt in main process:', error);
			return { success: false, message: error.message };
		}
	});
	
	ipcMain.handle('ai:generate-cover', async (event, { novelId, prompt }) => {
		try {
			const token = currentUserSession ? currentUserSession.token : null;
			const falResponse = await aiService.generateCoverImageViaProxy({ prompt, token });
			
			if (!falResponse || !falResponse.images || !falResponse.images[0]?.url) {
				throw new Error('Image generation failed or did not return a valid URL.');
			}
			
			const imageUrl = falResponse.images[0].url;
			
			const localPaths = await imageHandler.storeImageFromUrl(imageUrl, novelId, 'generated-fal');
			
			if (!localPaths || !localPaths.original_path) {
				throw new Error('Failed to download and save the generated cover.');
			}
			
			const fullPath = path.join(imageHandler.IMAGES_DIR, localPaths.original_path);
			
			return { success: true, filePath: fullPath, localPath: localPaths.original_path };
		} catch (error) {
			console.error('Failed to generate cover image in main process:', error);
			return { success: false, message: error.message };
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
		
		const userId = currentUserSession ? currentUserSession.user.id : 1;
		let novelId;
		
		const importTransaction = db.transaction(() => {
			const novelResult = db.prepare(
				'INSERT INTO novels (user_id, title, source_language, target_language, status) VALUES (?, ?, ?, ?, ?)'
			).run(userId, title, source_language, target_language, 'draft');
			novelId = novelResult.lastInsertRowid;
			
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
		});
		
		try {
			// Step 1: Run the database transaction to import the text content.
			importTransaction();
			
			// Step 2: Send a status update to the import window that cover generation is starting.
			if (importWindow && !importWindow.isDestroyed()) {
				importWindow.webContents.send('import:status-update', { statusKey: 'import.generatingCover' });
			}
			
			// Step 3: Asynchronously generate and save the cover.
			const token = currentUserSession ? currentUserSession.token : null;
			await generateAndSaveCover(novelId, title, token);
			
			// Step 4: Close the import window and open the editor for the new novel.
			if (importWindow) {
				importWindow.close();
			}
			createChapterEditorWindow({ novelId, chapterId: null });
			
			return { success: true, novelId };
		} catch (error) {
			console.error('Failed to import document:', error);
			throw error; // Rethrow to be caught by the renderer process.
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
				ce.target_content,
				ce.document_phrases,
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
	loadSession();
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
