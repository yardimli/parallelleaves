import { init as initRephraseEditor, buildPromptJson as buildRephraseJson } from './prompt-editors/rephrase-editor.js';
import { init as initTranslateEditor, buildPromptJson as buildTranslateJson } from './prompt-editors/translate-editor.js';
import { updateToolbarState } from './novel-planner/toolbar.js';

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

let isAiActionActive = false;
let originalFragment = null;
let aiActionRange = null;
let floatingToolbar = null;
let currentAiParams = null;
let activeContentWindow = null;
let currentPromptId = null;

function showAiSpinner() {
	const overlay = document.getElementById('ai-action-spinner-overlay');
	if (overlay) overlay.classList.remove('hidden');
}

function hideAiSpinner() {
	const overlay = document.getElementById('ai-action-spinner-overlay');
	if (overlay) overlay.classList.add('hidden');
}

const loadPrompt = async (promptId) => {
	if (!modalEl) return;
	
	const toggleBtn = modalEl.querySelector('.js-toggle-preview-btn');
	if (toggleBtn) toggleBtn.textContent = 'Show Preview';
	
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
	
	placeholder.classList.add('hidden');
	customEditorPane.classList.remove('hidden');
	
	customPromptTitle.textContent = `Prompt Builder: ${editorConfig.name}`;
	customFormContainer.innerHTML = `<div class="p-4 text-center"><span class="loading loading-spinner"></span></div>`;
	
	await editorConfig.init(customFormContainer, currentContext);
};

function cleanupAiAction() {
	if (floatingToolbar) {
		floatingToolbar.remove();
		floatingToolbar = null;
	}
	
	if (activeContentWindow) {
		activeContentWindow.postMessage({ type: 'setEditable', payload: { isEditable: true } }, window.location.origin);
		activeContentWindow.postMessage({ type: 'cleanupAiSuggestion' }, window.location.origin);
	}
	
	isAiActionActive = false;
	originalFragment = null;
	aiActionRange = null;
	currentAiParams = null;
	updateToolbarState(null);
}

function handleFloatyApply() {
	if (!isAiActionActive || !activeContentWindow) return;
	cleanupAiAction();
}

function handleFloatyDiscard() {
	if (!isAiActionActive || !activeContentWindow || !originalFragment) return;
	
	activeContentWindow.postMessage({
		type: 'discardAiSuggestion',
		payload: {
			from: aiActionRange.from,
			to: aiActionRange.to,
			originalFragmentJson: originalFragment,
		}
	}, window.location.origin);
	
	cleanupAiAction();
}

async function handleFloatyRetry() {
	if (!isAiActionActive || !activeContentWindow || !currentAiParams) return;
	
	const actionToRetry = currentAiParams.action;
	const contextForRetry = currentAiParams.context;
	const previousFormData = currentAiParams.formData;
	
	if (floatingToolbar) {
		floatingToolbar.remove();
		floatingToolbar = null;
	}
	
	activeContentWindow.postMessage({
		type: 'discardAiSuggestion',
		payload: {
			from: aiActionRange.from,
			to: aiActionRange.to,
			originalFragmentJson: originalFragment,
		}
	}, window.location.origin);
	
	const newTo = aiActionRange.from + originalFragment.content.size;
	activeContentWindow.postMessage({
		type: 'setSelection',
		payload: { from: aiActionRange.from, to: newTo }
	}, window.location.origin);
	
	activeContentWindow.postMessage({ type: 'setEditable', payload: { isEditable: true } }, window.location.origin);
	
	isAiActionActive = false;
	originalFragment = null;
	updateToolbarState(null);
	
	openPromptEditor(contextForRetry, actionToRetry, previousFormData);
}

