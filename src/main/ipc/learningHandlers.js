const { ipcMain } = require('electron');
const aiService = require('../../ai/ai.js');
const { htmlToPlainText } = require('../utils.js');
const path = require('path'); // MODIFICATION: Added for path handling.
const fs = require('fs'); // MODIFICATION: Added for file system access.

// MODIFICATION START: Main-process i18n utility.
const translationsCache = new Map();

/**
 * Loads and merges all .json files from a language directory.
 * @param {string} lang - The language code (e.g., 'en').
 * @returns {object} The merged translation object.
 */
function loadLanguage(lang) {
	if (translationsCache.has(lang)) {
		return translationsCache.get(lang);
	}
	
	const langDir = path.join(__dirname, '..', '..', '..', 'public', 'lang', lang);
	const mergedTranslations = {};
	
	try {
		if (!fs.existsSync(langDir) || !fs.lstatSync(langDir).isDirectory()) {
			throw new Error(`Language directory not found: ${lang}`);
		}
		
		const files = fs.readdirSync(langDir).filter(file => file.endsWith('.json'));
		
		for (const file of files) {
			const filePath = path.join(langDir, file);
			const fileContent = fs.readFileSync(filePath, 'utf8');
			const jsonData = JSON.parse(fileContent);
			const key = path.basename(file, '.json');
			mergedTranslations[key] = jsonData;
		}
		
		translationsCache.set(lang, mergedTranslations);
		return mergedTranslations;
	} catch (error) {
		console.error(`Failed to load language files for '${lang}':`, error);
		translationsCache.set(lang, {}); // Cache empty object on failure to avoid retries.
		return {};
	}
}

/**
 * Gets a nested property from an object using a dot-notation string.
 * @param {object} obj - The object to search.
 * @param {string} path - The dot-notation path (e.g., 'common.save').
 * @returns {*} The value if found, otherwise undefined.
 */
