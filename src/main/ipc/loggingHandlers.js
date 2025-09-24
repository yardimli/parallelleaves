const { ipcMain } = require('electron');
const fetch = require('node-fetch');
const config = require('../../../config.js');

const AI_PROXY_URL = config.AI_PROXY_URL;

/**
 * Registers IPC handlers for logging functionality.
 * @param {Database.Database} db - The application's database connection.
 * @param {object} sessionManager - The session manager instance.
 */
function registerLoggingHandlers(db, sessionManager) {
	ipcMain.handle('log:translation', async (event, data) => {
		const session = sessionManager.getSession();
		if (!session || !session.user) {
			console.error('Attempted to log translation without an active session.');
			return { success: false, message: 'User not authenticated.' };
		}
		
		const { novelId, chapterId, sourceText, targetText, marker, model, temperature } = data;
		const userId = session.user.id;
		
		// --- 1. Log to local SQLite database ---
		try {
			const stmt = db.prepare(`
                INSERT INTO translation_logs
                (user_id, novel_id, chapter_id, source_text, target_text, marker, model, temperature)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
			stmt.run(userId, novelId, chapterId, sourceText, targetText, marker, model, temperature);
			console.log('Translation event logged locally.');
		} catch (error) {
			console.error('Failed to log translation event to local database:', error);
			// We can decide whether to stop here or still try to log remotely.
			// For now, let's continue but return an error at the end.
		}
		
		// --- 2. Log to remote server ---
		if (!AI_PROXY_URL) {
			console.warn('AI_PROXY_URL not configured. Skipping remote logging.');
			return { success: true, message: 'Logged locally. Remote logging skipped.' };
		}
		
		try {
			const payload = {
				auth_token: session.token,
				novel_id: novelId,
				chapter_id: chapterId,
				source_text: sourceText,
				target_text: targetText,
				marker: marker,
				model: model,
				temperature: temperature
			};
			
			const response = await fetch(`${AI_PROXY_URL}?action=log_translation`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			
			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Remote logging failed with status ${response.status}: ${errorText}`);
			}
			
			console.log('Translation event logged remotely.');
			return { success: true, message: 'Translation logged successfully both locally and remotely.' };
			
		} catch (error) {
			console.error('Failed to log translation event to remote server:', error);
			// Return a failure but indicate local success if that happened.
			return { success: false, message: `Logged locally, but remote logging failed: ${error.message}` };
		}
	});
}

module.exports = { registerLoggingHandlers };
