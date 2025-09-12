import {toggleMark, setBlockType, wrapIn, lift} from 'prosemirror-commands';
import {history, undo, redo} from 'prosemirror-history';
import {wrapInList, liftListItem} from 'prosemirror-schema-list';
import {openPromptEditor} from '../prompt-editor.js';
import {getActiveEditor} from './content-editor.js';


let activeEditorView = null;
const toolbar = document.getElementById('top-toolbar');
const wordCountEl = document.getElementById('js-word-count');
let toolbarConfig = {};


function isNodeActive(state, type) {
	const {$from} = state.selection;
	for (let i = $from.depth; i > 0; i--) {
		if ($from.node(i).type === type) {
			return true;
		}
	}
	return false;
}

export function updateToolbarState(view) {
	activeEditorView = view;
	const allBtns = toolbar.querySelectorAll('.js-toolbar-btn, .js-ai-action-btn');
	
	const isMarkActive = (state, type) => {
		if (!type) return false;
		const {from, $from, to, empty} = state.selection;
		if (empty) {
			return !!(state.storedMarks || $from.marks()).some(mark => mark.type === type);
		}
		return state.doc.rangeHasMark(from, to, type);
	};
	
	if (view && view.state) {
		const {state} = view;
		const {schema} = state;
		const {from, to, empty, $from} = state.selection;
		
		const isTextSelected = !empty;
		
		allBtns.forEach(btn => {
			if (btn.classList.contains('js-ai-action-btn')) {
				const action = btn.dataset.action;
				if (action === 'scene-summarization') {
					btn.disabled = false;
				} else {
					btn.disabled = !isTextSelected;
				}
				return;
			}
			
			const cmd = btn.dataset.command;
			let commandFn, markType;
			
			switch (cmd) {
				case 'undo':
					btn.disabled = !undo(state);
					return;
				case 'redo':
					btn.disabled = !redo(state);
					return;
				case 'create_codex':
					btn.disabled = empty;
					return;
				case 'add_note': {
					const {$from} = state.selection;
					const isAtEmptyPara = empty && $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0;
					btn.disabled = !isAtEmptyPara;
					return;
				}
				case 'bold':
					markType = schema.marks.strong;
					commandFn = toggleMark(markType);
					break;
				case 'italic':
					markType = schema.marks.em;
					commandFn = toggleMark(markType);
					break;
				case 'underline':
					markType = schema.marks.underline;
					commandFn = toggleMark(markType);
					break;
				case 'strike':
					markType = schema.marks.strike;
					commandFn = toggleMark(markType);
					break;
				case 'blockquote':
					commandFn = isNodeActive(state, schema.nodes.blockquote) ? lift : wrapIn(schema.nodes.blockquote);
					btn.classList.toggle('active', isNodeActive(state, schema.nodes.blockquote));
					break;
				case 'bullet_list':
					commandFn = isNodeActive(state, schema.nodes.bullet_list) ? liftListItem(schema.nodes.list_item) : wrapInList(schema.nodes.bullet_list);
					btn.classList.toggle('active', isNodeActive(state, schema.nodes.bullet_list));
					break;
				case 'ordered_list':
					commandFn = isNodeActive(state, schema.nodes.ordered_list) ? liftListItem(schema.nodes.list_item) : wrapInList(schema.nodes.ordered_list);
					btn.classList.toggle('active', isNodeActive(state, schema.nodes.ordered_list));
					break;
				case 'horizontal_rule':
					btn.disabled = !((state, dispatch) => {
						if (dispatch) dispatch(state.tr.replaceSelectionWith(schema.nodes.horizontal_rule.create()));
						return true;
					})(state);
					return;
			}
			
			if (btn.closest('.js-dropdown-container')) {
				btn.disabled = !isTextSelected;
			}
			
			if (commandFn) {
				btn.disabled = !commandFn(state);
			}
			
			if (markType) {
				btn.classList.toggle('active', isMarkActive(state, markType));
			}
		});
		
		const headingBtn = toolbar.querySelector('.js-heading-btn');
		if (headingBtn) {
			const parent = $from.parent;
			if (parent.type.name === 'heading') {
				headingBtn.textContent = `Heading ${parent.attrs.level}`;
			} else {
				headingBtn.textContent = 'Paragraph';
			}
			headingBtn.disabled = !setBlockType(schema.nodes.paragraph)(state) && !setBlockType(schema.nodes.heading, {level: 1})(state);
		}
		
		if (isTextSelected) {
			const text = state.doc.textBetween(from, to, ' ');
			const words = text.trim().split(/\s+/).filter(Boolean);
			wordCountEl.textContent = `${words.length} word${words.length !== 1 ? 's' : ''} selected`;
		} else {
			wordCountEl.textContent = 'No text selected';
		}
		
	} else {
		allBtns.forEach(btn => {
			btn.disabled = true;
			btn.classList.remove('active');
		});
		const headingBtn = toolbar.querySelector('.js-heading-btn');
		if (headingBtn) headingBtn.textContent = 'Paragraph';
		wordCountEl.textContent = 'No text selected';
	}
}

