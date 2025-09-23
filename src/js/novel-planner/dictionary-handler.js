import { openDictionaryModal } from '../dictionary/dictionary-modal.js';
import { createIframeEditorInterface } from './editor-interface.js';

/**
 * Handles opening the dictionary modal, checking for selected text in either
 * the source or target editor to pre-fill a new dictionary entry.
 * @param {object|null} activeEditor - The contentWindow of the currently active iframe editor.
 * @param {object} currentSourceSelection - An object containing info about the current selection in the source column.
 */
export async function handleOpenDictionaryWithSelection (activeEditor, currentSourceSelection) {
	let selectedText = '';
	let sourceOrTarget = '';
	
	// Prioritize selection from the active iframe editor if one is focused
	if (activeEditor) {
		const editorInterface = createIframeEditorInterface(activeEditor);
		try {
			const iframeSelectedText = await editorInterface.getSelectionText();
			if (iframeSelectedText && iframeSelectedText.length > 0) {
				selectedText = iframeSelectedText;
				sourceOrTarget = 'target';
			}
		} catch (error) {
			console.error('Error getting selection from iframe:', error);
		}
	}
	
	// If no selection from iframe, check for selection in the source column
	if (!selectedText && currentSourceSelection.hasSelection && currentSourceSelection.text.length > 0) {
		selectedText = currentSourceSelection.text;
		sourceOrTarget = 'source';
	}
	
	openDictionaryModal(selectedText, sourceOrTarget);
};
