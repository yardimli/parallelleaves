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
 * Finds codex entry titles and phrases in an HTML string and wraps them in links.
 * @param {string} htmlString - The HTML content to process.
 * @param {Array<object>} codexCategories - The array of codex categories containing entries.
 * @returns {string} The HTML string with codex terms linked.
 */
export function processSourceContentForCodexLinks(htmlString, codexCategories) {
	if (!codexCategories || codexCategories.length === 0 || !htmlString) {
		return htmlString;
	}
	
	// 1. Create a flat list of terms to search for (titles and document phrases).
	const terms = [];
	codexCategories.forEach(category => {
		category.entries.forEach(entry => {
			if (entry.title) {
				terms.push({ text: entry.title, id: entry.id });
			}
			if (entry.document_phrases) {
				const phrases = entry.document_phrases.split(',').map(p => p.trim()).filter(Boolean);
				phrases.forEach(phrase => {
					terms.push({ text: phrase, id: entry.id });
				});
			}
		});
	});
	
	if (terms.length === 0) {
		return htmlString;
	}
	
	// Sort by length descending to match longer phrases first (e.g., "King Arthur" before "King").
	terms.sort((a, b) => b.text.length - a.text.length);
	
	const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const regex = new RegExp(`\\b(${terms.map(term => escapeRegex(term.text)).join('|')})\\b`, 'gi');
	
	// Map lower-cased phrases back to their entry IDs for case-insensitive matching.
	const termMap = new Map();
	terms.forEach(term => {
		termMap.set(term.text.toLowerCase(), term.id);
	});
	
	// 2. Parse HTML and walk through all text nodes.
	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = htmlString;
	
	const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT, null, false);
	const nodesToProcess = [];
	let node;
	while ((node = walker.nextNode())) {
		// Avoid creating links inside existing links or other unwanted elements.
		if (node.parentElement.closest('a, script, style')) {
			continue;
		}
		nodesToProcess.push(node);
	}
	
	// 3. For each text node, find matches and replace them with link elements.
	nodesToProcess.forEach(textNode => {
		const text = textNode.textContent;
		const matches = [...text.matchAll(regex)];
		
		if (matches.length > 0) {
			const fragment = document.createDocumentFragment();
			let lastIndex = 0;
			
			matches.forEach(match => {
				const matchedText = match[0];
				const entryId = termMap.get(matchedText.toLowerCase());
				if (!entryId) return;
				
				// Add text before the match.
				if (match.index > lastIndex) {
					fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
				}
				
				// Create and add the link.
				const link = document.createElement('a');
				link.href = '#';
				link.className = 'codex-link';
				link.dataset.codexEntryId = entryId;
				link.textContent = matchedText;
				fragment.appendChild(link);
				
				lastIndex = match.index + matchedText.length;
			});
			
			// Add any remaining text after the last match.
			if (lastIndex < text.length) {
				fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
			}
			
			// Replace the original text node with the new fragment.
			textNode.parentNode.replaceChild(fragment, textNode);
		}
	});
	
	// 4. Return the modified HTML.
	return tempDiv.innerHTML;
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
	// Modified: Regex now finds both opening [[#...]] and closing {{#...}} markers.
	const markerRegex = /(\[\[#(\d+)\]\])|(\{\{#(\d+)\}\})/g;
	
	// Replace the found markers with anchor tags.
	return htmlString.replace(markerRegex, (match, p1, p2, p3, p4) => {
		const number = p2 || p4; // The captured number will be in either the 2nd or 4th capture group.
		return `<a href="#" class="translation-marker-link" data-marker-id="${number}">${match}</a>`;
	});
}
