// src/js/prompt-editor.js

// This file now controls the prompt editor modal within the novel editor.

import { init as initRephraseEditor, buildPromptJson as buildRephraseJson } from './prompt-editors/rephrase-editor.js';
import { init as initTranslateEditor, buildPromptJson as buildTranslateJson } from './prompt-editors/translate-editor.js';
import { getActiveEditor } from './novel-planner/content-editor.js';
import { updateToolbarState } from './novel-planner/toolbar.js';
import { TextSelection } from 'prosemirror-state';
import { DOMParser } from 'prosemirror-model';

const editors = {
	'rephrase': { name: 'Rephrase', init: initRephraseEditor },
	'translate': { name: 'Translate', init: initTranslateEditor },
};

const promptBuilders = {
	'rephrase': buildRephraseJson,
	'translate': buildTranslateJson,
};

const formDataExtractors = {
	'rephrase': (form) => ({
		instructions: form.elements.instructions.value.trim(),
		selectedCodexIds: form.elements.codex_entry ? Array.from(form.elements.codex_entry).filter(cb => cb.checked).map(cb => cb.value) : [],
	}),
	'translate': (form) => ({
		instructions: form.elements.instructions.value.trim(),
		selectedCodexIds: form.elements.codex_entry ? Array.from(form.elements.codex_entry).filter(cb => cb.checked).map(cb => cb.value) : [],
	}),
};


let modalEl;
let currentContext;

// State variables for the AI review workflow, moved from toolbar.js
let isAiActionActive = false;
let originalFragment = null;
let aiActionRange = null;
let floatingToolbar = null;
let currentAiParams = null; // For the retry functionality
let activeEditorView = null;
let currentPromptId = null;

// NEW SECTION START: Helper functions to control the AI Action spinner visibility.
/**
 * Shows the spinner overlay in the chapter editor.
 */
function showAiSpinner() {
	const overlay = document.getElementById('ai-action-spinner-overlay');
	if (overlay) {
		overlay.classList.remove('hidden');
	}
}

/**
 * Hides the spinner overlay in the chapter editor.
 */
function hideAiSpinner() {
	const overlay = document.getElementById('ai-action-spinner-overlay');
	if (overlay) {
		overlay.classList.add('hidden');
	}
}
// NEW SECTION END

/**
 * Loads a specific prompt builder into the editor pane.
 * @param {string} promptId - The ID of the prompt to load.
 */
const loadPrompt = async (promptId) => {
	if (!modalEl) return;
	
	const toggleBtn = modalEl.querySelector('.js-toggle-preview-btn');
	if (toggleBtn) {
		toggleBtn.textContent = 'Show Preview';
	}
	
	const placeholder = modalEl.querySelector('.js-prompt-placeholder');
	const customEditorPane = modalEl.querySelector('.js-custom-editor-pane');
	const customPromptTitle = customEditorPane.querySelector('.js-custom-prompt-title');
	const customFormContainer = customEditorPane.querySelector('.js-custom-form-container');
	
	const editorConfig = editors[promptId];
	if (!editorConfig) {
		console.error(`No editor configured for promptId: ${promptId}`);
		placeholder.classList.remove('hidden');
		customEditorPane.classList.add('hidden');
		placeholder.innerHTML = `<p class="text-error">No editor found for prompt: ${promptId}</p>`;
		return;
	}
	
	modalEl.querySelectorAll('.js-prompt-item').forEach(btn => {
		btn.classList.toggle('btn-active', btn.dataset.promptId === promptId);
	});
	
	placeholder.classList.add('hidden');
	customEditorPane.classList.remove('hidden');
	
	customPromptTitle.textContent = `Prompt Builder: ${editorConfig.name}`;
	customFormContainer.innerHTML = `<div class="p-4 text-center"><span class="loading loading-spinner"></span></div>`;
	
	await editorConfig.init(customFormContainer, currentContext);
};


// --- AI Action Review Workflow (Moved from toolbar.js) ---

function setEditorEditable(view, isEditable) {
	view.setProps({
		editable: () => isEditable,
	});
}

function cleanupAiAction() {
	if (floatingToolbar) {
		floatingToolbar.remove();
		floatingToolbar = null;
	}
	
	if (activeEditorView) {
		setEditorEditable(activeEditorView, true);
		const { state, dispatch } = activeEditorView;
		const { schema } = state;
		const tr = state.tr.removeMark(0, state.doc.content.size, schema.marks.ai_suggestion);
		dispatch(tr);
		activeEditorView.focus();
	}
	
	isAiActionActive = false;
	originalFragment = null;
	aiActionRange = null;
	currentAiParams = null;
	updateToolbarState(activeEditorView);
}

function handleFloatyApply() {
	if (!isAiActionActive || !activeEditorView) return;
	cleanupAiAction();
}

