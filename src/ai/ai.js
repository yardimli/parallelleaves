const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
require('dotenv').config(); // Ensure .env variables are loaded

const OPEN_ROUTER_API_KEY = process.env.OPEN_ROUTER_API_KEY;

/**
 * Logs an AI interaction to a file in the user's data directory.
 * @param {string} service - The name of the AI service being called.
 * @param {object|string} prompt - The prompt or payload sent to the AI.
 * @param {object|string} response - The response received from the AI.
 */
function logAiInteraction(service, prompt, response) {
	try {
		const logPath = path.join(app.getPath('userData'), 'ai_interactions.log');
		const timestamp = new Date().toISOString();
		
		const formattedPrompt = typeof prompt === 'object' ? JSON.stringify(prompt, null, 2) : prompt;
		const formattedResponse = typeof response === 'object' ? JSON.stringify(response, null, 2) : response;
		
		const logEntry = `
==================================================
Timestamp: ${timestamp}
Service: ${service}
------------------ Prompt ------------------
${formattedPrompt}
------------------ Response ------------------
${formattedResponse}
==================================================\n\n`;
		
		fs.appendFileSync(logPath, logEntry);
	} catch (error) {
		console.error('Failed to write to AI log file:', error);
	}
}

/**
 * A generic function to call the OpenRouter API.
 * @param {object} payload - The request body for the OpenRouter API.
 * @returns {Promise<any>} The JSON response from the API.
 * @throws {Error} If the API call fails.
 */
async function callOpenRouter(payload) {
	if (!OPEN_ROUTER_API_KEY) {
		throw new Error('OpenRouter API key is not configured.');
	}
	
	if (payload.model.endsWith("--thinking")) {
		payload.model = payload.model.slice(0, -10); // Remove '--thinking' to get the real model ID.
		payload.reasoning = { 'effort' : 'medium'};
	}
	
	const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${OPEN_ROUTER_API_KEY}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(payload)
	});
	
	if (!response.ok) {
		const errorText = await response.text();
		console.error('OpenRouter API Error:', errorText);
		throw new Error(`OpenRouter API Error: ${response.status} ${errorText}`);
	}
	
	const data = await response.json();
	// The actual content is a JSON string within the response, so we parse it.
	const finalContent = JSON.parse(data.choices[0].message.content);
	
	logAiInteraction('OpenRouter (Non-streaming)', payload, finalContent);
	
	return finalContent;
}

/**
 * A generic function to call the OpenRouter API with streaming.
 * @param {object} payload - The request body for the OpenRouter API.
 * @param {function(string): void} onChunk - Callback function to handle each received text chunk.
 * @returns {Promise<void>} A promise that resolves when the stream is complete.
 * @throws {Error} If the API call fails.
 */
async function streamOpenRouter(payload, onChunk) {
	if (!OPEN_ROUTER_API_KEY) {
		throw new Error('OpenRouter API key is not configured.');
	}
	
	if (payload.model.endsWith("--thinking")) {
		payload.model = payload.model.slice(0, -10); // Remove '--thinking' to get the real model ID.
		payload.reasoning = { 'effort' : 'medium'};
	}
	
	
	const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${OPEN_ROUTER_API_KEY}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ ...payload, stream: true }) // Ensure streaming is enabled
	});
	
	if (!response.ok) {
		const errorText = await response.text();
		console.error('OpenRouter API Error:', errorText);
		throw new Error(`OpenRouter API Error: ${response.status} ${errorText}`);
	}
	
	let fullResponse = '';
	
	// Process the streaming response body
	for await (const chunk of response.body) {
		const lines = chunk.toString('utf8').split('\n').filter(line => line.trim().startsWith('data: '));
		for (const line of lines) {
			const message = line.replace(/^data: /, '');
			if (message === '[DONE]') {
				logAiInteraction('OpenRouter (Streaming)', payload, fullResponse);
				return; // Stream finished
			}
			try {
				const parsed = JSON.parse(message);
				const content = parsed.choices[0]?.delta?.content;
				if (content) {
					fullResponse += content; // Append chunk to full response.
					onChunk(content); // Send the text chunk to the callback
				}
			} catch (error) {
				console.error('Error parsing stream chunk:', message, error);
			}
		}
	}
	
	// Fallback log in case the stream ends without a [DONE] message.
	if (fullResponse) {
		logAiInteraction('OpenRouter (Streaming)', payload, fullResponse);
	}
}