function applyCommand(command, attrs = {}) {
	if (!activeEditorView) return;
	
	const {state, dispatch} = activeEditorView;
	const {schema} = state;
	let cmd;
	
	switch (command) {
		case 'bold':
			cmd = toggleMark(schema.marks.strong);
			break;
		case 'italic':
			cmd = toggleMark(schema.marks.em);
			break;
		case 'underline':
			cmd = toggleMark(schema.marks.underline);
			break;
		case 'strike':
			cmd = toggleMark(schema.marks.strike);
			break;
		case 'blockquote':
			cmd = isNodeActive(state, schema.nodes.blockquote) ? lift : wrapIn(schema.nodes.blockquote);
			break;
		case 'bullet_list':
			cmd = isNodeActive(state, schema.nodes.bullet_list) ? liftListItem(schema.nodes.list_item) : wrapInList(schema.nodes.bullet_list);
			break;
		case 'ordered_list':
			cmd = isNodeActive(state, schema.nodes.ordered_list) ? liftListItem(schema.nodes.list_item) : wrapInList(schema.nodes.ordered_list);
			break;
		case 'horizontal_rule':
			dispatch(state.tr.replaceSelectionWith(schema.nodes.horizontal_rule.create()));
			break;
		case 'heading':
			const {level} = attrs;
			cmd = (level === 0)
				? setBlockType(schema.nodes.paragraph)
				: setBlockType(schema.nodes.heading, {level});
			break;
	}
	
	if (cmd) {
		cmd(state, dispatch);
	}
}

function applyHighlight(color) {
	if (!activeEditorView) return;
	
	const {state} = activeEditorView;
	const {schema} = state;
	const {from, to} = state.selection;
	let tr = state.tr;
	
	Object.keys(schema.marks).forEach(markName => {
		if (markName.startsWith('highlight_')) {
			tr = tr.removeMark(from, to, schema.marks[markName]);
		}
	});
	
	if (color !== 'transparent') {
		const markType = schema.marks[`highlight_${color}`];
		if (markType) {
			tr = tr.addMark(from, to, markType.create());
		}
	}
	
	activeEditorView.dispatch(tr);
}

