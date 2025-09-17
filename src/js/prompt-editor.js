import { init as initRephraseEditor, buildPromptJson as buildRephraseJson } from './prompt-editors/rephrase-editor.js';
import { init as initTranslateEditor, buildPromptJson as buildTranslateJson } from './prompt-editors/translate-editor.js';
import { updateToolbarState as updateChapterToolbarState } from './novel-planner/toolbar.js';
import { t } from './i18n.js';

const editors = {
	'rephrase': { init: initRephraseEditor },
	'translate': { init: initTranslateEditor },
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
let currentEditorInterface; // Stores the interface to the active editor.

let isAiActionActive = false;
let originalFragmentJson = null;
let aiActionRange = null;
let floatingToolbar = null;
let currentAiParams = null;
let currentPromptId = null;

function showAiSpinner () {
	const overlay = document.getElementById('ai-action-spinner-overlay');
	if (overlay) overlay.classList.remove('hidden');
}

function hideAiSpinner () {
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
		placeholder.innerHTML = `<p class="text-error">${t('prompt.errorNoEditorForPrompt', { promptId })}</p>`;
		return;
	}
	
	placeholder.classList.add('hidden');
	customEditorPane.classList.remove('hidden');
	customPromptTitle.textContent = t(`prompt.${promptId}.title`);
	customFormContainer.innerHTML = `<div class="p-4 text-center"><span class="loading loading-spinner"></span></div>`;
	
	await editorConfig.init(customFormContainer, currentContext);
};

async function cleanupAiAction () {
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
	
	if (currentEditorInterface.type === 'iframe') {
		updateChapterToolbarState(null);
	}
}

async function handleFloatyApply () {
	if (!isAiActionActive || !currentEditorInterface) return;
	await cleanupAiAction();
}

async function handleFloatyDiscard () {
	if (!isAiActionActive || !currentEditorInterface || !originalFragmentJson) return;
	
	await currentEditorInterface.discardAiSuggestion(aiActionRange.from, aiActionRange.to, originalFragmentJson);
	await cleanupAiAction();
}

