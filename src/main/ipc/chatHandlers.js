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
			
			// Find the first system message if it exists (for chapter context)
			let systemMessageContent = 'You are a helpful assistant for a writer.';
			const systemMessages = messages.filter(msg => msg.role === 'system');
			if (systemMessages.length > 0) {
				// Concatenate all system messages, with the custom one first if it exists
				systemMessageContent = systemMessages.map(msg => msg.content).join('\n\n');
			}
			
			// The last message is the current user prompt. Filter out any system messages
			const userMessages = messages.filter(msg => msg.role === 'user' || msg.role === 'assistant');
			const userPrompt = userMessages[userMessages.length - 1]; // The actual user message
			const contextPairs = userMessages.slice(0, -1); // Previous user/assistant messages for context
			
			if (!userPrompt) {
				throw new Error('No user message found in chat input.');
			}
			
			const prompt = {
				system: systemMessageContent,
				context_pairs: contextPairs,
				user: userPrompt.content
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