async function handleToolbarAction(button) {
	if (button.classList.contains('js-ai-action-btn')) {
		const action = button.dataset.action;
		const novelId = document.body.dataset.novelId;
		if (!novelId) {
			alert('Error: Could not determine the current project.');
			return;
		}
		
		const isChapterEditor = toolbarConfig.isChapterEditor;
		
		const focusedEditor = getActiveEditor();
		let editorForPrompt = focusedEditor;
		let selectedText = '';
		let wordsBefore = '';
		let wordsAfter = '';
		let chapterId = null;
		
		const novelData = await window.api.getOneNovel(novelId);
		let languageForPrompt;
		
		if (action === 'scene-summarization') {
			if (isChapterEditor) {
				chapterId = toolbarConfig.getActiveChapterId ? toolbarConfig.getActiveChapterId() : null;
				if (!chapterId) {
					alert('Could not determine the active chapter.');
					return;
				}
				const views = toolbarConfig.getChapterViews ? toolbarConfig.getChapterViews(chapterId) : null;
				if (!views) {
					alert('Could not find editor views for the active chapter.');
					return;
				}
				
				// MODIFIED: Determine which content to summarize based on the focused editor.
				if (focusedEditor === views.targetContentView) {
					// User's cursor is in the target editor.
					selectedText = views.targetContentView.state.doc.textContent;
					editorForPrompt = views.targetSummaryView; // Output to target summary
					languageForPrompt = novelData.target_language || 'English';
				} else {
					// Fallback: Cursor is in the source editor, a summary box, or somewhere else.
					// Default to summarizing the source content.
					selectedText = views.sourceContentView.state.doc.textContent;
					editorForPrompt = views.sourceSummaryView; // Output to source summary
					languageForPrompt = novelData.source_language || 'English';
				}
			} else {
				// We are in a different editor (e.g., Codex). Summarize the active editor's full content.
				if (focusedEditor) {
					selectedText = focusedEditor.state.doc.textContent;
					editorForPrompt = focusedEditor; // The result will replace the current content.
				} else {
					alert('No active editor to summarize.');
					return;
				}
				languageForPrompt = novelData.target_language || 'English';
			}
		} else if (focusedEditor) {
			// For other actions like "Rephrase", use the selected text from the active editor.
			const {state} = focusedEditor;
			const {from, to, empty} = state.selection;
			if (!empty) {
				selectedText = state.doc.textBetween(from, to, ' ');
			}
			languageForPrompt = novelData.target_language || 'English';
		}
		
		if (focusedEditor) {
			const {state} = focusedEditor;
			const {from, to} = state.selection;
			
			const textBeforeSelection = state.doc.textBetween(Math.max(0, from - 1500), from);
			const textAfterSelection = state.doc.textBetween(to, Math.min(to + 1500, state.doc.content.size));
			
			wordsBefore = textBeforeSelection.trim().split(/\s+/).slice(-200).join(' ');
			wordsAfter = textAfterSelection.trim().split(/\s+/).slice(0, 200).join(' ');
			
			const chapterContainer = focusedEditor.dom.closest('[data-chapter-id]');
			if (chapterContainer) {
				chapterId = chapterContainer.dataset.chapterId;
			} else if (isChapterEditor) {
				chapterId = toolbarConfig.getActiveChapterId ? toolbarConfig.getActiveChapterId() : null;
			}
		}
		
		const allCodexEntries = await window.api.getAllCodexEntriesForNovel(novelId);
		let linkedCodexEntryIds = [];
		if (chapterId) {
			linkedCodexEntryIds = await window.api.getLinkedCodexIdsForChapter(chapterId);
		}
		
		const context = {
			selectedText,
			allCodexEntries,
			linkedCodexEntryIds,
			languageForPrompt,
			wordsBefore,
			wordsAfter,
			activeEditorView: editorForPrompt,
			isChapterSummarization: isChapterEditor && action === 'scene-summarization',
		};
		openPromptEditor(context, action);
		return;
	}
	
	if (!activeEditorView && !button.closest('.js-dropdown-container')) {
		return;
	}
	
	const command = button.dataset.command;
	
	if (command) {
		if (command === 'undo') {
			undo(activeEditorView.state, activeEditorView.dispatch);
		} else if (command === 'redo') {
			redo(activeEditorView.state, activeEditorView.dispatch);
		} else if (command === 'create_codex') {
			if (!activeEditorView) return;
			const {state} = activeEditorView;
			if (state.selection.empty) return;
			
			const selectedText = state.doc.textBetween(state.selection.from, state.selection.to, ' ');
			const novelId = document.body.dataset.novelId;
			
			if (novelId && selectedText) {
				window.api.openNewCodexEditor({novelId, selectedText});
			}
		} else if (command === 'add_note') {
			if (!activeEditorView) return;
			
			const activeChapterId = toolbarConfig.getActiveChapterId ? toolbarConfig.getActiveChapterId() : null;
			if (!activeChapterId) {
				alert('Cannot add a note without an active chapter.');
				return;
			}
			
			const noteModal = document.getElementById('note-editor-modal');
			const form = document.getElementById('note-editor-form');
			const title = noteModal.querySelector('.js-note-modal-title');
			const contentInput = document.getElementById('note-content-input');
			const posInput = document.getElementById('note-pos');
			const chapterIdInput = document.getElementById('note-chapter-id');
			
			title.textContent = 'Add Note';
			form.reset();
			posInput.value = '';
			chapterIdInput.value = activeChapterId;
			noteModal.showModal();
			contentInput.focus();
		} else {
			applyCommand(command);
		}
	} else if (button.classList.contains('js-highlight-option')) {
		applyHighlight(button.dataset.bg.replace('highlight-', ''));
		if (document.activeElement) document.activeElement.blur();
	} else if (button.classList.contains('js-heading-option')) {
		const level = parseInt(button.dataset.level, 10);
		applyCommand('heading', {level});
		if (document.activeElement) document.activeElement.blur();
	}
	
	if (activeEditorView) {
		activeEditorView.focus();
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
