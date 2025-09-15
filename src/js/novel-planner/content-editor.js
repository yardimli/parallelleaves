import { Schema, DOMParser } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';

let activeContentWindow = null;

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

// Spec for the custom 'note' node.
const noteNodeSpec = {
	attrs: {
		text: { default: '' },
	},
	group: 'block',
	content: '', // No direct content, managed by NodeView and attributes.
	draggable: false,
	selectable: false,
	isolating: true,
	toDOM(node) {
		const wrapper = document.createElement('div');
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
			const attrs = { text: p ? p.textContent : '' };
			return attrs;
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

export function setActiveEditor(contentWindow) {
	activeContentWindow = contentWindow;
}

export function getActiveEditor() {
	return activeContentWindow;
}

// A NodeView for our custom 'note' node.
export class NoteNodeView {
	// MODIFIED: Added `titles` parameter to constructor for i18n
	constructor(node, view, getPos, postMessageCallback, titles) {
		this.node = node;
		this.view = view;
		this.getPos = getPos;
		this.postMessage = postMessageCallback;
		
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
		// MODIFIED: Use translated title
		editBtn.title = titles.edit;
		editBtn.addEventListener('mousedown', this.openEditModal.bind(this));
		
		const deleteBtn = document.createElement('button');
		deleteBtn.type = 'button';
		deleteBtn.className = 'btn btn-xs btn-ghost text-error';
		deleteBtn.innerHTML = '<i class="bi bi-trash"></i>';
		// MODIFIED: Use translated title
		deleteBtn.title = titles.delete;
		deleteBtn.addEventListener('mousedown', this.deleteNode.bind(this));
		
		controls.appendChild(editBtn);
		controls.appendChild(deleteBtn);
		
		this.dom.appendChild(this.contentDOM);
		this.dom.appendChild(controls);
	}
	
	
	selectNode() {
		this.dom.classList.add('ProseMirror-selectednode');
	}
	
	deselectNode() {
		this.dom.classList.remove('ProseMirror-selectednode');
	}
	
	openEditModal(e) {
		e.preventDefault();
		this.postMessage('openNoteModal', {
			// MODIFIED: Use translation keys for the modal title
			title: 'editor.noteModal.editTitle',
			content: this.node.attrs.text,
			pos: this.getPos(),
		});
	}
	
	deleteNode(e) {
		e.preventDefault();
		const pos = this.getPos();
		const nodeSize = this.node.nodeSize;
		const tr = this.view.state.tr.delete(pos, pos + nodeSize);
		this.view.dispatch(tr);
	}
	
	stopEvent() {
		return true;
	}
	
	update(node) {
		if (node.type !== this.node.type) {
			return false;
		}
		
		if (node.attrs.text !== this.node.attrs.text) {
			this.contentDOM.textContent = node.attrs.text;
		}
		
		this.node = node;
		return true;
	}
}
