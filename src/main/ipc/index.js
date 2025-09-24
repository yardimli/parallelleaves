const { registerAiHandlers } = require('./aiHandlers.js');
const { registerAuthHandlers } = require('./authHandlers.js');
const { registerBackupRestoreHandlers } = require('./backupRestoreHandlers.js');
const { registerChapterHandlers } = require('./chapterHandlers.js');
const { registerChatHandlers } = require('./chatHandlers.js');
const { registerCodexHandlers } = require('./codexHandlers.js');
const { registerImportHandlers } = require('./importHandlers.js');
const { registerNovelHandlers } = require('./novelHandlers.js');
const { registerSectionHandlers } = require('./sectionHandlers.js');
const { registerSystemHandlers } = require('./systemHandlers.js');
const { registerDictionaryHandlers } = require('./dictionaryHandlers.js');
const { registerLoggingHandlers } = require('./loggingHandlers.js'); // New

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
	registerChatHandlers(db, sessionManager);
	registerCodexHandlers(db, sessionManager);
	registerImportHandlers(db, sessionManager, windowManager);
	registerNovelHandlers(db, sessionManager, windowManager);
	registerSectionHandlers(db);
	registerSystemHandlers(db, sessionManager, windowManager);
	registerDictionaryHandlers();
	registerLoggingHandlers(db, sessionManager); // New
}

module.exports = { registerIpcHandlers };
