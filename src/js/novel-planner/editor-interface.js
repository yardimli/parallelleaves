/**
 * Creates an interface object for communicating with a specific editor iframe.
 * This standardizes how the main window sends commands and requests data from iframes.
 * @param {Window} contentWindow - The contentWindow of the target iframe.
 * @returns {object} An interface object with methods to interact with the iframe.
 */
export const createIframeEditorInterface = (contentWindow) => {
	const post = (type, payload) => contentWindow.postMessage({ type, payload }, window.location.origin);
	
	return {
		type: 'iframe',
		// getting the current selection from the target editor to use as an insertion point.
		getSelectionInfo: (action) => new Promise((resolve) => {
			const listener = (event) => {
				if (event.source === contentWindow && event.data.type === 'selectionResponse') {
					window.removeEventListener('message', listener);
					resolve(event.data.payload);
				}
			};
			window.addEventListener('message', listener);
			
			// Both actions now just need the current selection state from the editor.
			post('prepareForRephrase', { isRephrase: action === 'rephrase' });
		}),
		getSelectionText: () => new Promise((resolve) => {
			const listener = (event) => {
				if (event.source === contentWindow && event.data.type === 'selectionResponse') {
					window.removeEventListener('message', listener);
					resolve(event.data.payload.selectedText);
				}
			};
			window.addEventListener('message', listener);
			post('getSelectionText'); // Send message to iframe to get selection text
		}),
		getFullHtml: () => new Promise((resolve) => {
			const listener = (event) => {
				if (event.source === contentWindow && event.data.type === 'fullHtmlResponse') {
					window.removeEventListener('message', listener);
					resolve(event.data.payload.html);
				}
			};
			window.addEventListener('message', listener);
			post('prepareForGetFullHtml');
		}),
		setEditable: (isEditable) => post('setEditable', { isEditable }),
		cleanupSuggestion: () => post('cleanupAiSuggestion'),
		discardAiSuggestion: (from, to, originalFragmentJson) => post('discardAiSuggestion', { from, to, originalFragmentJson }),
		
		replaceRangeWithSuggestion: (from, to, newContentHtml) => new Promise((resolve) => {
			const listener = (event) => {
				if (event.source === contentWindow && event.data.type === 'replacementComplete') {
					window.removeEventListener('message', listener);
					resolve({ finalRange: event.data.payload.finalRange, endCoords: event.data.payload.endCoords });
				}
			};
			window.addEventListener('message', listener);
			post('replaceRange', { from, to, newContentHtml });
		})
	};
};
