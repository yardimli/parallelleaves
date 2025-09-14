const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
require('dotenv').config(); // Ensure .env variables are loaded

// NEW: URL for the PHP proxy script. This should be added to your .env file.
// e.g., AI_PROXY_URL=https://your-server.com/ai-proxy.php
const AI_PROXY_URL = process.env.AI_PROXY_URL;

// REMOVED: logAiInteraction function is no longer needed as the client doesn't handle the API key.

/**
 * A generic function to call the AI proxy.
 * @param {object} payload - The request body for the OpenRouter API.
 * @returns {Promise<any>} The JSON response from the API.
 * @throws {Error} If the API call fails.
 */
async function callOpenRouter(payload) {
	// MODIFIED: Check for proxy URL instead of API key
	if (!AI_PROXY_URL) {
		throw new Error('AI Proxy URL is not configured.');
	}
	
	if (payload.model.endsWith("--thinking")) {
		payload.model = payload.model.slice(0, -10); // Remove '--thinking' to get the real model ID.
		payload.reasoning = { 'effort' : 'medium'};
	}
	
	// MODIFIED: Call the proxy script
	const response = await fetch(`${AI_PROXY_URL}?action=chat`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(payload)
	});
	
	if (!response.ok) {
		const errorText = await response.text();
		console.error('AI Proxy Error:', errorText);
		// Try to parse the error for a cleaner message
		try {
			const errorJson = JSON.parse(errorText);
			const message = errorJson.error?.message || errorText;
			throw new Error(`AI Proxy Error: ${response.status} ${message}`);
		} catch (e) {
			throw new Error(`AI Proxy Error: ${response.status} ${errorText}`);
		}
	}
	
	const data = await response.json();
	
	// The actual content might be a JSON string within the response, so we parse it.
	// This is specific to prompts that request a JSON object.
	if (payload.response_format?.type === 'json_object' && data.choices?.[0]?.message?.content) {
		try {
			return JSON.parse(data.choices[0].message.content);
		} catch (e) {
			console.error("Failed to parse nested JSON from AI response:", e);
			// Return the raw content if parsing fails, maybe it's not JSON as expected.
			return data.choices[0].message.content;
		}
	}
	
	return data; // Return the full response for non-JSON-object requests
}

// REMOVED: streamOpenRouter function is no longer needed.

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
 * Analyzes a text chunk to create or update codex entries.
 * @param {object} params - The parameters for generation.
 * @param {string} params.textChunk - A chunk of the novel text.
 * @param {string} params.existingCodexJson - A JSON string of existing codex entries.
 * @param {string} params.language - The language of the novel.
 * @param {string} params.targetLanguage - The target language for translation.
 * @param {string} params.model - The LLM model to use.
 * @returns {Promise<object>} The parsed JSON response with new and updated entries.
 */
async function generateCodexFromTextChunk({ textChunk, existingCodexJson, language, targetLanguage, model }) {
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

- \`new_entries\`: An array of objects for entities not found in the existing codex. Each object must have:
  - \`category\`: A string, either "Characters", "Locations", or "Objects & Lore".
  - \`title\`: The name of the new entity.
  - \`content\`: A descriptive paragraph in **${language}**.
  - \`target_content\`: The translation of 'content' into **${targetLanguage}**.
  - \`document_phrases\`: A comma-separated string of phrases from the text chunk.
- \`updated_entries\`: An array of objects for entities that were in the existing codex but have new information. Each object must have:
  - \`title\`: The exact title of the existing entity to update.
  - \`content\`: The new, complete, and updated descriptive paragraph in **${language}**.
  - \`target_content\`: The translation of the new 'content' into **${targetLanguage}**.
  - \`document_phrases\`: A comma-separated string of new phrases from the text chunk to be added to the entry.

Example Response:
{
  "new_entries": [
    {
      "category": "Characters",
      "title": "Captain Eva Rostova",
      "content": "A stern but fair captain of the starship 'Venture'. She is known for her tactical genius and unwavering loyalty to her crew.",
      "target_content": "Une capitaine sévère mais juste du vaisseau 'Venture'. Elle est connue pour son génie tactique et sa loyauté indéfectible envers son équipage.",
      "document_phrases": "Captain Eva Rostova, the captain"
    }
  ],
  "updated_entries": [
    {
      "title": "Aethelgard",
      "content": "The capital city of the Northern Kingdom, now described as having towering spires of obsidian that glitter under the twin moons. Its streets are paved with silver cobblestones, a recent addition by the new king.",
      "target_content": "La capitale du Royaume du Nord, maintenant décrite comme ayant des flèches imposantes d'obsidienne qui scintillent sous les deux lunes. Ses rues sont pavées de pavés d'argent, un ajout récent du nouveau roi.",
      "document_phrases": "towering spires of obsidian, silver cobblestones"
    }
  ]
}
`;
	
	return callOpenRouter({
		model: model,
		messages: [{ role: 'user', content: prompt }],
		response_format: { type: 'json_object' },
		temperature: 0.5,
	});
}


