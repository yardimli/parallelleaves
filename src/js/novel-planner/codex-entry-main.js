// This file now contains its own independent toolbar logic,
// decoupling it from the chapter editor's toolbar.

import { setupContentEditor } from './planner-codex-content-editor.js';
import { openPromptEditor, setupPromptEditor } from '../prompt-editor.js';
import { DOMSerializer, Fragment } from 'prosemirror-model';
import { undo, redo } from 'prosemirror-history';
import { toggleMark, setBlockType, wrapIn } from 'prosemirror-commands';
import { wrapInList } from 'prosemirror-schema-list';
import { TextSelection } from 'prosemirror-state';

// --- NEW: State management for multiple editors ---
let sourceEditorView = null;
let targetEditorView = null;
let activeEditorView = null; // This will hold the currently focused editor view
const debounceTimers = new Map();

// --- Helper Functions ---

function setButtonLoadingState(button, isLoading) {
	const text = button.querySelector('.js-btn-text');
	const spinner = button.querySelector('.js-spinner');
	if (isLoading) {
		button.disabled = true;
		if (text) text.classList.add('hidden');
		if (spinner) spinner.classList.remove('hidden');
	} else {
		button.disabled = false;
		if (text) text.classList.remove('hidden');
		if (spinner) spinner.classList.add('hidden');
	}
}

const serializeDocToHtml = (view) => {
	if (!view) return '';
	const serializer = DOMSerializer.fromSchema(view.state.schema);
	const fragment = serializer.serializeFragment(view.state.doc.content);
	const tempDiv = document.createElement('div');
	tempDiv.appendChild(fragment);
	return tempDiv.innerHTML;
};


// --- NEW: Editor Interface for Direct ProseMirror View ---
const createDirectEditorInterface = (view) => {
	const { schema } = view.state;
	
	return {
		type: 'direct',
		getSelectionInfo: (action) => {
			const { state } = view;
			if (state.selection.empty) return null;
			return {
				from: state.selection.from,
				to: state.selection.to,
				originalFragmentJson: state.doc.slice(state.selection.from, state.selection.to).content.toJSON(),
				selectedText: state.doc.textBetween(state.selection.from, state.selection.to, ' '),
			};
		},
		setEditable: (isEditable) => {
			view.setProps({ editable: () => isEditable });
		},
		cleanupSuggestion: () => {
			const { tr } = view.state;
			tr.removeMark(0, view.state.doc.content.size, schema.marks.ai_suggestion);
			view.dispatch(tr);
			view.focus();
		},
		discardSuggestion: (from, to, originalFragmentJson) => {
			const originalFragment = Fragment.fromJSON(schema, originalFragmentJson);
			let tr = view.state.tr.replaceWith(from, to, originalFragment);
			const newTo = from + originalFragment.size;
			tr = tr.setSelection(TextSelection.create(tr.doc, from, newTo));
			view.dispatch(tr);
		},
		streamStart: (from, to, chunk) => {
			const { state, dispatch } = view;
			const mark = schema.marks.ai_suggestion.create();
			let tr = state.tr.replaceWith(from, to, []);
			let insertionPos = from;
			
			const parts = chunk.split('\n');
			parts.forEach((part, index) => {
				if (part) {
					tr.insert(insertionPos, schema.text(part, [mark]));
					insertionPos += part.length;
				}
				if (index < parts.length - 1) {
					tr = tr.split(insertionPos);
					insertionPos = tr.selection.from;
				}
			});
			tr.setSelection(TextSelection.create(tr.doc, insertionPos));
			dispatch(tr);
		},
		streamChunk: (chunk) => {
			const { state, dispatch } = view;
			const mark = schema.marks.ai_suggestion.create();
			let tr = state.tr;
			let insertionPos = state.selection.to;
			
			const parts = chunk.split('\n');
			parts.forEach((part, index) => {
				if (part) {
					tr.insert(insertionPos, schema.text(part, [mark]));
					insertionPos += part.length;
				}
				if (index < parts.length - 1) {
					tr = tr.split(insertionPos);
					insertionPos = tr.selection.from;
				}
			});
			tr.setSelection(TextSelection.create(tr.doc, insertionPos));
			dispatch(tr);
		},
		streamDone: (from) => {
			const { state, dispatch } = view;
			let tr = state.tr;
			const to = state.selection.to;
			
			// Clean up empty paragraphs that might be inserted by line breaks
			const deletions = [];
			state.doc.nodesBetween(from, to, (node, pos) => {
				if (pos >= from && node.type.name === 'paragraph' && node.content.size === 0) {
					deletions.push({ from: pos, to: pos + node.nodeSize });
				}
			});
			if (deletions.length > 0) {
				for (let i = deletions.length - 1; i >= 0; i--) {
					tr.delete(deletions[i].from, deletions[i].to);
				}
			}
			dispatch(tr);
			
			// Return the final range for the floating toolbar
			return { from, to: tr.mapping.map(to) };
		},
	};
};