/**
 * Generates codex entries based on a novel outline.
 * @param {object} params - The parameters for generation.
 * @param {string} params.outlineJson - The novel outline as a JSON string.
 * @param {string} params.language - The output language.
 * @param {string} params.model - The LLM model to use.
 * @returns {Promise<object>} The parsed JSON codex data.
 */
async function generateNovelCodex({ outlineJson, language, model }) {
	const prompt = `
You are a world-building assistant. Based on the provided novel outline, your task is to identify and create encyclopedia-style entries (a codex) for the key characters and locations.

**Novel Outline (JSON):**
${outlineJson}

**Language for Output:** "${language}"

From the outline, extract the most important characters and locations. Generate a JSON object with the following structure:
- \`characters\`: An array of objects for the main characters. Each object must have:
  - \`name\`: The full name of the character.
  - \`content\`: A detailed paragraph describing their personality, motivations, and background.
- \`locations\`: An array of objects for the key settings. Each object must have:
  - \`name\`: The name of the location.
  - \`content\`: A detailed paragraph describing the location's atmosphere, appearance, and history.

Focus on the most prominent elements mentioned in the synopsis and chapter summaries. Provide at least 3 characters and 2 locations if possible. Ensure the entire output is a single, valid JSON object. Do not include any text or markdown formatting before or after the JSON.`;
	
	return callOpenRouter({
		model: model,
		messages: [{ role: 'user', content: prompt }],
		response_format: { type: 'json_object' },
		temperature: 0.6,
	});
}

/**
 * Processes a text selection using an LLM for actions like rephrasing.
 * @param {object} params - The parameters for the text processing.
 * @param {object} params.prompt - An object with 'system', 'user', and 'ai' properties for the prompt.
 * @param {string} params.model - The LLM model to use.
 * @returns {Promise<object>} The parsed JSON response with the processed text.
 */
