const { ipcMain } = require('electron');
const aiService = require('../../ai/ai.js');

/**
 * Registers IPC handlers for AI chat functionality.
 * @param {Database.Database} db - The application's database connection.
 * @param {object} sessionManager - The session manager instance.
 */
function registerChatHandlers(db, sessionManager) {
	ipcMain.handle('chat:send-message', async (event, data) => {
		try {
			const token = sessionManager.getSession()?.token || null;
			const { model, messages } = data; // messages is an array of {role, content}
			
			// The last message is the current user prompt. The rest is context.
			const userMessage = messages[messages.length - 1];
			const contextMessages = messages.slice(0, -1);
			
			const prompt = {
				system: 'You are a helpful assistant for a writer.',
				context_pairs: contextMessages,
				user: userMessage.content
			};
			
			const result = await aiService.processLLMText({ prompt, model, token });
			return { success: true, data: result };
		} catch (error) {
			console.error('AI Chat Error in main process:', error);
			return { success: false, error: error.message };
		}
	});
}

module.exports = { registerChatHandlers };
