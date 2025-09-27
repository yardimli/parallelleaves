const { ipcMain, shell } = require('electron');
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
	
	ipcMain.on('app:openChatWindow', (event, novelId) => {
		// Get the novelId directly passed from the renderer process
		if (windowManager && typeof windowManager.createChatWindow === 'function') {
			windowManager.createChatWindow(novelId);
		}
	});
	
	// MODIFICATION START: The listener now accepts an 'autoStart' parameter.
	ipcMain.on('app:openAnalysisWindow', (event, novelId, autoStart = false) => {
		if (windowManager && typeof windowManager.createAnalysisWindow === 'function') {
			// Pass the 'autoStart' flag to the window manager.
			windowManager.createAnalysisWindow(novelId, autoStart);
		}
	});
	// MODIFICATION END
	
	/**
	 * MODIFIED SECTION: This handler now reads all JSON files from a language-specific
	 * directory, merges them into a single object, and returns the result. This supports
	 * the new modular file structure for translations.
	 */
	ipcMain.handle('i18n:get-lang-file', (event, lang) => {
		const langDir = path.join(__dirname, '..', '..', '..', 'public', 'lang', lang);
		const mergedTranslations = {};
		
		try {
			// Check if the language directory exists.
			if (!fs.existsSync(langDir) || !fs.lstatSync(langDir).isDirectory()) {
				// This error will be caught and handled by the renderer, which will then try the 'en' fallback.
				throw new Error(`Language directory not found: ${lang}`);
			}
			
			// Read all files in the directory that end with .json.
			const files = fs.readdirSync(langDir).filter(file => file.endsWith('.json'));
			
			// Iterate over each file, parse it, and add it to the merged object.
			for (const file of files) {
				const filePath = path.join(langDir, file);
				const fileContent = fs.readFileSync(filePath, 'utf8');
				const jsonData = JSON.parse(fileContent);
				
				// The filename (without extension) becomes the top-level key.
				const key = path.basename(file, '.json'); // e.g., 'common' from 'common.json'
				mergedTranslations[key] = jsonData;
			}
			
			// Return the complete, merged language object as a JSON string.
			return JSON.stringify(mergedTranslations);
		} catch (error) {
			console.error(`Failed to read language files for: ${lang}`, error);
			// Propagate the error to the renderer process.
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