function getNested(obj, path) {
	return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

/**
 * A simple translation function for the main process.
 * @param {string} lang - The target language.
 * @param {string} key - The translation key.
 * @param {object} [substitutions={}] - An object of substitutions for placeholders.
 * @returns {string} The translated string.
 */
function t_main(lang, key, substitutions = {}) {
	const translations = loadLanguage(lang);
	const enTranslations = loadLanguage('en'); // Always load English as a fallback.
	
	let result = getNested(translations, key) ?? getNested(enTranslations, key);
	
	if (result === undefined) {
		return key; // Return the key if no translation is found.
	}
	
	if (typeof result === 'string') {
		for (const [subKey, subValue] of Object.entries(substitutions)) {
			result = result.replaceAll(`{${subKey}}`, subValue);
		}
	}
	
	return result;
}

/**
 * Extracts translation pairs from source and target HTML based on markers.
 * This is a simplified version of the one in chapterHandlers, as we need all pairs.
 * @param {string} sourceHtml - The source HTML content.
 * @param {string} targetHtml - The target HTML content.
 * @returns {Array<object>} An array of {marker, source, target} text pairs.
 */
const extractAllMarkerPairs = (sourceHtml, targetHtml) => {
	if (!sourceHtml || !targetHtml) {
		return [];
	}
	
	// MODIFICATION START: Updated getSegments to correctly pair opening and closing markers.
	const getSegments = (html) => {
		const segments = [];
		const openingMarkerRegex = /\[\[#(\d+)\]\]/g;
		let match;
		
		// Find all opening markers first.
		while ((match = openingMarkerRegex.exec(html)) !== null) {
			const number = parseInt(match[1], 10);
			const openMarkerEndIndex = match.index + match[0].length;
			
			// Construct the closing marker regex for this specific number.
			const closingMarkerRegex = new RegExp(`\\{\\{#${number}\\}\\}`);
			
			// Search for the closing marker *only in the part of the string after the opening marker*.
			const restOfString = html.substring(openMarkerEndIndex);
			const closeMatch = restOfString.match(closingMarkerRegex);
			
			// Only proceed if a corresponding closing marker is found.
			if (closeMatch) {
				// The content is the substring between the end of the opening marker and the start of the closing marker.
				const contentEndIndex = openMarkerEndIndex + closeMatch.index;
				const contentHtml = html.substring(openMarkerEndIndex, contentEndIndex);
				
				// Remove any other markers that might be nested inside this segment to avoid contamination.
				const contentWithoutInnerMarkers = contentHtml.replace(/(\[\[#\d+\]\])|(\{\{#\d+\}\})/g, '');
				const plainText = htmlToPlainText(contentWithoutInnerMarkers).trim();
				
				if (plainText) {
					segments.push({ number, text: plainText });
				}
			}
			// If no closing marker is found, the opening marker is ignored, fulfilling the requirement.
		}
		return segments;
	};
	// MODIFICATION END
	
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

	// Sort by marker number to ensure chronological order
	return pairs.sort((a, b) => a.marker - b.marker);
};

/**
 * Validates and filters the AI response to ensure it contains valid, correctly tagged translation pairs.
 * An incomplete pair (e.g., a source line without a matching target line) is discarded.
 * A line missing either its start or end tag is considered invalid.
 * @param {string} responseText - The raw text from the AI.
 * @param {string} sourceLang - The source language code.
 * @param {string} targetLang - The target language code.
 * @returns {string} - The cleaned-up response text containing only valid pairs, or an empty string if none are valid.
 */
function validateAndFilterLLMResponse(responseText, sourceLang, targetLang) {
	if (!responseText || typeof responseText !== 'string') {
		return '';
	}
	
	const lines = responseText.trim().split('\n').filter(line => line.trim() !== '');
	// We need an even number of lines to form pairs.
	if (lines.length === 0 || lines.length % 2 !== 0) {
		return '';
	}
	
	const sourceStartTag = `<${sourceLang}>`;
	const sourceEndTag = `</${sourceLang}>`;
	const targetStartTag = `<${targetLang}>`;
	const targetEndTag = `</${targetLang}>`;
	
	const validPairs = [];
	
	// Iterate through the lines two at a time to process them as pairs.
	for (let i = 0; i < lines.length; i += 2) {
		const sourceLine = lines[i].trim();
		const targetLine = lines[i + 1].trim();
		
		// MODIFICATION: Verify that each line in a pair has both its opening and closing tags.
		const isSourceValid = sourceLine.startsWith(sourceStartTag) && sourceLine.endsWith(sourceEndTag);
		const isTargetValid = targetLine.startsWith(targetStartTag) && targetLine.endsWith(targetEndTag);
		
		// If both lines in the pair are correctly formatted, add them to the result.
		if (isSourceValid && isTargetValid) {
			validPairs.push(sourceLine, targetLine);
		}
		// If a pair is invalid, it is skipped entirely, ensuring only complete pairs are kept.
	}
	
	return validPairs.join('\n');
}


/**
 * Registers IPC handlers for the learning window functionality.
 * @param {Database.Database} db - The application's database connection.
 * @param {object} sessionManager - The session manager instance.
 */
function registerLearningHandlers(db, sessionManager) {
	// MODIFICATION: The handler now accepts `lang` from the renderer.
	ipcMain.handle('learning:start', async (event, { novelId, model, temperature, lastMarkerNumber, lang = 'en' }) => {
		const learningWindow = event.sender.getOwnerBrowserWindow();
		
		try {
			const token = sessionManager.getSession()?.token || null;
			
			// 1. Get novel languages
			const novel = db.prepare('SELECT source_language, target_language FROM novels WHERE id = ?').get(novelId);
			if (!novel) {
				throw new Error('Novel not found.');
			}
			
			// 2. Get all chapter content and combine it
			const chapters = db.prepare('SELECT source_content, target_content FROM chapters WHERE novel_id = ? ORDER BY chapter_order').all(novelId);
			const combinedSource = chapters.map(c => c.source_content || '').join('');
			const combinedTarget = chapters.map(c => c.target_content || '').join('');
			
			// 3. Extract all pairs
			const allPairs = extractAllMarkerPairs(combinedSource, combinedTarget);
			
			// 4. Find the next pair to process
			const nextPair = allPairs.find(p => p.marker > lastMarkerNumber);
			
			if (!nextPair) {
				learningWindow.webContents.send('learning:update', { type: 'finished', message: 'editor.learning.noMorePairs' });
				return { success: true, message: 'No more pairs.' };
			}
			
			// 5. Construct the prompt using the new i18n utility.
			// MODIFICATION START: Replaced hardcoded prompts with dynamic, translated ones.
			const systemPrompt = t_main(lang, 'prompt.learning.system.base', {
				sourceLanguage: novel.source_language,
				targetLanguage: novel.target_language
			});
			
			const userPrompt = t_main(lang, 'prompt.learning.user.base', {
				sourceLanguage: novel.source_language,
				targetLanguage: novel.target_language,
				sourceText: nextPair.source,
				targetText: nextPair.target
			});
			
			const prompt = {
				system: systemPrompt,
				user: userPrompt
			};
			// MODIFICATION END
			
			// 6. Call the LLM
			const result = await aiService.processLLMText({
				prompt,
				model,
				token,
				temperature
			});
			
			if (result && result.choices && result.choices.length > 0) {
				const rawResponse = result.choices[0].message.content.trim();
				
				// MODIFICATION: The response from the AI is validated and filtered here.
				// This ensures only complete pairs with correct tags are used.
				const validatedResponse = validateAndFilterLLMResponse(rawResponse, novel.source_language, novel.target_language);
				
				if (validatedResponse) {
					// MODIFICATION: The block number is explicitly taken from `nextPair.marker`,
					// which is the number parsed from the source text's translation marker (e.g., [[#123]]).
					const formattedBlock = `\n\n#${nextPair.marker}\n${validatedResponse}`;
					
					learningWindow.webContents.send('learning:update', {
						type: 'new_instructions',
						data: {
							formattedBlock: formattedBlock,
							marker: nextPair.marker // Send the same marker number back to the client.
						}
					});
				} else {
					// If validation fails, send an error with the raw response for debugging
					throw new Error(`AI response was not in the expected pair format. Response: ${rawResponse}`);
				}
				
			} else {
				// Handle cases where the API returns a valid response but no choices, or an error structure
				const errorMessage = result.error ? result.error.message : 'AI response was empty or invalid.';
				throw new Error(errorMessage);
			}
			
			return { success: true };
			
		} catch (error) {
			console.error('Learning process failed:', error);
			learningWindow.webContents.send('learning:update', { type: 'error', message: 'editor.learning.error', params: { message: error.message } });
			return { success: false, error: error.message };
		}
	});
}

module.exports = { registerLearningHandlers };