/**
 * Processes a text selection using an LLM for actions like rephrasing.
 * @param {object} params - The parameters for the text processing.
 * @param {object} params.prompt - An object with 'system', 'user', and 'ai' properties for the prompt.
 * @param {string} params.model - The LLM model to use.
 * @returns {Promise<object>} The AI response object.
 */
async function processCodexText({ prompt, model }) {
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
	
	// This function calls the proxy which returns the full AI response.
	return callOpenRouter({
		model: model,
		messages: messages,
		temperature: 0.7,
	});
}

// REMOVED: streamProcessCodexText function is no longer needed.

/**
 * Fetches the list of available models from the AI Proxy.
 * Caches the result for 24 hours to a file in the user's app data directory.
 * @param {boolean} [forceRefresh=false] - If true, bypasses the cache and fetches from the API.
 * @returns {Promise<object>} The raw model data from the API or cache.
 * @throws {Error} If the API call fails.
 */
async function getOpenRouterModels(forceRefresh = false) {
	const cachePath = path.join(app.getPath('userData'), 'temp');
	const cacheFile = path.join(cachePath, 'openrouter_models.json');
	const cacheDurationInSeconds = 24 * 60 * 60; // 24 hours
	
	if (!forceRefresh && fs.existsSync(cacheFile) && (Date.now() - fs.statSync(cacheFile).mtimeMs) / 1000 < cacheDurationInSeconds) {
		try {
			const cachedContent = fs.readFileSync(cacheFile, 'utf8');
			return JSON.parse(cachedContent);
		} catch (error) {
			console.error('Failed to read or parse model cache:', error);
			// If cache is corrupt, proceed to fetch from API
		}
	}
	
	// MODIFIED: Check for proxy URL
	if (!AI_PROXY_URL) {
		throw new Error('AI Proxy URL is not configured.');
	}
	
	// MODIFIED: Call the proxy script with the get_models action
	const response = await fetch(`${AI_PROXY_URL}?action=get_models`, {
		method: 'GET',
		headers: {
			'Accept': 'application/json',
		},
	});
	
	if (!response.ok) {
		const errorText = await response.text();
		console.error('AI Proxy Models API Error:', errorText);
		throw new Error(`AI Proxy Models API Error: ${response.status} ${errorText}`);
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
	const negativeList = ['free', '8b', '9b', '3b', '7b', '12b', '22b', '24b', '32b', 'gpt-4 turbo', 'oss', 'tng', 'lite', '1.5', '2.0', 'tiny', 'gemma', 'small', 'nemo', 'chat', 'distill', '3.5', 'dolphin', 'codestral', 'devstral', 'magistral', 'pixtral', 'codex', 'o1-pro', 'o3-pro', 'experimental', 'preview'];
	
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
	generateCodexFromTextChunk,
	processCodexText,
	getOpenRouterModels,
	processModelsForView,
	suggestCodexDetails,
};
