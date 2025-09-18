import { EditorState, Plugin, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { DOMParser, DOMSerializer, Fragment, Schema } from 'prosemirror-model';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, setBlockType, wrapIn, lift } from 'prosemirror-commands';
import { wrapInList, liftListItem } from 'prosemirror-schema-list';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';

// --- ProseMirror Schema Definition
const highlightMarkSpec = (colorClass) => {
	return {
		attrs: {},
		parseDOM: [{ tag: `span.${colorClass}` }],
		toDOM: () => ['span', { class: colorClass }, 0],
	};
};

const nodes = basicSchema.spec.nodes.update('blockquote', {
	content: 'paragraph+',
	group: 'block',
	defining: true,
	parseDOM: [{ tag: 'blockquote' }],
	toDOM() { return ['blockquote', 0]; },
});

const schema = new Schema({
	nodes: addListNodes(nodes, 'paragraph+', 'block'),
	marks: {
		link: {
			attrs: { href: {}, title: { default: null } },
			inclusive: false,
			parseDOM: [{ tag: 'a[href]', getAttrs: dom => ({ href: dom.getAttribute('href'), title: dom.getAttribute('title') }) }],
			toDOM: node => ['a', node.attrs, 0],
		},
		em: {
			parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
			toDOM: () => ['em', 0],
		},
		strong: {
			parseDOM: [
				{ tag: 'strong' },
				{ tag: 'b', getAttrs: node => node.style.fontWeight !== 'normal' && null },
				{ style: 'font-weight', getAttrs: value => /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null },
			],
			toDOM: () => ['strong', 0],
		},
		code: {
			parseDOM: [{ tag: 'code' }],
			toDOM: () => ['code', 0],
		},
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

let editorView;
let parentOrigin; // Store the parent window's origin for security
let chapterId;
let field;
let hasSourceSelection = false;
let floatingTranslateBtn = null;

/**
 * Posts a message to the parent window.
 * @param {string} type - The message type.
 * @param {object} [payload] - The message payload.
 */
const postToParent = (type, payload) => {
	if (!parentOrigin || !parent.window) return;
	parent.window.postMessage({ type, payload }, parentOrigin);
};

/**
 * Calculates and sends the current height of the editor content to the parent.
 */
const sendResize = () => {
	// Use a small timeout to allow the DOM to render before calculating height
	setTimeout(() => {
		const height = document.body.scrollHeight + 200;
		postToParent('resize', { height });
	}, 50);
};

/**
 * Extracts the relevant state for the toolbar from the editor state.
 * @param {EditorState} state - The ProseMirror editor state.
 * @returns {object} A plain object representing the toolbar's state.
 */
const getToolbarState = (state) => {
	const { $from, from, to, empty } = state.selection;
	const { schema } = state;
	
	const isMarkActive = (type) => {
		if (!type) return false;
		if (empty) return !!(state.storedMarks || $from.marks()).some(mark => mark.type === type);
		return state.doc.rangeHasMark(from, to, type);
	};
	
	const isNodeActive = (type) => {
		for (let i = $from.depth; i > 0; i--) {
			if ($from.node(i).type === type) return true;
		}
		return false;
	};
	
	const parent = $from.parent;
	let headingLevel = 0;
	if (parent.type.name === 'heading') {
		headingLevel = parent.attrs.level;
	}
	
	return {
		canUndo: undo(state),
		canRedo: redo(state),
		isTextSelected: !empty,
		activeMarks: Object.keys(schema.marks).filter(markName => isMarkActive(schema.marks[markName])),
		activeNodes: Object.keys(schema.nodes).filter(nodeName => isNodeActive(schema.nodes[nodeName])),
		headingLevel: headingLevel,
		selectionText: state.doc.textBetween(from, to, ' '),
	};
};

/**
 * Creates and manages the floating translate button.
 * It appears next to an empty paragraph when there is a source selection.
 * @param {EditorView} view - The ProseMirror editor view.
 */
function manageFloatingButton(view) {
	// Always remove the existing button before deciding to show a new one
	if (floatingTranslateBtn) {
		floatingTranslateBtn.remove();
		floatingTranslateBtn = null;
	}
	
	const { state } = view;
	const { selection } = state;
	
	// Conditions to show the button: cursor must be in one spot (not a selection),
	// and there must be a text selection in the source pane.
	if (!selection.empty || !hasSourceSelection) return;
	
	const { $from } = selection;
	const parentNode = $from.parent;
	
	// Only show for empty paragraphs
	if (parentNode.type.name === 'paragraph' && parentNode.content.size === 0) {
		const pos = $from.pos;
		const coords = view.coordsAtPos(pos);
		
		floatingTranslateBtn = document.createElement('button');
		floatingTranslateBtn.className = 'floating-translate-btn';
		floatingTranslateBtn.innerHTML = '<i class="bi bi-translate"></i>';
		floatingTranslateBtn.title = 'Translate selected source text here'; // TODO: i18n
		document.body.appendChild(floatingTranslateBtn);
		
		// Position the button to the left of the cursor, vertically centered
		floatingTranslateBtn.style.position = 'absolute';
		floatingTranslateBtn.style.left = `${coords.left + 10}px`;
		floatingTranslateBtn.style.top = `${coords.top}px`;
		
		// Use mousedown to prevent the editor from losing focus, which would hide the button
		floatingTranslateBtn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			postToParent('requestTranslation', { from: pos, to: pos });
			if (floatingTranslateBtn) {
				floatingTranslateBtn.remove();
				floatingTranslateBtn = null;
			}
		});
	}
}

/**
 * Creates and initializes the ProseMirror editor view.
 * @param {HTMLElement} mount - The element to mount the editor in.
 * @param {object} config - The initialization configuration.
 */
function createEditorView (mount, config) {
	const { initialHtml, isEditable, chapterId: id, field: fieldName, i18n } = config;
	chapterId = id;
	field = fieldName;
	
	const editorPlugin = new Plugin({
		props: {
			editable: () => isEditable,
			handleDOMEvents: {
				focus (view) {
					postToParent('editorFocused', { chapterId, state: getToolbarState(view.state) });
				},
				blur (view) {
					// Use a timeout to allow a click on the floating button to register before it's removed
					setTimeout(() => {
						if (document.activeElement !== floatingTranslateBtn && floatingTranslateBtn) {
							floatingTranslateBtn.remove();
							floatingTranslateBtn = null;
						}
					}, 100);
					postToParent('editorBlurred', { chapterId });
				},
			},
			handleClick(view, pos, event) {
				manageFloatingButton(view);
				return false; // Let ProseMirror handle the click as well
			}
		},
	});
	
	const doc = DOMParser.fromSchema(schema).parse(document.createRange().createContextualFragment(initialHtml || ''));
	
	editorView = new EditorView(mount, {
		state: EditorState.create({
			doc: doc,
			plugins: [history(), keymap({ 'Mod-z': undo, 'Mod-y': redo }), keymap(baseKeymap), editorPlugin],
		}),
		
		dispatchTransaction (transaction) {
			const newState = this.state.apply(transaction);
			this.updateState(newState);
			
			if (isEditable && transaction.docChanged) {
				const serializer = DOMSerializer.fromSchema(this.state.schema);
				const fragment = serializer.serializeFragment(this.state.doc.content);
				const tempDiv = document.createElement('div');
				tempDiv.appendChild(fragment);
				postToParent('contentChanged', { chapterId, field, value: tempDiv.innerHTML });
			}
			
			if (transaction.selectionSet || transaction.docChanged) {
				postToParent('stateUpdate', { chapterId, state: getToolbarState(this.state) });
			}
			
			if (transaction.docChanged) {
				sendResize();
			}
			
			manageFloatingButton(this);
		},
	});
	
	sendResize();
}

/**
 * Executes a formatting or editor command received from the parent window.
 * @param {object} payload - The command details.
 */
function executeCommand ({ command, attrs }) {
	if (!editorView) return;
	const { state, dispatch } = editorView;
	const { schema } = state;
	let cmd;
	
	switch (command) {
		case 'undo':
			undo(state, dispatch);
			break;
		case 'redo':
			redo(state, dispatch);
			break;
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
			cmd = state.selection.$from.depth > 1 && state.selection.$from.node(-1).type === schema.nodes.blockquote ? lift : wrapIn(schema.nodes.blockquote);
			break;
		case 'bullet_list':
			cmd = liftListItem(schema.nodes.list_item)(state) ? liftListItem(schema.nodes.list_item) : wrapInList(schema.nodes.bullet_list);
			break;
		case 'ordered_list':
			cmd = liftListItem(schema.nodes.list_item)(state) ? liftListItem(schema.nodes.list_item) : wrapInList(schema.nodes.ordered_list);
			break;
		case 'horizontal_rule':
			dispatch(state.tr.replaceSelectionWith(schema.nodes.horizontal_rule.create()));
			break;
		case 'heading':
			cmd = (attrs.level === 0) ? setBlockType(schema.nodes.paragraph) : setBlockType(schema.nodes.heading, { level: attrs.level });
			break;
		case 'highlight':
			let tr = state.tr;
			const { from, to } = state.selection;
			Object.keys(schema.marks).forEach(markName => {
				if (markName.startsWith('highlight_')) tr = tr.removeMark(from, to, schema.marks[markName]);
			});
			if (attrs.color !== 'transparent') {
				const markType = schema.marks[`highlight_${attrs.color}`];
				if (markType) tr = tr.addMark(from, to, markType.create());
			}
			dispatch(tr);
			break;
	}
	
	if (cmd) cmd(state, dispatch);
	editorView.focus();
}

// Applies typography styles received from the parent window.
function applyTypography ({ styleProps, settings }) {
	const root = document.documentElement;
	Object.entries(styleProps).forEach(([prop, value]) => {
		root.style.setProperty(prop, value);
	});
}

/**
 * Main message listener for communication from the parent window.
 */
window.addEventListener('message', (event) => {
	if (!parentOrigin) {
		parentOrigin = event.origin;
	} else if (event.origin !== parentOrigin) {
		console.warn('Ignoring message from unexpected origin:', event.origin);
		return;
	}
	
	const { type, payload } = event.data;
	
	switch (type) {
		case 'init':
			document.documentElement.setAttribute('data-theme', payload.theme);
			if (payload.theme === 'dark') document.documentElement.classList.add('dark');
			createEditorView(document.getElementById('editor-container'), payload);
			
			const resizeObserver = new ResizeObserver(() => {
				sendResize();
			});
			resizeObserver.observe(document.body);
			break;
		case 'updateTypography':
			applyTypography(payload);
			break;
		case 'command':
			executeCommand(payload);
			break;
		case 'sourceSelectionChanged':
			hasSourceSelection = payload.hasSelection;
			// If the source selection is removed, hide the button immediately
			if (!hasSourceSelection && floatingTranslateBtn) {
				floatingTranslateBtn.remove();
				floatingTranslateBtn = null;
			}
			break;
		
		case 'replaceRange': {
			const { from, to, newContentHtml } = payload;
			const { state, dispatch } = editorView;
			const { schema } = state;
			
			const tempDiv = document.createElement('div');
			tempDiv.innerHTML = newContentHtml;
			const newFragment = DOMParser.fromSchema(schema).parseSlice(tempDiv).content;
			let tr = state.tr.replaceWith(from, to, newFragment);
			
			let finalTo = from + newFragment.size;
			
			const mark = schema.marks.ai_suggestion.create();
			tr = tr.addMark(from, finalTo, mark);
			
			dispatch(tr);
			
			// Get the FRESH state directly from the view
			const currentState = editorView.state;
			const $replaceStart = currentState.doc.resolve(from);
			const nodeBefore = $replaceStart.parent;
			
			console.log('Node before replacement start:', nodeBefore, nodeBefore ? nodeBefore.type.name : 'N/A', nodeBefore ? nodeBefore.content.size : 'N/A');
			
			if (nodeBefore && nodeBefore.type.name === 'paragraph' && nodeBefore.content.size === 0) {
				const paraFrom = from - nodeBefore.nodeSize;
				const paraTo = from;
				if (paraFrom>=0 && paraTo<=currentState.doc.content.size && paraFrom < paraTo) {
					console.log('Deleting empty paragraph from', paraFrom, 'to', paraTo);
					
					// Create and dispatch a NEW transaction
					const deleteTr = currentState.tr.delete(paraFrom, paraTo);
					editorView.dispatch(deleteTr);
					
					finalTo -= nodeBefore.nodeSize;
				}
			}
			
			const finalRange = { from, to: finalTo };
			const endCoords = editorView.coordsAtPos(finalTo);
			postToParent('replacementComplete', { finalRange: finalRange, endCoords: endCoords });
			break;
		}
		
		case 'findAndScrollToText': {
			const { text } = payload;
			if (!editorView || !text) break;
			
			const { state } = editorView;
			const { doc } = state;
			let foundPos = -1;
			
			// Iterate through all text nodes in the document to find the marker.
			doc.descendants((node, pos) => {
				if (foundPos !== -1) return false; // Stop searching once found.
				if (node.isText) {
					const index = node.text.indexOf(text);
					if (index !== -1) {
						foundPos = pos + index; // Calculate the absolute position of the text.
					}
				}
				return true;
			});
			
			if (foundPos !== -1) {
				// Create a selection at the found position to highlight it.
				const tr = state.tr.setSelection(TextSelection.create(doc, foundPos, foundPos + text.length));
				editorView.dispatch(tr);
				
				// Focus the editor to make the selection visible.
				editorView.focus();
				const { from } = editorView.state.selection;
				const coords = editorView.coordsAtPos(from);
				
				postToParent('markerFound', { top: coords.top });
			}
			break;
		}
		
		case 'setEditable':
			//editorView.setProps({ editable: () => payload.isEditable });
			break;
		case 'cleanupAiSuggestion': {
			const { tr } = editorView.state;
			tr.removeMark(0, editorView.state.doc.content.size, schema.marks.ai_suggestion);
			editorView.dispatch(tr);
			editorView.focus();
			break;
		}
		case 'discardAiSuggestion': {
			const { from, to, originalFragmentJson } = payload;
			const originalFragment = Fragment.fromJSON(schema, originalFragmentJson);
			
			let tr = editorView.state.tr.replaceWith(from, to, originalFragment);
			
			const newTo = from + originalFragment.size;
			tr = tr.setSelection(TextSelection.create(tr.doc, from, newTo));
			
			editorView.dispatch(tr);
			break;
		}
		case 'setSelection': {
			const { from, to } = payload;
			const tr = editorView.state.tr.setSelection(TextSelection.create(editorView.state.doc, from, to));
			editorView.dispatch(tr);
			break;
		}
		case 'prepareForRephrase': {
			const { state } = editorView;
			const isForRephrase = payload && payload.isRephrase;
			if (isForRephrase && state.selection.empty) {
				postToParent('selectionResponse', null);
				return;
			}
			
			const { doc, selection } = state;
			const { from, to } = selection;
			
			const textBefore = doc.textBetween(0, from, ' ');
			const wordsBefore = textBefore.trim().split(/\s+/).slice(-200).join(' ');
			
			const textAfter = doc.textBetween(to, doc.content.size, ' ');
			const wordsAfter = textAfter.trim().split(/\s+/).slice(0, 200).join(' ');
			
			postToParent('selectionResponse', {
				from: from,
				to: to,
				originalFragmentJson: doc.slice(from, to).content.toJSON(),
				selectedText: doc.textBetween(from, to, ' '),
				wordsBefore: wordsBefore,
				wordsAfter: wordsAfter
			});
			break;
		}
		case 'prepareForGetFullHtml': {
			if (!editorView) {
				postToParent('fullHtmlResponse', { html: '' });
				return;
			}
			const serializer = DOMSerializer.fromSchema(editorView.state.schema);
			const fragment = serializer.serializeFragment(editorView.state.doc.content);
			const tempDiv = document.createElement('div');
			tempDiv.appendChild(fragment);
			postToParent('fullHtmlResponse', { html: tempDiv.innerHTML });
			break;
		}
	}
});