function handleFloatyDiscard() {
	if (!isAiActionActive || !activeEditorView || !originalFragment) return;
	
	const { state, dispatch } = activeEditorView;
	const tr = state.tr.replace(aiActionRange.from, aiActionRange.to, originalFragment);
	dispatch(tr);
	
	cleanupAiAction();
}

async function handleFloatyRetry() {
	if (!isAiActionActive || !activeEditorView || !currentAiParams) return;
	
	const actionToRetry = currentAiParams.action;
	const contextForRetry = currentAiParams.context;
	const previousFormData = currentAiParams.formData;
	
	if (floatingToolbar) {
		floatingToolbar.remove();
		floatingToolbar = null;
	}
	
	const { state, dispatch } = activeEditorView;
	let tr = state.tr.replace(aiActionRange.from, aiActionRange.to, originalFragment);
	
	const newTo = aiActionRange.from + originalFragment.size;
	
	tr = tr.setSelection(TextSelection.create(tr.doc, aiActionRange.from, newTo));
	dispatch(tr);
	
	setEditorEditable(activeEditorView, true);
	
	isAiActionActive = false;
	originalFragment = null;
	updateToolbarState(activeEditorView);
	
	openPromptEditor(contextForRetry, actionToRetry, previousFormData);
}

function createFloatingToolbar(view, from, to, model) {
	if (floatingToolbar) floatingToolbar.remove();
	
	const text = view.state.doc.textBetween(from, to, ' ');
	const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
	const modelName = model.split('/').pop() || model;
	
	const toolbarEl = document.createElement('div');
	toolbarEl.id = 'ai-floating-toolbar';
	toolbarEl.innerHTML = `
        <button data-action="apply" title="Apply"><i class="bi bi-check-lg"></i> Apply</button>
        <button data-action="retry" title="Retry"><i class="bi bi-arrow-repeat"></i> Retry</button>
        <button data-action="discard" title="Discard"><i class="bi bi-x-lg"></i> Discard</button>
        <div class="divider-vertical"></div>
        <span class="text-gray-400">${wordCount} Words, ${modelName}</span>
    `;
	
	const container = document.getElementById('viewport') || document.body;
	container.appendChild(toolbarEl);
	floatingToolbar = toolbarEl;
	
	const toolbarWidth = toolbarEl.offsetWidth;
	const toolbarHeight = toolbarEl.offsetHeight;
	const containerRect = container.getBoundingClientRect();
	const startCoords = view.coordsAtPos(from);
	
	let desiredLeft = startCoords.left - containerRect.left;
	const finalLeft = Math.max(10, Math.min(desiredLeft, container.clientWidth - toolbarWidth - 10));
	
	let desiredTop = startCoords.top - containerRect.top - toolbarHeight - 5;
	if (desiredTop < 10) {
		desiredTop = startCoords.bottom - containerRect.top + 5;
	}
	const finalTop = Math.max(10, Math.min(desiredTop, container.clientHeight - toolbarHeight - 10));
	
	toolbarEl.style.left = `${finalLeft}px`;
	toolbarEl.style.top = `${finalTop}px`;
	
	toolbarEl.addEventListener('mousedown', (e) => e.preventDefault());
	toolbarEl.addEventListener('click', (e) => {
		const button = e.target.closest('button');
		if (!button) return;
		const action = button.dataset.action;
		if (action === 'apply') handleFloatyApply();
		if (action === 'discard') handleFloatyDiscard();
		if (action === 'retry') handleFloatyRetry();
	});
}

/**
 * Initiates the AI text processing stream and handles the response.
 * @param {object} params - The parameters for the AI stream.
 * @param {object} params.prompt - The prompt object to send to the AI.
 * @param {string} params.model - The AI model to use.
 */
