const { ipcMain, app } = require('electron');
const aiService = require('../../ai/ai.js');
const { htmlToPlainText } = require('../utils.js');
const path = require('path');
const fs = require('fs');

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
 * Validates and filters the AI response to ensure it contains valid, correctly tagged translation pairs.
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
	if (lines.length === 0 || lines.length % 2 !== 0) {
		return '';
	}
	
	const sourceStartTag = `<${sourceLang}>`;
	const sourceEndTag = `</${sourceLang}>`;
	const targetStartTag = `<${targetLang}>`;
	const targetEndTag = `</${targetLang}>`;
	
	const validPairs = [];
	
	for (let i = 0; i < lines.length; i += 2) {
		const sourceLine = lines[i].trim();
		const targetLine = lines[i + 1].trim();
		
		const isSourceValid = sourceLine.startsWith(sourceStartTag) && sourceLine.endsWith(sourceEndTag);
		const isTargetValid = targetLine.startsWith(targetStartTag) && targetLine.endsWith(targetEndTag);
		
		if (isSourceValid && isTargetValid) {
			validPairs.push(sourceLine, targetLine);
		}
	}
	
	return validPairs.join('\n');
}

// MODIFICATION: Renamed function to reflect its purpose
const getTranslationMemoryPath = (novelId) => {
	if (!novelId) {
		return null;
	}
	// MODIFICATION: Updated file naming convention
	return path.join(app.getPath('userData'), `translation_memory_${novelId}.txt`);
};

/**
 * Registers IPC handlers for the translation memory window functionality.
 * @param {Database.Database} db - The application's database connection.
 * @param {object} sessionManager - The session manager instance.
 */
