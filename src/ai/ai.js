const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const config = require('../../config.js');
const { htmlToPlainText } = require('../main/utils.js');

const AI_PROXY_URL = config.AI_PROXY_URL;

/**
 * A generic function to call the AI proxy.
 * @param {object} payload - The request body for the OpenRouter API.
 * @param {string|null} token - The user's session token.
 * @returns {Promise<any>} The JSON response from the API.
 * @throws {Error} If the API call fails.
 */
async function callOpenRouter(payload, token) {
	if (!AI_PROXY_URL) {
		throw new Error('AI Proxy URL is not configured in config.js.');
	}
	
	if (payload.model.endsWith('--thinking')) {
		payload.model = payload.model.slice(0, -10); // Remove '--thinking' to get the real model ID.
		payload.reasoning = { 'effort': 'medium' };
	}
	
	const headers = {
		'Content-Type': 'application/json'
	};
	
	if (token) {
		payload.auth_token = token;
	}
	
	const response = await fetch(`${AI_PROXY_URL}?action=chat`, {
		method: 'POST',
		headers: headers,
		body: JSON.stringify(payload)
	});
	
	if (!response.ok) {
		const errorText = await response.text();
		console.error('AI Proxy Error:', errorText);
		try {
			const errorJson = JSON.parse(errorText);
			const message = errorJson.error?.message || errorText;
			throw new Error(`AI Proxy Error: ${response.status} ${message}`);
		} catch (e) {
			throw new Error(`AI Proxy Error: ${response.status} ${errorText}`);
		}
	}
	
	const data = await response.json();
	
	if (payload.response_format?.type === 'json_object' && data.choices?.[0]?.message?.content) {
		try {
			return JSON.parse(data.choices[0].message.content);
		} catch (e) {
			console.error('Failed to parse nested JSON from AI response:', e);
			return data.choices[0].message.content;
		}
	}
	
	return data;
}

/**
 * Generates a creative prompt for a book cover based on its title.
 * @param {object} params - The parameters for prompt generation.
 * @param {string} params.title - The title of the novel.
 * @param {string|null} params.token - The user's session token.
 * @returns {Promise<string|null>} The generated prompt string, or null on failure.
 */
async function generateCoverPrompt({ title, token }) {
	const modelId = config.OPEN_ROUTER_MODEL || 'openai/gpt-4o';
	const prompt = `Using the book title "${title}", write a clear and simple description of a scene for an AI image generator to create a book cover. Include the setting, mood, and main objects. Include the "${title}" in the prompt Return the result as a JSON with one key "prompt". Example: with title "Blue Scape" {"prompt": "An astronaut on a red planet looking at a big cosmic cloud, realistic, add the title "Blue Scape" to the image."}`;
	
	try {
		const content = await callOpenRouter({
			model: modelId,
			messages: [{ role: 'user', content: prompt }],
			response_format: { type: 'json_object' },
			temperature: 0.7
		}, token);
		return content.prompt || null;
	} catch (error) {
		console.error('Failed to generate cover prompt:', error);
		return null;
	}
}

/**
 * Calls the server-side proxy to generate an image using Fal.ai.
 * @param {object} params - The parameters for image generation.
 * @param {string} params.prompt - The text prompt for the image.
 * @param {string|null} params.token - The user's session token.
 * @returns {Promise<any>} The JSON response from the proxy (which is the Fal.ai response).
 */
async function generateCoverImageViaProxy({ prompt, token }) {
	if (!AI_PROXY_URL) {
		throw new Error('AI Proxy URL is not configured in config.js.');
	}
	
	const payload = {
		prompt: prompt,
		auth_token: token
	};
	
	const response = await fetch(`${AI_PROXY_URL}?action=generate_cover`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	});
	
	if (!response.ok) {
		const errorText = await response.text();
		console.error('AI Proxy Cover Generation Error:', errorText);
		try {
			const errorJson = JSON.parse(errorText);
			const message = errorJson.error?.message || errorText;
			throw new Error(`AI Proxy Error: ${response.status} ${message}`);
		} catch (e) {
			throw new Error(`AI Proxy Error: ${response.status} ${errorText}`);
		}
	}
	
	return response.json();
}

/**
 * Analyzes a text chunk to create or update codex entries as an HTML string.
 * @param {object} params - The parameters for generation.
 * @param {string} params.textChunk - A chunk of the novel text.
 * @param {string} params.existingCodexHtml - The HTML content of the existing codex file.
 * @param {string} params.sourceLanguage - The language of the novel text chunk.
 * @param {string} params.targetLanguage - The language for the output codex entries.
 * @param {string} params.model - The LLM model to use.
 * @param {string|null} params.token - The user's session token.
 * @param {number} [params.temperature=0.5] - The temperature for the AI model.
 * @returns {Promise<string>} An HTML string containing new or updated codex entries.
 */
