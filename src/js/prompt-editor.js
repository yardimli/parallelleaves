// MODIFIED: This file is heavily refactored to use an "editor interface" pattern.
// This allows it to interact with both direct ProseMirror views (Codex Editor)
// and iframe-based views (Chapter Editor) without knowing the implementation details.

import { init as initRephraseEditor, buildPromptJson as buildRephraseJson } from './prompt-editors/rephrase-editor.js';
import { init as initTranslateEditor, buildPromptJson as buildTranslateJson } from './prompt-editors/translate-editor.js';
import { updateToolbarState as updateChapterToolbarState } from './novel-planner/toolbar.js';

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
		contextPairs: parseInt(form.elements.context_pairs.value, 10) || 0,
	}),
};


let modalEl;
let currentContext;
let currentEditorInterface; // NEW: Stores the interface to the active editor.

let isAiActionActive = false;
let originalFragmentJson = null; // MODIFIED: Store as JSON for easier transport.
let aiActionRange = null;
let floatingToolbar = null;
let currentAiParams = null;
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

// MODIFIED: Uses the editor interface for all interactions.
async function cleanupAiAction() {
	if (floatingToolbar) {
		floatingToolbar.remove();
		floatingToolbar = null;
	}
	
	if (currentEditorInterface) {
		await currentEditorInterface.setEditable(true);
		await currentEditorInterface.cleanupSuggestion();
	}
	
	isAiActionActive = false;
	originalFragmentJson = null;
	aiActionRange = null;
	currentAiParams = null;
	
	// For chapter editor, we need to reset its specific toolbar.
	if (currentEditorInterface.type === 'iframe') {
		updateChapterToolbarState(null);
	}
}

// MODIFIED: Uses the editor interface.
async function handleFloatyApply() {
	if (!isAiActionActive || !currentEditorInterface) return;
	await cleanupAiAction();
}

// MODIFIED: Uses the editor interface.
async function handleFloatyDiscard() {
	if (!isAiActionActive || !currentEditorInterface || !originalFragmentJson) return;
	
	await currentEditorInterface.discardSuggestion(aiActionRange.from, aiActionRange.to, originalFragmentJson);
	await cleanupAiAction();
}

// MODIFIED: Uses the editor interface.
async function handleFloatyRetry() {
	if (!isAiActionActive || !currentEditorInterface || !currentAiParams) return;
	
	const actionToRetry = currentAiParams.action;
	const contextForRetry = currentAiParams.context;
	const previousFormData = currentAiParams.formData;
	
	if (floatingToolbar) {
		floatingToolbar.remove();
		floatingToolbar = null;
	}
	
	await currentEditorInterface.discardSuggestion(aiActionRange.from, aiActionRange.to, originalFragmentJson);
	await currentEditorInterface.setEditable(true);
	
	isAiActionActive = false;
	originalFragmentJson = null;
	aiActionRange = null;
	currentAiParams = null;
	
	if (currentEditorInterface.type === 'iframe') {
		updateChapterToolbarState(null);
	}
	
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

// MODIFIED: Uses the editor interface.
async function startAiStream(params) {
	const { prompt, model } = params;
	
	isAiActionActive = true;
	if (currentEditorInterface.type === 'iframe') {
		updateChapterToolbarState(null);
	}
	await currentEditorInterface.setEditable(false);
	
	let isFirstChunk = true;
	
	const onData = async (payload) => {
		if (payload.chunk) {
			if (isFirstChunk) {
				hideAiSpinner();
				await currentEditorInterface.streamStart(aiActionRange.from, aiActionRange.to, payload.chunk);
				isFirstChunk = false;
			} else {
				await currentEditorInterface.streamChunk(payload.chunk);
			}
		} else if (payload.done) {
			const finalRange = await currentEditorInterface.streamDone(aiActionRange.from);
			aiActionRange.to = finalRange.to; // Update the end of the range
			createFloatingToolbar(aiActionRange.from, aiActionRange.to, model);
		} else if (payload.error) {
			console.error('AI Action Error:', payload.error);
			window.showAlert(payload.error);
			hideAiSpinner();
			await handleFloatyDiscard();
		}
	};
	
	try {
		window.api.processCodexTextStream({ prompt, model }, onData);
	} catch (error) {
		console.error('AI Action Error:', error);
		window.showAlert(error.message);
		hideAiSpinner();
		await handleFloatyDiscard();
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

// MODIFIED: Uses the editor interface.
async function handleModalApply() {
	if (!modalEl || isAiActionActive) return;
	
	const model = modalEl.querySelector('.js-llm-model-select').value;
	const action = currentPromptId;
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
	
	currentEditorInterface = currentContext.editorInterface;
	if (!currentEditorInterface) {
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
	
	const selectionInfo = await currentEditorInterface.getSelectionInfo(action, currentContext.translationInfo);
	
	if (!selectionInfo) {
		window.showAlert('Could not get selection from the editor. For rephrasing, please select some text.');
		return;
	}
	
	aiActionRange = { from: selectionInfo.from, to: selectionInfo.to };
	originalFragmentJson = selectionInfo.originalFragmentJson;
	
	const text = action === 'translate' ? currentContext.selectedText : selectionInfo.selectedText;
	
	const wordCount = text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
	const promptContext = { ...currentContext, selectedText: text, wordCount };
	
	if (action === 'translate' && formDataObj.contextPairs > 0) {
		try {
			const chapterId = currentContext.activeEditorView.frameElement.dataset.chapterId;
			const blockNumber = currentContext.translationInfo.blockNumber;
			
			const pairs = await window.api.getTranslationContext({
				chapterId: chapterId,
				endBlockNumber: blockNumber,
				pairCount: formDataObj.contextPairs,
			});
			promptContext.translationPairs = pairs;
		} catch (error) {
			console.error('Failed to fetch translation context:', error);
			window.showAlert(`Could not fetch previous translation blocks for context. ${error.message}`);
		}
	}
	
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
	
	// This listener is now only for the iframe editor, as the direct view
	// will resolve its stream promises directly.
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
 * @param {object} context - The context for the prompt, including the `editorInterface`.
 * @param {string} promptId - The ID of the prompt to open.
 * @param {object|null} initialState - The form state to restore from a previous run.
 */
export async function openPromptEditor(context, promptId, initialState = null) {
	if (!modalEl) {
		console.error('Prompt editor modal element not found.');
		return;
	}
	// NEW: Enforce the presence of an editor interface.
	if (!context.editorInterface) {
		console.error('`editorInterface` is missing from the context for openPromptEditor.');
		window.showAlert('Cannot open AI editor: Editor interface is not available.');
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
