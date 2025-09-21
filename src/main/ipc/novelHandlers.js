const { ipcMain, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const HTMLtoDOCX = require('html-to-docx');
const imageHandler = require('../../utils/image-handler.js');
const { countWordsInHtml, htmlToPlainText } = require('../utils.js');
const { mapLanguageToIsoCode } = require('../../js/languages.js');

// NEW: Helper function to convert numbers to Roman numerals for default Act titles.
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
// MODIFICATION: Added sessionManager to the function signature.
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
	
	// NEW: Handler for creating a blank project with a default structure.
	ipcMain.handle('novels:createBlank', (event, { title, source_language, target_language }) => {
		try {
			// MODIFICATION START: Get user ID from session to satisfy the NOT NULL constraint.
			const session = sessionManager.getSession();
			if (!session || !session.user) {
				return { success: false, message: 'User not authenticated.' };
			}
			const userId = session.user.id;
			
			const novelResult = db.prepare(
				'INSERT INTO novels (user_id, title, author, source_language, target_language) VALUES (?, ?, ?, ?, ?)'
			).run(userId, title, '', source_language, target_language);
			// MODIFICATION END
			
			const novelId = novelResult.lastInsertRowid;
			
			const insertSection = db.prepare('INSERT INTO sections (novel_id, title, section_order) VALUES (?, ?, ?)');
			const insertChapter = db.prepare('INSERT INTO chapters (novel_id, section_id, title, chapter_order, source_content, target_content) VALUES (?, ?, ?, ?, ?, ?)');
			
			db.transaction(() => {
				for (let i = 1; i <= 3; i++) { // 3 Acts
					const sectionResult = insertSection.run(novelId, `Act ${toRoman(i)}`, i);
					const sectionId = sectionResult.lastInsertRowid;
					
					for (let j = 1; j <= 10; j++) { // 10 Chapters per Act
						insertChapter.run(novelId, sectionId, `Chapter ${j}`, j, '<p></p>', '<p></p>');
					}
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
		
		novel.sections = db.prepare('SELECT * FROM sections WHERE novel_id = ? ORDER BY section_order').all(novelId);
		novel.sections.forEach(section => {
			section.chapters = db.prepare('SELECT * FROM chapters WHERE section_id = ? ORDER BY `chapter_order`').all(section.id);
		});
		
		novel.codexCategories = db.prepare(`
            SELECT cc.*, COUNT(ce.id) as entries_count FROM codex_categories cc
            LEFT JOIN codex_entries ce ON ce.codex_category_id = cc.id
            WHERE cc.novel_id = ? GROUP BY cc.id ORDER BY cc.name
        `).all(novelId);
		
		novel.codexCategories.forEach(category => {
			category.entries = db.prepare(`
                SELECT * FROM codex_entries WHERE codex_category_id = ? ORDER BY title
            `).all(category.id);
		});
		return novel;
	});
	
	ipcMain.handle('novels:getForExport', (event, novelId) => {
		try {
			const novel = db.prepare('SELECT id, title, author, target_language FROM novels WHERE id = ?').get(novelId);
			if (!novel) throw new Error('Novel not found.');
			
			novel.sections = db.prepare('SELECT id, title FROM sections WHERE novel_id = ? ORDER BY section_order').all(novelId);
			for (const section of novel.sections) {
				section.chapters = db.prepare('SELECT id, title, target_content FROM chapters WHERE section_id = ? ORDER BY chapter_order').all(section.id);
			}
			
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
	
	ipcMain.handle('novels:getOutlineData', (event, novelId) => {
		try {
			const novel = db.prepare('SELECT title FROM novels WHERE id = ?').get(novelId);
			if (!novel) throw new Error('Novel not found');
			
			const sections = db.prepare('SELECT * FROM sections WHERE novel_id = ? ORDER BY section_order').all(novelId);
			for (const section of sections) {
				section.chapters = db.prepare('SELECT id, title, source_content, target_content, chapter_order FROM chapters WHERE section_id = ? ORDER BY chapter_order').all(section.id);
				
				section.total_word_count = section.chapters.reduce((sum, ch) => sum + countWordsInHtml(ch.target_content), 0);
				section.chapter_count = section.chapters.length;
				
				for (const chapter of section.chapters) {
					chapter.word_count = countWordsInHtml(chapter.target_content);
					const contentToUse = chapter.target_content || chapter.source_content;
					
					if (contentToUse) {
						const textContent = htmlToPlainText(contentToUse);
						
						const words = textContent.split(/\s+/);
						const wordLimitedText = words.slice(0, 200).join(' ');
						
						const sentences = textContent.match(/[^.!?]+[.!?]+/g) || [];
						const sentenceLimitedText = sentences.slice(0, 5).join(' ');
						
						let truncatedText;
						if (wordLimitedText.length > 0 && (sentenceLimitedText.length === 0 || wordLimitedText.length <= sentenceLimitedText.length)) {
							truncatedText = wordLimitedText;
							if (words.length > 200) truncatedText += '...';
						} else if (sentenceLimitedText.length > 0) {
							truncatedText = sentenceLimitedText;
							if (sentences.length > 5) truncatedText += '...';
						} else {
							truncatedText = textContent;
						}
						chapter.summary = `<p>${truncatedText}</p>`;
					} else {
						chapter.summary = `<p class="italic text-base-content/60" data-i18n="electron.noContent"></p>`;
					}
				}
			}
			
			const codexCategories = db.prepare('SELECT id, name FROM codex_categories WHERE novel_id = ? ORDER BY name').all(novelId);
			for (const category of codexCategories) {
				category.entries = db.prepare('SELECT id, title, content, target_content FROM codex_entries WHERE codex_category_id = ? ORDER BY title').all(category.id);
			}
			
			return {
				novel_title: novel.title,
				sections: sections,
				codex_categories: codexCategories
			};
		} catch (error) {
			console.error(`Error in getOutlineData for novelId ${novelId}:`, error);
			throw error;
		}
	});
	
	ipcMain.handle('novels:getOutlineState', (event, novelId) => {
		try {
			const chapterCount = db.prepare('SELECT COUNT(id) as count FROM chapters WHERE novel_id = ?').get(novelId).count;
			const codexCount = db.prepare('SELECT COUNT(id) as count FROM codex_entries WHERE novel_id = ?').get(novelId).count;
			return { success: true, chapterCount, codexCount };
		} catch (error) {
			console.error(`Failed to get outline state for novel ${novelId}:`, error);
			return { success: false, message: 'Failed to get outline state.' };
		}
	});
	
	ipcMain.handle('novels:getFullManuscript', (event, novelId) => {
		try {
			const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(novelId);
			if (!novel) return { id: novelId, title: 'Not Found', sections: [] };
			
			novel.sections = db.prepare('SELECT * FROM sections WHERE novel_id = ? ORDER BY section_order').all(novelId);
			for (const section of novel.sections) {
				section.chapters = db.prepare('SELECT id, title, source_content, target_content, chapter_order FROM chapters WHERE section_id = ? ORDER BY `chapter_order`').all(section.id);
				for (const chapter of section.chapters) {
					chapter.source_word_count = countWordsInHtml(chapter.source_content);
					chapter.target_word_count = countWordsInHtml(chapter.target_content);
				}
			}
			return novel;
		} catch (error) {
			console.error(`Error in getFullManuscript for novelId ${novelId}:`, error);
			return { id: novelId, title: 'Error Loading', sections: [] };
		}
	});
	
	ipcMain.handle('novels:getAllContent', (event, novelId) => {
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
	
	ipcMain.on('novels:openOutline', (event, novelId) => {
		windowManager.createOutlineWindow(novelId);
	});
	
	ipcMain.on('novels:openOutlineAndAutogenCodex', (event, novelId) => {
		windowManager.createOutlineWindow(novelId, true);
	});
}

module.exports = { registerNovelHandlers };
