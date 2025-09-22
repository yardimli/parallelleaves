import { EditorState, Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { DOMParser, DOMSerializer, Schema } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, setBlockType, wrapIn } from 'prosemirror-commands';
import { wrapInList } from 'prosemirror-schema-list';
import { initI18n, t, applyTranslationsTo } from './i18n.js';

const debounce = (func, delay) => {
	let timeout;
	return function(...args) {
		const context = this;
		clearTimeout(timeout);
		timeout = setTimeout(() => func.apply(context, args), delay);
	};
};

const codexSchema = new Schema({
	nodes: addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block'),
	marks: {
		...basicSchema.spec.marks,
		underline: {
			parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
			toDOM: () => ['u', 0]
		},
		strike: {
			parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }],
			toDOM: () => ['s', 0]
		}
	}
});

let editorView = null;
let novelId = null;
let currentEditorState = null;

const debouncedSave = debounce(async () => {
	if (!editorView || !novelId) return;
	
	const statusEl = document.getElementById('js-save-status');
	if (statusEl) statusEl.textContent = t('codex.viewer.saving');
	
	const serializer = DOMSerializer.fromSchema(codexSchema);
	const fragment = serializer.serializeFragment(editorView.state.doc.content);
	const tempDiv = document.createElement('div');
	tempDiv.appendChild(fragment);
	const htmlContent = tempDiv.innerHTML;
	
	try {
		await window.api.codex.save({ novelId, htmlContent });
		if (statusEl) statusEl.textContent = t('codex.viewer.saved');
		updateTotalWordCount(); // Update total word count on save
	} catch (error) {
		console.error('Failed to save codex:', error);
		if (statusEl) statusEl.textContent = t('codex.viewer.saveError');
	}
}, 1500);

/**
 * NEW: Fetches the latest codex content and updates the editor without a full page reload.
 */
async function reloadCodexContent() {
	if (!editorView || !novelId) return;
	
	try {
		const newHtmlContent = await window.api.codex.get(novelId);
		const newDoc = DOMParser.fromSchema(codexSchema).parse(document.createRange().createContextualFragment(newHtmlContent));
		
		// Create a new state with the new document but preserve plugins
		const newState = EditorState.create({
			doc: newDoc,
			plugins: editorView.state.plugins
		});
		
		// Update the view with the new state
		editorView.updateState(newState);
		
		// Also update the word count
		updateTotalWordCount();
		
		const statusEl = document.getElementById('js-save-status');
		if (statusEl) statusEl.textContent = t('codex.viewer.saved');
	} catch (error) {
		console.error('Failed to reload codex content:', error);
		window.showAlert(t('codex.viewer.errorLoad', { message: error.message }));
	}
}

function updateTotalWordCount() {
	if (!editorView) return;
	const text = editorView.state.doc.textContent;
	const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
	const totalWordCountEl = document.getElementById('js-total-word-count');
	if (totalWordCountEl) {
		totalWordCountEl.textContent = `${wordCount.toLocaleString()} ${t('common.words')}`;
	}
}

function updateToolbarState(view) {
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
	const allBtns = toolbar.querySelectorAll('.js-toolbar-btn');
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

function applyCommand(command) {
	if (editorView && command) {
		command(editorView.state, editorView.dispatch);
		editorView.focus();
	}
}

function handleToolbarAction(button) {
	if (!editorView) return;
	
	const command = button.dataset.command;
	const schema = editorView.state.schema;
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

function setupToolbar() {
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
			return; // Let dropdown handle its own state
		}
		handleToolbarAction(button);
	});
	
	updateToolbarState(null);
}

function setupEditor(mount, initialContent) {
	const doc = DOMParser.fromSchema(codexSchema).parse(document.createRange().createContextualFragment(initialContent));
	
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
								updateToolbarState(view);
								return false;
							}
						}
					}
				})
			]
		}),
		dispatchTransaction(transaction) {
			const newState = this.state.apply(transaction);
			this.updateState(newState);
			
			updateToolbarState(this);
			if (transaction.docChanged) {
				debouncedSave();
			}
		}
	});
}

