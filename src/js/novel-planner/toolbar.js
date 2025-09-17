import { openPromptEditor } from '../prompt-editor.js';
import { t } from '../i18n.js';

let activeContentWindow = null;
let currentToolbarState = {};
const toolbar = document.getElementById('top-toolbar');
const wordCountEl = document.getElementById('js-word-count');
let toolbarConfig = {};

export function setActiveContentWindow(contentWindow) {
	activeContentWindow = contentWindow;
}

export function updateToolbarState(newState) {
	currentToolbarState = newState || {};
	const allBtns = toolbar.querySelectorAll('.js-toolbar-btn, .js-ai-action-btn');
	
	allBtns.forEach(btn => {
		btn.disabled = true;
		btn.classList.remove('active');
	});
	const headingBtn = toolbar.querySelector('.js-heading-btn');
	if (headingBtn) headingBtn.textContent = t('editor.paragraph');
	wordCountEl.textContent = t('editor.noTextSelected');
	
	const translateBtn = toolbar.querySelector('.js-ai-action-btn[data-action="translate"]');
	if (translateBtn) {
		const selection = window.getSelection();
		if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
			const range = selection.getRangeAt(0);
			let checkNode = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
			const sourceContainer = checkNode.closest('.source-content-readonly');
			if (sourceContainer) {
				const text = selection.toString().trim();
				if (text.length > 0) {
					translateBtn.disabled = false;
					const words = text.split(/\s+/).filter(Boolean);
					wordCountEl.textContent = t('editor.wordsSelectedSource', { count: words.length });
				}
			}
		}
	}
	
	if (newState) {
		allBtns.forEach(btn => {
			const cmd = btn.dataset.command;
			if (btn.classList.contains('js-ai-action-btn')) {
				if (btn.dataset.action === 'rephrase') btn.disabled = !newState.isTextSelected;
				return;
			}
			
			btn.disabled = false;
			
			switch (cmd) {
				case 'undo':
					btn.disabled = !newState.canUndo;
					break;
				case 'redo':
					btn.disabled = !newState.canRedo;
					break;
				case 'create_codex':
					btn.disabled = !newState.isTextSelected;
					break;
				case 'bold':
					btn.classList.toggle('active', newState.activeMarks.includes('strong'));
					break;
				case 'italic':
					btn.classList.toggle('active', newState.activeMarks.includes('em'));
					break;
				case 'underline':
					btn.classList.toggle('active', newState.activeMarks.includes('underline'));
					break;
				case 'strike':
					btn.classList.toggle('active', newState.activeMarks.includes('strike'));
					break;
				case 'blockquote':
					btn.classList.toggle('active', newState.activeNodes.includes('blockquote'));
					break;
				case 'bullet_list':
					btn.classList.toggle('active', newState.activeNodes.includes('bullet_list'));
					break;
				case 'ordered_list':
					btn.classList.toggle('active', newState.activeNodes.includes('ordered_list'));
					break;
			}
			if (btn.closest('.js-dropdown-container')) {
				btn.disabled = !newState.isTextSelected;
			}
		});
		
		if (headingBtn) {
			if (newState.headingLevel > 0) {
				headingBtn.textContent = `${t(`editor.heading${newState.headingLevel}`)}`;
			} else {
				headingBtn.textContent = t('editor.paragraph');
			}
			headingBtn.disabled = false;
		}
		
		if (newState.isTextSelected) {
			const words = newState.selectionText.trim().split(/\s+/).filter(Boolean);
			wordCountEl.textContent = t('editor.wordsSelected', { count: words.length });
		} else if (!translateBtn || translateBtn.disabled) {
			wordCountEl.textContent = t('editor.noTextSelected');
		}
	}
}

function applyCommand(command, attrs = {}) {
	if (!activeContentWindow) return;
	activeContentWindow.postMessage({
		type: 'command',
		payload: { command, attrs }
	}, window.location.origin);
}

function applyHighlight(color) {
	if (!activeContentWindow) return;
	activeContentWindow.postMessage({
		type: 'command',
		payload: { command: 'highlight', attrs: { color } }
	}, window.location.origin);
}

const createIframeEditorInterface = (contentWindow) => {
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
		setEditable: (isEditable) => post('setEditable', { isEditable }),
		cleanupSuggestion: () => post('cleanupAiSuggestion'),
		discardAiSuggestion: (from, to, originalFragmentJson) => post('discardAiSuggestion', { from, to, originalFragmentJson }),
		
		replaceRangeWithSuggestion: (from, to, newContentHtml) => new Promise((resolve) => {
			const listener = (event) => {
				if (event.source === contentWindow && event.data.type === 'replacementComplete') {
					window.removeEventListener('message', listener);
					resolve({finalRange:event.data.payload.finalRange, endCoords:event.data.payload.endCoords});
				}
			};
			window.addEventListener('message', listener);
			post('replaceRange', { from, to, newContentHtml });
		}),
	};
};


