const path = require('path');
const fs = require('fs');

/**
 * Retrieves an HTML template file's content.
 * @param {string} templateName - The name of the template without the extension.
 * @returns {string} The content of the HTML template.
 */
function getTemplate(templateName) {
	const templatePath = path.join(__dirname, '..', '..', 'public', 'templates', `${templateName}.html`);
	try {
		return fs.readFileSync(templatePath, 'utf8');
	} catch (error) {
		console.error(`Failed to read template: ${templateName}`, error);
		return `<p class="text-error">Error: Could not load template ${templateName}.</p>`;
	}
}

/**
 * Converts an HTML string to a formatted plain text string.
 * @param {string} html - The HTML string to convert.
 * @returns {string} The resulting plain text.
 */
function htmlToPlainText(html) {
	if (!html) return '';
	// 1) Normalize BRs to newlines
	let s = html.replace(/<br\s*\/?>/gi, '\n');
	// 2) Insert newlines around block-level elements
	const block = '(?:p|div|section|article|header|footer|nav|aside|h[1-6]|ul|ol|li|table|thead|tbody|tfoot|tr|th|td|blockquote|pre|hr)';
	s = s
		.replace(new RegExp(`<\\s*${block}[^>]*>`, 'gi'), '\n')
		.replace(new RegExp(`<\\/\\s*${block}\\s*>`, 'gi'), '\n');
	// 3) Drop all remaining tags
	s = s.replace(/<[^>]+>/g, '');
	// 4) Trim accidental spaces before punctuation
	s = s
		.replace(/\s+([.,!?;:])/g, '$1')
		.replace(/(\() +/g, '$1')
		.replace(/ +(\))/g, '$1');
	// 5) Collapse whitespace and normalize newlines
	s = s
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n[ \t]+/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.replace(/[ \t]{2,}/g, ' ');
	return s.trim();
}

/**
 * Counts the words in an HTML string.
 * @param {string} html - The HTML string.
 * @returns {number} The number of words.
 */
function countWordsInHtml(html) {
	if (!html) return 0;
	const text = htmlToPlainText(html);
	const words = text.trim().split(/\s+/).filter(Boolean);
	return words.length;
}

/**
 * Scans two HTML strings to find all instances of `[[#<number>]]` and returns the highest number found.
 * @param {string} sourceHtml - The HTML of the source content.
 * @param {string} targetHtml - The HTML of the target content.
 * @returns {number} The highest marker number found, or 0 if none are found.
 */
function findHighestMarkerNumber(sourceHtml, targetHtml) {
	const markerRegex = /\[\[#(\d+)\]\]/g;
	let highest = 0;
	
	const combinedHtml = sourceHtml + targetHtml;
	const matches = combinedHtml.matchAll(markerRegex);
	
	for (const match of matches) {
		const num = parseInt(match[1], 10);
		if (num > highest) {
			highest = num;
		}
	}
	
	return highest;
}

module.exports = {
	getTemplate,
	htmlToPlainText,
	countWordsInHtml,
	findHighestMarkerNumber
};