// --- NEW: Debounced Save Logic (moved and adapted from planner-codex-content-editor.js) ---
function triggerDebouncedSave(entryId) {
	const key = `codex-${entryId}`;
	if (debounceTimers.has(key)) {
		clearTimeout(debounceTimers.get(key));
	}
	const timer = setTimeout(() => {
		saveWindowContent(entryId);
		debounceTimers.delete(key);
	}, 2000);
	debounceTimers.set(key, timer);
}

async function saveWindowContent(entryId) {
	const titleInput = document.getElementById('js-codex-title-input');
	const phrasesInput = document.getElementById('js-codex-phrases-input');
	
	const data = {
		title: titleInput.value,
		content: serializeDocToHtml(sourceEditorView),
		target_content: serializeDocToHtml(targetEditorView),
		document_phrases: phrasesInput.value,
	};
	
	try {
		const response = await window.api.updateCodexEntry(entryId, data);
		if (!response.success) throw new Error(response.message || 'Failed to save codex entry.');
	} catch (error) {
		console.error('Error saving codex entry:', error);
		window.showAlert('Could not save changes to codex entry.');
	}
}


// --- MODIFIED: Toolbar Logic for Codex Editor ---

let currentEditorState = null;

/**
 * Updates the toolbar buttons' enabled/active state based on the editor's state.
 * @param {EditorView} view - The ProseMirror editor view.
 */
