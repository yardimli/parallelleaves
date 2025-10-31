const { ipcMain, dialog, app } = require('electron');
const path = require('path');
const fs = require('fs');
const imageHandler = require('../../utils/image-handler.js');
const { getNovelBackupData } = require('../autoBackupManager.js');

const DICTIONARIES_DIR = path.join(app.getPath('userData'), 'dictionaries');

/**
 * Ensures a directory exists.
 * @param {string} dirPath - The path to the directory.
 */
function ensureDir(dirPath) {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
	}
}

/**
 * Registers IPC handlers for backup and restore functionality.
 * @param {Database.Database} db - The application's database connection.
 * @param {object} sessionManager - The session manager instance.
 */
function registerBackupRestoreHandlers(db, sessionManager) {
	ipcMain.handle('novels:getForBackup', (event, novelId) => {
		try {
			// Pass the database connection to the shared function.
			return getNovelBackupData(db, novelId);
		} catch (error) {
			console.error(`Failed to get novel for backup (ID: ${novelId}):`, error);
			throw error; // Let the renderer process handle the error display.
		}
	});
	
	ipcMain.handle('novels:restoreFromBackup', (event, backupData) => {
		const restoreTransaction = db.transaction(() => {
			const {
				novel,
				chapters = [],
				image,
				dictionaryJson
			} = backupData;
			
			// 1. Insert the novel, getting the new ID.
			const newNovelStmt = db.prepare(`
                INSERT INTO novels (user_id, title, author,  status, source_language, target_language, rephrase_settings, translate_settings)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
			const newNovelResult = newNovelStmt.run(
				sessionManager.getSession()?.user.id || 1,
				`${novel.title} (Restored)`,
				novel.author,
				novel.status,
				novel.source_language,
				novel.target_language,
				novel.rephrase_settings,
				novel.translate_settings
			);
			const newNovelId = newNovelResult.lastInsertRowid;
			
			const newChapterStmt = db.prepare(`
                INSERT INTO chapters (novel_id, title, source_content, target_content, status, chapter_order)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
			
			// 3. Insert chapters directly.
			for (const chapter of chapters) {
				newChapterStmt.run(newNovelId, chapter.title, chapter.source_content, chapter.target_content, chapter.status, chapter.chapter_order);
			}
			
			// 6. Restore cover image if it exists in the backup
			if (image && image.data && image.filename) {
				try {
					ensureDir(imageHandler.IMAGES_DIR);
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
			
			if (dictionaryJson) {
				try {
					ensureDir(DICTIONARIES_DIR);
					const dictionaryPath = path.join(DICTIONARIES_DIR, `${newNovelId}.json`);
					fs.writeFileSync(dictionaryPath, dictionaryJson, 'utf8');
				} catch (e) {
					console.error('Failed to restore dictionary file:', e);
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