// MODIFICATION: Renamed handler registration function
function registerTranslationMemoryHandlers(db, sessionManager) {
	// MODIFICATION: Renamed IPC handler and updated logic
	ipcMain.handle('translation-memory:start', async (event, { novelId, model, temperature, processedMarkerNumbers, lang = 'en', pairCount = 2 }) => {
		const memoryWindow = event.sender.getOwnerBrowserWindow();
		
		try {
			const token = sessionManager.getSession()?.token || null;
			
			const novel = db.prepare('SELECT source_language, target_language FROM novels WHERE id = ?').get(novelId);
			if (!novel) {
				throw new Error('Novel not found.');
			}
			
			const chapters = db.prepare('SELECT source_content, target_content FROM chapters WHERE novel_id = ? ORDER BY chapter_order').all(novelId);
			const combinedSource = chapters.map(c => c.source_content || '').join('');
			const combinedTarget = chapters.map(c => c.target_content || '').join('');
			
			const allPairs = extractAllMarkerPairs(combinedSource, combinedTarget);
			
			const nextPair = allPairs.find(p => !processedMarkerNumbers.includes(p.marker));
			
			if (!nextPair) {
				// MODIFICATION: Updated event channel and i18n key
				memoryWindow.webContents.send('translation-memory:update', { type: 'finished', message: 'editor.translationMemory.noMorePairs' });
				return { success: true, message: 'No more pairs.' };
			}
			
			const systemPrompt = t_main(lang, 'prompt.translationMemory.system.base', {
				sourceLanguage: novel.source_language,
				targetLanguage: novel.target_language
			});
			
			const userPrompt = t_main(lang, 'prompt.translationMemory.user.base', {
				sourceLanguage: novel.source_language,
				targetLanguage: novel.target_language,
				sourceText: nextPair.source,
				targetText: nextPair.target,
				pairCount: pairCount
			});
			
			const prompt = {
				system: systemPrompt,
				user: userPrompt
			};
			
			const result = await aiService.processLLMText({
				prompt,
				model,
				token,
				temperature
			});
			
			if (result && result.choices && result.choices.length > 0) {
				const rawResponse = result.choices[0].message.content.trim();
				const validatedResponse = validateAndFilterLLMResponse(rawResponse, novel.source_language, novel.target_language);
				
				if (validatedResponse) {
					const formattedBlock = `\n\n#${novelId}-${nextPair.marker}\n${validatedResponse}`;
					
					// MODIFICATION: Updated event channel
					memoryWindow.webContents.send('translation-memory:update', {
						type: 'new_instructions',
						data: {
							formattedBlock: formattedBlock,
							marker: nextPair.marker
						}
					});
				} else {
					throw new Error(`AI response was not in the expected pair format. Response: ${rawResponse}`);
				}
			} else {
				const errorMessage = result.error ? result.error.message : 'AI response was empty or invalid.';
				throw new Error(errorMessage);
			}
			
			return { success: true };
		} catch (error) {
			console.error('Translation memory generation failed:', error);
			// MODIFICATION: Updated event channel and i18n key
			memoryWindow.webContents.send('translation-memory:update', { type: 'error', message: 'editor.translationMemory.error', params: { message: error.message } });
			return { success: false, error: error.message };
		}
	});
	
	// MODIFICATION: Renamed handler and added XML metadata header on save
	ipcMain.handle('translation-memory:save', (event, { novelId, content }) => {
		const filePath = getTranslationMemoryPath(novelId);
		if (!filePath) {
			return { success: false, message: 'Invalid novelId.' };
		}
		try {
			const novel = db.prepare('SELECT title, author, source_language, target_language FROM novels WHERE id = ?').get(novelId);
			if (!novel) {
				throw new Error('Novel not found for metadata generation.');
			}
			
			// Create XML metadata header
			const metadata = `<!--
<metadata>
  <novel_id>${novelId}</novel_id>
  <title>${novel.title || 'Untitled'}</title>
  <author>${novel.author || 'Unknown'}</author>
  <source_language>${novel.source_language}</source_language>
  <target_language>${novel.target_language}</target_language>
  <generated_at>${new Date().toISOString()}</generated_at>
</metadata>
-->`;
			
			// Strip any existing header before prepending the new one
			const contentWithoutHeader = content.replace(/<!--\s*<metadata>[\s\S]*?<\/metadata>\s*-->\s*/, '');
			const finalContent = `${metadata}\n${contentWithoutHeader}`;
			
			fs.writeFileSync(filePath, finalContent, 'utf8');
			return { success: true };
		} catch (error) {
			console.error(`Failed to save translation memory for novel ${novelId}:`, error);
			return { success: false, message: error.message };
		}
	});
	
	// MODIFICATION: Renamed handler
	ipcMain.handle('translation-memory:load', (event, novelId) => {
		const filePath = getTranslationMemoryPath(novelId);
		if (!filePath) {
			return { success: false, message: 'Invalid novelId.' };
		}
		try {
			if (fs.existsSync(filePath)) {
				const content = fs.readFileSync(filePath, 'utf8');
				return { success: true, content };
			}
			return { success: true, content: '' };
		} catch (error) {
			console.error(`Failed to load translation memory for novel ${novelId}:`, error);
			return { success: false, message: error.message };
		}
	});
	
	// MODIFICATION: Renamed handler and added logic to strip XML header
	ipcMain.handle('translation-memory:getForAI', (event, novelId) => {
		const filePath = getTranslationMemoryPath(novelId);
		if (!filePath) {
			return '';
		}
		try {
			if (fs.existsSync(filePath)) {
				const content = fs.readFileSync(filePath, 'utf8');
				// Strip XML header and marker lines
				const contentWithoutHeader = content.replace(/<!--\s*<metadata>[\s\S]*?<\/metadata>\s*-->\s*/, '');
				const lines = contentWithoutHeader.split('\n');
				const filteredLines = lines.filter(line => !/^\s*#\d+-\d+\s*$/.test(line.trim()));
				return filteredLines.join('\n');
			}
			return '';
		} catch (error) {
			console.error(`Failed to get translation memory for AI (novel ${novelId}):`, error);
			return '';
		}
	});
	
	// NEW HANDLER: Get combined memory content for multiple novels
	ipcMain.handle('translation-memory:getForNovels', (event, novelIds) => {
		if (!Array.isArray(novelIds) || novelIds.length === 0) {
			return '';
		}
		
		let combinedContent = '';
		for (const novelId of novelIds) {
			const filePath = getTranslationMemoryPath(novelId);
			if (filePath && fs.existsSync(filePath)) {
				try {
					const content = fs.readFileSync(filePath, 'utf8');
					const contentWithoutHeader = content.replace(/<!--\s*<metadata>[\s\S]*?<\/metadata>\s*-->\s*/, '');
					const lines = contentWithoutHeader.split('\n');
					const filteredLines = lines.filter(line => !/^\s*#\d+-\d+\s*$/.test(line.trim()));
					if (filteredLines.length > 0) {
						combinedContent += filteredLines.join('\n') + '\n\n';
					}
				} catch (error) {
					console.error(`Failed to read translation memory for novel ${novelId}:`, error);
				}
			}
		}
		return combinedContent.trim();
	});
}

// MODIFICATION: Renamed exported function
module.exports = { registerTranslationMemoryHandlers };