async function setupAutogenCodex(novelId) {
	const autogenBtn = document.getElementById('js-autogen-codex');
	const modal = document.getElementById('autogen-codex-modal');
	const modalContent = document.getElementById('js-autogen-codex-modal-content');
	
	if (!autogenBtn || !modal || !modalContent) return;
	
	autogenBtn.addEventListener('click', async () => {
		try {
			modalContent.innerHTML = await window.api.getTemplate('codex/autogen-codex-modal');
			applyTranslationsTo(modalContent);
			const select = modalContent.querySelector('.js-llm-model-select');
			const result = await window.api.getModels();
			if (result.success && result.models.length > 0) {
				select.innerHTML = '';
				result.models.forEach(group => {
					const optgroup = document.createElement('optgroup');
					optgroup.label = group.group;
					group.models.forEach(model => {
						const option = new Option(model.name, model.id);
						optgroup.appendChild(option);
					});
					select.appendChild(optgroup);
				});
				select.value = 'openai/gpt-4o';
			} else {
				select.innerHTML = `<option>${t('codex.viewer.autoGenModal.errorLoadModels')}</option>`;
			}
			modal.showModal();
		} catch (error) {
			console.error('Failed to open autogen modal:', error);
			modalContent.innerHTML = `<p class="text-error">${t('codex.viewer.autoGenModal.errorLoadTool', { message: error.message })}</p>`;
			modal.showModal();
		}
	});
	
	modalContent.addEventListener('submit', (event) => {
		event.preventDefault();
		const form = event.target;
		if (!form) return;
		
		const model = form.querySelector('.js-llm-model-select').value;
		if (!model) {
			alert(t('codex.viewer.autoGenModal.alertSelectModel'));
			return;
		}
		
		const actionButtons = form.querySelector('#js-autogen-action-buttons');
		const progressSection = form.querySelector('#js-autogen-progress-section');
		if (actionButtons) actionButtons.classList.add('hidden');
		if (progressSection) progressSection.classList.remove('hidden');
		
		const stopBtn = form.querySelector('#js-autogen-stop-btn');
		if (stopBtn) {
			stopBtn.addEventListener('click', () => {
				window.api.stopCodexAutogen();
				stopBtn.disabled = true;
				stopBtn.textContent = t('stopping...'); // Visual feedback
			}, { once: true });
		}
		
		window.api.startCodexAutogen({ novelId, model });
	});
	
	window.api.onCodexAutogenUpdate((event, { progress, status, statusKey }) => {
		const progressBar = document.getElementById('js-autogen-progress-bar');
		const statusText = document.getElementById('js-autogen-status-text');
		
		if (progressBar) progressBar.value = progress;
		if (statusText) statusText.textContent = statusKey ? t(statusKey) : status;
	});
	
	window.api.onCodexAutogenFinished((event, { status }) => {
		if (modal.open) {
			modal.close();
		}
		
		// Reload the codex content in the editor if the process was not an error.
		if (status === 'complete' || status === 'cancelled') {
			setTimeout(() => {
				reloadCodexContent();
			}, 500); // A small delay to ensure the file system has caught up.
		}
	});
}

document.addEventListener('DOMContentLoaded', async () => {
	await initI18n();
	
	const params = new URLSearchParams(window.location.search);
	novelId = params.get('novelId');
	
	if (!novelId) {
		document.body.innerHTML = `<p class="text-error p-8">${t('codex.viewer.errorProjectMissing')}</p>`;
		return;
	}
	
	try {
		const novel = await window.api.getOneNovel(novelId);
		document.title = t('codex.viewer.title', { novelTitle: novel.title });
		
		const initialContent = await window.api.codex.get(novelId);
		const editorMount = document.querySelector('.js-editable');
		setupEditor(editorMount, initialContent);
		
		setupToolbar();
		updateToolbarState(editorView);
		updateTotalWordCount();
		
		setupAutogenCodex(novelId);
		
	} catch (error) {
		console.error('Failed to load codex viewer:', error);
		document.body.innerHTML = `<p class="text-error p-8">${t('codex.viewer.errorLoad', { message: error.message })}</p>`;
	}
});
