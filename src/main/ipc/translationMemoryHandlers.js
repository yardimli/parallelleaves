const { ipcMain, app } = require('electron');
const aiService = require('../../ai/ai.js');
const { htmlToPlainText } = require('../utils.js');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { AI_PROXY_URL } = require('../../../config.js');

/**
 * A generic function to call the translation memory API endpoints.
 * @param {string} action - The specific API action to call (e.g., 'tm_sync_blocks').
 * @param {object} payload - The data to send in the request body.
 * @param {string|null} token - The user's session token.
 * @returns {Promise<any>} The JSON response from the API.
 */
async function callTmApi(action, payload, token) {
	if (!AI_PROXY_URL) {
		throw new Error('AI Proxy URL is not configured.');
	}
	
	const fullPayload = { ...payload, auth_token: token };
	
	const response = await fetch(`${AI_PROXY_URL}?action=${action}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(fullPayload),
	});
	
	const responseText = await response.text();
	if (!response.ok) {
		let errorMessage = `Server error: ${response.status}`;
		try {
			const errorJson = JSON.parse(responseText);
			errorMessage = errorJson.error?.message || responseText;
		} catch (e) {
			// Ignore if response is not JSON
		}
		throw new Error(errorMessage);
	}
	
	try {
		return JSON.parse(responseText);
	} catch (e) {
		throw new Error('Invalid JSON response from server.');
	}
}

/**
 * Extracts translation pairs from source and target HTML based on markers.
 * @param {string} sourceHtml - The source HTML content.
 * @param {string} targetHtml - The target HTML content.
 * @returns {Array<object>} An array of {marker, source, target} text pairs.
 */
const extractAllMarkerPairs = (sourceHtml, targetHtml) => {
	if (!sourceHtml || !targetHtml) {
		return [];
	}
	
	const getSegments = (html) => {
		const segments = [];
		const openingMarkerRegex = /\[\[#(\d+)\]\]/g;
		let match;
		
		while ((match = openingMarkerRegex.exec(html)) !== null) {
			const number = parseInt(match[1], 10);
			const openMarkerEndIndex = match.index + match[0].length;
			
			const closingMarkerRegex = new RegExp(`\\{\\{#${number}\\}\\}`);
			const restOfString = html.substring(openMarkerEndIndex);
			const closeMatch = restOfString.match(closingMarkerRegex);
			
			if (closeMatch) {
				const contentEndIndex = openMarkerEndIndex + closeMatch.index;
				const contentHtml = html.substring(openMarkerEndIndex, contentEndIndex);
				const contentWithoutInnerMarkers = contentHtml.replace(/(\[\[#\d+\]\])|(\{\{#\d+\}\})/g, '');
				const plainText = htmlToPlainText(contentWithoutInnerMarkers).trim();
				
				if (plainText) {
					segments.push({ number, text: plainText });
				}
			}
		}
		return segments;
	};
	
	const sourceSegments = getSegments(sourceHtml);
	const targetSegments = getSegments(targetHtml);
	
	const sourceMap = new Map(sourceSegments.map(s => [s.number, s.text]));
	const pairs = [];
	
	for (const targetSegment of targetSegments) {
		if (sourceMap.has(targetSegment.number)) {
			pairs.push({
				marker: targetSegment.number,
				source: sourceMap.get(targetSegment.number),
				target: targetSegment.text
			});
		}
	}
	
	return pairs.sort((a, b) => a.marker - b.marker);
};

/**
 * Checks the server to see which novels have a translation memory.
 * @param {string|null} token The user's auth token.
 * @returns {Promise<{success: boolean, novelIds?: number[], message?: string}>}
 */
async function hasValidTranslationMemory(token) {
	try {
		const result = await callTmApi('tm_get_all_with_memory', {}, token);
		return { success: true, novelIds: result.novel_ids || [] };
	} catch (error) {
		return { success: false, message: error.message };
	}
}

/**
 * Registers IPC handlers for the translation memory window functionality.
 * @param {Database.Database} db - The application's database connection.
 * @param {object} sessionManager - The session manager instance.
 * @param {object} windowManager - The window manager instance.
 */
function registerTranslationMemoryHandlers(db, sessionManager, windowManager) {
	// MODIFICATION: New handler for background generation
	ipcMain.handle('translation-memory:generate-in-background', async (event, novelId) => {
		const editorWindow = event.sender.getOwnerBrowserWindow();
		const token = sessionManager.getSession()?.token || null;
		
		try {
			// Step 1: Sync local novel content with the server.
			editorWindow.webContents.send('translation-memory:progress-update', { message: 'Syncing novel content...' });
			const novel = db.prepare('SELECT source_language, target_language FROM novels WHERE id = ?').get(novelId);
			if (!novel) throw new Error('Novel not found locally.');
			
			const chapters = db.prepare('SELECT source_content, target_content FROM chapters WHERE novel_id = ?').all(novelId);
			const combinedSource = chapters.map(c => c.source_content || '').join('');
			const combinedTarget = chapters.map(c => c.target_content || '').join('');
			const allPairs = extractAllMarkerPairs(combinedSource, combinedTarget);
			
			await callTmApi('tm_sync_blocks', {
				novel_id: novelId,
				source_language: novel.source_language,
				target_language: novel.target_language,
				pairs: allPairs
			}, token);
			
			// Step 2: Request the full background generation process from the server.
			editorWindow.webContents.send('translation-memory:progress-update', { message: 'Starting generation process...' });
			const result = await callTmApi('tm_run_full_generation', { novel_id: novelId }, token);
			
			// Step 3: Report completion to the renderer.
			editorWindow.webContents.send('translation-memory:progress-update', {
				message: 'Generation complete!',
				finished: true,
				processedCount: result.processed_count || 0
			});
			
			return { success: true, processedCount: result.processed_count };
			
		} catch (error) {
			console.error('Background translation memory generation failed:', error);
			editorWindow.webContents.send('translation-memory:progress-update', {
				message: error.message,
				error: true
			});
			return { success: false, error: error.message };
		}
	});
	
	ipcMain.handle('translation-memory:get-entry-count', async (event, novelId) => {
		try {
			const token = sessionManager.getSession()?.token || null;
			const result = await callTmApi('tm_get_entry_count', { novel_id: novelId }, token);
			return { success: true, count: result.count };
		} catch (error) {
			return { success: false, message: error.message, count: 0 };
		}
	});
	
	ipcMain.handle('translation-memory:getForNovels', async (event, novelIds) => {
		try {
			const token = sessionManager.getSession()?.token || null;
			const result = await callTmApi('tm_get_memory_for_novels', { novel_ids: novelIds }, token);
			return result.content || '';
		} catch (error) {
			console.error(`Failed to get translation memory for AI (novels ${novelIds.join(', ')}):`, error);
			return '';
		}
	});
}

module.exports = { registerTranslationMemoryHandlers, hasValidTranslationMemory, extractAllMarkerPairs };
