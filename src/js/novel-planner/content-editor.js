import { Schema, DOMParser } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';

let activeEditorView = null;

const highlightMarkSpec = (colorClass) => ({
	attrs: {},
	parseDOM: [{ tag: `span.${colorClass}` }],
	toDOM: () => ['span', { class: colorClass }, 0],
});

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
			const p = dom.querySelector('p');
			return { text: p ? p.textContent : '' };
		}
	}]
};

// Add the note node to the schema spec before the horizontal rule.
const nodesWithNote = nodes.addBefore('horizontal_rule', 'note', noteNodeSpec);

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

export function setActiveEditor(view) {
	activeEditorView = view;
}

export function getActiveEditor() {
	return activeEditorView;
}

// A NodeView for our custom 'note' node.
export class NoteNodeView {
	constructor(node, view, getPos) {
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
		this.dom.classList.add('ProseMirror-selectednode');
	}
	
	// ProseMirror calls this when the node is deselected. We use it to remove the visual indicator.
	deselectNode() {
		this.dom.classList.remove('ProseMirror-selectednode');
	}
	
	openEditModal(e) {
		e.preventDefault();
		const noteModal = document.getElementById('note-editor-modal');
		const form = document.getElementById('note-editor-form');
		const title = noteModal.querySelector('.js-note-modal-title');
		const contentInput = document.getElementById('note-content-input');
		const posInput = document.getElementById('note-pos');
		const chapterIdInput = document.getElementById('note-chapter-id');
		
		title.textContent = 'Edit Note';
		contentInput.value = this.node.attrs.text;
		posInput.value = this.getPos();
		
		// Find the chapterId from the parent element to populate the modal.
		const chapterEl = this.dom.closest('.manuscript-chapter-item');
		if(chapterEl) {
			chapterIdInput.value = chapterEl.dataset.chapterId;
		}
		
		noteModal.showModal();
	}
	
	deleteNode(e) {
		e.preventDefault();
		const tr = this.view.state.tr.delete(this.getPos(), this.getPos() + this.node.nodeSize);
		this.view.dispatch(tr);
	}
	
	stopEvent() { return true; }
	
	update(node) {
		if (node.type !== this.node.type) return false;
		this.node = node;
		this.contentDOM.textContent = node.attrs.text;
		return true;
	}
}
