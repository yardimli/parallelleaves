const { ipcMain } = require('electron');
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
				// MODIFICATION START: Updated query to handle both old ('[[#38]]') and new ('38') marker formats for backward compatibility.
				const original = db.prepare(`
                    SELECT target_text FROM translation_logs
                    WHERE novel_id = ? AND (marker = ? OR marker = '[[' || '#' || ? || ']]')
                    ORDER BY created_at DESC
                    LIMIT 1
                `).get(novelId, edit.marker, edit.marker);
				// MODIFICATION END
				
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
					system: `You are a linguistic analyst. Your task is to compare two versions of a text and identify the specific changes made.
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
			
			// TODO: Mark the processed logs as analyzed in a separate "apply" step.
			// For now, we just return the results.
			
			return { success: true, results: finalResults };
			
		} catch (error) {
			console.error('Analysis process failed:', error);
			analysisWindow.webContents.send('analysis:update', { type: 'error', message: `Analysis failed: ${error.message}` });
			return { success: false, error: error.message };
		}
	});
}

module.exports = { registerAnalysisHandlers };
