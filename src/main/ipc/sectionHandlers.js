const { ipcMain } = require('electron');

/**
 * Registers IPC handlers for section (act) related functionality.
 * @param {Database.Database} db - The application's database connection.
 */
function registerSectionHandlers(db) {
	ipcMain.handle('sections:rename', (event, { sectionId, newTitle }) => {
		try {
			db.prepare('UPDATE sections SET title = ? WHERE id = ?').run(newTitle, sectionId);
			return { success: true };
		} catch (error) {
			console.error(`Failed to rename section ${sectionId}:`, error);
			return { success: false, message: error.message };
		}
	});
	
	ipcMain.handle('sections:delete', (event, { sectionId }) => {
		try {
			const section = db.prepare('SELECT novel_id, section_order FROM sections WHERE id = ?').get(sectionId);
			if (!section) throw new Error('Section not found.');
			
			db.transaction(() => {
				// Delete all chapters within the section first
				db.prepare('DELETE FROM chapters WHERE section_id = ?').run(sectionId);
				// Delete the section itself
				db.prepare('DELETE FROM sections WHERE id = ?').run(sectionId);
				// Re-order subsequent sections
				db.prepare('UPDATE sections SET section_order = section_order - 1 WHERE novel_id = ? AND section_order > ?')
					.run(section.novel_id, section.section_order);
			})();
			
			return { success: true };
		} catch (error) {
			console.error(`Failed to delete section ${sectionId}:`, error);
			return { success: false, message: error.message };
		}
	});
	
	ipcMain.handle('sections:insert', (event, { sectionId, direction }) => {
		try {
			const refSection = db.prepare('SELECT novel_id, section_order FROM sections WHERE id = ?').get(sectionId);
			if (!refSection) throw new Error('Reference section not found.');
			
			const newOrder = direction === 'above' ? refSection.section_order : refSection.section_order + 1;
			
			db.transaction(() => {
				// Shift existing sections
				db.prepare('UPDATE sections SET section_order = section_order + 1 WHERE novel_id = ? AND section_order >= ?')
					.run(refSection.novel_id, newOrder);
				
				// Insert the new section
				const newSectionResult = db.prepare('INSERT INTO sections (novel_id, title, section_order) VALUES (?, ?, ?)')
					.run(refSection.novel_id, 'New Act', newOrder);
				const newSectionId = newSectionResult.lastInsertRowid;
				
				// Add one default chapter to the new section
				db.prepare('INSERT INTO chapters (novel_id, section_id, title, chapter_order, source_content, target_content) VALUES (?, ?, ?, ?, ?, ?)')
					.run(refSection.novel_id, newSectionId, 'New Chapter', 1, '<p></p>', '<p></p>');
			})();
			
			return { success: true };
		} catch (error) {
			console.error(`Failed to insert section near ${sectionId}:`, error);
			return { success: false, message: error.message };
		}
	});
}

module.exports = { registerSectionHandlers };
