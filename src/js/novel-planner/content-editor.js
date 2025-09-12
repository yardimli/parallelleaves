import { EditorState, Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Schema, DOMParser, DOMSerializer } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { updateToolbarState } from './toolbar.js';

const debounceTimers = new Map();
const editorInstances = new Map();
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

// NEW: Spec for the custom 'note' node.
const noteNodeSpec = {
	attrs: {
		text: { default: '' },
	},
	group: 'block',
	content: '', // No direct content, managed by NodeView and attributes.
	draggable: false,
	selectable: false,
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

// NEW: Add the note node to the schema spec before the horizontal rule.
const nodesWithNote = nodes.addBefore('horizontal_rule', 'note', noteNodeSpec);

export const schema = new Schema({
	nodes: addListNodes(nodesWithNote, 'paragraph+', 'block'), // MODIFIED: Use the updated nodes spec
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

const descriptionSchema = new Schema({
	nodes: {
		doc: { content: 'paragraph' },
		paragraph: { content: 'text*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
		text: {},
	},
	marks: {},
});

export function setActiveEditor(view) {
	activeEditorView = view;
}

export function getActiveEditor() {
	return activeEditorView;
}

// ... (rest of the file is unchanged until the end)

function triggerDebouncedSave(windowContent) {
	const isChapter = windowContent.matches('.chapter-window-content');
	const isCodex = windowContent.matches('.codex-entry-window-content');
	
	let id, key;
	
	if (isChapter) {
		id = windowContent.dataset.chapterId;
		key = `chapter-${id}`;
	} else if (isCodex) {
		id = windowContent.dataset.entryId;
		key = `codex-${id}`;
	} else {
		return;
	}
	
	if (!id) return;
	
	if (debounceTimers.has(key)) {
		clearTimeout(debounceTimers.get(key));
	}
	
	const timer = setTimeout(() => {
		saveWindowContent(windowContent);
		debounceTimers.delete(key);
	}, 2000);
	
	debounceTimers.set(key, timer);
}

async function saveWindowContent(windowContent) {
	const isChapter = windowContent.matches('.chapter-window-content');
	const isCodex = windowContent.matches('.codex-entry-window-content');
	
	const serializeDocToHtml = (view) => {
		const serializer = DOMSerializer.fromSchema(view.state.schema);
		const fragment = serializer.serializeFragment(view.state.doc.content);
		const tempDiv = document.createElement('div');
		tempDiv.appendChild(fragment);
		return tempDiv.innerHTML;
	};
	
	if (isCodex) {
		const entryId = windowContent.dataset.entryId;
		const instances = editorInstances.get(`codex-${entryId}`);
		if (!instances) return;
		
		const titleInput = windowContent.querySelector('.js-codex-title-input');
		const content = serializeDocToHtml(instances.contentView);
		const data = { title: titleInput.value, content };
		
		try {
			const response = await window.api.updateCodexEntry(entryId, data);
			if (!response.success) throw new Error(response.message || 'Failed to save codex entry.');
		} catch (error) {
			console.error('Error saving codex entry:', error);
			alert('Error: Could not save changes to codex entry.');
		}
	} else if (isChapter) {
		const chapterId = windowContent.dataset.chapterId;
		const instances = editorInstances.get(`chapter-${chapterId}`);
		if (!instances) return;
		
		const titleInput = windowContent.querySelector('.js-chapter-title-input');
		const summary = serializeDocToHtml(instances.summaryView);
		const data = { title: titleInput.value, summary };
		
		try {
			const response = await window.api.updateChapterContent(chapterId, data);
			if (!response.success) throw new Error(response.message || 'Failed to save chapter.');
		} catch (error) {
			console.error('Error saving chapter:', error);
			alert('Error: Could not save changes to chapter.');
		}
	}
}

function initEditorsForWindow(windowContent) {
	const isChapter = windowContent.matches('.chapter-window-content');
	const isCodex = windowContent.matches('.codex-entry-window-content');
	
	let id, key;
	
	if (isChapter) {
		id = windowContent.dataset.chapterId;
		key = `chapter-${id}`;
	} else if (isCodex) {
		id = windowContent.dataset.entryId;
		key = `codex-${id}`;
	} else {
		return;
	}
	
	if (!id || editorInstances.has(key)) return;
	
	const initialContentContainer = windowContent.querySelector('.js-pm-content');
	if (!initialContentContainer) return;
	
	const createEditor = (mount, isSimpleSchema) => {
		const name = mount.dataset.name;
		const placeholder = mount.dataset.placeholder || '';
		const initialContentEl = initialContentContainer.querySelector(`[data-name="${name}"]`);
		const currentSchema = isSimpleSchema ? descriptionSchema : schema;
		
		const doc = DOMParser.fromSchema(currentSchema).parse(initialContentEl);
		
		const customKeymap = {
			...baseKeymap,
			'Mod-b': toggleMark(schema.marks.strong),
			'Mod-B': toggleMark(schema.marks.strong),
			'Mod-i': toggleMark(schema.marks.em),
			'Mod-I': toggleMark(schema.marks.em),
		};
		
		const view = new EditorView(mount, {
			state: EditorState.create({
				doc,
				plugins: [
					history(),
					keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo }),
					keymap(customKeymap),
					isSimpleSchema ? keymap({ 'Enter': () => true }) : keymap({}),
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
				const newState = view.state.apply(transaction);
				view.updateState(newState);
				if (transaction.docChanged) {
					triggerDebouncedSave(windowContent);
				}
				if ((transaction.selectionSet || transaction.docChanged)) {
					updateToolbarState(view);
				}
			},
		});
		return view;
	};
	
	if (isCodex) {
		const titleInput = windowContent.querySelector('.js-codex-title-input');
		titleInput.addEventListener('input', () => triggerDebouncedSave(windowContent));
		const contentMount = windowContent.querySelector('.js-codex-editable[data-name="content"]');
		if (!contentMount) return;
		
		const contentView = createEditor(contentMount, false);
		
		editorInstances.set(key, { contentView });
	} else if (isChapter) {
		const titleInput = windowContent.querySelector('.js-chapter-title-input');
		titleInput.addEventListener('input', () => triggerDebouncedSave(windowContent));
		
		const summaryMount = windowContent.querySelector('.js-editable[data-name="summary"]');
		if (!summaryMount) return;
		const summaryView = createEditor(summaryMount, false);
		
		editorInstances.set(key, { summaryView });
	}
}

export function setupContentEditor(desktop) {
	const observer = new MutationObserver((mutationsList) => {
		for (const mutation of mutationsList) {
			if (mutation.type === 'childList') {
				mutation.addedNodes.forEach(node => {
					if (node.nodeType !== Node.ELEMENT_NODE) return;
					const windowContent = node.querySelector('.codex-entry-window-content, .chapter-window-content') || (node.matches('.codex-entry-window-content, .chapter-window-content') ? node : null);
					if (windowContent) {
						initEditorsForWindow(windowContent);
					}
				});
				mutation.removedNodes.forEach(node => {
					if (node.nodeType !== Node.ELEMENT_NODE) return;
					const windowContent = node.querySelector('.codex-entry-window-content, .chapter-window-content') || (node.matches('.codex-entry-window-content, .chapter-window-content') ? node : null);
					if (windowContent) {
						let key;
						if (windowContent.matches('.codex-entry-window-content')) {
							key = `codex-${windowContent.dataset.entryId}`;
						} else if (windowContent.matches('.chapter-window-content')) {
							key = `chapter-${windowContent.dataset.chapterId}`;
						}
						
						if (key && editorInstances.has(key)) {
							const views = editorInstances.get(key);
							Object.values(views).forEach(view => view.destroy());
							editorInstances.delete(key);
							debounceTimers.delete(key);
						}
					}
				});
			}
		}
	});
	
	observer.observe(desktop, { childList: true, subtree: true });
	
	desktop.querySelectorAll('.codex-entry-window-content, .chapter-window-content').forEach(initEditorsForWindow);
}


// NEW: A NodeView for our custom 'note' node.
export class NoteNodeView {
	constructor(node, view, getPos) {
		this.node = node;
		this.view = view;
		this.getPos = getPos;
		
		this.dom = document.createElement('div');
		this.dom.className = 'note-wrapper not-prose p-1 my-1 border-l-4 border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-600 rounded-r-md relative group';
		// NEW: Add the `contenteditable="false"` attribute to the main wrapper.
		// This prevents the user from being able to place a cursor inside or select text.
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
	
	// NEW: Add a `selectNode` method.
	// ProseMirror calls this when the node is selected. We use it to add a visual indicator.
	selectNode() {
		this.dom.classList.add('ProseMirror-selectednode');
	}
	
	// NEW: Add a `deselectNode` method.
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