async function processCodexText({ prompt, model }) {
	const messages = [];
	if (prompt.system) {
		messages.push({ role: 'system', content: prompt.system });
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
	
	// NOTE: This function relies on the prompt instructing the AI to return a valid JSON object.
	// The `callOpenRouter` function will attempt to parse the response as JSON.
	return callOpenRouter({
		model: model,
		messages: messages,
		response_format: { type: 'json_object' }, // Assuming JSON is still desired for this non-streaming version.
		temperature: 0.7,
	});
}

/**
 * Processes a text selection using an LLM with streaming for actions like rephrasing.
 * @param {object} params - The parameters for the text processing.
 * @param {object} params.prompt - An object with 'system', 'user', and 'ai' properties for the prompt.
 * @param {string} params.model - The LLM model to use.
 * @param {function(string): void} onChunk - Callback function to handle each received text chunk.
 * @returns {Promise<void>} A promise that resolves when the stream is complete.
 */
async function streamProcessCodexText({ prompt, model }, onChunk) {
	const messages = [];
	if (prompt.system) {
		messages.push({ role: 'system', content: prompt.system });
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
	
	await streamOpenRouter({
		model: model,
		messages: messages,
		temperature: 0.7,
	}, onChunk);
}


/**
 * Fetches the list of available models from the OpenRouter API.
 * Caches the result for 24 hours to a file in the user's app data directory.
 * @param {boolean} [forceRefresh=false] - If true, bypasses the cache and fetches from the API.
 * @returns {Promise<object>} The raw model data from the API or cache.
 * @throws {Error} If the API call fails.
 */
async function getOpenRouterModels(forceRefresh = false) { // MODIFIED: Added forceRefresh parameter.
	const cachePath = path.join(app.getPath('userData'), 'temp');
	const cacheFile = path.join(cachePath, 'openrouter_models.json');
	const cacheDurationInSeconds = 24 * 60 * 60; // 24 hours
	
	// MODIFIED: Added forceRefresh check to bypass cache if needed.
	if (!forceRefresh && fs.existsSync(cacheFile) && (Date.now() - fs.statSync(cacheFile).mtimeMs) / 1000 < cacheDurationInSeconds) {
		try {
			const cachedContent = fs.readFileSync(cacheFile, 'utf8');
			return JSON.parse(cachedContent);
		} catch (error) {
			console.error('Failed to read or parse model cache:', error);
			// If cache is corrupt, proceed to fetch from API
		}
	}
	
	const response = await fetch('https://openrouter.ai/api/v1/models', {
		method: 'GET',
		headers: {
			'Accept': 'application/json',
			'HTTP-Referer': 'https://github.com/locutusdeborg/novel-skriver', // Example referrer
			'X-Title': 'Parallel Leaves',
		},
	});
	
	if (!response.ok) {
		const errorText = await response.text();
		console.error('OpenRouter Models API Error:', errorText);
		throw new Error(`OpenRouter Models API Error: ${response.status} ${errorText}`);
	}
	
	const modelsData = await response.json();
	
	try {
		fs.mkdirSync(cachePath, { recursive: true });
		fs.writeFileSync(cacheFile, JSON.stringify(modelsData));
	} catch (error) {
		console.error('Failed to write model cache:', error);
	}
	
	return modelsData;
}

/**
 * Processes the raw models list from OpenRouter to create a view-friendly array.
 * @param {object} modelsData The raw JSON response from getOpenRouterModels().
 * @returns {Array<object>} A sorted array of models ready for a dropdown.
 */
function processModelsForView(modelsData) {
	const processedModels = [];
	const positiveList = ['openai', 'anthropic', 'mistral', 'google', 'deepseek', 'mistral', 'moonshot', 'glm'];
	const negativeList = ['free', '8b', '9b', '3b', '7b', '12b', '22b', '24b', '32b', 'gpt-4 turbo', 'oss', 'tng', 'lite', '1.5', '2.0', 'tiny', 'gemma', 'small', 'nano', ' mini', '-mini', 'nemo', 'chat', 'distill', '3.5', 'dolphin', 'codestral', 'devstral', 'magistral', 'pixtral', 'codex', 'o1-pro', 'o3-pro', 'experimental', 'preview'];
	
	const models = (modelsData.data || []).sort((a, b) => a.name.localeCompare(b.name));
	
	for (const model of models) {
		const id = model.id;
		let name = model.name;
		const idLower = id.toLowerCase();
		const nameLower = name.toLowerCase();
		
		const isNegativeMatch = negativeList.some(word => idLower.includes(word) || nameLower.includes(word));
		if (isNegativeMatch) {
			continue;
		}
		
		const isPositiveMatch = positiveList.some(word => idLower.includes(word) || nameLower.includes(word));
		if (!isPositiveMatch) {
			continue;
		}
		
		const hasImageSupport = (model.architecture?.input_modalities || []).includes('image');
		const hasReasoningSupport = (model.supported_parameters || []).includes('reasoning');
		
		if (hasImageSupport) {
			name += ' (i)';
		}
		
		if (hasReasoningSupport && !name.toLowerCase().includes('think')) {
			processedModels.push({ id: id, name: name });
			processedModels.push({ id: `${id}--thinking`, name: `${name} (thinking)` });
		} else {
			processedModels.push({ id: id, name: name });
		}
	}
	
	return processedModels.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Suggests a title and category for a new codex entry based on selected text.
 * @param {object} params - The parameters for generation.
 * @param {string} params.text - The selected text to analyze.
 * @param {Array<string>} params.categories - A list of existing category names to choose from.
 * @param {string} params.model - The LLM model to use.
 * @returns {Promise<object>} The parsed JSON response with 'title' and 'category_name'.
 */
async function suggestCodexDetails({ text, categories, model }) {
	const categoryList = categories.join(', ');
	const prompt = `
You are an intelligent assistant helping a writer organize their world-building codex.
Analyze the following text selection from their novel.

**Text Selection:**
"${text}"

**Task:**
1.  Based on the text, create a concise and appropriate title for a new codex entry. The title should be the name of the person, place, or thing being described.
2.  From the following list of existing categories, choose the one that best fits this new entry.

**Existing Categories:**
[${categoryList}]

Provide your response as a single, valid JSON object with two keys:
- \`title\`: The suggested title for the codex entry.
- \`category_name\`: The name of the best-fitting category from the provided list.

Example Response: {"title": "Captain Eva Rostova", "category_name": "Characters"}
`;
	
	return callOpenRouter({
		model: model,
		messages: [{ role: 'user', content: prompt }],
		response_format: { type: 'json_object' },
		temperature: 0.5,
	});
}


module.exports = {
	generateNovelCodex,
	processCodexText,
	streamProcessCodexText,
	getOpenRouterModels,
	processModelsForView,
	suggestCodexDetails,
};
