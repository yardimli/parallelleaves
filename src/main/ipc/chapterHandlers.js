const { ipcMain } = require('electron');
const { htmlToPlainText } = require('../utils.js');

/**
 * Extracts translation pairs from source and target HTML based on markers.
 * @param {string} sourceHtml - The source HTML content.
 * @param {string} targetHtml - The target HTML content.
 * @param {string|null} [selectedText=null] - Text selected for translation, used to truncate the last source segment.
 * @returns {Array<object>} An array of {source, target} text pairs.
 */
const extractMarkerPairsFromHtml = (sourceHtml, targetHtml, selectedText = null) => {
	if (!sourceHtml || !targetHtml) {
		return [];
	}
	
	const getSegments = (html) => {
		const segments = [];
		const parts = html.split(/(\[\[#\d+\]\])/g);
		for (let i = 1; i < parts.length; i += 2) {
			const marker = parts[i];
			const content = parts[i + 1] || '';
			const match = marker.match(/\[\[#(\d+)\]\]/);
			if (match) {
				const number = parseInt(match[1], 10);
				// Remove any closing markers from the content segment before processing.
				// This ensures that `{{#...}}` tags don't get included in the context pairs.
				const contentWithoutClosingMarkers = content.replace(/\{\{#\d+\}\}/g, '');
				const plainText = htmlToPlainText(contentWithoutClosingMarkers);
				
				if (plainText) {
					segments.push({ number, text: plainText, isLastSegment: i === parts.length - 2 });
				}
			}
		}
		return segments;
	};
	
	const sourceSegmentsArray = getSegments(sourceHtml);
	const targetSegmentsArray = getSegments(targetHtml);
	
	if (selectedText && sourceSegmentsArray.length > 0) {
		const lastSourceSegment = sourceSegmentsArray[sourceSegmentsArray.length - 1];
		if (lastSourceSegment.isLastSegment) {
			const selectionIndex = lastSourceSegment.text.indexOf(selectedText.trim());
			if (selectionIndex !== -1) {
				lastSourceSegment.text = lastSourceSegment.text.substring(0, selectionIndex).trim();
				if (!lastSourceSegment.text) {
					sourceSegmentsArray.pop();
				}
			}
		}
	}
	
	const sourceSegmentsMap = new Map(sourceSegmentsArray.map(s => [s.number, s.text]));
	const pairs = [];
	for (const targetSegment of targetSegmentsArray) {
		if (sourceSegmentsMap.has(targetSegment.number)) {
			pairs.push({
				source: sourceSegmentsMap.get(targetSegment.number),
				target: targetSegment.text,
			});
		}
	}
	return pairs;
};

/**
 * Registers IPC handlers for chapter-related functionality.
 * @param {Database.Database} db - The application's database connection.
 * @param {object} windowManager - The window manager instance.
 */
function registerChapterHandlers(db, windowManager) {
	ipcMain.on('chapters:openEditor', (event, { novelId, chapterId }) => {
		windowManager.createChapterEditorWindow({ novelId, chapterId });
	});
	
	ipcMain.handle('chapters:updateField', (event, { chapterId, field, value }) => {
		const allowedFields = ['title', 'target_content', 'source_content'];
		if (!allowedFields.includes(field)) {
			return { success: false, message: 'Invalid field specified.' };
		}
		try {
			db.prepare(`UPDATE chapters SET ${field} = ? WHERE id = ?`).run(value, chapterId);
			return { success: true };
		} catch (error) {
			console.error(`Failed to update ${field} for chapter ${chapterId}:`, error);
			return { success: false, message: `Failed to save ${field}.` };
		}
	});
	
	ipcMain.handle('chapters:getRawContent', (event, { chapterId, field }) => {
		const allowedFields = ['source_content', 'target_content'];
		if (!allowedFields.includes(field)) {
			throw new Error('Invalid field specified.');
		}
		try {
			const result = db.prepare(`SELECT ${field} FROM chapters WHERE id = ?`).get(chapterId);
			return result ? result[field] : null;
		} catch (error) {
			console.error(`Failed to get raw content for chapter ${chapterId}:`, error);
			throw new Error('Database error while fetching chapter content.');
		}
	});
	
	ipcMain.handle('chapters:getTranslationContext', (event, { chapterId, pairCount, selectedText }) => {
		if (pairCount <= 0) {
			return [];
		}
		
		try {
			const currentChapter = db.prepare('SELECT novel_id, chapter_order, source_content, target_content FROM chapters WHERE id = ?').get(chapterId);
			if (!currentChapter) {
				throw new Error('Current chapter not found.');
			}
			
			const currentChapterPairs = extractMarkerPairsFromHtml(currentChapter.source_content, currentChapter.target_content, selectedText);
			
			if (currentChapterPairs.length >= pairCount) {
				return currentChapterPairs.slice(-pairCount);
			}
			
			const neededPairs = pairCount - currentChapterPairs.length;
			
			const previousChapter = db.prepare(`
	            SELECT source_content, target_content
	            FROM chapters
	            WHERE novel_id = ? AND chapter_order < ?
	            ORDER BY chapter_order DESC
	            LIMIT 1
	        `).get(currentChapter.novel_id, currentChapter.chapter_order);
			
			if (!previousChapter) {
				return currentChapterPairs;
			}
			
			const previousChapterPairs = extractMarkerPairsFromHtml(previousChapter.source_content, previousChapter.target_content);
			const lastPairsFromPrevious = previousChapterPairs.slice(-neededPairs);
			
			return [...lastPairsFromPrevious, ...currentChapterPairs];
			
		} catch (error) {
			console.error(`Failed to get translation context for chapter ${chapterId}:`, error);
			throw new Error('Failed to retrieve translation context from the database.');
		}
	});
	
	ipcMain.handle('chapters:rename', (event, { chapterId, newTitle }) => {
		try {
			db.prepare('UPDATE chapters SET title = ? WHERE id = ?').run(newTitle, chapterId);
			return { success: true };
		} catch (error) {
			console.error(`Failed to rename chapter ${chapterId}:`, error);
			return { success: false, message: error.message };
		}
	});
	
	ipcMain.handle('chapters:delete', (event, { chapterId }) => {
		try {
			const chapter = db.prepare('SELECT section_id, chapter_order FROM chapters WHERE id = ?').get(chapterId);
			if (!chapter) throw new Error('Chapter not found.');
			
			db.transaction(() => {
				db.prepare('DELETE FROM chapters WHERE id = ?').run(chapterId);
				db.prepare('UPDATE chapters SET chapter_order = chapter_order - 1 WHERE section_id = ? AND chapter_order > ?')
					.run(chapter.section_id, chapter.chapter_order);
			})();
			
			return { success: true };
		} catch (error) {
			console.error(`Failed to delete chapter ${chapterId}:`, error);
			return { success: false, message: error.message };
		}
	});
	
	ipcMain.handle('chapters:insert', (event, { chapterId, direction }) => {
		try {
			const refChapter = db.prepare('SELECT novel_id, section_id, chapter_order FROM chapters WHERE id = ?').get(chapterId);
			if (!refChapter) throw new Error('Reference chapter not found.');
			
			const newOrder = direction === 'above' ? refChapter.chapter_order : refChapter.chapter_order + 1;
			
			db.transaction(() => {
				db.prepare('UPDATE chapters SET chapter_order = chapter_order + 1 WHERE section_id = ? AND chapter_order >= ?')
					.run(refChapter.section_id, newOrder);
				
				db.prepare('INSERT INTO chapters (novel_id, section_id, title, chapter_order, source_content, target_content) VALUES (?, ?, ?, ?, ?, ?)')
					.run(refChapter.novel_id, refChapter.section_id, 'New Chapter', newOrder, '<p></p>', '<p></p>');
			})();
			
			return { success: true };
		} catch (error) {
			console.error(`Failed to insert chapter near ${chapterId}:`, error);
			return { success: false, message: error.message };
		}
	});
}

module.exports = { registerChapterHandlers };
