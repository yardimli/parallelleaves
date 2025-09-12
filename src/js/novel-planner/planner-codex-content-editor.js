// NEW: Content editor manager specifically for the standalone codex entry editor.
import { EditorState, Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { DOMParser, DOMSerializer } from 'prosemirror-model';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { schema, setActiveEditor } from '../novel-planner/content-editor.js';
import { updateToolbarState } from '../novel-planner/toolbar.js';

const debounceTimers = new Map();
let editorView = null;

export function getCodexEditorView() {
	return editorView;
}

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
		alert('Error: Could not save changes to codex entry.');
	}
}

// MODIFIED: Function now accepts an options object to conditionally enable debounced saving.
export function setupContentEditor(options = {}) {
	const { entryId } = options;
	const initialContentContainer = document.getElementById('js-pm-content-source');
	const mount = document.querySelector('.js-editable[data-name="content"]');
	const titleInput = document.getElementById('js-codex-title-input');
	
	if (!initialContentContainer || !mount || !titleInput) return;
	
	const placeholder = mount.dataset.placeholder || '';
	const initialContentEl = initialContentContainer.querySelector(`[data-name="content"]`);
	const doc = DOMParser.fromSchema(schema).parse(initialContentEl);
	
	editorView = new EditorView(mount, {
		state: EditorState.create({
			doc,
			plugins: [
				history(),
				keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo }),
				keymap(baseKeymap),
				new Plugin({
					props: {
						handleDOMEvents: {
							focus(view) {
								setActiveEditor(view);
								updateToolbarState(view);
							},
							blur(view, event) {
								const relatedTarget = event.relatedTarget;
								if (!relatedTarget || !relatedTarget.closest('#top-toolbar')) {
									setActiveEditor(null);
									updateToolbarState(null);
								}
							},
						},
						attributes: (state) => ({
							class: `ProseMirror ${state.doc.childCount === 1 && state.doc.firstChild.content.size === 0 ? 'is-editor-empty' : ''}`,
							'data-placeholder': placeholder,
						}),
					},
				}),
			],
		}),
		dispatchTransaction(transaction) {
			const newState = this.state.apply(transaction);
			this.updateState(newState);
			// MODIFIED: Only trigger debounced save if an entryId is provided (i.e., in edit mode).
			if (transaction.docChanged && entryId) {
				triggerDebouncedSave(entryId);
			}
			if ((transaction.selectionSet || transaction.docChanged)) {
				if (this.hasFocus()) {
					updateToolbarState(this);
				}
			}
		},
	});
	
	// MODIFIED: Only add the input listener for debounced saving in edit mode.
	if (entryId) {
		titleInput.addEventListener('input', () => triggerDebouncedSave(entryId));
	}
	
	editorView.focus();
}
