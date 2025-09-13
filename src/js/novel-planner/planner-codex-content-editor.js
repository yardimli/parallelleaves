import { EditorState, Plugin } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
import { Schema, DOMParser } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';

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


// MODIFIED: `setupContentEditor` is now a factory function that returns the view.
export function setupContentEditor(mount, options = {}) {
	const { initialContent, placeholder, onStateChange, onFocus } = options;
	
	if (!mount) return null;
	
	const doc = DOMParser.fromSchema(codexSchema).parse(initialContent);
	
	const view = new EditorView(mount, {
		state: EditorState.create({
			doc,
			plugins: [
				history(),
				keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo }),
				keymap(baseKeymap),
				placeholderPlugin(placeholder || ''),
				// NEW: Plugin to handle focus events for tracking the active editor.
				new Plugin({
					props: {
						handleDOMEvents: {
							focus(view) {
								if (onFocus) onFocus(view);
								return false; // Don't stop propagation
							},
						},
					},
				}),
			],
		}),
		dispatchTransaction(transaction) {
			const newState = this.state.apply(transaction);
			this.updateState(newState);
			if (onStateChange) {
				onStateChange(this, transaction);
			}
		},
	});
	
	return view;
}
