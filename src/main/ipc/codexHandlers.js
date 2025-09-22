const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { htmlToPlainText } = require('../utils.js');
const aiService = require('../../ai/ai.js');

const CODEX_DIR = path.join(app.getPath('userData'), 'codex');

/**
 * Ensures the codex directory exists.
 */
function ensureCodexDir() {
	if (!fs.existsSync(CODEX_DIR)) {
		fs.mkdirSync(CODEX_DIR, { recursive: true });
	}
}

/**
 * Registers IPC handlers for the simplified file-based Codex functionality.
 * @param {Database.Database} db - The application's database connection.
 * @param {object} sessionManager - The session manager instance.
 */
function registerCodexHandlers(db, sessionManager) {
	ipcMain.handle('codex:get', (event, novelId) => {
		ensureCodexDir();
		const filePath = path.join(CODEX_DIR, `codex-${novelId}.html`);
		try {
			if (fs.existsSync(filePath)) {
				return fs.readFileSync(filePath, 'utf8');
			}
			return '<p></p>'; // Return empty paragraph for a new codex file
		} catch (error) {
			console.error(`Failed to read codex for novel ${novelId}:`, error);
			throw new Error('Could not load codex file.');
		}
	});
	
	ipcMain.handle('codex:save', (event, { novelId, htmlContent }) => {
		ensureCodexDir();
		const filePath = path.join(CODEX_DIR, `codex-${novelId}.html`);
		try {
			fs.writeFileSync(filePath, htmlContent, 'utf8');
			return { success: true };
		} catch (error) {
			console.error(`Failed to save codex for novel ${novelId}:`, error);
			throw new Error('Could not save codex file.');
		}
	});
	
	ipcMain.on('autogen:start-codex-generation', async (event, { novelId, model }) => {
		const sender = event.sender;
		const sendProgress = (progress, status, statusKey = null, statusParams = {}) => {
			if (!sender.isDestroyed()) {
				sender.send('autogen:progress-update', { progress, status, statusKey, statusParams });
			}
		};
		
		try {
			sendProgress(0, 'Fetching novel content...');
			
			const chapters = db.prepare('SELECT source_content FROM chapters WHERE novel_id = ? AND source_content IS NOT NULL').all(novelId);
			if (chapters.length === 0) {
				sendProgress(100, 'No source content found to analyze.', 'electron.codexGenNoSource');
				return;
			}
			
			const fullText = chapters.map(c => c.source_content).join('\n');
			const cleanedText = htmlToPlainText(fullText);
			
			const words = cleanedText.split(/\s+/);
			const chunkSize = 10000;
			const chunks = [];
			for (let i = 0; i < words.length; i += chunkSize) {
				chunks.push(words.slice(i, i + chunkSize).join(' '));
			}
			
			if (chunks.length === 0) {
				sendProgress(100, 'No text found after cleaning.', 'electron.codexGenNoText');
				return;
			}
			
			sendProgress(5, `Found ${words.length.toLocaleString()} words, split into ${chunks.length} chunks.`);
			
			const codexFilePath = path.join(CODEX_DIR, `codex-${novelId}.html`);
			let existingCodexHtml = '';
			if (fs.existsSync(codexFilePath)) {
				existingCodexHtml = fs.readFileSync(codexFilePath, 'utf8');
			}
			
			const novel = db.prepare('SELECT source_language FROM novels WHERE id = ?').get(novelId);
			const language = novel ? novel.source_language : 'English';
			
			let appendedContent = '';
			
			for (let i = 0; i < chunks.length; i++) {
				const chunk = chunks[i];
				const progress = 5 + Math.round((i / chunks.length) * 90);
				sendProgress(progress, `Analyzing chunk ${i + 1} of ${chunks.length}...`);
				
				const token = sessionManager.getSession()?.token || null;
				const resultHtml = await aiService.generateCodexFromTextChunk({
					textChunk: chunk,
					existingCodexHtml: existingCodexHtml + appendedContent, // Include newly generated content for context
					language,
					model,
					token,
				});
				
				if (resultHtml && resultHtml.trim() !== '') {
					appendedContent += `\n<hr>\n<h2>From Chunk ${i + 1}</h2>\n` + resultHtml;
				}
			}
			
			if (appendedContent.trim() !== '') {
				fs.appendFileSync(codexFilePath, appendedContent, 'utf8');
			}
			
			sendProgress(100, 'Codex generation complete! The page will now reload.', 'electron.codexGenComplete');
			
		} catch (error) {
			console.error('Codex auto-generation failed:', error);
			sendProgress(100, `An error occurred: ${error.message}`, 'electron.codexGenError', { message: error.message });
		}
	});
}

module.exports = { registerCodexHandlers };
