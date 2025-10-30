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
		prompt: prompt
	};
	
	if (token) {
		payload.auth_token = token;
	}
	
	console.log(payload);
	
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
 * Processes a text selection using an LLM for actions like rephrasing or translating.
 * @param {object} params - The parameters for the text processing.
 * @param {object} params.prompt - An object with 'system', 'user', and 'ai' properties for the prompt.
 * @param {string} params.model - The LLM model to use.
 * @param {string|null} params.token - The user's session token.
 * @param {number} [params.temperature=0.7] - The temperature for the AI model.
 * @param {object|null} [params.response_format=null] - Optional response format object (e.g., { type: 'json_object' }).
 * @param {Array<number>} [params.translation_memory_ids=[]] - Array of novel IDs for TM.
 * @param {boolean} [params.use_codex=false] - MODIFICATION: Flag to tell the server to inject the codex.
 * @param {number|null} [params.novelId=null] - MODIFICATION: The novel ID, required if use_codex is true.
 * @returns {Promise<object>} The AI response object.
 */
async function processLLMText({ prompt, model, token, temperature = 0.7, response_format = null, translation_memory_ids = [], use_codex = false, novelId = null }) {
	const messages = [];
	if (prompt.system) {
		messages.push({ role: 'system', content: prompt.system });
	}
	if (prompt.context_pairs && Array.isArray(prompt.context_pairs)) {
		messages.push(...prompt.context_pairs);
	}
	
	if (prompt.user) {
		messages.push({ role: 'user', content: prompt.user });
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
	
	if (translation_memory_ids && translation_memory_ids.length > 0) {
		payload.translation_memory_ids = translation_memory_ids;
	}
	
	if (use_codex && novelId) {
		payload.use_codex = true;
		payload.novel_id = novelId;
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
	processLLMText,
	getOpenRouterModels,
	generateCoverPrompt,
	generateCoverImageViaProxy
};
