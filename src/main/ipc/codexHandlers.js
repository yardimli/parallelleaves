const { ipcMain } = require('electron');
const { htmlToPlainText } = require('../utils.js');
const aiService = require('../../ai/ai.js');
const config = require('../../../config.js');

/**
 * Registers IPC handlers for Codex functionality.
 * @param {Database.Database} db - The application's database connection.
 * @param {object} sessionManager - The session manager instance.
 * @param {object} windowManager - The window manager instance.
 */
function registerCodexHandlers(db, sessionManager, windowManager) {
	ipcMain.on('autogen:start-codex-generation', async (event, { novelId, model }) => {
		const sender = event.sender;
		const sendProgress = (progress, status, statusKey = null, statusParams = {}) => {
			if (!sender.isDestroyed()) {
				sender.send('autogen:progress-update', { progress, status, statusKey, statusParams });
			}
		};
		
		try {
			sendProgress(0, 'Fetching novel content...');
			
			const chapters = db.prepare('SELECT source_content FROM chapters WHERE novel_id = ? AND source_content IS NOT NULL').all(novelId);
			if (chapters.length === 0) {
				sendProgress(100, 'No source content found to analyze. Process finished.', 'electron.codexGenNoSource');
				return;
			}
			
			const fullText = chapters.map(c => c.source_content).join('\n');
			const cleanedText = htmlToPlainText(fullText);
			
			const words = cleanedText.split(/\s+/);
			const chunkSize = 10000;
			const chunks = [];
			for (let i = 0; i < words.length; i += chunkSize) {
				chunks.push(words.slice(i, i + chunkSize).join(' '));
			}
			
			if (chunks.length === 0) {
				sendProgress(100, 'No text found after cleaning. Process finished.', 'electron.codexGenNoText');
				return;
			}
			
			sendProgress(5, `Found ${words.length.toLocaleString()} words, split into ${chunks.length} chunks.`);
			
			const getExistingCodex = () => {
				const categories = db.prepare('SELECT id, name FROM codex_categories WHERE novel_id = ?').all(novelId);
				const codexData = {};
				for (const category of categories) {
					const entries = db.prepare('SELECT title, content FROM codex_entries WHERE codex_category_id = ?').all(category.id);
					codexData[category.name] = entries;
				}
				return codexData;
			};
			
			const novel = db.prepare('SELECT source_language, target_language FROM novels WHERE id = ?').get(novelId);
			const language = novel ? novel.source_language : 'English';
			const targetLanguage = novel ? novel.target_language : 'English';
			
			for (let i = 0; i < chunks.length; i++) {
				const chunk = chunks[i];
				const progress = 5 + Math.round((i / chunks.length) * 90);
				sendProgress(progress, `Analyzing chunk ${i + 1} of ${chunks.length}...`);
				
				const existingCodex = getExistingCodex();
				const existingCodexJson = JSON.stringify(existingCodex, null, 2);
				
				const token = sessionManager.getSession()?.token || null;
				const result = await aiService.generateCodexFromTextChunk({
					textChunk: chunk,
					existingCodexJson,
					language,
					targetLanguage,
					model,
					token,
				});
				
				const processResultsTransaction = db.transaction(() => {
					const categoriesMap = new Map(db.prepare('SELECT name, id FROM codex_categories WHERE novel_id = ?').all(novelId).map(c => [c.name, c.id]));
					
					if (result.new_entries && Array.isArray(result.new_entries)) {
						for (const entry of result.new_entries) {
							if (!entry.category || !entry.title || !entry.content) continue;
							
							if (!categoriesMap.has(entry.category)) {
								const catResult = db.prepare('INSERT INTO codex_categories (novel_id, name) VALUES (?, ?)').run(novelId, entry.category);
								categoriesMap.set(entry.category, catResult.lastInsertRowid);
							}
							const categoryId = categoriesMap.get(entry.category);
							
							const existing = db.prepare('SELECT id FROM codex_entries WHERE title = ? AND codex_category_id = ?').get(entry.title, categoryId);
							if (!existing) {
								db.prepare('INSERT INTO codex_entries (novel_id, codex_category_id, title, content, target_content, document_phrases) VALUES (?, ?, ?, ?, ?, ?)')
									.run(novelId, categoryId, entry.title, entry.content, entry.target_content || '', entry.document_phrases || '');
							}
						}
					}
					
					if (result.updated_entries && Array.isArray(result.updated_entries)) {
						for (const entry of result.updated_entries) {
							if (!entry.title || !entry.content) continue;
							
							const existingEntry = db.prepare('SELECT document_phrases FROM codex_entries WHERE novel_id = ? AND title = ?').get(novelId, entry.title);
							let newPhrases = entry.document_phrases || '';
							if (existingEntry && existingEntry.document_phrases) {
								const existingSet = new Set(existingEntry.document_phrases.split(',').map(p => p.trim()).filter(Boolean));
								const newSet = new Set(newPhrases.split(',').map(p => p.trim()).filter(Boolean));
								const combined = new Set([...existingSet, ...newSet]);
								newPhrases = Array.from(combined).join(', ');
							}
							
							db.prepare('UPDATE codex_entries SET content = ?, target_content = ?, document_phrases = ? WHERE novel_id = ? AND title = ?')
								.run(entry.content, entry.target_content || '', newPhrases, novelId, entry.title);
						}
					}
				});
				
				processResultsTransaction();
			}
			
			sendProgress(100, 'Codex generation complete! The page will now reload.', 'electron.codexGenComplete');
			
		} catch (error) {
			console.error('Codex auto-generation failed:', error);
			sendProgress(100, `An error occurred: ${error.message}`, 'electron.codexGenError', { message: error.message });
		}
	});
	
	ipcMain.handle('codex:getAllForNovel', (event, novelId) => {
		try {
			const categories = db.prepare('SELECT id, name FROM codex_categories WHERE novel_id = ? ORDER BY name ASC').all(novelId);
			categories.forEach(category => {
				category.entries = db.prepare('SELECT id, title, content, target_content, document_phrases FROM codex_entries WHERE codex_category_id = ? ORDER BY title ASC').all(category.id);
			});
			return categories;
		} catch (error) {
			console.error('Failed to get all codex entries for novel:', error);
			return [];
		}
	});
	
	ipcMain.handle('codex-categories:getAllForNovel', (event, novelId) => {
		try {
			return db.prepare('SELECT id, name FROM codex_categories WHERE novel_id = ? ORDER BY name ASC').all(novelId);
		} catch (error) {
			console.error('Failed to get categories for novel:', error);
			return [];
		}
	});
	
	ipcMain.handle('codex-entries:suggest-details', async (event, { novelId, text }) => {
		try {
			const categories = db.prepare('SELECT id, name FROM codex_categories WHERE novel_id = ? ORDER BY name').all(novelId);
			const categoryNames = categories.map(c => c.name);
			
			if (categoryNames.length === 0) {
				categoryNames.push('Characters', 'Locations', 'Items', 'Lore');
			}
			
			const model = config.OPEN_ROUTER_MODEL || 'openai/gpt-4o-mini';
			
			const novel = db.prepare('SELECT target_language FROM novels WHERE id = ?').get(novelId);
			const targetLanguage = novel ? novel.target_language : 'English';
			
			const token = sessionManager.getSession()?.token || null;
			const suggestion = await aiService.suggestCodexDetails({
				text,
				categories: categoryNames,
				targetLanguage: targetLanguage,
				model,
				token,
			});
			
			let categoryId = null;
			if (suggestion.category_name) {
				const matchedCategory = categories.find(c => c.name.toLowerCase() === suggestion.category_name.toLowerCase());
				if (matchedCategory) {
					categoryId = matchedCategory.id;
				}
			}
			
			return {
				success: true,
				title: suggestion.title || '',
				categoryId: categoryId,
			};
		} catch (error) {
			console.error('Failed to suggest codex details:', error);
			return { success: false, message: error.message };
		}
	});
	
	ipcMain.handle('codex-entries:store', async (event, novelId, formData) => {
		const { title, content, target_content, document_phrases, codex_category_id, new_category_name } = formData;
		let categoryId = codex_category_id;
		let newCategoryData = null;
		let entryId;
		
		try {
			const runSyncTransaction = db.transaction(() => {
				if (new_category_name) {
					const result = db.prepare('INSERT INTO codex_categories (novel_id, name) VALUES (?, ?)')
						.run(novelId, new_category_name);
					categoryId = result.lastInsertRowid;
					newCategoryData = { id: categoryId, name: new_category_name };
				}
				
				const entryResult = db.prepare('INSERT INTO codex_entries (novel_id, codex_category_id, title, content, target_content, document_phrases) VALUES (?, ?, ?, ?, ?, ?)')
					.run(novelId, categoryId, title, content, target_content, document_phrases);
				entryId = entryResult.lastInsertRowid;
			});
			
			runSyncTransaction();
			
			const newEntry = db.prepare('SELECT * FROM codex_entries WHERE id = ?')
				.get(entryId);
			
			return {
				success: true,
				message: 'Codex entry created successfully.',
				codexEntry: {
					id: newEntry.id,
					title: newEntry.title,
					category_id: newEntry.codex_category_id,
				},
				newCategory: newCategoryData,
			};
		} catch (error) {
			console.error("Error in 'codex-entries:store':", error);
			throw error;
		}
	});
	
	ipcMain.handle('codex-entries:update', (event, entryId, data) => {
		db.prepare('UPDATE codex_entries SET title = ?, content = ?, target_content = ?, document_phrases = ? WHERE id = ?')
			.run(data.title, data.content, data.target_content, data.document_phrases, entryId);
		return { success: true, message: 'Codex entry updated successfully.' };
	});
	
	ipcMain.handle('codex-entries:delete', (event, entryId) => {
		try {
			const result = db.prepare('DELETE FROM codex_entries WHERE id = ?').run(entryId);
			if (result.changes === 0) {
				return { success: false, message: 'Codex entry not found.' };
			}
			return { success: true, message: 'Codex entry deleted successfully.' };
		} catch (error) {
			console.error(`Failed to delete codex entry ${entryId}:`, error);
			throw new Error('Failed to delete the codex entry from the database.');
		}
	});
	
	ipcMain.on('codex-entries:openEditor', (event, entryId) => {
		windowManager.createCodexEditorWindow({ mode: 'edit', entryId });
	});
	
	ipcMain.on('codex-entries:openNewEditor', (event, { novelId, selectedText }) => {
		windowManager.createCodexEditorWindow({ mode: 'new', novelId, selectedText });
	});
	
	ipcMain.handle('codex-entries:getOneForEditor', (event, entryId) => {
		const entry = db.prepare(`
			SELECT
				ce.title,
				ce.content,
				ce.target_content,
				ce.document_phrases,
				ce.novel_id,
				n.title AS novel_title
			FROM codex_entries ce
			JOIN novels n ON ce.novel_id = n.id
			WHERE ce.id = ?
		`).get(entryId);
		
		if (!entry) {
			throw new Error('Codex entry not found for editor.');
		}
		
		return entry;
	});
}

module.exports = { registerCodexHandlers };
