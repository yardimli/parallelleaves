const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { htmlToPlainText } = require('../utils.js');
const aiService = require('../../ai/ai.js');

const CODEX_DIR = path.join(app.getPath('userData'), 'codex');
let isCodexGenCancelled = false;

/**
 * Ensures the codex directory exists.
 */
function ensureCodexDir() {
	if (!fs.existsSync(CODEX_DIR)) {
		fs.mkdirSync(CODEX_DIR, { recursive: true });
	}
}

/**
 * Helper function to escape special characters for use in a RegExp.
 * @param {string} string - The string to escape.
 * @returns {string} The escaped string.
 */
function escapeRegex(string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parses an HTML string to extract codex entries.
 * @param {string} html - The HTML containing entries.
 * @returns {Array<{title: string, html: string}>} An array of entry objects.
 */
function parseEntriesFromHtml(html) {
	const entries = [];
	// This regex captures the h3 title and the full entry block (h3 + p).
	const entryRegex = /(<h3>([\s\S]*?)<\/h3>[\s\S]*?<p>[\s\S]*?<\/p>)/g;
	let match;
	while ((match = entryRegex.exec(html)) !== null) {
		entries.push({
			title: match[2].trim(), // The title is in the second capture group
			html: match[1] // The full HTML block is in the first capture group
		});
	}
	return entries;
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
	
	ipcMain.on('autogen:stop-codex-generation', () => {
		isCodexGenCancelled = true;
	});
	
	ipcMain.on('autogen:start-codex-generation', async (event, { novelId, model }) => {
		isCodexGenCancelled = false; // Reset cancellation flag at the start.
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
				if (!sender.isDestroyed()) sender.send('autogen:process-finished', { status: 'complete' });
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
				if (!sender.isDestroyed()) sender.send('autogen:process-finished', { status: 'complete' });
				return;
			}
			
			sendProgress(5, `Found ${words.length.toLocaleString()} words, split into ${chunks.length} chunks.`);
			
			const codexFilePath = path.join(CODEX_DIR, `codex-${novelId}.html`);
			
			const novel = db.prepare('SELECT source_language, target_language FROM novels WHERE id = ?').get(novelId);
			const sourceLanguage = novel ? novel.source_language : 'English';
			const targetLanguage = novel ? novel.target_language : 'English';
			
			for (let i = 0; i < chunks.length; i++) {
				if (isCodexGenCancelled) {
					sendProgress(100, 'Process cancelled by user.');
					if (!sender.isDestroyed()) sender.send('autogen:process-finished', { status: 'cancelled' });
					return;
				}
				
				const chunk = chunks[i];
				const progress = 5 + Math.round((i / chunks.length) * 90);
				sendProgress(progress, `Analyzing chunk ${i + 1} of ${chunks.length}...`);
				
				let currentCodexContent = '';
				if (fs.existsSync(codexFilePath)) {
					currentCodexContent = fs.readFileSync(codexFilePath, 'utf8');
				}
				
				const token = sessionManager.getSession()?.token || null;
				const resultHtml = await aiService.generateCodexFromTextChunk({
					textChunk: chunk,
					existingCodexHtml: currentCodexContent,
					sourceLanguage: sourceLanguage,
					targetLanguage: targetLanguage,
					model,
					token,
				});
				
				if (resultHtml && resultHtml.trim() !== '') {
					const newEntries = parseEntriesFromHtml(resultHtml);
					
					for (const entry of newEntries) {
						const entryRegex = new RegExp(`(<h3>${escapeRegex(entry.title)}</h3>[\\s\\S]*?<p>[\\s\\S]*?</p>)`, 'i');
						
						if (entryRegex.test(currentCodexContent)) {
							// Entry exists, replace it.
							currentCodexContent = currentCodexContent.replace(entryRegex, entry.html);
						} else {
							// Entry is new, append it.
							currentCodexContent += `\n${entry.html}`;
						}
					}
					// Save the updated content back to the file after processing the chunk's results.
					fs.writeFileSync(codexFilePath, currentCodexContent, 'utf8');
				}
			}
			
			sendProgress(100, 'Codex generation complete!', 'electron.codexGenComplete');
			if (!sender.isDestroyed()) sender.send('autogen:process-finished', { status: 'complete' });
			
		} catch (error) {
			console.error('Codex auto-generation failed:', error);
			sendProgress(100, `An error occurred: ${error.message}`, 'electron.codexGenError', { message: error.message });
			if (!sender.isDestroyed()) sender.send('autogen:process-finished', { status: 'error', message: error.message });
		}
	});
}

module.exports = { registerCodexHandlers };