// MODIFIED: Removed 'async' as this function initiates a stream but doesn't wait for it to finish.
function startAiStream(params) {
	const { prompt, model } = params;
	
	isAiActionActive = true;
	updateToolbarState(activeEditorView);
	setEditorEditable(activeEditorView, false);
	
	let isFirstChunk = true;
	let currentInsertionPos = aiActionRange.from;
	
	const onData = (payload) => {
		if (payload.chunk) {
			// MODIFIED: Hide spinner on receiving the first chunk of data.
			if (isFirstChunk) {
				hideAiSpinner();
			}
			
			const { schema } = activeEditorView.state;
			const mark = schema.marks.ai_suggestion.create();
			let tr = activeEditorView.state.tr;
			
			if (isFirstChunk) {
				tr.replaceWith(aiActionRange.from, aiActionRange.to, []);
				isFirstChunk = false;
			}
			
			const parts = payload.chunk.split('\n');
			parts.forEach((part, index) => {
				if (part) {
					const textNode = schema.text(part, [mark]);
					tr.insert(currentInsertionPos, textNode);
					currentInsertionPos += part.length;
				}
				if (index < parts.length - 1) {
					tr.split(currentInsertionPos);
					currentInsertionPos += 2;
				}
			});
			
			aiActionRange.to = currentInsertionPos;
			
			// Dispatch the transaction to update the view's state and DOM.
			activeEditorView.dispatch(tr);
			
			// MODIFIED SECTION START: Replaced tr.scrollIntoView() with a more reliable DOM-based approach
			// using requestAnimationFrame to ensure it runs after the browser has painted the DOM updates.
			requestAnimationFrame(() => {
				// Ensure the view hasn't been destroyed in the meantime.
				if (!activeEditorView || activeEditorView.isDestroyed) return;
				
				try {
					const { selection } = activeEditorView.state;
					// Get the DOM node at the current cursor position.
					const { node } = activeEditorView.domAtPos(selection.head);
					// If it's a text node, get its parent element to scroll to.
					const element = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
					
					if (element && typeof element.scrollIntoView === 'function') {
						// Use the native browser API. 'nearest' scrolls the minimum amount required.
						element.scrollIntoView({ block: 'nearest' });
					}
				} catch (e) {
					console.error('Error scrolling editor into view:', e);
				}
			});
			// MODIFIED SECTION END
			
		} else if (payload.done) {
			createFloatingToolbar(activeEditorView, aiActionRange.from, aiActionRange.to, model);
			
		} else if (payload.error) {
			console.error('AI Action Error:', payload.error);
			window.showAlert(payload.error);
			// MODIFIED: Hide spinner if an error occurs.
			hideAiSpinner();
			handleFloatyDiscard();
		}
	};
	
	try {
		window.api.processCodexTextStream({ prompt, model }, onData);
	} catch (error) {
		console.error('AI Action Error:', error);
		window.showAlert(error.message);
		// MODIFIED: Hide spinner if an error occurs during stream initiation.
		hideAiSpinner();
		handleFloatyDiscard();
	}
}

async function populateModelDropdown(initialState = null) {
	if (!modalEl) return;
	const select = modalEl.querySelector('.js-llm-model-select');
	if (!select) return;
	
	try {
		const result = await window.api.getModels();
		if (!result.success || !result.models || result.models.length === 0) {
			throw new Error(result.message || 'No models returned from API.');
		}
		
		const models = result.models;
		const defaultModel = 'openai/gpt-4o-mini';
		
		select.innerHTML = '';
		models.forEach(model => {
			const option = new Option(model.name, model.id);
			select.appendChild(option);
		});
		
		const savedModel = initialState?.model;
		if (savedModel && models.some(m => m.id === savedModel)) {
			select.value = savedModel;
		} else if (models.some(m => m.id === defaultModel)) {
			select.value = defaultModel;
		} else if (models.length > 0) {
			select.value = models[0].id;
		}
	} catch (error) {
		console.error('Failed to populate AI model dropdowns:', error);
		select.innerHTML = '<option value="" disabled selected>Error loading</option>';
	}
}

