// src/main/ipc/dictionaryHandlers.js
const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs');

const DICTIONARIES_DIR = path.join(app.getPath('userData'), 'dictionaries');

/**
 * Ensures the dictionaries directory exists.
 */
function ensureDictionariesDir() {
	if (!fs.existsSync(DICTIONARIES_DIR)) {
		fs.mkdirSync(DICTIONARIES_DIR, { recursive: true });
	}
}

/**
 * Registers IPC handlers for dictionary-related functionality.
 */
function registerDictionaryHandlers() {
	ipcMain.handle('dictionary:get', async (event, novelId) => {
		ensureDictionariesDir();
		const filePath = path.join(DICTIONARIES_DIR, `${novelId}.json`);
		try {
			if (fs.existsSync(filePath)) {
				const data = fs.readFileSync(filePath, 'utf8');
				return JSON.parse(data);
			}
			return []; // Return empty array if file doesn't exist
		} catch (error) {
			console.error(`Failed to read dictionary for novel ${novelId}:`, error);
			throw new Error('Could not load dictionary.');
		}
	});
	
	ipcMain.handle('dictionary:save', async (event, novelId, data) => {
		ensureDictionariesDir();
		const filePath = path.join(DICTIONARIES_DIR, `${novelId}.json`);
		try {
			fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8'); // Write data to file.
			return { success: true }; // Indicate success.
		} catch (error) {
			console.error(`Failed to save dictionary for novel ${novelId}:`, error);
			throw new Error('Could not save dictionary.'); // Throw error on failure.
		}
	});
}

module.exports = { registerDictionaryHandlers };
