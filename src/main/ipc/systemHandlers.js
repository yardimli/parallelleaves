const { ipcMain, shell, app, BrowserWindow } = require('electron');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const config = require('../../../config.js');
const { supportedLanguages } = require('../../js/languages.js');
const { getTemplate, findHighestMarkerNumber } = require('../utils.js');

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
			websiteUrl: 'https://github.com/yardimli/parallelleaves'
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
			console.log('Latest version from server:', data.latest_version, 'Current version:', config.APP_VERSION);
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
	
	// MODIFIED: This handler now creates a flag file and quits the application.
	// The actual data deletion is handled on the next startup to avoid file lock issues.
	ipcMain.on('app:reset', () => {
		const userDataPath = app.getPath('userData');
		// Place the flag file one level above userData to prevent it from being deleted during the reset.
		const resetFlagPath = path.join(userDataPath, '..', 'reset.flag');
		
		try {
			// Create the flag file to signal a reset on the next launch.
			fs.writeFileSync(resetFlagPath, 'reset');
			console.log(`Reset flag created at: ${resetFlagPath}`);
			
			// Quit the application. The startup process will handle the deletion.
			app.quit();
		} catch (error) {
			console.error('Failed to create reset flag:', error);
			// If we can't create the flag, we shouldn't quit, as the reset won't happen.
		}
	});
	
	ipcMain.on('app:openChatWindow', (event, novelId) => {
		if (windowManager && typeof windowManager.createChatWindow === 'function') {
			windowManager.createChatWindow(novelId);
		}
	});
	
	ipcMain.on('app:openTranslationMemoryWindow', (event, novelId) => {
		if (windowManager && typeof windowManager.createTranslationMemoryWindow === 'function') {
			windowManager.createTranslationMemoryWindow(novelId);
		}
	});
	
	ipcMain.handle('i18n:get-lang-file', (event, lang) => {
		const langDir = path.join(__dirname, '..', '..', '..', 'public', 'lang', lang);
		const mergedTranslations = {};
		
		try {
			if (!fs.existsSync(langDir) || !fs.lstatSync(langDir).isDirectory()) {
				throw new Error(`Language directory not found: ${lang}`);
			}
			
			const files = fs.readdirSync(langDir).filter(file => file.endsWith('.json'));
			
			for (const file of files) {
				const filePath = path.join(langDir, file);
				const fileContent = fs.readFileSync(filePath, 'utf8');
				const jsonData = JSON.parse(fileContent);
				
				const key = path.basename(file, '.json');
				mergedTranslations[key] = jsonData;
			}
			
			return JSON.stringify(mergedTranslations);
		} catch (error) {
			console.error(`Failed to read language files for: ${lang}`, error);
			throw new Error(`Could not load language files for: ${lang}`);
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
	
	ipcMain.handle('novels:findHighestMarkerNumber', (event, sourceHtml, targetHtml) => {
		return findHighestMarkerNumber(sourceHtml, targetHtml);
	});
}

module.exports = { registerSystemHandlers };
