import { Schema, DOMParser } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';

let activeEditorView = null;

const highlightMarkSpec = (colorClass) => {
	console.log(`[PM DEBUG] highlightMarkSpec called for color: ${colorClass}`);
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

// Spec for the custom 'note' node.
const noteNodeSpec = {
	attrs: {
		text: { default: '' },
	},
	group: 'block',
	content: '', // No direct content, managed by NodeView and attributes.
	draggable: false,
	selectable: false,
	isolating: true, // MODIFIED: Prevents cursor from entering and content from being merged.
	toDOM(node) {
		console.log('[PM DEBUG] noteNodeSpec.toDOM called for node:', node);
		// This is the "serialized" version for saving. The NodeView creates the interactive version.
		const wrapper = document.createElement('div');
		// Add the 'note-wrapper' class for parsing and a 'prose' class to prevent nested prose styles.
		wrapper.className = 'note-wrapper not-prose';
		const p = document.createElement('p');
		p.textContent = node.attrs.text;
		wrapper.appendChild(p);
		return wrapper;
	},
	parseDOM: [{
		tag: 'div.note-wrapper',
		getAttrs(dom) {
			console.log('[PM DEBUG] noteNodeSpec.parseDOM.getAttrs called on DOM element:', dom);
			const p = dom.querySelector('p');
			const attrs = { text: p ? p.textContent : '' };
			console.log('[PM DEBUG] Parsed attributes:', attrs);
			return attrs;
		}
	}]
};

// Add the note node to the schema spec before the horizontal rule.
const nodesWithNote = nodes.addBefore('horizontal_rule', 'note', noteNodeSpec);

console.log('[PM DEBUG] Creating ProseMirror Schema...');
export const schema = new Schema({
	nodes: addListNodes(nodesWithNote, 'paragraph+', 'block'),
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
console.log('[PM DEBUG] Schema created successfully.');

export function setActiveEditor(view) {
	console.log('[PM DEBUG] setActiveEditor called. New view:', view);
	activeEditorView = view;
}

export function getActiveEditor() {
	console.log('[PM DEBUG] getActiveEditor called.');
	return activeEditorView;
}

// A NodeView for our custom 'note' node.
export class NoteNodeView {
	constructor(node, view, getPos) {
		console.log('[PM DEBUG] NoteNodeView.constructor called.');
		console.log('  - Initial node:', node);
		console.log('  - Initial position:', getPos());
		this.node = node;
		this.view = view;
		this.getPos = getPos;
		
		this.dom = document.createElement('div');
		this.dom.className = 'note-wrapper not-prose p-1 my-1 border-l-4 border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-600 rounded-r-md relative group';
		this.dom.contentEditable = false;
		
		this.contentDOM = document.createElement('p');
		this.contentDOM.className = 'text-base-content/80 m-0';
		this.contentDOM.textContent = node.attrs.text;
		
		const controls = document.createElement('div');
		controls.className = 'absolute top-1 right-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity';
		
		const editBtn = document.createElement('button');
		editBtn.type = 'button';
		editBtn.className = 'btn btn-xs btn-ghost';
		editBtn.innerHTML = '<i class="bi bi-pencil"></i>';
		editBtn.title = 'Edit note';
		editBtn.addEventListener('mousedown', this.openEditModal.bind(this));
		
		const deleteBtn = document.createElement('button');
		deleteBtn.type = 'button';
		deleteBtn.className = 'btn btn-xs btn-ghost text-error';
		deleteBtn.innerHTML = '<i class="bi bi-trash"></i>';
		deleteBtn.title = 'Delete note';
		deleteBtn.addEventListener('mousedown', this.deleteNode.bind(this));
		
		controls.appendChild(editBtn);
		controls.appendChild(deleteBtn);
		
		this.dom.appendChild(this.contentDOM);
		this.dom.appendChild(controls);
	}
	
	
	// ProseMirror calls this when the node is selected. We use it to add a visual indicator.
	selectNode() {
		console.log(`[PM DEBUG] NoteNodeView.selectNode called for node at pos ${this.getPos()}`);
		this.dom.classList.add('ProseMirror-selectednode');
	}
	
	// ProseMirror calls this when the node is deselected. We use it to remove the visual indicator.
	deselectNode() {
		console.log(`[PM DEBUG] NoteNodeView.deselectNode called for node at pos ${this.getPos()}`);
		this.dom.classList.remove('ProseMirror-selectednode');
	}
	
	openEditModal(e) {
		e.preventDefault();
		console.log('[PM DEBUG] NoteNodeView.openEditModal called.');
		const noteModal = document.getElementById('note-editor-modal');
		const form = document.getElementById('note-editor-form');
		const title = noteModal.querySelector('.js-note-modal-title');
		const contentInput = document.getElementById('note-content-input');
		const posInput = document.getElementById('note-pos');
		const chapterIdInput = document.getElementById('note-chapter-id');
		
		title.textContent = 'Edit Note';
		contentInput.value = this.node.attrs.text;
		posInput.value = this.getPos();
		console.log(`  - Setting modal pos to: ${this.getPos()}`);
		
		// Find the chapterId from the parent element to populate the modal.
		const chapterEl = this.dom.closest('.manuscript-chapter-item');
		if(chapterEl) {
			chapterIdInput.value = chapterEl.dataset.chapterId;
			console.log(`  - Found and set chapterId: ${chapterEl.dataset.chapterId}`);
		} else {
			console.warn('[PM DEBUG] Could not find parent .manuscript-chapter-item to get chapterId.');
		}
		
		noteModal.showModal();
	}
	
	deleteNode(e) {
		e.preventDefault();
		const pos = this.getPos();
		const nodeSize = this.node.nodeSize;
		console.log(`[PM DEBUG] NoteNodeView.deleteNode called. Deleting node at pos ${pos} with size ${nodeSize}`);
		const tr = this.view.state.tr.delete(pos, pos + nodeSize);
		this.view.dispatch(tr);
	}
	
	stopEvent() {
		console.log('[PM DEBUG] NoteNodeView.stopEvent called, returning true.');
		return true;
	}
	
	update(node) {
		// If the node type has changed, we must re-render.
		if (node.type !== this.node.type) {
			return false;
		}
		
		// If the note text is the only thing that can change,
		// check if it has and update the DOM directly.
		if (node.attrs.text !== this.node.attrs.text) {
			const noteTextElement = this.dom.querySelector('.note-text-class'); // Or however you access it
			if (noteTextElement) {
				noteTextElement.textContent = node.attrs.text;
			}
		}
		
		// Update the internal node reference
		this.node = node;
		// Return true to signal that ProseMirror doesn't need to re-render this node.
		return true;
	}
}
