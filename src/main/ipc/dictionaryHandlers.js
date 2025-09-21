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
	
	// New: IPC handler to get dictionary content formatted for AI prompts.
	ipcMain.handle('dictionary:getContentForAI', async (event, novelId) => { // New: Handler for getting dictionary content in AI-friendly format.
		ensureDictionariesDir(); // Ensure the dictionaries directory exists.
		const filePath = path.join(DICTIONARIES_DIR, `${novelId}.json`); // Construct the path to the novel's dictionary file.
		try {
			if (fs.existsSync(filePath)) { // Check if the dictionary file exists.
				const data = fs.readFileSync(filePath, 'utf8'); // Read the file content.
				const dictionaryEntries = JSON.parse(data); // Parse the JSON data.
				// Format as "source = target" per line for AI prompt.
				return (dictionaryEntries || []).map(entry => `${entry.source} = ${entry.target}`).join('\n'); // New: Map entries to "source = target" string and join with newlines.
			}
			// Return an empty string if the file doesn't exist, indicating no dictionary content.
			return ''; // New: Return empty string if no dictionary file is found.
		} catch (error) {
			// Log the error but return an empty string to allow AI operations to continue without dictionary.
			console.error(`Failed to read or parse dictionary for novel ${novelId} for AI context:`, error); // New: Log specific error for AI context.
			return ''; // New: Return empty string on error to prevent AI prompt failure.
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
