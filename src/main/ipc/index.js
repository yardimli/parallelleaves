const { registerAiHandlers } = require('./aiHandlers.js');
const { registerAuthHandlers } = require('./authHandlers.js');
const { registerBackupRestoreHandlers } = require('./backupRestoreHandlers.js');
const { registerChapterHandlers } = require('./chapterHandlers.js');
const { registerCodexHandlers } = require('./codexHandlers.js');
const { registerImportHandlers } = require('./importHandlers.js');
const { registerNovelHandlers } = require('./novelHandlers.js');
const { registerSystemHandlers } = require('./systemHandlers.js');

/**
 * Registers all IPC handlers for the application.
 * @param {Database.Database} db - The application's database connection.
 * @param {object} sessionManager - The session manager instance.
 * @param {object} windowManager - The window manager instance.
 */
function registerIpcHandlers(db, sessionManager, windowManager) {
	registerAiHandlers(db, sessionManager);
	registerAuthHandlers(sessionManager);
	registerBackupRestoreHandlers(db, sessionManager);
	registerChapterHandlers(db, windowManager);
	registerCodexHandlers(db, sessionManager, windowManager);
	registerImportHandlers(db, sessionManager, windowManager);
	registerNovelHandlers(db, windowManager);
	registerSystemHandlers(db, sessionManager);
}

module.exports = { registerIpcHandlers };