function updateCodexToolbarState(view) {
	if (!view) {
		currentEditorState = null;
	} else {
		const { state } = view;
		const { $from, from, to, empty } = state.selection;
		const { schema } = state;
		
		const isMarkActive = (type) => {
			if (empty) return !!(state.storedMarks || $from.marks()).some(mark => mark.type === type);
			return state.doc.rangeHasMark(from, to, type);
		};
		
		const isNodeActive = (type) => {
			for (let i = $from.depth; i > 0; i--) {
				if ($from.node(i).type === type) return true;
			}
			return false;
		};
		
		let headingLevel = 0;
		if ($from.parent.type.name === 'heading') {
			headingLevel = $from.parent.attrs.level;
		}
		
		currentEditorState = {
			canUndo: undo(state),
			canRedo: redo(state),
			isTextSelected: !empty,
			activeMarks: Object.keys(schema.marks).filter(markName => isMarkActive(schema.marks[markName])),
			activeNodes: Object.keys(schema.nodes).filter(nodeName => isNodeActive(schema.nodes[nodeName])),
			headingLevel: headingLevel,
			selectionText: state.doc.textBetween(from, to, ' '),
		};
	}
	
	const toolbar = document.getElementById('top-toolbar');
	const allBtns = toolbar.querySelectorAll('.js-toolbar-btn, .js-ai-action-btn');
	const wordCountEl = document.getElementById('js-word-count');
	
	allBtns.forEach(btn => {
		btn.disabled = !currentEditorState;
		btn.classList.remove('active');
	});
	
	const headingBtn = toolbar.querySelector('.js-heading-btn');
	if (headingBtn) headingBtn.textContent = 'Paragraph';
	wordCountEl.textContent = 'No text selected';
	
	if (currentEditorState) {
		allBtns.forEach(btn => {
			const cmd = btn.dataset.command;
			if (btn.classList.contains('js-ai-action-btn')) {
				btn.disabled = !currentEditorState.isTextSelected;
				return;
			}
			
			switch (cmd) {
				case 'undo': btn.disabled = !currentEditorState.canUndo; break;
				case 'redo': btn.disabled = !currentEditorState.canRedo; break;
				case 'bold': btn.classList.toggle('active', currentEditorState.activeMarks.includes('strong')); break;
				case 'italic': btn.classList.toggle('active', currentEditorState.activeMarks.includes('em')); break;
				case 'underline': btn.classList.toggle('active', currentEditorState.activeMarks.includes('underline')); break;
				case 'strike': btn.classList.toggle('active', currentEditorState.activeMarks.includes('strike')); break;
				case 'blockquote': btn.classList.toggle('active', currentEditorState.activeNodes.includes('blockquote')); break;
				case 'bullet_list': btn.classList.toggle('active', currentEditorState.activeNodes.includes('bullet_list')); break;
				case 'ordered_list': btn.classList.toggle('active', currentEditorState.activeNodes.includes('ordered_list')); break;
			}
			if (btn.closest('.js-dropdown-container')) {
				btn.disabled = !currentEditorState.isTextSelected;
			}
		});
		
		if (headingBtn) {
			headingBtn.textContent = currentEditorState.headingLevel > 0 ? `Heading ${currentEditorState.headingLevel}` : 'Paragraph';
		}
		
		if (currentEditorState.isTextSelected) {
			const words = currentEditorState.selectionText.trim().split(/\s+/).filter(Boolean);
			wordCountEl.textContent = `${words.length} word${words.length !== 1 ? 's' : ''} selected`;
		}
	}
}

/**
 * Applies a ProseMirror command to the editor.
 * @param {Function} command - The ProseMirror command to execute.
 */
function applyCommand(command) {
	const view = activeEditorView;
	if (view && command) {
		command(view.state, view.dispatch);
		view.focus();
	}
}

/**
 * Handles clicks on toolbar buttons.
 * @param {HTMLElement} button - The clicked button element.
 */