async function handleFloatyRetry () {
	if (!isAiActionActive || !currentEditorInterface || !currentAiParams) return;
	
	const actionToRetry = currentAiParams.action;
	const contextForRetry = currentAiParams.context;
	const previousFormData = currentAiParams.formData;
	
	if (floatingToolbar) {
		floatingToolbar.remove();
		floatingToolbar = null;
	}
	
	await currentEditorInterface.discardAiSuggestion(aiActionRange.from, aiActionRange.to, originalFragmentJson);
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

function createFloatingToolbar (from, to, model) {
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

async function startAiAction (params) {
	const { prompt, model } = params;
	
	isAiActionActive = true;
	if (currentEditorInterface.type === 'iframe') {
		updateChapterToolbarState(null);
	}
	await currentEditorInterface.setEditable(false);
	showAiSpinner();
	
	try {
		const result = await window.api.processLLMText({ prompt, model });
		hideAiSpinner();
		
		if (result.success && result.data.choices && result.data.choices.length > 0) {
			let newContentText = result.data.choices[0].message.content ?? 'No content generated.';
			newContentText = newContentText.trim();
			
			const newContentHtml = '<p>' + newContentText.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
			console.log('AI Action Result:', newContentText, newContentHtml);
			
			// Use the editor interface to replace the content
			const replacementData = await currentEditorInterface.replaceRangeWithSuggestion(
				aiActionRange.from,
				aiActionRange.to,
				newContentHtml
			);
			
			if (replacementData) {
				//console.log( replacementData );
				aiActionRange.to = replacementData.finalRange.to;
				createFloatingToolbar(aiActionRange.from, aiActionRange.to, model);
				
				if (replacementData.finalRange) {
					// Use a short timeout to allow the iframe to resize itself via its postMessage mechanism before we calculate scroll.
					setTimeout(() => {
						const iframeEl = currentContext.activeEditorView.frameElement;
						const container = document.getElementById('js-manuscript-container');
						const endCoords = replacementData.endCoords;
						
						if (iframeEl && container && endCoords) {
							const iframeRect = iframeEl.getBoundingClientRect();
							const containerRect = container.getBoundingClientRect();
							
							// The y-coordinate of the content's end, relative to the parent's viewport
							const contentEndAbsoluteY = iframeRect.top + endCoords.bottom;
							
							// The y-coordinate of the content's end, relative to the scroll container
							const contentEndRelativeY = contentEndAbsoluteY - containerRect.top;
							
							// Calculate the desired scrollTop to bring the new content into view with some padding
							const desiredScrollTop = container.scrollTop + contentEndRelativeY - container.clientHeight + 50; // 50px padding from bottom
							
							// Only scroll if the content is not already visible
							if (desiredScrollTop > container.scrollTop) {
								container.scrollTo({top: desiredScrollTop, behavior: 'smooth'});
							}
						}
					}, 100);
				}
			} else {
				console.error("Editor did not return a final range after replacement.");
				await handleFloatyDiscard();
			}
		} else {
			const errorMessage = result.error || (result.data.error ? result.data.error.message : 'Unknown AI error.');
			throw new Error(errorMessage);
		}
	} catch (error) {
		console.error('AI Action Error:', error);
		window.showAlert(error.message);
		hideAiSpinner();
		await handleFloatyDiscard();
	}
}

async function populateModelDropdown (initialState = null) {
	if (!modalEl) return;
	const select = modalEl.querySelector('.js-llm-model-select');
	if (!select) return;
	
	try {
		const result = await window.api.getModels();
		// console.log('Models fetched from API:');
		// console.log(result.models);
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

async function handleModalApply () {
	if (!modalEl || isAiActionActive) return;
	
	const model = modalEl.querySelector('.js-llm-model-select').value;
	const action = currentPromptId;
	const form = modalEl.querySelector('.js-custom-editor-pane form');
	
	if (!model || !action || !form) {
		window.showAlert(t('prompt.errorApplyAction'));
		return;
	}
	
	const builder = promptBuilders[action];
	const extractor = formDataExtractors[action];
	if (!builder || !extractor) {
		window.showAlert(t('prompt.errorNoBuilder', { action }));
		return;
	}
	
	modalEl.close();
	
	currentEditorInterface = currentContext.editorInterface;
	if (!currentEditorInterface) {
		window.showAlert(t('prompt.errorNoActiveEditor'));
		return;
	}
	
	const formDataObj = extractor(form);
	
	const novelId = document.body.dataset.novelId;
	if (novelId) {
		const settingsToSave = { model, ...formDataObj };
		window.api.updatePromptSettings({ novelId, promptType: action, settings: settingsToSave })
			.catch(err => console.error('Failed to save prompt settings:', err));
	}
	
	console.log('AI Action Params:', { model, action, formData: formDataObj });
	const selectionInfo = await currentEditorInterface.getSelectionInfo(action);
	
	if (!selectionInfo) {
		window.showAlert(t('prompt.errorNoSelection'));
		return;
	}
	
	aiActionRange = { from: selectionInfo.from, to: selectionInfo.to };
	originalFragmentJson = selectionInfo.originalFragmentJson || [];
	
	const text = action === 'translate' ? currentContext.selectedText : selectionInfo.selectedText;
	
	const wordCount = text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
	const promptContext = { ...currentContext, selectedText: text, wordCount };
	
	if (action === 'translate' && formDataObj.contextPairs > 0) {
		try {
			const chapterId = currentContext.chapterId;
			const pairs = await window.api.getTranslationContext({
				chapterId: chapterId,
				pairCount: formDataObj.contextPairs,
			});
			promptContext.translationPairs = pairs;
		} catch (error) {
			console.error('Failed to fetch translation context:', error);
			window.showAlert(t('prompt.errorFetchContext', { message: error.message }));
		}
	}
	
	const prompt = builder(formDataObj, promptContext);
	
	currentAiParams = { prompt, model, action, context: currentContext, formData: formDataObj };
	
	startAiAction({ prompt: currentAiParams.prompt, model: currentAiParams.model });
}


/**
 * Initializes the prompt editor modal logic once, attaching the necessary event listener.
 */
export function setupPromptEditor () {
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
			toggleBtn.textContent = isHidden ? t('editor.showPreview') : t('editor.hidePreview');
		});
	}
}

/**
 * Opens the prompt editor modal with fresh context.
 * @param {object} context - The context for the prompt, including the `editorInterface`.
 * @param {string} promptId - The ID of the prompt to open.
 * @param {object|null} initialState - The form state to restore from a previous run.
 */
export async function openPromptEditor (context, promptId, initialState = null) {
	if (!modalEl) {
		console.error('Prompt editor modal element not found.');
		return;
	}
	if (!context.editorInterface) {
		console.error('`editorInterface` is missing from the context for openPromptEditor.');
		window.showAlert(t('prompt.errorNoInterface'));
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
