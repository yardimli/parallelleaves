const { ipcMain } = require('electron');
const aiService = require('../../ai/ai.js');
const config = require('../../../config.js');

/**
 * Registers IPC handlers for AI-related functionality.
 * @param {Database.Database} db - The application's database connection.
 * @param {object} sessionManager - The session manager instance.
 */
function registerAiHandlers(db, sessionManager) {
	ipcMain.handle('llm:process-text', async (event, data) => {
		try {
			const token = sessionManager.getSession()?.token || null;
			const { prompt, model, temperature, response_format } = data;
			const result = await aiService.processLLMText({ prompt, model, temperature, response_format, token });
			return { success: true, data: result };
		} catch (error) {
			console.error('AI Processing Error in main process:', error);
			return { success: false, error: error.message };
		}
	});
	
	ipcMain.handle('ai:getModels', async () => {
		try {
			const token = sessionManager.getSession()?.token || null;
			const processedModels = await aiService.getOpenRouterModels(false, token);
			return { success: true, models: processedModels };
		} catch (error) {
			console.error('Failed to get or process AI models:', error);
			return { success: false, message: error.message };
		}
	});
	
	ipcMain.handle('ai:generate-cover-prompt', async (event, { novelTitle }) => {
		try {
			const token = sessionManager.getSession()?.token || null;
			const prompt = await aiService.generateCoverPrompt({ title: novelTitle, token });
			return { success: true, prompt };
		} catch (error) {
			console.error('Failed to generate cover prompt in main process:', error);
			return { success: false, message: error.message };
		}
	});
	
	ipcMain.handle('ai:generate-cover', async (event, { novelId, prompt }) => {
		try {
			const token = sessionManager.getSession()?.token || null;
			const falResponse = await aiService.generateCoverImageViaProxy({ prompt, token });
			
			if (!falResponse || !falResponse.images || !falResponse.images[0]?.url) {
				throw new Error('Image generation failed or did not return a valid URL.');
			}
			
			const imageUrl = falResponse.images[0].url;
			const imageHandler = require('../../utils/image-handler.js');
			const path = require('path');
			
			const localPaths = await imageHandler.storeImageFromUrl(imageUrl, novelId, 'generated-fal');
			
			if (!localPaths || !localPaths.original_path) {
				throw new Error('Failed to download and save the generated cover.');
			}
			
			const fullPath = path.join(imageHandler.IMAGES_DIR, localPaths.original_path);
			
			return { success: true, filePath: fullPath, localPath: localPaths.original_path };
		} catch (error) {
			console.error('Failed to generate cover image in main process:', error);
			return { success: false, message: error.message };
		}
	});
}

module.exports = { registerAiHandlers };
