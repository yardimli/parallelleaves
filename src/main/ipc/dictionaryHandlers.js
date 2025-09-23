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
	
	// Modified: This handler now accepts an optional 'type' to filter the dictionary for the AI.
	ipcMain.handle('dictionary:getContentForAI', async (event, novelId, type) => {
		ensureDictionariesDir();
		const filePath = path.join(DICTIONARIES_DIR, `${novelId}.json`);
		try {
			if (fs.existsSync(filePath)) {
				const data = fs.readFileSync(filePath, 'utf8');
				let dictionaryEntries = JSON.parse(data) || [];
				
				// New: Filter entries based on the provided type if it exists.
				if (type) {
					dictionaryEntries = dictionaryEntries.filter(entry => {
						// If an entry has no type (from older versions), default it to 'translation' for filtering.
						const entryType = entry.type || 'translation';
						return entryType === type;
					});
				}
				
				// Format as "source = target" per line for AI prompt.
				return dictionaryEntries.map(entry => `${entry.source} = ${entry.target}`).join('\n');
			}
			return '';
		} catch (error) {
			console.error(`Failed to read or parse dictionary for novel ${novelId} for AI context:`, error);
			return '';
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