async function generateCodexFromTextChunk({ textChunk, existingCodexHtml, sourceLanguage, targetLanguage, model, token, temperature = 0.5 }) {
	const existingCodexText = htmlToPlainText(existingCodexHtml);
	const prompt = `
You are a meticulous world-building assistant for a novelist. Your task is to analyze a chunk of text from a novel and update a codex (an encyclopedia of the world).

**Instructions:**
1.  Read the provided **Text Chunk** (written in ${sourceLanguage}).
2.  Review the **Existing Codex Content** to understand what is already documented.
3.  Identify new characters, locations, or significant objects/lore within the text chunk.
4.  Identify if the text chunk provides new information or details about entities that *already exist* in the codex.
5.  For each new or updated entity, write a brief, encyclopedia-style entry.
6.  **IMPORTANT:** All your output must be written in **${targetLanguage}**.
7.  Format your entire output as a single block of simple HTML. Use \`<h3>\` for each entity's title and \`<p>\` for its description.
8.  If you are updating an existing entry, your new entry should be a complete replacement, incorporating both old and new information.
9.  Return **only the HTML for the new or updated entries**. Do not repeat entries from the existing codex that were not changed by the new text chunk.
10. If you find no new or updated entities worth adding, return an empty string.

**Existing Codex Content (for context):**
<codex>
${existingCodexText.substring(0, 8000)}
</codex>

**Text Chunk to Analyze (in ${sourceLanguage}):**
<text>
${textChunk}
</text>

**Example HTML Output (in ${targetLanguage}):**
<h3>Elaria</h3>
<p>A skilled archer from the Whisperwood, known for her silent movements and keen eye. She assisted Lord Kael during the siege.</p>
<h3>Shadowfang Keep</h3>
<p>An ancient fortress located in the northern mountains, now serving as Lord Kael's stronghold. It is known for its imposing black stone walls and a newly discovered secret passage in the east wing.</p>
`;
	
	const response = await callOpenRouter({
		model: model,
		messages: [{ role: 'user', content: prompt }],
		temperature: temperature
	}, token);
	
	// The response is not JSON, so we directly access the content.
	return response.choices?.[0]?.message?.content || '';
}

/**
 * Processes a text selection using an LLM for actions like rephrasing.
 * @param {object} params - The parameters for the text processing.
 * @param {object} params.prompt - An object with 'system', 'user', and 'ai' properties for the prompt.
 * @param {string} params.model - The LLM model to use.
 * @param {string|null} params.token - The user's session token.
 * @param {string} [params.contextualContent=''] - MODIFICATION: Renamed from dictionaryContent to reflect its new purpose.
 * @param {number} [params.temperature=0.7] - The temperature for the AI model.
 * @param {object|null} [params.response_format=null] - Optional response format object (e.g., { type: 'json_object' }).
 * @returns {Promise<object>} The AI response object.
 */
async function processLLMText({ prompt, model, token, contextualContent = '', temperature = 0.7, response_format = null }) {
	const messages = [];
	if (prompt.system) {
		messages.push({ role: 'system', content: prompt.system });
	}
	if (prompt.context_pairs && Array.isArray(prompt.context_pairs)) {
		messages.push(...prompt.context_pairs);
	}
	
	let userContent = prompt.user;
	if (contextualContent) {
		const dictionaryBlock = `Take into account the following custom dictionary:\n<dictionary>\n${contextualContent}\n</dictionary>`;
		userContent = `${dictionaryBlock}\n\n${userContent}`;
	}
	
	if (userContent) {
		messages.push({ role: 'user', content: userContent });
	}
	if (prompt.ai) {
		messages.push({ role: 'assistant', content: prompt.ai });
	}
	
	if (messages.length === 0) {
		throw new Error('Prompt is empty. Cannot call AI service.');
	}
	
	const payload = {
		model: model,
		messages: messages,
		temperature: temperature
	};
	
	if (response_format) {
		payload.response_format = response_format;
	}
	
	return callOpenRouter(payload, token);
}

/**
 * Fetches the list of available models from the AI Proxy.
 * The proxy now handles the filtering and processing, and returns a grouped structure.
 * Caches the result for 24 hours to a file in the user's app data directory.
 * @param {boolean} [forceRefresh=false] - If true, bypasses the cache and fetches from the API.
 * @param {string|null} token - The user's session token.
 * @returns {Promise<Array<object>>} The processed and grouped array of models from the proxy.
 * @throws {Error} If the API call fails.
 */
async function getOpenRouterModels(forceRefresh = false, token) {
	const cachePath = path.join(app.getPath('userData'), 'temp');
	const cacheFile = path.join(cachePath, 'openrouter_models.json');
	const cacheDurationInSeconds = 24 * 60 * 60; // 24 hours
	
	if (!forceRefresh && fs.existsSync(cacheFile) && (Date.now() - fs.statSync(cacheFile).mtimeMs) / 1000 < cacheDurationInSeconds) {
		try {
			const cachedContent = fs.readFileSync(cacheFile, 'utf8');
			const JSONcachedContent = JSON.parse(cachedContent);
			console.log('Loaded models from cache.');
			return JSONcachedContent;
		} catch (error) {
			console.error('Failed to read or parse model cache:', error);
		}
	}
	
	if (!AI_PROXY_URL) {
		throw new Error('AI Proxy URL is not configured in config.js.');
	}
	
	const headers = {
		'Accept': 'application/json',
		'Content-Type': 'application/json'
	};
	
	const payload = {};
	if (token) {
		payload.auth_token = token;
	}
	
	const response = await fetch(`${AI_PROXY_URL}?action=get_models`, {
		method: 'POST',
		headers: headers,
		body: JSON.stringify(payload)
	});
	
	if (!response.ok) {
		const errorText = await response.text();
		console.error('AI Proxy Models API Error:', errorText);
		throw new Error(`AI Proxy Models API Error: ${response.status} ${errorText}`);
	}
	
	const processedModelsData = await response.json(); // This is now the grouped array
	
	try {
		fs.mkdirSync(cachePath, { recursive: true });
		fs.writeFileSync(cacheFile, JSON.stringify(processedModelsData));
	} catch (error) {
		console.error('Failed to write model cache:', error);
	}
	
	console.log('Fetched models from AI Proxy API.');
	return processedModelsData;
}

module.exports = {
	generateCodexFromTextChunk,
	processLLMText,
	getOpenRouterModels,
	generateCoverPrompt,
	generateCoverImageViaProxy
};
