// NEW: This file is now a self-contained ProseMirror editor setup for the Codex window.
// It no longer depends on the shared content-editor.js.

import { EditorState, Plugin } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
import { Schema, DOMParser, DOMSerializer } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';

let editorView = null;

// --- Schema Definition (local to this editor) ---

const highlightMarkSpec = (colorClass) => ({
	attrs: {},
	parseDOM: [{ tag: `span.${colorClass}` }],
	toDOM: () => ['span', { class: colorClass }, 0],
});

const codexSchema = new Schema({
	nodes: addListNodes(basicSchema.spec.nodes, 'paragraph+', 'block'),
	marks: {
		...basicSchema.spec.marks,
		underline: {
			parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
			toDOM: () => ['u', 0],
		},
		strike: {
			parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }],
			toDOM: () => ['s', 0],
		},
		highlight_yellow: highlightMarkSpec('highlight-yellow'),
		highlight_green: highlightMarkSpec('highlight-green'),
		highlight_blue: highlightMarkSpec('highlight-blue'),
		highlight_red: highlightMarkSpec('highlight-red'),
		ai_suggestion: {
			parseDOM: [{ tag: 'span.ai-suggestion' }],
			toDOM: () => ['span', { class: 'ai-suggestion' }, 0],
		},
	},
});


// --- Editor Setup ---

const debounceTimers = new Map();

export function getCodexEditorView() {
	return editorView;
}

function triggerDebouncedSave(entryId, onStateChange) {
	const key = `codex-${entryId}`;
	if (debounceTimers.has(key)) {
		clearTimeout(debounceTimers.get(key));
	}
	const timer = setTimeout(() => {
		saveWindowContent(entryId);
		debounceTimers.delete(key);
	}, 2000);
	debounceTimers.set(key, timer);
	// MODIFIED: Also trigger toolbar state update on change.
	if (onStateChange && editorView) {
		onStateChange(editorView);
	}
}

async function saveWindowContent(entryId) {
	const serializeDocToHtml = (view) => {
		if (!view) return '';
		const serializer = DOMSerializer.fromSchema(view.state.schema);
		const fragment = serializer.serializeFragment(view.state.doc.content);
		const tempDiv = document.createElement('div');
		tempDiv.appendChild(fragment);
		return tempDiv.innerHTML;
	};
	
	const titleInput = document.getElementById('js-codex-title-input');
	const content = serializeDocToHtml(editorView);
	const data = {
		title: titleInput.value,
		content,
	};
	
	try {
		const response = await window.api.updateCodexEntry(entryId, data);
		if (!response.success) throw new Error(response.message || 'Failed to save codex entry.');
	} catch (error) {
		console.error('Error saving codex entry:', error);
		window.showAlert('Could not save changes to codex entry.');
	}
}

// NEW: A plugin to handle showing a placeholder text on an empty editor.
const placeholderPlugin = (placeholderText) => new Plugin({
	props: {
		decorations(state) {
			const { doc } = state;
			// Check if the document contains a single empty paragraph
			if (doc.childCount === 1 && doc.firstChild.isTextblock && doc.firstChild.content.size === 0) {
				// Create a decoration for that node
				return DecorationSet.create(doc, [
					Decoration.node(0, doc.firstChild.nodeSize, {
						class: 'is-editor-empty',
						'data-placeholder': placeholderText,
					}),
				]);
			}
			return null;
		},
	},
});


// MODIFIED: `setupContentEditor` now takes an `onStateChange` callback for the toolbar.
export function setupContentEditor(options = {}) {
	const { entryId, onStateChange } = options;
	const initialContentContainer = document.getElementById('js-pm-content-source');
	const mount = document.querySelector('.js-editable[data-name="content"]');
	const titleInput = document.getElementById('js-codex-title-input');
	
	if (!initialContentContainer || !mount || !titleInput) return;
	
	const placeholder = mount.dataset.placeholder || '';
	const initialContentEl = initialContentContainer.querySelector(`[data-name="content"]`);
	const doc = DOMParser.fromSchema(codexSchema).parse(initialContentEl);
	
	editorView = new EditorView(mount, {
		state: EditorState.create({
			doc,
			plugins: [
				history(),
				keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo }),
				keymap(baseKeymap),
				placeholderPlugin(placeholder),
			],
		}),
		dispatchTransaction(transaction) {
			const newState = this.state.apply(transaction);
			this.updateState(newState);
			if (entryId && transaction.docChanged) {
				triggerDebouncedSave(entryId, onStateChange);
			}
			if ((transaction.selectionSet || transaction.docChanged) && onStateChange) {
				if (this.hasFocus()) {
					onStateChange(this);
				}
			}
		},
	});
	
	if (entryId) {
		titleInput.addEventListener('input', () => triggerDebouncedSave(entryId, onStateChange));
	}
	
	// Initial state update for toolbar
	if (onStateChange) {
		onStateChange(editorView);
	}
	
	editorView.focus();
}
