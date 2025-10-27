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
	
	const getSegments = (html) => {
		const segments = [];
		// This regex finds a marker and captures everything until the next marker or the end of the string.
		const parts = html.split(/(\[\[#\d+\]\])/g);
		for (let i = 1; i < parts.length; i += 2) {
			const marker = parts[i];
			const content = parts[i + 1] || '';
			const match = marker.match(/\[\[#(\d+)\]\]/);
			if (match) {
				const number = parseInt(match[1], 10);
				// Remove the corresponding closing marker from the content.
				const closingMarkerRegex = new RegExp(`\\s*\\{\\{#${number}\\}\\}\\s*`, 'g');
				const contentWithoutClosingMarkers = content.replace(closingMarkerRegex, '');
				const plainText = htmlToPlainText(contentWithoutClosingMarkers).trim();
				
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
				target: targetSegment.text,
			});
		}
	}
	
	// Sort by marker number to ensure chronological order
	return pairs.sort((a, b) => a.marker - b.marker);
};


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
				system: `You are a literary translation analyst. Your task is to analyze a pair of texts—an original and its translation—and generate three concise, actionable instructions for an AI translator to improve future translations based on the style observed.
- Each instruction must be a single sentence.
- Focus on tone, style, word choice, and literary devices.
- Do not mention specific words or phrases from the text. Generalize the advice.
- Respond ONLY with the three instructions, each on a new line. Do not add any other text, formatting, or numbering.`,
				user: `Analyze the translation and create 3 instructions each of up to a sentence long to a llm in format of:
<${novel.source_language}></${novel.source_language}>
<${novel.target_language}></${novel.target_language}>

${novel.source_language} Text:
<text>
${nextPair.source}
</text>

${novel.target_language} Text:
<text>
${nextPair.target}
</text>
`
			};
			console.log(prompt);
			
			// 6. Call the LLM
			const result = await aiService.processLLMText({
				prompt,
				model,
				token,
				temperature
			});
			
			if (result.success && result.data.choices && result.data.choices.length > 0) {
				const instructions = result.data.choices[0].message.content.trim();
				learningWindow.webContents.send('learning:update', {
					type: 'results',
					data: {
						marker: nextPair.marker,
						instructions: instructions.split('\n').filter(line => line.trim() !== '')
					}
				});
			} else {
				const errorMessage = result.error || (result.data.error ? result.data.error.message : 'Unknown AI error.');
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
