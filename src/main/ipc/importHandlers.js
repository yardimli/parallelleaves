const { ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const mammoth = require('mammoth');
const aiService = require('../../ai/ai.js');
const imageHandler = require('../../utils/image-handler.js');

/**
 * Generates and saves a cover for a novel asynchronously.
 * @param {Database.Database} db - The database connection.
 * @param {number} novelId - The ID of the novel.
 * @param {string} title - The title of the novel.
 * @param {string|null} token - The user's session token.
 */
async function generateAndSaveCover(db, novelId, title, token) {
	try {
		const prompt = await aiService.generateCoverPrompt({ title, token });
		if (!prompt) throw new Error('Failed to generate cover prompt.');
		
		const falResponse = await aiService.generateCoverImageViaProxy({ prompt, token });
		if (!falResponse || !falResponse.images || !falResponse.images[0]?.url) {
			throw new Error('Image generation failed.');
		}
		
		const localPaths = await imageHandler.storeImageFromUrl(falResponse.images[0].url, novelId, 'cover-autogen');
		if (!localPaths || !localPaths.original_path) {
			throw new Error('Failed to save the generated cover.');
		}
		
		const userId = 1; // Assuming default user for now
		db.transaction(() => {
			db.prepare("DELETE FROM images WHERE novel_id = ? AND image_type LIKE '%cover%'").run(novelId);
			db.prepare(`
                INSERT INTO images (user_id, novel_id, image_local_path, thumbnail_local_path, image_type, prompt)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(userId, novelId, localPaths.original_path, localPaths.original_path, 'generated', prompt);
		})();
		
	} catch (error) {
		console.error(`Failed to auto-generate cover for novel ${novelId}:`, error);
	}
}

/**
 * Registers IPC handlers for document import functionality.
 * @param {Database.Database} db - The application's database connection.
 * @param {object} sessionManager - The session manager instance.
 * @param {object} windowManager - The window manager instance.
 */
function registerImportHandlers(db, sessionManager, windowManager) {
	ipcMain.on('app:open-import-window', () => {
		windowManager.createImportWindow();
	});
	
	ipcMain.handle('dialog:showOpenDocument', async () => {
		const { canceled, filePaths } = await dialog.showOpenDialog({
			properties: ['openFile'],
			filters: [
				{ name: 'Documents', extensions: ['txt', 'docx'] }
			]
		});
		return !canceled ? filePaths[0] : null;
	});
	
	ipcMain.handle('document:read', async (event, filePath) => {
		try {
			const extension = path.extname(filePath).toLowerCase();
			if (extension === '.txt') {
				return fs.readFileSync(filePath, 'utf8');
			} else if (extension === '.docx') {
				const result = await mammoth.extractRawText({ path: filePath });
				return result.value;
			} else {
				throw new Error('Unsupported file type.');
			}
		} catch (error) {
			console.error('Failed to read document:', error);
			throw error;
		}
	});
	
	// MODIFICATION START: The 'acts' parameter is replaced with a flat 'chapters' array.
	ipcMain.handle('document:import', async (event, { title, source_language, target_language, chapters }) => {
		if (!title || !source_language || !target_language || !chapters || chapters.length === 0) {
			// MODIFICATION END
			throw new Error('Invalid data provided for import.');
		}
		
		const userId = sessionManager.getSession()?.user.id || 1;
		let novelId;
		
		const importTransaction = db.transaction(() => {
			const novelResult = db.prepare(
				'INSERT INTO novels (user_id, title, source_language, target_language, status) VALUES (?, ?, ?, ?, ?)'
			).run(userId, title, source_language, target_language, 'draft');
			novelId = novelResult.lastInsertRowid;
			
			let chapterOrder = 1;
			for (const chapter of chapters) {
				db.prepare(
					'INSERT INTO chapters (novel_id, title, source_content, status, chapter_order) VALUES (?, ?, ?, ?, ?)'
				).run(novelId, chapter.title, chapter.content, 'in_progress', chapterOrder++);
			}
		});
		
		try {
			importTransaction();
			
			const importWindow = windowManager.getImportWindow();
			if (importWindow && !importWindow.isDestroyed()) {
				importWindow.webContents.send('import:status-update', { statusKey: 'import.generatingCover' });
			}
			
			const token = sessionManager.getSession()?.token || null;
			await generateAndSaveCover(db, novelId, title, token);
			
			if (importWindow) {
				importWindow.close();
			}
			windowManager.createChapterEditorWindow({ novelId, chapterId: null });
			
			return { success: true, novelId };
		} catch (error) {
			console.error('Failed to import document:', error);
			throw error;
		}
	});
}

module.exports = { registerImportHandlers };
