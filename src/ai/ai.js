const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const config = require('../../config.js');

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
	
	if (payload.model.endsWith("--thinking")) {
		payload.model = payload.model.slice(0, -10); // Remove '--thinking' to get the real model ID.
		payload.reasoning = { 'effort' : 'medium'};
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
			console.error("Failed to parse nested JSON from AI response:", e);
			return data.choices[0].message.content;
		}
	}
	
	return data;
}

// NEW SECTION START
/**
 * Generates a creative prompt for a book cover based on its title.
 * @param {object} params - The parameters for prompt generation.
 * @param {string} params.title - The title of the novel.
 * @param {string|null} params.token - The user's session token.
 * @returns {Promise<string|null>} The generated prompt string, or null on failure.
 */
async function generateCoverPrompt({ title, token }) {
	const modelId = config.OPEN_ROUTER_MODEL || 'openai/gpt-4o-mini';
	const prompt = `Using the book title "${title}", write a clear and simple description of a scene for an AI image generator to create a book cover. Include the setting, mood, and main objects. Include the "${title}" in the prompt Return the result as a JSON with one key "prompt". Example: with title "Blue Scape" {"prompt": "An astronaut on a red planet looking at a big cosmic cloud, realistic, add the title "Blue Scape" to the image."}`;
	
	try {
		const content = await callOpenRouter({
			model: modelId,
			messages: [{ role: 'user', content: prompt }],
			response_format: { type: 'json_object' },
			temperature: 0.7,
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
		auth_token: token,
	};
	
	const response = await fetch(`${AI_PROXY_URL}?action=generate_cover`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
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
// NEW SECTION END

/**
 * Generates codex entries based on a novel outline.
 * @param {object} params - The parameters for generation.
 * @param {string} params.outlineJson - The novel outline as a JSON string.
 * @param {string} params.language - The output language.
 * @param {string} params.model - The LLM model to use.
 * @param {string|null} params.token - The user's session token.
 * @returns {Promise<object>} The parsed JSON codex data.
 */
async function generateNovelCodex({ outlineJson, language, model, token }) {
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
	}, token);
}

/**
 * Analyzes a text chunk to create or update codex entries.
 * @param {object} params - The parameters for generation.
 * @param {string} params.textChunk - A chunk of the novel text.
 * @param {string} params.existingCodexJson - A JSON string of existing codex entries.
 * @param {string} params.language - The language of the novel.
 * @param {string} params.targetLanguage - The target language for translation.
 * @param {string} params.model - The LLM model to use.
 * @param {string|null} params.token - The user's session token.
 * @returns {Promise<object>} The parsed JSON response with new and updated entries.
 */
async function generateCodexFromTextChunk({ textChunk, existingCodexJson, language, targetLanguage, model, token }) {
	const prompt = `
You are a meticulous world-building assistant for a novelist. Your task is to analyze a chunk of text from a novel and identify entities that should be in a codex (an encyclopedia of the world). These entities are typically People, Locations, or Objects/Lore.

**Instructions:**
1.  Read the provided **Text Chunk**.
2.  Review the **Existing Codex Entries** to understand what is already documented.
3.  Identify new characters, locations, or significant objects/lore within the text chunk that are not in the codex.
4.  If you find new information about an entity that is ALREADY in the codex, update its description. The new description should integrate the old and new information seamlessly.
5.  For each new or updated entry, provide:
    - A concise title (the name of the entity).
    - A descriptive paragraph for the 'content' field in the source language (**${language}**).
    - A translation of the 'content' into the 'target_content' field in the target language (**${targetLanguage}**).
    - A comma-separated list of exact phrases from the **Text Chunk** that refer to this entity for the 'document_phrases' field.

**Existing Codex Entries (JSON):**
${existingCodexJson}

**Text Chunk to Analyze:**
<text>
${textChunk}
</text>

**Output Format:**
Respond with a single, valid JSON object. Do not include any text or markdown before or after the JSON. The JSON object must have two keys: \`new_entries\` and \`updated_entries\`.
`;
	
	return callOpenRouter({
		model: model,
		messages: [{ role: 'user', content: prompt }],
		response_format: { type: 'json_object' },
		temperature: 0.5,
	}, token);
}


/**
 * Processes a text selection using an LLM for actions like rephrasing.
 * @param {object} params - The parameters for the text processing.
 * @param {object} params.prompt - An object with 'system', 'user', and 'ai' properties for the prompt.
 * @param {string} params.model - The LLM model to use.
 * @param {string|null} params.token - The user's session token.
 * @returns {Promise<object>} The AI response object.
 */
async function processLLMText({ prompt, model, token }) {
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
	
	return callOpenRouter({
		model: model,
		messages: messages,
		temperature: 0.7,
	}, token);
}

/**
 * Fetches the list of available models from the AI Proxy.
 * The proxy now handles the filtering and processing.
 * Caches the result for 24 hours to a file in the user's app data directory.
 * @param {boolean} [forceRefresh=false] - If true, bypasses the cache and fetches from the API.
 * @param {string|null} token - The user's session token.
 * @returns {Promise<Array<object>>} The processed and sorted array of models from the proxy.
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
		'Content-Type': 'application/json',
	};
	
	const payload = {};
	if (token) {
		payload.auth_token = token;
	}
	
	const response = await fetch(`${AI_PROXY_URL}?action=get_models`, {
		method: 'POST',
		headers: headers,
		body: JSON.stringify(payload),
	});
	
	if (!response.ok) {
		const errorText = await response.text();
		console.error('AI Proxy Models API Error:', errorText);
		throw new Error(`AI Proxy Models API Error: ${response.status} ${errorText}`);
	}
	
	const processedModelsData = await response.json(); // This is now the processed array
	
	try {
		fs.mkdirSync(cachePath, { recursive: true });
		fs.writeFileSync(cacheFile, JSON.stringify(processedModelsData));
	} catch (error) {
		console.error('Failed to write model cache:', error);
	}
	
	console.log('Fetched models from AI Proxy API.');
	return processedModelsData;
}


/**
 * Suggests a title and category for a new codex entry based on selected text.
 * @param {object} params - The parameters for generation.
 * @param {string} params.text - The selected text to analyze.
 * @param {Array<string>} params.categories - A list of existing category names to choose from.
 * @param {string} params.model - The LLM model to use.
 * @param {string|null} params.token - The user's session token.
 * @returns {Promise<object>} The parsed JSON response with 'title' and 'category_name'.
 */
async function suggestCodexDetails({ text, categories, model, token }) {
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
	}, token);
}


module.exports = {
	generateNovelCodex,
	generateCodexFromTextChunk,
	processLLMText,
	getOpenRouterModels,
	suggestCodexDetails,
	generateCoverPrompt, // NEW: Export new function
	generateCoverImageViaProxy, // NEW: Export new function
};