function createFloatingToolbar(from, to, model) {
	if (floatingToolbar) floatingToolbar.remove();
	
	const modelName = model.split('/').pop() || model;
	
	const toolbarEl = document.createElement('div');
	toolbarEl.id = 'ai-floating-toolbar';
	toolbarEl.innerHTML = `
        <button data-action="apply" title="Apply"><i class="bi bi-check-lg"></i> Apply</button>
        <button data-action="retry" title="Retry"><i class="bi bi-arrow-repeat"></i> Retry</button>
        <button data-action="discard" title="Discard"><i class="bi bi-x-lg"></i> Discard</button>
        <div class="divider-vertical"></div>
        <span class="text-gray-400">${modelName}</span>
    `;
	
	document.body.appendChild(toolbarEl);
	floatingToolbar = toolbarEl;
	
	toolbarEl.style.left = `40%`;
	toolbarEl.style.top = `20%`;
	
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

// MODIFIED: This function now sends a single "start" message and then subsequent "chunk" messages.
function startAiStream(params) {
	const { prompt, model } = params;
	
	isAiActionActive = true;
	updateToolbarState(null);
	activeContentWindow.postMessage({ type: 'setEditable', payload: { isEditable: false } }, window.location.origin);
	
	let isFirstChunk = true;
	
	const onData = (payload) => {
		if (payload.chunk) {
			if (isFirstChunk) {
				hideAiSpinner();
				// Send a dedicated "start" message with position info for the first chunk.
				activeContentWindow.postMessage({
					type: 'aiStreamStart',
					payload: {
						chunk: payload.chunk,
						from: aiActionRange.from,
						to: aiActionRange.to
					}
				}, window.location.origin);
				isFirstChunk = false;
			} else {
				// Subsequent chunks don't need position info.
				activeContentWindow.postMessage({
					type: 'aiStreamChunk',
					payload: {
						chunk: payload.chunk
					}
				}, window.location.origin);
			}
			
		} else if (payload.done) {
			// MODIFIED: The `aiStreamDone` message now only needs the starting position.
			// The iframe will determine the end position from its own state.
			activeContentWindow.postMessage({
				type: 'aiStreamDone',
				payload: { from: aiActionRange.from }
			}, window.location.origin);
			
		} else if (payload.error) {
			console.error('AI Action Error:', payload.error);
			window.showAlert(payload.error);
			hideAiSpinner();
			handleFloatyDiscard();
		}
	};
	
	try {
		window.api.processCodexTextStream({ prompt, model }, onData);
	} catch (error) {
		console.error('AI Action Error:', error);
		window.showAlert(error.message);
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

// MODIFIED: This function now communicates with the iframe to get selection info before starting the AI stream.
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
	
	activeContentWindow = currentContext.activeEditorView;
	if (!activeContentWindow) {
		window.showAlert('No active editor to apply changes to.');
		return;
	}
	
	const formDataObj = extractor(form);
	
	const novelId = document.body.dataset.novelId;
	if (novelId) {
		const settingsToSave = { model, ...formDataObj };
		window.api.updatePromptSettings({ novelId, promptType: action, settings: settingsToSave })
			.catch(err => console.error('Failed to save prompt settings:', err));
	}
	
	// Use a Promise to wait for the iframe to respond with its selection information.
	const getSelectionFromIframe = () => new Promise((resolve) => {
		const listener = (event) => {
			if (event.source === activeContentWindow && event.data.type === 'selectionResponse') {
				window.removeEventListener('message', listener);
				resolve(event.data.payload);
			}
		};
		window.addEventListener('message', listener);
		
		// Ask the iframe to prepare for the action.
		if (action === 'translate') {
			activeContentWindow.postMessage({
				type: 'prepareForTranslate',
				payload: { blockNumber: currentContext.translationInfo.blockNumber }
			}, window.location.origin);
		} else { // 'rephrase'
			activeContentWindow.postMessage({ type: 'prepareForRephrase' }, window.location.origin);
		}
	});
	
	const selectionInfo = await getSelectionFromIframe();
	
	if (!selectionInfo) {
		window.showAlert('Could not get selection from the editor. For rephrasing, please select some text.');
		return;
	}
	
	// Store the selection range and original content provided by the iframe.
	aiActionRange = { from: selectionInfo.from, to: selectionInfo.to };
	originalFragment = selectionInfo.originalFragmentJson;
	
	// For 'translate', the selected text comes from the source panel. For 'rephrase', it comes from the iframe.
	const text = action === 'translate' ? currentContext.selectedText : selectionInfo.selectedText;
	
	const wordCount = text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
	const promptContext = { ...currentContext, selectedText: text, wordCount };
	const prompt = builder(formDataObj, promptContext);
	
	currentAiParams = { prompt, model, action, context: currentContext, formData: formDataObj };
	
	showAiSpinner();
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
	
	window.addEventListener('message', (event) => {
		if (event.data.type === 'aiStreamFinished') {
			const { from, to } = event.data.payload;
			aiActionRange.to = to;
			createFloatingToolbar(from, to, currentAiParams.model);
		}
	});
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
