// This file now controls the prompt editor modal within the novel editor.

// Import init and buildPromptJson functions from all editor modules.
import { init as initRephraseEditor, buildPromptJson as buildRephraseJson } from './prompt-editors/rephrase-editor.js';
import { init as initSceneSummarizationEditor, buildPromptJson as buildSceneSummarizationJson } from './prompt-editors/scene-summarization-editor.js';
import { getActiveEditor } from './novel-planner/content-editor.js';
import { updateToolbarState } from './novel-planner/toolbar.js';
import { TextSelection } from 'prosemirror-state';
import { DOMParser } from 'prosemirror-model';

// Configuration mapping prompt IDs to their respective builder modules.
const editors = {
	'rephrase': { name: 'Rephrase', init: initRephraseEditor },
	'scene-summarization': { name: 'Scene Summarization', init: initSceneSummarizationEditor },
};

// Map of prompt builder functions for easy access.
const promptBuilders = {
	'rephrase': buildRephraseJson,
	'scene-summarization': buildSceneSummarizationJson,
};

// Map of functions to extract structured form data.
const formDataExtractors = {
	'rephrase': (form) => ({
		instructions: form.elements.instructions.value.trim(),
		selectedCodexIds: form.elements.codex_entry ? Array.from(form.elements.codex_entry).filter(cb => cb.checked).map(cb => cb.value) : [],
	}),
	'scene-summarization': (form) => ({
		words: form.elements.words.value,
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

async function startAiSummarizationStream(params) {
	const { prompt, model } = params;
	
	setEditorEditable(activeEditorView, false);
	updateToolbarState(activeEditorView);
	
	const editorWrapper = activeEditorView.dom.parentElement;
	const spinner = editorWrapper.querySelector('.js-summary-spinner');
	if (spinner) spinner.classList.remove('hidden');
	
	let fullResponse = '';
	let isFirstChunk = true;
	
	const onData = (payload) => {
		if (payload.chunk) {
			fullResponse += payload.chunk;
			const { state, dispatch } = activeEditorView;
			let tr = state.tr;
			
			if (isFirstChunk) {
				tr.delete(0, state.doc.content.size);
				isFirstChunk = false;
			}
			
			tr.insertText(payload.chunk, tr.doc.content.size);
			dispatch(tr);
			
		} else if (payload.done) {
			const { state, dispatch } = activeEditorView;
			const { schema } = state;
			
			const tempDiv = document.createElement('div');
			tempDiv.innerText = fullResponse.trim();
			const newContentNode = DOMParser.fromSchema(schema).parse(tempDiv);
			
			const finalTr = state.tr.replaceWith(0, state.doc.content.size, newContentNode.content);
			dispatch(finalTr);
			
			if (spinner) spinner.classList.add('hidden');
			setEditorEditable(activeEditorView, true);
			activeEditorView.focus();
			updateToolbarState(activeEditorView);
			
		} else if (payload.error) {
			console.error('AI Summarization Error:', payload.error);
			alert(`Error: ${payload.error}`);
			
			if (spinner) spinner.classList.add('hidden');
			setEditorEditable(activeEditorView, true);
			updateToolbarState(activeEditorView);
		}
	};
	
	try {
		window.api.processCodexTextStream({ prompt, model }, onData);
	} catch (error) {
		console.error('AI Summarization Error:', error);
		alert(`Error: ${error.message}`);
		
		if (spinner) spinner.classList.add('hidden');
		setEditorEditable(activeEditorView, true);
		updateToolbarState(activeEditorView);
	}
}


async function startAiStream(params) {
	const { prompt, model } = params;
	
	isAiActionActive = true;
	updateToolbarState(activeEditorView);
	setEditorEditable(activeEditorView, false);
	
	let isFirstChunk = true;
	let currentInsertionPos = aiActionRange.from;
	
	const onData = (payload) => {
		if (payload.chunk) {
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
			activeEditorView.dispatch(tr);
			
		} else if (payload.done) {
			createFloatingToolbar(activeEditorView, aiActionRange.from, aiActionRange.to, model);
			
		} else if (payload.error) {
			console.error('AI Action Error:', payload.error);
			alert(`Error: ${payload.error}`);
			handleFloatyDiscard();
		}
	};
	
	try {
		window.api.processCodexTextStream({ prompt, model }, onData);
	} catch (error) {
		console.error('AI Action Error:', error);
		alert(`Error: ${error.message}`);
		handleFloatyDiscard();
	}
}

async function populateModelDropdown() {
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
		
		if (models.some(m => m.id === defaultModel)) {
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
		alert('Could not apply action. Missing model, action, or form.');
		return;
	}
	
	const builder = promptBuilders[action];
	const extractor = formDataExtractors[action];
	if (!builder || !extractor) {
		alert(`No prompt builder or form extractor found for action: ${action}`);
		return;
	}
	
	modalEl.close();
	
	// MODIFIED: This logic now correctly handles both summarization contexts.
	if (action === 'scene-summarization') {
		activeEditorView = currentContext.activeEditorView;
		if (!activeEditorView) {
			alert('Target editor not found for summarization.');
			return;
		}
		
		const formDataObj = extractor(form);
		const wordCount = currentContext.selectedText ? currentContext.selectedText.trim().split(/\s+/).filter(Boolean).length : 0;
		const promptContext = { ...currentContext, wordCount };
		const prompt = builder(formDataObj, promptContext);
		
		await startAiSummarizationStream({ prompt, model });
		return;
	}
	
	// Original workflow for all other actions like "Rephrase".
	activeEditorView = currentContext.activeEditorView;
	if (!activeEditorView) {
		alert('No active editor to apply changes to.');
		return;
	}
	
	const { state } = activeEditorView;
	const { from, to, empty } = state.selection;
	
	if (empty) {
		alert('Please select text to apply this action.');
		return;
	}
	
	const text = state.doc.textBetween(from, to, ' ');
	
	originalFragment = state.doc.slice(from, to);
	aiActionRange = { from, to };
	
	const formDataObj = extractor(form);
	
	const wordCount = text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
	const promptContext = { ...currentContext, selectedText: text, wordCount };
	const prompt = builder(formDataObj, promptContext);
	
	currentAiParams = { prompt, model, action, context: currentContext, formData: formDataObj };
	
	await startAiStream({ prompt: currentAiParams.prompt, model: currentAiParams.model });
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
		await populateModelDropdown();
		await loadPrompt(promptId);
		modalEl.showModal();
		
	} catch (error) {
		console.error('Error loading prompt editor:', error);
		modalEl.showModal();
	}
	
}