async function handleToolbarAction(button) {
	if (button.classList.contains('js-ai-action-btn')) {
		const action = button.dataset.action;
		const novelId = document.body.dataset.novelId;
		if (!novelId) {
			window.showAlert(t('editor.toolbar.errorNoProject'));
			return;
		}
		
		const novelData = await window.api.getOneNovel(novelId);
		
		let settings = {};
		if (action === 'rephrase' && novelData.rephrase_settings) {
			try {
				settings = JSON.parse(novelData.rephrase_settings);
			} catch (e) {
				console.error('Error parsing rephrase_settings JSON', e);
			}
		} else if (action === 'translate' && novelData.translate_settings) {
			try {
				settings = JSON.parse(novelData.translate_settings);
			} catch (e) {
				console.error('Error parsing translate_settings JSON', e);
			}
		}
		
		if (action === 'translate') {
			const selection = window.getSelection();
			if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
			
			const range = selection.getRangeAt(0);
			
			let checkNode = range.commonAncestorContainer;
			if (checkNode.nodeType === Node.TEXT_NODE) {
				checkNode = checkNode.parentElement;
			}
			const sourceContainer = checkNode.closest('.source-content-readonly');
			
			if (!sourceContainer) return;
			
			const selectedText = selection.toString();
			const chapterItem = sourceContainer.closest('.manuscript-chapter-item');
			const chapterId = chapterItem.dataset.chapterId;
			
			// Pass the iframe editor interface to openPromptEditor.
			const targetContentWindow = toolbarConfig.getChapterViews(chapterId)?.iframe.contentWindow;
			if (!targetContentWindow) {
				window.showAlert(t('editor.toolbar.errorNoTargetEditor'));
				return;
			}
			
			const allCodexEntries = await window.api.getAllCodexEntriesForNovel(novelId);
			
			// The context no longer needs block-specific info.
			const context = {
				selectedText,
				allCodexEntries,
				languageForPrompt: novelData.source_language || 'English',
				targetLanguage: novelData.target_language || 'English',
				activeEditorView: targetContentWindow,
				editorInterface: createIframeEditorInterface(targetContentWindow),
				chapterId: chapterId, // Pass chapterId for context fetching
			};
			openPromptEditor(context, 'translate', settings);
			return;
		}
		
		// This is for the 'rephrase' action in the chapter editor.
		if (!activeContentWindow) return;
		
		const { selectionText } = currentToolbarState;
		const chapterId = toolbarConfig.getActiveChapterId ? toolbarConfig.getActiveChapterId() : null;
		
		const allCodexEntries = await window.api.getAllCodexEntriesForNovel(novelId);
		
		const context = {
			selectedText: selectionText,
			allCodexEntries,
			languageForPrompt: novelData.target_language || 'English',
			activeEditorView: activeContentWindow, // Kept for backward compatibility
			editorInterface: createIframeEditorInterface(activeContentWindow),
			chapterId: chapterId,
		};
		openPromptEditor(context, action, settings);
		return;
	}
	
	if (!activeContentWindow && !button.closest('.js-dropdown-container')) {
		return;
	}
	
	const command = button.dataset.command;
	
	if (command) {
		if (command === 'create_codex') {
			if (!currentToolbarState.isTextSelected) return;
			const novelId = document.body.dataset.novelId;
			if (novelId && currentToolbarState.selectionText) {
				window.api.openNewCodexEditor({ novelId, selectedText: currentToolbarState.selectionText });
			}
		} else {
			applyCommand(command);
		}
	} else if (button.classList.contains('js-highlight-option')) {
		applyHighlight(button.dataset.bg.replace('highlight-', ''));
		if (document.activeElement) document.activeElement.blur();
	} else if (button.classList.contains('js-heading-option')) {
		const level = parseInt(button.dataset.level, 10);
		applyCommand('heading', { level });
		if (document.activeElement) document.activeElement.blur();
	}
}

export function setupTopToolbar(config = {}) {
	toolbarConfig = config;
	if (!toolbar) return;
	
	toolbar.addEventListener('mousedown', event => {
		const target = event.target;
		const dropdownTrigger = target.closest('button[tabindex="0"]');
		const inDropdownContent = target.closest('.dropdown-content');
		
		if ((dropdownTrigger && dropdownTrigger.closest('.dropdown')) || inDropdownContent) {
			return;
		}
		
		event.preventDefault();
	});
	
	toolbar.addEventListener('click', event => {
		const button = event.target.closest('button');
		if (!button || button.disabled) return;
		
		if (button.closest('.js-dropdown-container')) {
			if (button.classList.contains('js-toolbar-btn')) return;
		}
		
		handleToolbarAction(button);
	});
	
	updateToolbarState(null);
}
