const { ipcMain, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const HTMLtoDOCX = require('html-to-docx');
const imageHandler = require('../../utils/image-handler.js');
const { countWordsInHtml, htmlToPlainText } = require('../utils.js');
const { mapLanguageToIsoCode } = require('../../js/languages.js');
const { hasValidTranslationMemory, extractAllMarkerPairs } = require('./translationMemoryHandlers.js');

function toRoman(num) {
	const roman = { M: 1000, CM: 900, D: 500, CD: 400, C: 100, XC: 90, L: 50, XL: 40, X: 10, IX: 9, V: 5, IV: 4, I: 1 };
	let str = '';
	for (let i of Object.keys(roman)) {
		let q = Math.floor(num / roman[i]);
		num -= q * roman[i];
		str += i.repeat(q);
	}
	return str;
}

/**
 * Registers IPC handlers for novel-related functionality.
 * @param {Database.Database} db - The application's database connection.
 * @param {object} sessionManager - The session manager instance.
 * @param {object} windowManager - The window manager instance.
 */
function registerNovelHandlers(db, sessionManager, windowManager) {
	ipcMain.handle('novels:getAllWithCovers', (event) => {
		const stmt = db.prepare(`
            SELECT
                n.*,
                i.image_local_path as cover_path,
                (SELECT COUNT(id) FROM chapters WHERE novel_id = n.id) as chapter_count
            FROM novels n
            LEFT JOIN (
                SELECT novel_id, image_local_path, ROW_NUMBER() OVER(PARTITION BY novel_id ORDER BY created_at DESC) as rn
                FROM images
            ) i ON n.id = i.novel_id AND i.rn = 1
            ORDER BY n.updated_at DESC
        `);
		const novels = stmt.all();
		
		for (const novel of novels) {
			const chapters = db.prepare('SELECT source_content, target_content FROM chapters WHERE novel_id = ?').all(novel.id);
			
			novel.source_word_count = chapters.reduce((sum, ch) => sum + countWordsInHtml(ch.source_content), 0);
			novel.target_word_count = chapters.reduce((sum, ch) => sum + countWordsInHtml(ch.target_content), 0);
			
			if (novel.cover_path) {
				novel.cover_path = path.join(imageHandler.IMAGES_DIR, novel.cover_path);
			}
		}
		
		return novels;
	});
	
	ipcMain.handle('novels:getAllWithTranslationMemory', async (event) => {
		try {
			const allNovels = db.prepare('SELECT id, title FROM novels ORDER BY title ASC').all();
			const novelsWithTmResult = await hasValidTranslationMemory(sessionManager.getSession()?.token);
			
			if (!novelsWithTmResult.success) {
				console.error('Failed to get novels with TM from server:', novelsWithTmResult.message);
				return [];
			}
			
			const tmNovelIds = new Set(novelsWithTmResult.novelIds);
			return allNovels.filter(novel => tmNovelIds.has(novel.id));
		} catch (error) {
			console.error('Failed to get novels with translation memory:', error);
			return [];
		}
	});
	
	ipcMain.handle('novels:createBlank', (event, { title, source_language, target_language }) => {
		try {
			const session = sessionManager.getSession();
			if (!session || !session.user) {
				return { success: false, message: 'User not authenticated.' };
			}
			const userId = session.user.id;
			
			const novelResult = db.prepare(
				'INSERT INTO novels (user_id, title, author, source_language, target_language) VALUES (?, ?, ?, ?, ?)'
			).run(userId, title, '', source_language, target_language);
			
			const novelId = novelResult.lastInsertRowid;
			
			const insertChapter = db.prepare('INSERT INTO chapters (novel_id, title, chapter_order, source_content, target_content) VALUES (?, ?, ?, ?, ?)');
			
			db.transaction(() => {
				for (let j = 1; j <= 10; j++) { // 10 Chapters
					insertChapter.run(novelId, `Chapter ${j}`, j, '<p></p>', '<p></p>');
				}
			})();
			
			return { success: true, novelId };
		} catch (error) {
			console.error('Failed to create blank novel:', error);
			return { success: false, message: error.message };
		}
	});
	
	ipcMain.handle('novels:getOne', (event, novelId) => {
		const novel = db.prepare('SELECT id, title, source_language, target_language, rephrase_settings, translate_settings FROM novels WHERE id = ?').get(novelId);
		if (!novel) return null;
		
		novel.chapters = db.prepare('SELECT * FROM chapters WHERE novel_id = ? ORDER BY chapter_order').all(novelId);
		
		return novel;
	});
	
	ipcMain.handle('novels:getForExport', (event, novelId) => {
		try {
			const novel = db.prepare('SELECT id, title, author, target_language FROM novels WHERE id = ?').get(novelId);
			if (!novel) throw new Error('Novel not found.');
			
			novel.chapters = db.prepare('SELECT id, title, target_content FROM chapters WHERE novel_id = ? ORDER BY chapter_order').all(novelId);
			
			return { success: true, data: novel };
		} catch (error) {
			console.error(`Failed to get novel for export (ID: ${novelId}):`, error);
			return { success: false, message: error.message };
		}
	});
	
	ipcMain.handle('novels:exportToDocx', async (event, { title, htmlContent, targetLanguage, dialogStrings }) => {
		const defaultFileName = `${title.replace(/[^a-z0-9]/gi, '_')} - ${new Date().toISOString().split('T')[0]}.docx`;
		const { canceled, filePath } = await dialog.showSaveDialog({
			title: 'Export Novel as DOCX',
			defaultPath: defaultFileName,
			filters: [{ name: 'Word Document', extensions: ['docx'] }]
		});
		
		if (canceled || !filePath) {
			return { success: false, message: 'Export cancelled by user.' };
		}
		
		try {
			const langCode = mapLanguageToIsoCode(targetLanguage || 'English');
			
			const fileBuffer = await HTMLtoDOCX(htmlContent, null, {
				table: { row: { cantSplit: true } },
				footer: true,
				pageNumber: true,
				lang: langCode
			});
			
			fs.writeFileSync(filePath, fileBuffer);
			
			const { response } = await dialog.showMessageBox({
				type: 'info',
				title: dialogStrings.title,
				message: dialogStrings.message,
				detail: dialogStrings.detail.replace('{filePath}', filePath),
				buttons: [dialogStrings.openFolder, dialogStrings.ok],
				defaultId: 1
			});
			
			if (response === 0) {
				shell.showItemInFolder(filePath);
			}
			
			return { success: true, path: filePath };
		} catch (error) {
			console.error('Failed to convert HTML to DOCX:', error);
			return { success: false, message: error.message };
		}
	});
	
	ipcMain.handle('novels:updatePromptSettings', (event, { novelId, promptType, settings }) => {
		const allowedTypes = ['rephrase', 'translate'];
		if (!allowedTypes.includes(promptType)) {
			return { success: false, message: 'Invalid prompt type.' };
		}
		const settingsJson = JSON.stringify(settings);
		const fieldName = `${promptType}_settings`;
		
		try {
			db.prepare(`UPDATE novels SET ${fieldName} = ? WHERE id = ?`).run(settingsJson, novelId);
			return { success: true };
		} catch (error) {
			console.error(`Failed to update prompt settings for novel ${novelId}:`, error);
			throw new Error('Failed to update prompt settings.');
		}
	});
	
	ipcMain.handle('novels:getFullManuscript', (event, novelId) => {
		try {
			const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(novelId);
			if (!novel) return { id: novelId, title: 'Not Found', chapters: [] };
			
			novel.chapters = db.prepare('SELECT id, title, source_content, target_content, chapter_order FROM chapters WHERE novel_id = ? ORDER BY chapter_order').all(novelId);
			for (const chapter of novel.chapters) {
				chapter.source_word_count = countWordsInHtml(chapter.source_content);
				chapter.target_word_count = countWordsInHtml(chapter.target_content);
			}
			return novel;
		} catch (error) {
			console.error(`Error in getFullManuscript for novelId ${novelId}:`, error);
			return { id: novelId, title: 'Error Loading', chapters: [] };
		}
	});
	
	ipcMain.handle('novels:getAllNovelContent', (event, novelId) => {
		try {
			const chapters = db.prepare('SELECT source_content, target_content FROM chapters WHERE novel_id = ?').all(novelId);
			const combinedContent = chapters.map(c => (c.source_content || '') + (c.target_content || '')).join('');
			return { success: true, combinedHtml: combinedContent };
		} catch (error) {
			console.error(`Failed to get all content for novel ${novelId}:`, error);
			return { success: false, message: 'Failed to retrieve novel content.' };
		}
	});
	
	ipcMain.handle('novels:updateProseSettings', (event, { novelId, source_language, target_language }) => {
		try {
			db.prepare('UPDATE novels SET source_language = ?, target_language = ? WHERE id = ?').run(source_language, target_language, novelId);
			return { success: true };
		} catch (error) {
			console.error('Failed to update language settings:', error);
			throw new Error('Failed to update language settings.');
		}
	});
	
	ipcMain.handle('novels:updateMeta', (event, { novelId, title, author }) => {
		try {
			db.prepare('UPDATE novels SET title = ?, author = ? WHERE id = ?').run(title, author, novelId);
			return { success: true };
		} catch (error) {
			console.error('Failed to update novel meta:', error);
			throw new Error('Failed to update novel metadata.');
		}
	});
	
	ipcMain.handle('novels:updateNovelCover', async (event, { novelId, coverInfo }) => {
		let localPath;
		let imageType = 'unknown';
		
		if (coverInfo.type === 'remote') {
			localPath = await imageHandler.storeImageFromUrl(coverInfo.data, novelId, 'cover');
			imageType = 'generated';
		} else if (coverInfo.type === 'local') {
			const paths = await imageHandler.storeImageFromPath(coverInfo.data, novelId, null, 'cover-upload');
			localPath = paths.original_path;
			imageType = 'upload';
		}
		
		if (!localPath) {
			throw new Error('Failed to store the new cover image.');
		}
		
		db.transaction(() => {
			const oldImage = db.prepare('SELECT * FROM images WHERE novel_id = ?').get(novelId);
			if (oldImage && oldImage.image_local_path) {
				const oldFullPath = path.join(imageHandler.IMAGES_DIR, oldImage.image_local_path);
				if (fs.existsSync(oldFullPath)) fs.unlinkSync(oldFullPath);
			}
			db.prepare('DELETE FROM images WHERE novel_id = ?').run(novelId);
			
			db.prepare('INSERT INTO images (user_id, novel_id, image_local_path, thumbnail_local_path, image_type) VALUES (?, ?, ?, ?, ?)')
				.run(1, novelId, localPath, localPath, imageType);
		})();
		
		const absolutePath = path.join(imageHandler.IMAGES_DIR, localPath);
		BrowserWindow.getAllWindows().forEach(win => {
			win.webContents.send('novels:cover-updated', { novelId, imagePath: absolutePath });
		});
		
		return { success: true };
	});
	
	ipcMain.handle('novels:delete', (event, novelId) => {
		db.transaction(() => {
			const imagesToDelete = db.prepare('SELECT image_local_path, thumbnail_local_path FROM images WHERE novel_id = ?').all(novelId);
			
			for (const image of imagesToDelete) {
				if (image.image_local_path) {
					const fullPath = path.join(imageHandler.IMAGES_DIR, image.image_local_path);
					if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
				}
				if (image.thumbnail_local_path) {
					const thumbPath = path.join(imageHandler.IMAGES_DIR, image.thumbnail_local_path);
					if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
				}
			}
			
			db.prepare('DELETE FROM novels WHERE id = ?').run(novelId);
		})();
		
		return { success: true };
	});
	
	ipcMain.on('novels:openEditor', (event, novelId) => {
		windowManager.createChapterEditorWindow({ novelId, chapterId: null });
	});
	
}

module.exports = { registerNovelHandlers };
