const { ipcMain, shell } = require('electron');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const config = require('../../../config.js');
const { supportedLanguages } = require('../../js/languages.js');
const { getTemplate } = require('../utils.js');

/**
 * Registers IPC handlers for system-level functionality.
 * @param {Database.Database} db - The application's database connection.
 * @param {object} sessionManager - The session manager instance.
 * @param {object} windowManager - The window manager instance.
 */
function registerSystemHandlers(db, sessionManager, windowManager) {
	ipcMain.handle('splash:get-init-data', () => {
		return {
			version: config.APP_VERSION,
			user: sessionManager.getSession()?.user || null,
			websiteUrl: 'https://github.com/locutusdeborg/novel-skriver'
		};
	});
	
	ipcMain.handle('splash:check-for-updates', async () => {
		try {
			if (!config.VERSION_CHECK_URL) {
				console.log('VERSION_CHECK_URL not configured. Skipping update check.');
				return null;
			}
			const response = await fetch(config.VERSION_CHECK_URL);
			if (!response.ok) {
				throw new Error(`Update server returned status ${response.status}`);
			}
			const data = await response.json();
			return data.latest_version;
		} catch (error) {
			console.error('Failed to check for updates:', error);
			return null;
		}
	});
	
	ipcMain.on('splash:close', (event) => {
		const splashWindow = event.sender.getOwnerBrowserWindow();
		if (splashWindow && !splashWindow.isDestroyed()) {
			splashWindow.close();
		}
	});
	
	ipcMain.on('splash:finished', () => {
		if (windowManager && typeof windowManager.closeSplashAndShowMain === 'function') {
			windowManager.closeSplashAndShowMain();
		}
	});
	
	ipcMain.on('app:open-external-url', (event, url) => {
		if (url) {
			shell.openExternal(url);
		}
	});
	
	ipcMain.on('app:openChatWindow', () => {
		if (windowManager && typeof windowManager.createChatWindow === 'function') {
			windowManager.createChatWindow();
		}
	});
	
	ipcMain.handle('i18n:get-lang-file', (event, lang) => {
		const langPath = path.join(__dirname, '..', '..', '..', 'public', 'lang', `${lang}.json`);
		try {
			return fs.readFileSync(langPath, 'utf8');
		} catch (error) {
			console.error(`Failed to read language file: ${lang}`, error);
			throw new Error(`Could not load language file: ${lang}.json`);
		}
	});
	
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
			} else {
				session.setSpellCheckerLanguages([]);
			}
			return { success: true };
		} catch (error) {
			console.error('Failed to set spellchecker language:', error);
			return { success: false, message: error.message };
		}
	});
	
	ipcMain.handle('languages:get-supported', () => {
		return supportedLanguages;
	});
}

module.exports = { registerSystemHandlers };
