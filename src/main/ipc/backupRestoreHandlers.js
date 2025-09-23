const { ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const imageHandler = require('../../utils/image-handler.js');

/**
 * Registers IPC handlers for backup and restore functionality.
 * @param {Database.Database} db - The application's database connection.
 * @param {object} sessionManager - The session manager instance.
 */
function registerBackupRestoreHandlers(db, sessionManager) {
	ipcMain.handle('novels:getForBackup', (event, novelId) => {
		try {
			const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(novelId);
			if (!novel) {
				throw new Error('Novel not found.');
			}
			
			const sections = db.prepare('SELECT * FROM sections WHERE novel_id = ? ORDER BY section_order').all(novelId);
			const chapters = db.prepare('SELECT * FROM chapters WHERE novel_id = ? ORDER BY section_id, chapter_order').all(novelId);
			
			// Handle cover image backup
			let image = null;
			const imageRecord = db.prepare('SELECT image_local_path FROM images WHERE novel_id = ?').get(novelId);
			if (imageRecord && imageRecord.image_local_path) {
				const imagePath = path.join(imageHandler.IMAGES_DIR, imageRecord.image_local_path);
				if (fs.existsSync(imagePath)) {
					const imageData = fs.readFileSync(imagePath);
					image = {
						filename: path.basename(imageRecord.image_local_path),
						data: imageData.toString('base64')
					};
				}
			}
			
			return {
				novel,
				sections,
				chapters,
				image // Add image data to the backup object
			};
		} catch (error) {
			console.error(`Failed to get novel for backup (ID: ${novelId}):`, error);
			throw error; // Let the renderer process handle the error display.
		}
	});
	
	ipcMain.handle('novels:restoreFromBackup', (event, backupData) => {
		const restoreTransaction = db.transaction(() => {
			const {
				novel,
				sections = [],
				chapters = [],
				image
			} = backupData;
			
			// 1. Insert the novel, getting the new ID.
			const newNovelStmt = db.prepare(`
                INSERT INTO novels (user_id, series_id, title, author, genre, logline, synopsis, status, order_in_series, source_language, target_language, rephrase_settings, translate_settings)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
			const newNovelResult = newNovelStmt.run(
				sessionManager.getSession()?.user.id || 1,
				null, // series_id is not backed up/restored for simplicity
				`${novel.title} (Restored)`,
				novel.author,
				novel.genre,
				novel.logline,
				novel.synopsis,
				novel.status,
				novel.order_in_series,
				novel.source_language,
				novel.target_language,
				novel.rephrase_settings,
				novel.translate_settings
			);
			const newNovelId = newNovelResult.lastInsertRowid;
			
			// ID mapping tables
			const sectionIdMap = new Map();
			
			const newSectionStmt = db.prepare(`
                INSERT INTO sections (novel_id, title, description, section_order)
                VALUES (?, ?, ?, ?)
            `);
			const newChapterStmt = db.prepare(`
                INSERT INTO chapters (novel_id, section_id, title, source_content, target_content, status, chapter_order)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
			
			// 2. Insert sections
			for (const section of sections) {
				const oldSectionId = section.id;
				const newSectionResult = newSectionStmt.run(newNovelId, section.title, section.description, section.section_order);
				sectionIdMap.set(oldSectionId, newSectionResult.lastInsertRowid);
			}
			
			// 3. Insert chapters
			for (const chapter of chapters) {
				const newSectionId = sectionIdMap.get(chapter.section_id);
				if (newSectionId) {
					newChapterStmt.run(newNovelId, newSectionId, chapter.title, chapter.source_content, chapter.target_content, chapter.status, chapter.chapter_order);
				}
			}
			
			// 6. Restore cover image if it exists in the backup
			if (image && image.data && image.filename) {
				try {
					const imageBuffer = Buffer.from(image.data, 'base64');
					const fileExtension = path.extname(image.filename);
					const uniqueName = `${Date.now()}-${newNovelId}-restored${fileExtension}`;
					const savePath = path.join(imageHandler.IMAGES_DIR, uniqueName);
					fs.writeFileSync(savePath, imageBuffer);
					
					db.prepare(`
                        INSERT INTO images (user_id, novel_id, image_local_path, thumbnail_local_path, image_type)
                        VALUES (?, ?, ?, ?, ?)
                    `).run(sessionManager.getSession()?.user.id || 1, newNovelId, uniqueName, uniqueName, 'restored');
				} catch (e) {
					console.error('Failed to restore cover image:', e);
				}
			}
		});
		
		try {
			restoreTransaction();
			return { success: true };
		} catch (error) {
			console.error('Failed to restore novel from backup:', error);
			return { success: false, message: error.message };
		}
	});
	
	ipcMain.handle('dialog:saveBackup', async (event, defaultFileName, jsonString) => {
		const { canceled, filePath } = await dialog.showSaveDialog({
			title: 'Save Novel Backup',
			defaultPath: defaultFileName,
			filters: [{ name: 'JSON Files', extensions: ['json'] }]
		});
		
		if (!canceled && filePath) {
			try {
				fs.writeFileSync(filePath, jsonString);
				return { success: true };
			} catch (error) {
				console.error('Failed to save backup file:', error);
				return { success: false, message: error.message };
			}
		}
		return { success: false, message: 'Save cancelled by user.' };
	});
	
	ipcMain.handle('dialog:openBackup', async (event) => {
		const { canceled, filePaths } = await dialog.showOpenDialog({
			title: 'Open Novel Backup',
			properties: ['openFile'],
			filters: [{ name: 'JSON Files', extensions: ['json'] }]
		});
		
		if (!canceled && filePaths.length > 0) {
			try {
				return fs.readFileSync(filePaths[0], 'utf8');
			} catch (error) {
				console.error('Failed to read backup file:', error);
				throw error;
			}
		}
		return null; // User cancelled
	});
}

module.exports = { registerBackupRestoreHandlers };
