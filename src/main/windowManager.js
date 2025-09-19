const { BrowserWindow, Menu, MenuItem } = require('electron');
const path = require('path');

let mainWindow = null;
let splashWindow = null;
let importWindow = null;
let chapterEditorWindows = new Map();
let outlineWindows = new Map();
let codexEditorWindows = new Map();
let chatWindow = null;
let isMainWindowReady = false;

/**
 * Sets a Content Security Policy for the window's webContents.
 * This was a missing feature from the refactoring of electron-main-old.js.
 * It helps to mitigate cross-site scripting (XSS) and other injection attacks.
 * @param {BrowserWindow} win - The window to apply the CSP to.
 */
function setContentSecurityPolicy(win) {
	win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
		callback({
			responseHeaders: {
				...details.responseHeaders,
				'Content-Security-Policy': ["default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' file: data: https:;"],
			},
		});
	});
}

/**
 * Generic function to create a context menu for editable content.
 * @param {BrowserWindow} win - The window to attach the context menu to.
 */
function createContextMenu(win) {
	win.webContents.on('context-menu', (event, params) => {
		const menu = new Menu();
		
		for (const suggestion of params.dictionarySuggestions) {
			menu.append(new MenuItem({
				label: suggestion,
				click: () => win.webContents.replaceMisspelling(suggestion)
			}));
		}
		
		if (params.misspelledWord) {
			menu.append(
				new MenuItem({
					label: 'Add to dictionary',
					click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
				})
			);
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
}

function createSplashWindow() {
	splashWindow = new BrowserWindow({
		width: 500,
		height: 500,
		transparent: true,
		frame: false,
		alwaysOnTop: true,
		center: true,
		icon: path.join(__dirname, '..', '..', 'public/assets/icon.png'),
		webPreferences: {
			preload: path.join(__dirname, '..', '..', 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	
	splashWindow.loadFile('public/splash.html');
	
	splashWindow.on('closed', () => {
		splashWindow = null;
	});
}

function createMainWindow() {
	mainWindow = new BrowserWindow({
		show: false,
		width: 1400,
		height: 1000,
		icon: path.join(__dirname, '..', '..', 'public/assets/icon.png'),
		title: 'Parallel Leaves - Translation Editor',
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, '..', '..', 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false
		}
	});
	
	setContentSecurityPolicy(mainWindow);
	
	mainWindow.loadFile('public/index.html');
	
	mainWindow.once('ready-to-show', () => {
		isMainWindowReady = true;
	});
	
	mainWindow.on('closed', () => {
		mainWindow = null;
	});
	
	createContextMenu(mainWindow);
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
	
	const win = new BrowserWindow({
		width: 1600,
		height: 1000,
		icon: path.join(__dirname, '..', '..', 'public/assets/icon.png'),
		title: 'Parallel Leaves - Translation Editor',
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, '..', '..', 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	
	setContentSecurityPolicy(win);
	
	win.loadFile('public/chapter-editor.html', { query: { novelId, chapterId } });
	chapterEditorWindows.set(windowKey, win);
	
	win.on('closed', () => {
		chapterEditorWindows.delete(windowKey);
	});
	
	createContextMenu(win);
}

function createOutlineWindow(novelId) {
	if (outlineWindows.has(novelId)) {
		const existingWin = outlineWindows.get(novelId);
		if (existingWin) {
			existingWin.focus();
			return;
		}
	}
	
	const win = new BrowserWindow({
		width: 1800,
		height: 1000,
		icon: path.join(__dirname, '..', '..', 'public/assets/icon.png'),
		title: 'Parallel Leaves - Outline Viewer',
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, '..', '..', 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	
	setContentSecurityPolicy(win);
	
	win.loadFile('public/outline-viewer.html', { query: { novelId: novelId } });
	outlineWindows.set(novelId, win);
	
	win.on('closed', () => {
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
	
	const win = new BrowserWindow({
		width: 1200,
		height: 800,
		icon: path.join(__dirname, '..', '..', 'public/assets/icon.png'),
		title: 'Parallel Leaves - Codex Editor',
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, '..', '..', 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	
	setContentSecurityPolicy(win);
	
	const query = { mode };
	if (mode === 'edit') query.entryId = entryId;
	else {
		query.novelId = novelId;
		query.selectedText = encodeURIComponent(selectedText || '');
	}
	
	win.loadFile('public/codex-entry-editor.html', { query });
	codexEditorWindows.set(windowKey, win);
	
	win.on('closed', () => {
		codexEditorWindows.delete(windowKey);
	});
	
	createContextMenu(win);
}

function createImportWindow() {
	if (importWindow) {
		importWindow.focus();
		return;
	}
	
	importWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		icon: path.join(__dirname, '..', '..', 'public/assets/icon.png'),
		title: 'Parallel Leaves - Import Document',
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, '..', '..', 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	
	importWindow.loadFile('public/import-document.html');
	
	importWindow.on('closed', () => {
		importWindow = null;
	});
}

function createChatWindow() {
	if (chatWindow) {
		chatWindow.focus();
		return;
	}
	
	chatWindow = new BrowserWindow({
		width: 600,
		height: 800,
		icon: path.join(__dirname, '..', '..', 'public/assets/icon.png'),
		title: 'AI Chat',
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, '..', '..', 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	
	setContentSecurityPolicy(chatWindow);
	
	chatWindow.loadFile('public/chat-window.html');
	
	chatWindow.on('closed', () => {
		chatWindow = null;
	});
}

function closeSplashAndShowMain() {
	if (splashWindow && !splashWindow.isDestroyed()) {
		splashWindow.close();
	}
	
	const show = () => {
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.show();
			mainWindow.focus();
		}
	};
	
	if (isMainWindowReady) {
		show();
	} else if (mainWindow) {
		mainWindow.once('ready-to-show', show);
	}
}

module.exports = {
	createSplashWindow,
	createMainWindow,
	createChapterEditorWindow,
	createOutlineWindow,
	createCodexEditorWindow,
	createImportWindow,
	createChatWindow,
	closeSplashAndShowMain,
	getMainWindow: () => mainWindow,
	getImportWindow: () => importWindow,
};