async function handleToolbarAction(button) {
	const view = activeEditorView;
	if (!view) return;
	
	if (button.classList.contains('js-ai-action-btn')) {
		const action = button.dataset.action;
		const novelId = document.body.dataset.novelId;
		if (!novelId || !currentEditorState || !currentEditorState.isTextSelected) return;
		
		const novelData = await window.api.getOneNovel(novelId);
		const settings = novelData.rephrase_settings ? JSON.parse(novelData.rephrase_settings) : {};
		
		const allCodexEntries = await window.api.getAllCodexEntriesForNovel(novelId);
		
		const context = {
			selectedText: currentEditorState.selectionText,
			allCodexEntries,
			languageForPrompt: novelData.target_language || 'English',
			activeEditorView: view,
			editorInterface: createDirectEditorInterface(view),
		};
		openPromptEditor(context, action, settings);
		return;
	}
	
	const command = button.dataset.command;
	const schema = view.state.schema;
	let cmdFunc = null;
	
	switch (command) {
		case 'undo': cmdFunc = undo; break;
		case 'redo': cmdFunc = redo; break;
		case 'bold': cmdFunc = toggleMark(schema.marks.strong); break;
		case 'italic': cmdFunc = toggleMark(schema.marks.em); break;
		case 'underline': cmdFunc = toggleMark(schema.marks.underline); break;
		case 'strike': cmdFunc = toggleMark(schema.marks.strike); break;
		case 'blockquote': cmdFunc = wrapIn(schema.nodes.blockquote); break;
		case 'bullet_list': cmdFunc = wrapInList(schema.nodes.bullet_list); break;
		case 'ordered_list': cmdFunc = wrapInList(schema.nodes.ordered_list); break;
		case 'horizontal_rule':
			cmdFunc = (state, dispatch) => {
				dispatch(state.tr.replaceSelectionWith(schema.nodes.horizontal_rule.create()));
				return true;
			};
			break;
	}
	
	if (button.classList.contains('js-highlight-option')) {
		const color = button.dataset.bg.replace('highlight-', '');
		cmdFunc = (state, dispatch) => {
			let tr = state.tr;
			const { from, to } = state.selection;
			Object.keys(schema.marks).forEach(markName => {
				if (markName.startsWith('highlight_')) tr = tr.removeMark(from, to, schema.marks[markName]);
			});
			if (color !== 'transparent') {
				const markType = schema.marks[`highlight_${color}`];
				if (markType) tr = tr.addMark(from, to, markType.create());
			}
			dispatch(tr);
			return true;
		};
		if (document.activeElement) document.activeElement.blur();
	}
	
	if (button.classList.contains('js-heading-option')) {
		const level = parseInt(button.dataset.level, 10);
		cmdFunc = (level === 0)
			? setBlockType(schema.nodes.paragraph)
			: setBlockType(schema.nodes.heading, { level });
		if (document.activeElement) document.activeElement.blur();
	}
	
	applyCommand(cmdFunc);
}

/**
 * Sets up event listeners for the top toolbar.
 */
function setupCodexToolbar() {
	const toolbar = document.getElementById('top-toolbar');
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
		if (button.closest('.js-dropdown-container') && button.classList.contains('js-toolbar-btn')) {
			return;
		}
		handleToolbarAction(button);
	});
	
	// Set initial state
	updateCodexToolbarState(null);
}


// --- Mode-Specific Setup Functions ---

/**
 * Configures the editor window for creating a new codex entry.
 * @param {string} novelId - The ID of the novel this entry belongs to.
 * @param {string} selectedText - The text selected in the chapter editor.
 */
