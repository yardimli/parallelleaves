// MODIFIED: Removed imports for AI prompt editor functionality
import { DOMSerializer, Fragment, DOMParser, Schema } from 'prosemirror-model';
import { history, undo, redo } from 'prosemirror-history';
import { toggleMark, setBlockType, wrapIn, baseKeymap } from 'prosemirror-commands';
import { wrapInList } from 'prosemirror-schema-list';
import { TextSelection, EditorState, Plugin } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
import { initI18n, t } from '../i18n.js';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';
import { keymap } from 'prosemirror-keymap';

const highlightMarkSpec = (colorClass) => {
	return {
		attrs: {},
		parseDOM: [{ tag: `span.${colorClass}` }],
		toDOM: () => ['span', { class: colorClass }, 0]
	};
};

const nodes = basicSchema.spec.nodes.update('blockquote', {
	content: 'paragraph+',
	group: 'block',
	defining: true,
	parseDOM: [{ tag: 'blockquote' }],
	toDOM () { return ['blockquote', 0]; }
});

// The schema is defined locally for use by the editors on this page.
export const schema = new Schema({
	nodes: addListNodes(nodes, 'paragraph+', 'block'),
	marks: {
		link: {
			attrs: { href: {}, title: { default: null } },
			inclusive: false,
			parseDOM: [{ tag: 'a[href]', getAttrs: dom => ({ href: dom.getAttribute('href'), title: dom.getAttribute('title') }) }],
			toDOM: node => ['a', node.attrs, 0]
		},
		em: {
			parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
			toDOM: () => ['em', 0]
		},
		strong: {
			parseDOM: [
				{ tag: 'strong' },
				{ tag: 'b', getAttrs: node => node.style.fontWeight !== 'normal' && null },
				{ style: 'font-weight', getAttrs: value => /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null }
			],
			toDOM: () => ['strong', 0]
		},
		code: {
			parseDOM: [{ tag: 'code' }],
			toDOM: () => ['code', 0]
		},
		underline: {
			parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
			toDOM: () => ['u', 0]
		},
		strike: {
			parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }],
			toDOM: () => ['s', 0]
		},
		highlight_yellow: highlightMarkSpec('highlight-yellow'),
		highlight_green: highlightMarkSpec('highlight-green'),
		highlight_blue: highlightMarkSpec('highlight-blue'),
		highlight_red: highlightMarkSpec('highlight-red'),
		// MODIFIED: Removed the 'ai_suggestion' mark as it's no longer needed without AI functions.
	}
});

// --- State management for multiple editors ---
let sourceEditorView = null;
let targetEditorView = null;
let activeEditorView = null; // This will hold the currently focused editor view
const debounceTimers = new Map();

// --- Helper Functions ---

function setButtonLoadingState (button, isLoading) {
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
};

const serializeDocToHtml = (view) => {
	if (!view) return '';
	const serializer = DOMSerializer.fromSchema(view.state.schema);
	const fragment = serializer.serializeFragment(view.state.doc.content);
	const tempDiv = document.createElement('div');
	tempDiv.appendChild(fragment);
	return tempDiv.innerHTML;
};

// MODIFIED: Removed the createDirectEditorInterface function as it was only for AI integration.

function triggerDebouncedSave (entryId) {
	const key = `codex-${entryId}`;
	if (debounceTimers.has(key)) {
		clearTimeout(debounceTimers.get(key));
	}
	const timer = setTimeout(() => {
		saveWindowContent(entryId);
		debounceTimers.delete(key);
	}, 1000);
	debounceTimers.set(key, timer);
}

async function saveWindowContent (entryId) {
	const titleInput = document.getElementById('js-codex-title-input');
	const phrasesInput = document.getElementById('js-codex-phrases-input');
	
	const data = {
		title: titleInput.value,
		content: serializeDocToHtml(sourceEditorView),
		target_content: serializeDocToHtml(targetEditorView),
		document_phrases: phrasesInput.value
	};
	
	try {
		const response = await window.api.updateCodexEntry(entryId, data);
		if (!response.success) throw new Error(response.message || 'Failed to save codex entry.');
	} catch (error) {
		console.error('Error saving codex entry:', error);
		window.showAlert(t('editor.codexEditor.errorSave'));
	}
}

let currentEditorState = null;

// Plugin to handle showing a placeholder text on an empty editor.
const placeholderPlugin = (placeholderText) => new Plugin({
	props: {
		decorations (state) {
			const { doc } = state;
			// Check if the document contains a single empty paragraph
			if (doc.childCount === 1 && doc.firstChild.isTextblock && doc.firstChild.content.size === 0) {
				// Create a decoration for that node
				return DecorationSet.create(doc, [
					Decoration.node(0, doc.firstChild.nodeSize, {
						class: 'is-editor-empty',
						'data-placeholder': placeholderText
					})
				]);
			}
			return null;
		}
	}
});

/**
 * Sets up a ProseMirror editor instance.
 * @param {HTMLElement} mount - The DOM element to mount the editor in.
 * @param {object} options - Configuration options for the editor.
 * @returns {EditorView|null} The created ProseMirror EditorView instance.
 */
