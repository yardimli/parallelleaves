const { ipcMain, BrowserWindow } = require('electron'); // MODIFICATION: Added BrowserWindow
const aiService = require('../../ai/ai.js');

/**
 * Registers IPC handlers for the analysis window functionality.
 * @param {Database.Database} db - The application's database connection.
 * @param {object} sessionManager - The session manager instance.
 * @param {object} windowManager - The window manager instance.
 */
function registerAnalysisHandlers(db, sessionManager, windowManager) {
	ipcMain.handle('analysis:start', async (event, { novelId, model, temperature }) => {
		const analysisWindow = event.sender.getOwnerBrowserWindow();
		
		try {
			const token = sessionManager.getSession()?.token || null;
			
			// Step 1: Find the latest unanalyzed edit for each unique marker.
			const latestEdits = db.prepare(`
                WITH LatestEdits AS (
                    SELECT
                        id,
                        marker,
                        content,
                        ROW_NUMBER() OVER(PARTITION BY marker ORDER BY created_at DESC) as rn
                    FROM target_editor_logs
                    WHERE novel_id = ? AND is_analyzed = 0
                )
                SELECT id, marker, content FROM LatestEdits WHERE rn = 1
            `).all(novelId);
			
			if (latestEdits.length === 0) {
				analysisWindow.webContents.send('analysis:update', { type: 'finished', message: 'No new edits to analyze.' });
				return { success: true, message: 'No edits found.' };
			}
			
			analysisWindow.webContents.send('analysis:update', { type: 'progress', message: `Found ${latestEdits.length} edits to analyze...` });
			
			const analysisPairs = [];
			for (const edit of latestEdits) {
				// MODIFICATION: Updated query to handle both old ('[[#38]]') and new ('38') marker formats for backward compatibility.
				const original = db.prepare(`
                    SELECT target_text FROM translation_logs
                    WHERE novel_id = ? AND (marker = ? OR marker = '[[' || '#' || ? || ']]')
                    ORDER BY created_at DESC
                    LIMIT 1
                `).get(novelId, edit.marker, edit.marker);
				
				if (original && original.target_text.trim() !== edit.content.trim()) {
					analysisPairs.push({
						logId: edit.id,
						marker: edit.marker,
						original: original.target_text,
						edited: edit.content
					});
				}
			}
			
			if (analysisPairs.length === 0) {
				analysisWindow.webContents.send('analysis:update', { type: 'finished', message: 'No significant changes found in edits.' });
				return { success: true, message: 'No significant changes.' };
			}
			
			// Step 3: Send pairs to the LLM for analysis.
			const analysisPromises = analysisPairs.map(pair => {
				const prompt = {
					system: `You are a linguistic analyst. Your task is to compare two versions of a text and identify the specific changes made. The changes are to be used in helping a translator understand the editor's style and preferences. Only include phrases that were changed, rephrased, or corrected. If a sentence was added or removed entirely, do not include it in the output. Focus solely on modifications within existing sentences.
Respond ONLY with a valid JSON object where keys are the original phrases and values are the edited phrases.
- The JSON object should only contain key-value pairs of actual changes.
- If a sentence is completely new, do not include it.
- If a sentence was deleted, do not include it.
- Focus on rephrasing, word choice changes, and corrections.
- If no significant changes are found between the two texts, return an empty JSON object {}.
Example: {"the big red cat": "the large crimson cat", "he said happily": "he exclaimed joyfully"}`,
					user: `Original Text: "${pair.original}"\n\nEdited Text: "${pair.edited}"`
				};
				
				return aiService.processLLMText({
					prompt,
					model,
					token,
					temperature,
					response_format: { type: 'json_object' }
				}).then(result => {
					analysisWindow.webContents.send('analysis:update', { type: 'progress', message: `Analyzed marker #${pair.marker}...` });
					return {
						marker: pair.marker,
						changes: result // The result is already parsed JSON
					};
				}).catch(error => {
					console.error(`Error analyzing marker ${pair.marker}:`, error);
					analysisWindow.webContents.send('analysis:update', { type: 'error', message: `Error analyzing marker #${pair.marker}: ${error.message}` });
					return { marker: pair.marker, changes: {} }; // Return empty on error
				});
			});
			
			const allResults = await Promise.all(analysisPromises);
			
			const finalResults = allResults.filter(r => r && Object.keys(r.changes).length > 0);
			
			analysisWindow.webContents.send('analysis:update', { type: 'results', data: finalResults });
			analysisWindow.webContents.send('analysis:update', { type: 'finished', message: 'Analysis complete.' });
			
			return { success: true, results: finalResults };
			
		} catch (error) {
			console.error('Analysis process failed:', error);
			analysisWindow.webContents.send('analysis:update', { type: 'error', message: `Analysis failed: ${error.message}` });
			return { success: false, error: error.message };
		}
	});
	
	// MODIFICATION START: New handler to mark edits as analyzed
	ipcMain.handle('analysis:markAsAnalyzed', async (event, novelId) => {
		try {
			// 1. Update local SQLite database
			db.prepare('UPDATE target_editor_logs SET is_analyzed = 1 WHERE novel_id = ?')
				.run(novelId);
			
			// 2. Update remote MySQL database via proxy
			const session = sessionManager.getSession();
			if (session && session.token) {
				const fetch = require('node-fetch');
				const config = require('../../../config.js');
				const AI_PROXY_URL = config.AI_PROXY_URL;
				
				const payload = {
					novel_id: novelId,
					auth_token: session.token
				};
				
				const response = await fetch(`${AI_PROXY_URL}?action=mark_edits_analyzed`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload)
				});
				if (!response.ok) {
					console.error('Failed to mark remote edits as analyzed:', await response.text());
				}
			}
			
			// 3. Notify all windows that analysis has been applied so they can update UI
			BrowserWindow.getAllWindows().forEach(win => {
				win.webContents.send('analysis:applied');
			});
			
			return { success: true };
		} catch (error) {
			console.error(`Failed to mark edits as analyzed for novel ${novelId}:`, error);
			return { success: false, message: error.message };
		}
	});
	// MODIFICATION END
	
	// MODIFICATION START: New handler to check for unanalyzed edits
	ipcMain.handle('analysis:hasUnanalyzedEdits', (event, novelId) => {
		try {
			const result = db.prepare(
				'SELECT COUNT(*) as count FROM target_editor_logs WHERE novel_id = ? AND is_analyzed = 0'
			).get(novelId);
			return result.count > 0;
		} catch (error) {
			console.error(`Failed to check for unanalyzed edits for novel ${novelId}:`, error);
			return false; // Return false on error to avoid UI bugs
		}
	});
	// MODIFICATION END
}

module.exports = { registerAnalysisHandlers };