async function setupCreateMode(novelId, selectedText) {
	document.body.dataset.novelId = novelId;
	
	// 1. Configure UI for creation
	document.title = 'Create New Codex Entry';
	document.getElementById('js-novel-info').textContent = 'Create New Codex Entry';
	document.getElementById('js-create-meta-section').classList.remove('hidden');
	document.getElementById('js-create-action-section').classList.remove('hidden');
	
	// 2. Setup ProseMirror editors
	const sourceContainer = document.getElementById('js-pm-content-source');
	sourceContainer.querySelector('[data-name="content"]').innerHTML = `<p>${selectedText.replace(/\n/g, '</p><p>')}</p>`;
	
	const editorMounts = document.querySelectorAll('.js-editable');
	const sourceMount = Array.from(editorMounts).find(el => el.dataset.name === 'content');
	const targetMount = Array.from(editorMounts).find(el => el.dataset.name === 'target_content');
	
	const onEditorStateChange = (view) => {
		if (view.hasFocus()) {
			updateCodexToolbarState(view);
		}
	};
	const onEditorFocus = (view) => {
		activeEditorView = view;
		updateCodexToolbarState(view);
	};
	
	sourceEditorView = setupContentEditor(sourceMount, {
		initialContent: sourceContainer.querySelector('[data-name="content"]'),
		placeholder: sourceMount.dataset.placeholder,
		onStateChange: onEditorStateChange,
		onFocus: onEditorFocus,
	});
	targetEditorView = setupContentEditor(targetMount, {
		initialContent: sourceContainer.querySelector('[data-name="target_content"]'),
		placeholder: targetMount.dataset.placeholder,
		onStateChange: onEditorStateChange,
		onFocus: onEditorFocus,
	});
	
	activeEditorView = sourceEditorView; // Default to source
	setupCodexToolbar();
	
	// 3. Fetch categories and populate dropdown
	const categorySelect = document.getElementById('js-codex-category');
	const newCategoryWrapper = document.getElementById('js-new-category-wrapper');
	const newCategoryInput = document.getElementById('js-new-category-name');
	
	const categories = await window.api.getCategoriesForNovel(novelId);
	categories.forEach(cat => categorySelect.add(new Option(cat.name, cat.id)));
	
	categorySelect.addEventListener('change', () => {
		const isNew = categorySelect.value === 'new';
		newCategoryWrapper.classList.toggle('hidden', !isNew);
		newCategoryInput.required = isNew;
	});
	
	// 4. Get AI suggestions and pre-fill form
	const titleInput = document.getElementById('js-codex-title-input');
	const suggestionSpinner = document.getElementById('js-ai-suggestion-spinner');
	suggestionSpinner.classList.remove('hidden');
	try {
		const result = await window.api.suggestCodexDetails(novelId, selectedText);
		if (result.success) {
			titleInput.value = result.title;
			if (result.categoryId) categorySelect.value = result.categoryId;
		}
	} catch (e) {
		console.error('AI suggestion failed', e);
		titleInput.value = selectedText.slice(0, 50); // Fallback
	} finally {
		suggestionSpinner.classList.add('hidden');
	}
	
	// 5. Setup form submission
	const form = document.getElementById('js-codex-form');
	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const createBtn = form.querySelector('.js-create-entry-btn');
		setButtonLoadingState(createBtn, true);
		
		const phrasesInput = document.getElementById('js-codex-phrases-input');
		
		const formData = {
			title: titleInput.value,
			content: serializeDocToHtml(sourceEditorView),
			target_content: serializeDocToHtml(targetEditorView),
			document_phrases: phrasesInput.value,
			codex_category_id: categorySelect.value === 'new' ? null : categorySelect.value,
			new_category_name: categorySelect.value === 'new' ? newCategoryInput.value : null,
		};
		
		try {
			const result = await window.api.createCodexEntry(novelId, formData);
			if (result.success) {
				const newEntryId = result.codexEntry.id;
				window.location.search = `?mode=edit&entryId=${newEntryId}`;
			} else {
				throw new Error(result.message || 'Failed to create entry.');
			}
		} catch (error) {
			console.error('Error creating codex entry:', error);
			window.showAlert(error.message);
			setButtonLoadingState(createBtn, false);
		}
	});
}

/**
 * Configures the editor window for editing an existing codex entry.
 * @param {string} entryId - The ID of the entry to edit.
 */
