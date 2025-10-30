const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { htmlToPlainText } = require('../utils.js');
const fetch = require('node-fetch');
const { AI_PROXY_URL } = require('../../../config.js');

let activeCodexJobs = new Map();

/**
 * A generic function to call the server-side codex API.
 * @param {string} action - The specific API action (e.g., 'codex_get_status').
 * @param {object} payload - The data to send.
 * @param {string} token - The user's auth token.
 * @returns {Promise<any>} The JSON response from the server.
 */
async function callCodexApi(action, payload, token) {
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
 * Registers IPC handlers for the server-side Codex functionality.
 * @param {Database.Database} db - The application's database connection.
 * @param {object} sessionManager - The session manager instance.
 * @param {object} windowManager - The window manager instance.
 */
function registerCodexHandlers(db, sessionManager, windowManager) {
	ipcMain.on('codex:start-generation', async (event, novelId) => {
		const sender = event.sender;
		const token = sessionManager.getSession()?.token;
		
		if (!token) {
			sender.send('codex:finished', { status: 'error', message: 'User not authenticated.' });
			return;
		}
		
		if (activeCodexJobs.has(novelId)) {
			console.log(`Codex generation for novel ${novelId} is already in progress.`);
			return;
		}
		
		activeCodexJobs.set(novelId, true);
		
		try {
			// 1. Get novel languages and current status from server
			sender.send('codex:update', { statusKey: 'editor.codex.status.checking' });
			const { status } = await callCodexApi('codex_get_status', { novel_id: novelId }, token);
			
			if (status === 'complete' || status === 'generating') {
				sender.send('codex:finished', { status: 'complete' });
				activeCodexJobs.delete(novelId);
				return;
			}
			
			// MODIFICATION START: Get novel metadata from the local DB.
			const novel = db.prepare('SELECT title, author, source_language, target_language FROM novels WHERE id = ?').get(novelId);
			if (!novel) {
				throw new Error(`Novel with ID ${novelId} not found locally.`);
			}
			// MODIFICATION END
			
			// 2. Get content and split into chunks
			sender.send('codex:update', { statusKey: 'editor.codex.status.preparing' });
			const chapters = db.prepare('SELECT source_content FROM chapters WHERE novel_id = ? AND source_content IS NOT NULL AND LENGTH(source_content) > 10').all(novelId);
			if (chapters.length === 0) {
				sender.send('codex:finished', { status: 'complete' });
				activeCodexJobs.delete(novelId);
				return;
			}
			
			const fullText = chapters.map(c => htmlToPlainText(c.source_content)).join('\n');
			const words = fullText.split(/\s+/);
			const chunkSize = 8000; // Approx word count for large contexts
			const chunks = [];
			for (let i = 0; i < words.length; i += chunkSize) {
				chunks.push(words.slice(i, i + chunkSize).join(' '));
			}
			
			if (chunks.length === 0) {
				sender.send('codex:finished', { status: 'complete' });
				activeCodexJobs.delete(novelId);
				return;
			}
			
			// 3. Start the job on the server, now including novel metadata
			// MODIFICATION START: Added title, author, and languages to the payload.
			await callCodexApi('codex_start_job', {
				novel_id: novelId,
				total_chunks: chunks.length,
				title: novel.title, // Add title
				author: novel.author, // Add author
				source_language: novel.source_language, // Add source language
				target_language: novel.target_language, // Add target language
			}, token);
			// MODIFICATION END
			
			// 4. Process chunks sequentially
			for (let i = 0; i < chunks.length; i++) {
				if (!activeCodexJobs.has(novelId)) { // Check if job was cancelled
					sender.send('codex:finished', { status: 'cancelled' });
					return;
				}
				
				sender.send('codex:update', { statusKey: 'editor.codex.status.generating', progress: i + 1, total: chunks.length });
				
				await callCodexApi('codex_process_chunk', {
					novel_id: novelId,
					chunk_text: chunks[i],
					chunk_index: i,
				}, token);
			}
			
			// 5. Finalize
			await callCodexApi('codex_mark_complete', { novel_id: novelId }, token);
			sender.send('codex:finished', { status: 'complete' });
			
		} catch (error) {
			console.error(`Codex generation failed for novel ${novelId}:`, error);
			sender.send('codex:finished', { status: 'error', message: error.message });
		} finally {
			activeCodexJobs.delete(novelId);
		}
	});
	
	ipcMain.on('codex:stop-generation', (event, novelId) => {
		if (activeCodexJobs.has(novelId)) {
			activeCodexJobs.delete(novelId);
			console.log(`Codex generation for novel ${novelId} cancelled by user.`);
		}
	});
}

module.exports = { registerCodexHandlers };
