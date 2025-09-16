import { EditorState, Plugin, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { DOMParser, DOMSerializer, Fragment } from 'prosemirror-model';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, setBlockType, wrapIn, lift } from 'prosemirror-commands';
import { wrapInList, liftListItem } from 'prosemirror-schema-list';
import { schema, NoteNodeView } from './content-editor.js';

let editorView;
let parentOrigin; // Store the parent window's origin for security
let chapterId;
let field;

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
	
	const isAtEmptyPara = empty && $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0;
	
	return {
		canUndo: undo(state),
		canRedo: redo(state),
		isTextSelected: !empty,
		canAddNote: isAtEmptyPara,
		activeMarks: Object.keys(schema.marks).filter(markName => isMarkActive(schema.marks[markName])),
		activeNodes: Object.keys(schema.nodes).filter(nodeName => isNodeActive(schema.nodes[nodeName])),
		headingLevel: headingLevel,
		selectionText: state.doc.textBetween(from, to, ' '),
	};
};

/**
 * Creates and initializes the ProseMirror editor view.
 * @param {HTMLElement} mount - The element to mount the editor in.
 * @param {object} config - The initialization configuration.
 */
function createEditorView(mount, config) {
	const { initialHtml, isEditable, chapterId: id, field: fieldName, i18n } = config;
	chapterId = id;
	field = fieldName;
	
	const noteProtectionPlugin = new Plugin({
		filterTransaction(tr, state) {
			if (!tr.docChanged) return true;
			let noteDeleted = false;
			state.doc.descendants((node, pos) => {
				if (node.type.name === 'note' && tr.mapping.mapResult(pos).deleted) {
					noteDeleted = true;
				}
			});
			return !noteDeleted;
		},
	});
	
	const editorPlugin = new Plugin({
		props: {
			editable: () => isEditable,
			handleDOMEvents: {
				focus(view) {
					postToParent('editorFocused', { chapterId, state: getToolbarState(view.state) });
				},
				blur() {
					postToParent('editorBlurred', { chapterId });
				},
			},
		},
	});
	
	const doc = DOMParser.fromSchema(schema).parse(document.createRange().createContextualFragment(initialHtml || ''));
	
	const i18nTitles = i18n || { edit: 'Edit note', delete: 'Delete note' };
	
	editorView = new EditorView(mount, {
		state: EditorState.create({
			doc: doc,
			plugins: [history(), keymap({ 'Mod-z': undo, 'Mod-y': redo }), keymap(baseKeymap), editorPlugin, noteProtectionPlugin],
		}),
		nodeViews: {
			note(node, view, getPos) {
				return new NoteNodeView(node, view, getPos, (type, payload) => postToParent(type, payload), {
					edit: i18nTitles.editNote,
					delete: i18nTitles.deleteNote
				});
			}
		},
		dispatchTransaction(transaction) {
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
		},
	});
	
	sendResize();
}

/**
 * Executes a formatting or editor command received from the parent window.
 * @param {object} payload - The command details.
 */
function executeCommand({ command, attrs }) {
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

function findTranslationBlockPositions(blockNumber) {
	const { doc } = editorView.state;
	let noteNodeCount = 0;
	let blockStartPos = -1;
	let blockEndPos = doc.content.size;
	let blockFound = false;
	
	doc.forEach((node, pos) => {
		if (node.type.name === 'note') {
			noteNodeCount++;
			if (noteNodeCount === blockNumber) {
				blockStartPos = pos + node.nodeSize;
				blockFound = true;
			} else if (blockFound) {
				blockEndPos = pos;
				blockFound = false; // Stop searching
			}
		}
	});
	return { blockStartPos, blockEndPos };
}

// NEW FUNCTION: Applies typography styles received from the parent window.
function applyTypography({ styleProps, settings }) {
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
		case 'saveNote': {
			const { pos, noteText } = payload;
			let tr;
			if (pos !== null && !isNaN(pos)) {
				tr = editorView.state.tr.setNodeMarkup(pos, null, { text: noteText });
			} else {
				const { $from } = editorView.state.selection;
				const noteNode = schema.nodes.note.create({ text: noteText });
				tr = editorView.state.tr.replaceRangeWith($from.start(), $from.end(), noteNode);
			}
			editorView.dispatch(tr);
			editorView.focus();
			break;
		}
		
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
				console.log('Deleting empty paragraph from', paraFrom, 'to', paraTo);
				
				// Create and dispatch a NEW transaction
				const deleteTr = currentState.tr.delete(paraFrom, paraTo);
				editorView.dispatch(deleteTr);
				
				finalTo -= nodeBefore.nodeSize;
			}
			
			const finalRange = { from, to: finalTo };
			const endCoords = editorView.coordsAtPos(finalTo);
			postToParent('replacementComplete', { finalRange: finalRange, endCoords: endCoords });
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
		case 'prepareForTranslate': {
			const { blockNumber } = payload;
			const { state, dispatch } = editorView;
			const { schema } = state;
			let tr = state.tr;
			
			const { blockStartPos, blockEndPos } = findTranslationBlockPositions(blockNumber);
			
			if (blockStartPos === -1) {
				postToParent('selectionResponse', null); // Signal error
				return;
			}
			
			const before = state.doc.childBefore(blockEndPos);
			let insertPos = (before.node && before.offset >= blockStartPos)
				? before.offset + before.node.nodeSize
				: blockStartPos;
			
			tr.insert(insertPos, schema.nodes.paragraph.create());
			const fromPos = insertPos + 1;
			tr.setSelection(TextSelection.create(tr.doc, fromPos));
			dispatch(tr);
			
			const finalState = editorView.state;
			postToParent('selectionResponse', {
				from: finalState.selection.from,
				to: finalState.selection.to,
				originalFragmentJson: finalState.doc.slice(finalState.selection.from, finalState.selection.to).content.toJSON(),
				selectedText: ''
			});
			break;
		}
		case 'prepareForRephrase': {
			const { state } = editorView;
			if (state.selection.empty) {
				postToParent('selectionResponse', null);
				return;
			}
			postToParent('selectionResponse', {
				from: state.selection.from,
				to: state.selection.to,
				originalFragmentJson: state.doc.slice(state.selection.from, state.selection.to).content.toJSON(),
				selectedText: state.doc.textBetween(state.selection.from, state.selection.to, ' ')
			});
			break;
		}
	}
});
