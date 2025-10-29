const { BrowserWindow, Menu, MenuItem, shell } = require('electron');
const path = require('path');

let mainWindow = null;
let splashWindow = null;
let importWindow = null;
let chapterEditorWindows = new Map();
let codexViewerWindows = new Map();
let chatWindow = null;
// MODIFICATION: Removed translationMemoryWindow variable
let isMainWindowReady = false;

/**
 * Sets a Content Security Policy for the window's webContents.
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
		
		const hasSelection = params.selectionText.trim() !== '';
		
		if (params.isEditable) {
			if (menu.items.length > 0) menu.append(new MenuItem({ type: 'separator' }));
			menu.append(new MenuItem({ label: 'Cut', role: 'cut', enabled: hasSelection }));
			menu.append(new MenuItem({ label: 'Copy', role: 'copy', enabled: hasSelection }));
			if (hasSelection) {
				menu.append(new MenuItem({
					label: 'Lookup on Google',
					click: () => {
						const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(params.selectionText)}`;
						shell.openExternal(searchUrl);
					}
				}));
			}
			menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
			menu.append(new MenuItem({ type: 'separator' }));
			menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));
		} else if (hasSelection) {
			if (menu.items.length > 0 && menu.items[menu.items.length - 1].type !== 'separator') {
				menu.append(new MenuItem({ type: 'separator' }));
			}
			menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
			menu.append(new MenuItem({
				label: 'Lookup on Google',
				click: () => {
					const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(params.selectionText)}`;
					shell.openExternal(searchUrl);
				}
			}));
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

function createCodexViewerWindow(novelId) {
	if (codexViewerWindows.has(novelId)) {
		const existingWin = codexViewerWindows.get(novelId);
		if (existingWin) {
			existingWin.focus();
			return;
		}
	}
	
	const win = new BrowserWindow({
		width: 1200,
		height: 900,
		icon: path.join(__dirname, '..', '..', 'public/assets/icon.png'),
		title: 'Parallel Leaves - Codex Viewer',
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, '..', '..', 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	
	setContentSecurityPolicy(win);
	
	win.loadFile('public/codex-viewer.html', { query: { novelId: novelId } });
	codexViewerWindows.set(novelId, win);
	
	win.on('closed', () => {
		codexViewerWindows.delete(novelId);
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

function createChatWindow(novelId) {
	if (chatWindow && !chatWindow.isDestroyed()) {
		const currentUrl = new URL(chatWindow.webContents.getURL());
		const currentNovelId = currentUrl.searchParams.get('novelId');
		
		if (currentNovelId !== novelId) {
			chatWindow.loadFile('public/chat-window.html', { query: { novelId: novelId } });
		}
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
	
	chatWindow.loadFile('public/chat-window.html', { query: { novelId: novelId } });
	
	chatWindow.on('closed', () => {
		chatWindow = null;
	});
}

// MODIFICATION: Removed createTranslationMemoryWindow function

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
	createCodexViewerWindow,
	createImportWindow,
	createChatWindow,
	// MODIFICATION: Removed createTranslationMemoryWindow from exports
	closeSplashAndShowMain,
	getMainWindow: () => mainWindow,
	getImportWindow: () => importWindow,
};