async function handleModalApply() {
	if (!modalEl || isAiActionActive) return;
	
	const model = modalEl.querySelector('.js-llm-model-select').value;
	const action = currentPromptId ? currentPromptId : null;
	const form = modalEl.querySelector('.js-custom-editor-pane form');
	
	if (!model || !action || !form) {
		window.showAlert('Could not apply action. Missing model, action, or form.');
		return;
	}
	
	const builder = promptBuilders[action];
	const extractor = formDataExtractors[action];
	if (!builder || !extractor) {
		window.showAlert(`No prompt builder or form extractor found for action: ${action}`);
		return;
	}
	
	modalEl.close();
	
	activeEditorView = currentContext.activeEditorView;
	if (!activeEditorView) {
		window.showAlert('No active editor to apply changes to.');
		return;
	}
	
	const formDataObj = extractor(form);
	
	// Save the current prompt settings for next time.
	const novelId = document.body.dataset.novelId;
	if (novelId) {
		const settingsToSave = {
			model: model,
			instructions: formDataObj.instructions,
			selectedCodexIds: formDataObj.selectedCodexIds,
		};
		// Fire-and-forget save operation.
		window.api.updatePromptSettings({
			novelId: novelId,
			promptType: action,
			settings: settingsToSave
		}).catch(err => console.error('Failed to save prompt settings:', err));
	}
	
	const { state, dispatch } = activeEditorView;
	let tr = state.tr;
	let fromPos = state.selection.from;
	let toPos = state.selection.to;
	
	if (action === 'translate') {
		const { schema } = state;
		const blockNumber = currentContext.translationInfo.blockNumber;
		
		// 1. Find the start and end positions of the target translation block.
		let noteNodeCount = 0;
		let blockStartPos = -1;
		let blockEndPos = state.doc.content.size;
		let blockFound = false;
		
		state.doc.forEach((node, pos) => {
			if (node.type.name === 'note') {
				noteNodeCount++;
				if (noteNodeCount === blockNumber) {
					// The content for this block starts right after this note marker.
					blockStartPos = pos + node.nodeSize;
					blockFound = true;
				} else if (blockFound) {
					// This is the note for the *next* block, so it marks the end of our block.
					blockEndPos = pos;
					blockFound = false; // Stop searching, we have our end position.
				}
			}
		});
		
		if (blockStartPos === -1) {
			window.showAlert(`Could not find target translation block #${blockNumber}.`, 'Translation Error');
			return;
		}
		
		// 2. Find the last node in the block to insert after.
		const before = state.doc.childBefore(blockEndPos);
		let lastNodeInBlock = null;
		let lastNodePosInBlock = -1;
		if (before.node && before.offset >= blockStartPos) {
			lastNodeInBlock = before.node;
			lastNodePosInBlock = before.offset;
		}
		
		// 3. Determine insertion position.
		let insertPos;
		if (lastNodeInBlock) {
			// There's content in the block, so insert after the last node.
			insertPos = lastNodePosInBlock + lastNodeInBlock.nodeSize;
		} else {
			// The block is empty, so insert at its beginning.
			insertPos = blockStartPos;
		}
		
		// 4. Always insert a new, empty paragraph for the translation.
		tr.insert(insertPos, schema.nodes.paragraph.create());
		
		// 5. Set the cursor position inside this new paragraph, ready for streaming.
		fromPos = toPos = insertPos + 1;
		tr.setSelection(TextSelection.create(tr.doc, fromPos, toPos));
	} else { // For 'rephrase' and other actions
		if (state.selection.empty) {
			window.showAlert('Please select text to apply this action.', 'Action Required');
			return;
		}
	}
	
	// Apply any transactions (like moving the cursor or inserting a paragraph).
	if (tr.docChanged || tr.selectionSet) {
		dispatch(tr);
	}
	
	// Get the final state *after* any changes to get the correct positions.
	const finalState = activeEditorView.state;
	fromPos = finalState.selection.from;
	toPos = finalState.selection.to;
	
	originalFragment = finalState.doc.slice(fromPos, toPos);
	aiActionRange = { from: fromPos, to: toPos };
	
	const text = action === 'translate' ? currentContext.selectedText : finalState.doc.textBetween(aiActionRange.from, aiActionRange.to, ' ');
	
	const wordCount = text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
	const promptContext = { ...currentContext, selectedText: text, wordCount };
	const prompt = builder(formDataObj, promptContext);
	
	currentAiParams = { prompt, model, action, context: currentContext, formData: formDataObj };
	
	// MODIFIED: Show spinner before starting the stream request.
	showAiSpinner();
	// MODIFIED: Removed 'await' as startAiStream is not an async-blocking function.
	startAiStream({ prompt: currentAiParams.prompt, model: currentAiParams.model });
}


/**
 * Initializes the prompt editor modal logic once, attaching the necessary event listener.
 */
export function setupPromptEditor() {
	modalEl = document.getElementById('prompt-editor-modal');
	if (!modalEl) return;
	
	const applyBtn = modalEl.querySelector('.js-prompt-apply-btn');
	if (applyBtn) {
		applyBtn.addEventListener('click', handleModalApply);
	}
	
	const toggleBtn = modalEl.querySelector('.js-toggle-preview-btn');
	if (toggleBtn) {
		toggleBtn.addEventListener('click', () => {
			const formContainer = modalEl.querySelector('.js-custom-form-container');
			if (!formContainer) return;
			
			const previewSection = formContainer.querySelector('.js-live-preview-section');
			if (!previewSection) return;
			
			const isHidden = previewSection.classList.toggle('hidden');
			toggleBtn.textContent = isHidden ? 'Show Preview' : 'Hide Preview';
		});
	}
}

/**
 * Opens the prompt editor modal with fresh context.
 * @param {object} context
 * @param {string} promptId The ID of the prompt to open.
 * @param {object|null} initialState The form state to restore from a previous run.
 */
export async function openPromptEditor(context, promptId, initialState = null) {
	if (!modalEl) {
		console.error('Prompt editor modal element not found.');
		return;
	}
	currentContext = { ...context, initialState };
	currentPromptId = promptId;
	
	const placeholder = modalEl.querySelector('.js-prompt-placeholder');
	const customEditorPane = modalEl.querySelector('.js-custom-editor-pane');
	
	placeholder.classList.add('hidden');
	customEditorPane.classList.remove('hidden');
	
	try {
		await populateModelDropdown(initialState);
		await loadPrompt(promptId);
		modalEl.showModal();
		
	} catch (error) {
		console.error('Error loading prompt editor:', error);
		modalEl.showModal();
	}
	
}
