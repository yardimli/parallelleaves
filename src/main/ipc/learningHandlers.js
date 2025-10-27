const { ipcMain } = require('electron');
const aiService = require('../../ai/ai.js');
const { htmlToPlainText } = require('../utils.js');

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
	console.log(pairs);
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
	ipcMain.handle('learning:start', async (event, { novelId, model, temperature, lastMarkerNumber }) => {
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
			
			// 5. Construct the prompt
			const prompt = {
				system: `You are a literary translation analyst. Your task is to analyze a pair of texts—an original and its translation—and generate concise, actionable translation pairs for an AI translator to imitate the style of the human translator.
- Each instruction MUST be a pair of lines.
- The first line is the source text, starting with <${novel.source_language}> and ending with </${novel.source_language}>.
- The second line is the target text, starting with <${novel.target_language}> and ending with </${novel.target_language}>.
- Do NOT add any extra text, explanations, or formatting.`,
				user: `Analyze the following pair and generate exactly two (2) translation pairs that best reflect the translator's style.

Source (${novel.source_language}):
${nextPair.source}

Translation (${novel.target_language}):
${nextPair.target}
`
			};
			
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
