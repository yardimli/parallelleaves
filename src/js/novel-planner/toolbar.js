import { openPromptEditor } from '../prompt-editor.js';
import { getActiveEditor } from './content-editor.js';

// MODIFIED: These variables now manage communication with iframes.
let activeContentWindow = null;
let currentToolbarState = {};
const toolbar = document.getElementById('top-toolbar');
const wordCountEl = document.getElementById('js-word-count');
let toolbarConfig = {};

// NEW: Function to set the active iframe's content window.
export function setActiveContentWindow(contentWindow) {
	activeContentWindow = contentWindow;
}

// MODIFIED: This function now receives a plain state object from an iframe.
export function updateToolbarState(newState) {
	currentToolbarState = newState || {};
	const allBtns = toolbar.querySelectorAll('.js-toolbar-btn, .js-ai-action-btn');
	
	allBtns.forEach(btn => {
		btn.disabled = true;
		btn.classList.remove('active');
	});
	const headingBtn = toolbar.querySelector('.js-heading-btn');
	if (headingBtn) headingBtn.textContent = 'Paragraph';
	wordCountEl.textContent = 'No text selected';
	
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
					wordCountEl.textContent = `${words.length} word${words.length !== 1 ? 's' : ''} selected (source)`;
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
				case 'add_note':
					btn.disabled = !newState.canAddNote;
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
				headingBtn.textContent = `Heading ${newState.headingLevel}`;
			} else {
				headingBtn.textContent = 'Paragraph';
			}
			headingBtn.disabled = false;
		}
		
		if (newState.isTextSelected) {
			const words = newState.selectionText.trim().split(/\s+/).filter(Boolean);
			wordCountEl.textContent = `${words.length} word${words.length !== 1 ? 's' : ''} selected`;
		} else if (!translateBtn || translateBtn.disabled) {
			wordCountEl.textContent = 'No text selected';
		}
	}
}

// MODIFIED: Sends a command to the active iframe via postMessage.
function applyCommand(command, attrs = {}) {
	if (!activeContentWindow) return;
	activeContentWindow.postMessage({
		type: 'command',
		payload: { command, attrs }
	}, window.location.origin);
}

// MODIFIED: Sends a highlight command to the active iframe.
function applyHighlight(color) {
	if (!activeContentWindow) return;
	activeContentWindow.postMessage({
		type: 'command',
		payload: { command: 'highlight', attrs: { color } }
	}, window.location.origin);
}

async function handleToolbarAction(button) {
	if (button.classList.contains('js-ai-action-btn')) {
		const action = button.dataset.action;
		const novelId = document.body.dataset.novelId;
		if (!novelId) {
			window.showAlert('Could not determine the current project.');
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
			
			const findBlockMarkerForNode = (node, container, offset) => {
				let el = node === container ? container.childNodes[offset - 1] : (node.nodeType === Node.TEXT_NODE ? node.parentElement : node);
				while (el && el.parentElement !== container) el = el.parentElement;
				if (!el) return null;
				let current = el;
				while (current) {
					if (current.nodeType === Node.ELEMENT_NODE && current.hasAttribute('data-block-number')) return current;
					current = current.previousElementSibling;
				}
				return null;
			};
			
			const startMarker = findBlockMarkerForNode(range.startContainer, sourceContainer, range.startOffset);
			const endMarker = findBlockMarkerForNode(range.endContainer, sourceContainer, range.endOffset);
			
			if (startMarker !== endMarker) {
				window.showAlert('Selection cannot span across multiple translation blocks. Please select text within a single block.', 'Selection Error');
				return;
			}
			
			const selectedText = selection.toString();
			const chapterItem = sourceContainer.closest('.manuscript-chapter-item');
			const chapterId = chapterItem.dataset.chapterId;
			const blockNumber = startMarker ? parseInt(startMarker.dataset.blockNumber, 10) : 1;
			
			// MODIFIED: Find the correct iframe contentWindow for the target editor.
			const targetContentWindow = toolbarConfig.getChapterViews(chapterId)?.iframe.contentWindow;
			if (!targetContentWindow) {
				window.showAlert('Could not find the target editor for this chapter.');
				return;
			}
			
			const allCodexEntries = await window.api.getAllCodexEntriesForNovel(novelId);
			const linkedCodexEntryIds = await window.api.getLinkedCodexIdsForChapter(chapterId);
			
			const context = {
				selectedText,
				allCodexEntries,
				linkedCodexEntryIds,
				languageForPrompt: novelData.source_language || 'English',
				targetLanguage: novelData.target_language || 'English',
				activeEditorView: targetContentWindow, // Pass the contentWindow
				translationInfo: { blockNumber },
			};
			openPromptEditor(context, 'translate', settings);
			return;
		}
		
		const focusedEditor = getActiveEditor();
		if (!focusedEditor) return;
		
		const { selectionText } = currentToolbarState;
		const chapterId = toolbarConfig.getActiveChapterId ? toolbarConfig.getActiveChapterId() : null;
		
		const allCodexEntries = await window.api.getAllCodexEntriesForNovel(novelId);
		let linkedCodexEntryIds = chapterId ? await window.api.getLinkedCodexIdsForChapter(chapterId) : [];
		
		const context = {
			selectedText: selectionText,
			allCodexEntries,
			linkedCodexEntryIds,
			languageForPrompt: novelData.target_language || 'English',
			wordsBefore: '', // Note: Getting surrounding text is complex with iframes and omitted for this refactor.
			wordsAfter: '',
			activeEditorView: focusedEditor,
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
		} else if (command === 'add_note') {
			const activeChapterId = toolbarConfig.getActiveChapterId ? toolbarConfig.getActiveChapterId() : null;
			if (!activeChapterId) {
				window.showAlert('Cannot add a note without an active chapter.');
				return;
			}
			const noteModal = document.getElementById('note-editor-modal');
			const form = document.getElementById('note-editor-form');
			form.reset();
			noteModal.querySelector('.js-note-modal-title').textContent = 'Add Note';
			document.getElementById('note-pos').value = '';
			noteModal.showModal();
			document.getElementById('note-content-input').focus();
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
