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
	// Handler for logging successful translations
	ipcMain.handle('log:translation', async (event, logData) => {
		const session = sessionManager.getSession();
		if (!session || !session.token) {
			return { success: false, message: 'User not authenticated.' };
		}
		
		//check if logData.marker is in the format [[#number]] and extract the number
		if (logData.marker && typeof logData.marker === 'string') {
			const markerMatch = logData.marker.match(/^\[\[#(\d+)\]\]$/);
			if (markerMatch) {
				logData.marker = markerMatch[1]; // Extracted number as string
			}
		}
		
		const normalizedLogData = {
			novel_id: logData.novel_id || logData.novelId,
			chapter_id: logData.chapter_id || logData.chapterId,
			source_text: logData.source_text || logData.sourceText,
			target_text: logData.target_text || logData.targetText,
			marker: logData.marker,
			model: logData.model,
			temperature: logData.temperature
		};
		
		// Added validation to fail early if essential text fields are missing after normalization.
		// This prevents the NOT NULL constraint error in SQLite.
		if (!normalizedLogData.source_text || !normalizedLogData.target_text) {
			console.error('Failed to log translation: source_text or target_text is missing from logData.', logData);
			return { success: false, message: 'Cannot log translation: source or target text is missing.' };
		}
		
		// 1. Log to local SQLite database
		try {
			// Use the fully normalized data for the database query.
			db.prepare(`
                INSERT INTO translation_logs (user_id, novel_id, chapter_id, source_text, target_text, marker, model, temperature)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
				session.user.id,
				normalizedLogData.novel_id,
				normalizedLogData.chapter_id,
				normalizedLogData.source_text,
				normalizedLogData.target_text,
				normalizedLogData.marker,
				normalizedLogData.model,
				normalizedLogData.temperature
			);
		} catch (error) {
			console.error('Failed to log translation to local DB:', error);
			// Continue to attempt remote logging even if local fails.
		}
		
		// 2. Log to remote MySQL database via proxy
		try {
			// Use the normalized data for the remote payload to ensure the proxy receives snake_case keys.
			const payload = { ...normalizedLogData, auth_token: session.token };
			//console.log('Logging translation to remote server with payload:', payload);
			const response = await fetch(`${AI_PROXY_URL}?action=log_translation`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			
			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Remote logging failed: ${errorText}`);
			}
			return { success: true };
		} catch (error) {
			console.error('Failed to log translation to remote server:', error);
			return { success: false, message: error.message };
		}
	});
	
	// Handler for logging target editor changes
	ipcMain.handle('log:target-edit', async (event, logData) => {
		const session = sessionManager.getSession();
		if (!session || !session.token) {
			return { success: false, message: 'User not authenticated.' };
		}
		
		// 1. Log to local SQLite database
		try {
			const { novelId, chapterId, marker, content } = logData;
			db.prepare(`
                INSERT INTO target_editor_logs (user_id, novel_id, chapter_id, marker, content)
                VALUES (?, ?, ?, ?, ?)
            `).run(session.user.id, novelId, chapterId, marker, content);
		} catch (error) {
			console.error('Failed to log target edit to local DB:', error);
		}
		
		// 2. Log to remote MySQL database via proxy
		try {
			const payload = {
				novel_id: logData.novelId,
				chapter_id: logData.chapterId,
				marker: logData.marker,
				content: logData.content,
				auth_token: session.token
			};
			//console.log('Logging target edit to remote server with payload:', payload);
			const response = await fetch(`${AI_PROXY_URL}?action=log_target_edit`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			
			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Remote target edit logging failed: ${errorText}`);
			}
			return { success: true };
		} catch (error) {
			console.error('Failed to log target edit to remote server:', error);
			return { success: false, message: error.message };
		}
	});
}

module.exports = { registerLoggingHandlers };
