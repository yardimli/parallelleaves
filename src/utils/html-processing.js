/**
 * A collection of utility functions for processing HTML content within the application.
 * This includes converting HTML to plain text and processing text to add special links.
 */

/**
 * Converts an HTML string to a formatted plain text string.
 * This is useful for preparing content for AI prompts or saving a clean version of the text.
 * @param {string} html - The HTML string to convert.
 * @returns {string} The resulting plain text.
 */
export function htmlToPlainText(html) {
	if (!html) return '';
	// 1) Normalize BRs to newlines
	let s = html.replace(/<br\s*\/?>/gi, '\n');
	// 2) Insert newlines around block-level elements to preserve separation
	const block = '(?:p|div|section|article|header|footer|nav|aside|h[1-6]|ul|ol|li|table|thead|tbody|tfoot|tr|th|td|blockquote|pre|hr)';
	s = s
		.replace(new RegExp(`<\\s*${block}[^>]*>`, 'gi'), '\n')
		.replace(new RegExp(`<\\/\\s*${block}\\s*>`, 'gi'), '\n');
	// 3) Drop all remaining tags without adding spaces
	s = s.replace(/<[^>]+>/g, '');
	// 4) Trim accidental spaces before punctuation caused by earlier steps
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
 * Finds translation markers ([[#123]] and {{#123}}) in an HTML string and wraps them in links.
 * @param {string} htmlString - The HTML content to process.
 * @returns {string} The HTML string with markers linked.
 */
export function processSourceContentForMarkers(htmlString) {
	if (!htmlString) {
		return htmlString;
	}
	// Regex now finds both opening [[#...]] and closing {{#...}} markers.
	const markerRegex = /(\[\[#(\d+)\]\])|(\{\{#(\d+)\}\})/g;
	
	// Replace the found markers with anchor tags, now including a data-marker-type.
	return htmlString.replace(markerRegex, (match, p1, p2, p3, p4) => {
		const number = p2 || p4; // The captured number will be in either the 2nd or 4th capture group.
		// New: Determine if the marker is an opening or closing type.
		const type = p1 ? 'opening' : 'closing';
		return `<a href="#" class="translation-marker-link" data-marker-id="${number}" data-marker-type="${type}">${match}</a>`;
	});
}