async function setupEditMode(entryId) {
	document.body.dataset.entryId = entryId;
	try {
		const entryData = await window.api.getOneCodexForEditor(entryId);
		document.body.dataset.novelId = entryData.novel_id;
		
		document.getElementById('js-novel-info').textContent = `${entryData.novel_title} > Codex`;
		document.getElementById('js-codex-title-input').value = entryData.title;
		document.getElementById('js-codex-phrases-input').value = entryData.document_phrases || '';
		document.title = `Editing Codex: ${entryData.title}`;
		
		const sourceContainer = document.getElementById('js-pm-content-source');
		sourceContainer.querySelector('[data-name="content"]').innerHTML = entryData.content || '';
		sourceContainer.querySelector('[data-name="target_content"]').innerHTML = entryData.target_content || '';
		
		const editorMounts = document.querySelectorAll('.js-editable');
		const sourceMount = Array.from(editorMounts).find(el => el.dataset.name === 'content');
		const targetMount = Array.from(editorMounts).find(el => el.dataset.name === 'target_content');
		
		const onEditorStateChange = (view, transaction) => {
			if (entryId && transaction.docChanged) {
				triggerDebouncedSave(entryId);
			}
			if (view.hasFocus()) {
				updateCodexToolbarState(view);
			}
		};
		const onEditorFocus = (view) => {
			activeEditorView = view;
			updateCodexToolbarState(view);
		};
		
		sourceEditorView = setupContentEditor(sourceMount, {
			initialContent: sourceContainer.querySelector('[data-name="content"]'),
			placeholder: sourceMount.dataset.placeholder,
			onStateChange: onEditorStateChange,
			onFocus: onEditorFocus,
		});
		targetEditorView = setupContentEditor(targetMount, {
			initialContent: sourceContainer.querySelector('[data-name="target_content"]'),
			placeholder: targetMount.dataset.placeholder,
			onStateChange: onEditorStateChange,
			onFocus: onEditorFocus,
		});
		
		activeEditorView = sourceEditorView; // Default to source
		setupCodexToolbar();
		updateCodexToolbarState(activeEditorView); // Initial update
		
		// Add input listeners for title and phrases to trigger save
		const titleInput = document.getElementById('js-codex-title-input');
		const phrasesInput = document.getElementById('js-codex-phrases-input');
		titleInput.addEventListener('input', () => triggerDebouncedSave(entryId));
		phrasesInput.addEventListener('input', () => triggerDebouncedSave(entryId));
		
		const deleteBtn = document.getElementById('js-delete-codex-entry-btn');
		const deleteModal = document.getElementById('delete-confirm-modal');
		const cancelDeleteBtn = document.getElementById('js-cancel-delete-btn');
		const confirmDeleteBtn = document.getElementById('js-confirm-delete-btn');
		
		if (deleteBtn && deleteModal && cancelDeleteBtn && confirmDeleteBtn) {
			deleteBtn.classList.remove('hidden'); // Show the delete button in edit mode
			
			deleteBtn.addEventListener('click', (e) => {
				e.preventDefault();
				deleteModal.showModal();
			});
			
			cancelDeleteBtn.addEventListener('click', () => {
				deleteModal.close();
			});
			
			confirmDeleteBtn.addEventListener('click', async () => {
				try {
					const result = await window.api.deleteCodexEntry(entryId);
					if (result.success) {
						window.close(); // Close the editor window on successful deletion
					} else {
						throw new Error(result.message || 'Failed to delete entry.');
					}
				} catch (error) {
					console.error('Error deleting codex entry:', error);
					window.showAlert(error.message);
				} finally {
					deleteModal.close();
				}
			});
		}
		
	} catch (error) {
		console.error('Failed to load codex entry data:', error);
		document.body.innerHTML = `<p class="text-error p-8">Error: Could not load codex entry data. ${error.message}</p>`;
	}
}

// --- Main Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
	window.showAlert = function(message, title = 'Error') {
		const modal = document.getElementById('alert-modal');
		if (modal) {
			const modalTitle = modal.querySelector('#alert-modal-title');
			const modalContent = modal.querySelector('#alert-modal-content');
			if (modalTitle) modalTitle.textContent = title;
			if (modalContent) modalContent.textContent = message;
			modal.showModal();
		} else {
			alert(message);
		}
	};
	
	setupPromptEditor();
	
	const params = new URLSearchParams(window.location.search);
	const mode = params.get('mode') || 'edit';
	
	if (mode === 'new') {
		const novelId = params.get('novelId');
		const selectedText = decodeURIComponent(params.get('selectedText') || '');
		if (!novelId) {
			document.body.innerHTML = '<p class="text-error p-8">Error: Novel ID is missing for new entry.</p>';
			return;
		}
		await setupCreateMode(novelId, selectedText);
	} else {
		const entryId = params.get('entryId');
		if (!entryId) {
			document.body.innerHTML = '<p class="text-error p-8">Error: Codex Entry ID is missing.</p>';
			return;
		}
		await setupEditMode(entryId);
	}
});