function setupContentEditor (mount, options = {}) {
	const { initialContent, placeholder, onStateChange, onFocus } = options;
	
	if (!mount) return null;
	
	// Use the main schema defined at the top of this file.
	const doc = DOMParser.fromSchema(schema).parse(initialContent);
	
	const view = new EditorView(mount, {
		state: EditorState.create({
			doc,
			plugins: [
				history(),
				keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo }),
				keymap(baseKeymap),
				placeholderPlugin(placeholder || ''),
				//  Plugin to handle focus events for tracking the active editor.
				new Plugin({
					props: {
						handleDOMEvents: {
							focus (view) {
								if (onFocus) onFocus(view);
								return false; // Don't stop propagation
							}
						}
					}
				})
			]
		}),
		dispatchTransaction (transaction) {
			const newState = this.state.apply(transaction);
			this.updateState(newState);
			if (onStateChange) {
				onStateChange(this, transaction);
			}
		}
	});
	
	return view;
}

/**
 * Updates the toolbar buttons' enabled/active state based on the editor's state.
 * @param {EditorView} view - The ProseMirror editor view.
 */
function updateCodexToolbarState (view) {
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
			selectionText: state.doc.textBetween(from, to, ' ')
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
	if (headingBtn) headingBtn.textContent = t('editor.paragraph');
	wordCountEl.textContent = t('editor.noTextSelected');
	
	if (currentEditorState) {
		allBtns.forEach(btn => {
			const cmd = btn.dataset.command;
			// MODIFIED: Removed check for AI action buttons
			
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
			headingBtn.textContent = currentEditorState.headingLevel > 0 ? t(`editor.heading${currentEditorState.headingLevel}`) : t('editor.paragraph');
		}
		
		if (currentEditorState.isTextSelected) {
			const words = currentEditorState.selectionText.trim().split(/\s+/).filter(Boolean);
			wordCountEl.textContent = t('editor.wordsSelected', { count: words.length });
		}
	}
}

/**
 * Applies a ProseMirror command to the editor.
 * @param {Function} command - The ProseMirror command to execute.
 */
function applyCommand (command) {
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
async function handleToolbarAction (button) {
	const view = activeEditorView;
	if (!view) return;
	
	// MODIFIED: Removed the block that handled AI action buttons.
	
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
function setupCodexToolbar () {
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
async function setupCreateMode (novelId, selectedText) {
	document.body.dataset.novelId = novelId;
	
	// 1. Configure UI for creation
	document.title = t('editor.codexEditor.createTitle');
	document.getElementById('js-novel-info').textContent = t('editor.codexEditor.createTitle');
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
		placeholder: t(sourceMount.dataset.i18nPlaceholder),
		onStateChange: onEditorStateChange,
		onFocus: onEditorFocus
	});
	targetEditorView = setupContentEditor(targetMount, {
		initialContent: sourceContainer.querySelector('[data-name="target_content"]'),
		placeholder: t(targetMount.dataset.i18nPlaceholder),
		onStateChange: onEditorStateChange,
		onFocus: onEditorFocus
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
			new_category_name: categorySelect.value === 'new' ? newCategoryInput.value : null
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
async function setupEditMode (entryId) {
	document.body.dataset.entryId = entryId;
	try {
		const entryData = await window.api.getOneCodexForEditor(entryId);
		document.body.dataset.novelId = entryData.novel_id;
		
		document.getElementById('js-novel-info').textContent = t('editor.codexEditor.novelInfo', { novelTitle: entryData.novel_title });
		document.getElementById('js-codex-title-input').value = entryData.title;
		document.getElementById('js-codex-phrases-input').value = entryData.document_phrases || '';
		document.title = t('editor.codexEditor.editTitle', { entryTitle: entryData.title });
		
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
			placeholder: t(sourceMount.dataset.i18nPlaceholder),
			onStateChange: onEditorStateChange,
			onFocus: onEditorFocus
		});
		targetEditorView = setupContentEditor(targetMount, {
			initialContent: sourceContainer.querySelector('[data-name="target_content"]'),
			placeholder: t(targetMount.dataset.i18nPlaceholder),
			onStateChange: onEditorStateChange,
			onFocus: onEditorFocus
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
		document.body.innerHTML = `<p class="text-error p-8">${t('editor.codexEditor.errorLoad', { message: error.message })}</p>`;
	}
}

// --- Main Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
	await initI18n();
	
	window.showAlert = function (message, title = t('common.error')) {
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
	
	// MODIFIED: Removed call to setupPromptEditor()
	
	const params = new URLSearchParams(window.location.search);
	const mode = params.get('mode') || 'edit';
	
	if (mode === 'new') {
		const novelId = params.get('novelId');
		const selectedText = decodeURIComponent(params.get('selectedText') || '');
		if (!novelId) {
			document.body.innerHTML = `<p class="text-error p-8">${t('editor.codexEditor.errorMissingNovelId')}</p>`;
			return;
		}
		await setupCreateMode(novelId, selectedText);
	} else {
		const entryId = params.get('entryId');
		if (!entryId) {
			document.body.innerHTML = `<p class="text-error p-8">${t('editor.codexEditor.errorMissingId')}</p>`;
			return;
		}
		await setupEditMode(entryId);
	}
});
