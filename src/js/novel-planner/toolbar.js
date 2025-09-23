import { openPromptEditor } from '../prompt-editor.js';
import { t } from '../i18n.js';
import { createIframeEditorInterface } from './editor-interface.js';

let activeContentWindow = null;
let currentToolbarState = {};
const toolbar = document.getElementById('top-toolbar');
const wordCountEl = document.getElementById('js-word-count');
let toolbarConfig = {};

export function setActiveContentWindow (contentWindow) {
	activeContentWindow = contentWindow;
}

export function updateToolbarState (newState) {
	currentToolbarState = newState || {};
	const allBtns = toolbar.querySelectorAll('.js-toolbar-btn, .js-ai-action-btn');
	
	allBtns.forEach(btn => {
		btn.disabled = true;
		btn.classList.remove('active');
	});
	const headingBtn = toolbar.querySelector('.js-heading-btn');
	if (headingBtn) headingBtn.textContent = t('editor.paragraph');
	wordCountEl.textContent = t('editor.noTextSelected');
	
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
					btn.classList.toggle('active', newState.activeMarks.includes('bullet_list'));
					break;
				case 'ordered_list':
					btn.classList.toggle('active', newState.activeMarks.includes('ordered_list'));
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
		} else {
			wordCountEl.textContent = t('editor.noTextSelected');
		}
	}
}

function applyCommand (command, attrs = {}) {
	if (!activeContentWindow) return;
	activeContentWindow.postMessage({
		type: 'command',
		payload: { command, attrs }
	}, window.location.origin);
}

function applyHighlight (color) {
	if (!activeContentWindow) return;
	activeContentWindow.postMessage({
		type: 'command',
		payload: { command: 'highlight', attrs: { color } }
	}, window.location.origin);
}

async function handleToolbarAction (button) {
	if (button.id === 'js-open-dictionary-btn') {
		// Modified: Use the callback passed during setup
		if (typeof toolbarConfig.onOpenDictionary === 'function') {
			await toolbarConfig.onOpenDictionary();
		}
		return;
	}
	
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
		
		if (!activeContentWindow) return;
		
		const editorInterface = createIframeEditorInterface(activeContentWindow);
		const selectionInfo = await editorInterface.getSelectionInfo(action);
		
		if (!selectionInfo) {
			console.log('Rephrase action cancelled: no text selected in the editor.');
			return;
		}
		
		const chapterId = toolbarConfig.getActiveChapterId ? toolbarConfig.getActiveChapterId() : null;
		
		const context = {
			selectedText: selectionInfo.selectedText,
			wordsBefore: selectionInfo.wordsBefore,
			wordsAfter: selectionInfo.wordsAfter,
			languageForPrompt: novelData.target_language || 'English',
			activeEditorView: activeContentWindow,
			editorInterface: editorInterface,
			chapterId: chapterId,
			novelId: novelId
		};
		openPromptEditor(context, action, settings);
		return;
	}
	
	if (!activeContentWindow && !button.closest('.js-dropdown-container')) {
		return;
	}
	
	const command = button.dataset.command;
	
	if (command) {
		applyCommand(command);
	} else if (button.classList.contains('js-highlight-option')) {
		applyHighlight(button.dataset.bg.replace('highlight-', ''));
		if (document.activeElement) document.activeElement.blur();
	} else if (button.classList.contains('js-heading-option')) {
		const level = parseInt(button.dataset.level, 10);
		applyCommand('heading', { level });
		if (document.activeElement) document.activeElement.blur();
	}
}

export function setupTopToolbar (config = {}) {
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
