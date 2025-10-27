import { init as initRephraseEditor, buildPromptJson as buildRephraseJson } from './prompt-editors/rephrase-editor.js';
import { init as initTranslateEditor, buildPromptJson as buildTranslateJson } from './prompt-editors/translate-editor.js';
import { updateToolbarState as updateChapterToolbarState } from './novel-planner/toolbar.js';
import { t, applyTranslationsTo } from './i18n.js';
import { htmlToPlainText, processSourceContentForMarkers } from '../utils/html-processing.js';

const AI_SETTINGS_KEYS = {
	MODEL: 'parallel-leaves-ai-model',
	TEMPERATURE: 'parallel-leaves-ai-temperature'
};

const editors = {
	'rephrase': { init: initRephraseEditor },
	'translate': { init: initTranslateEditor }
};

const promptBuilders = {
	'rephrase': buildRephraseJson,
	'translate': buildTranslateJson
};

const formDataExtractors = {
	'rephrase': (form) => ({
		instructions: form.elements.instructions.value.trim(),
		tense: form.elements.tense.value,
		useCodex: form.elements.use_codex.checked,
		useDictionary: form.elements.use_dictionary.checked
	}),
	'translate': (form) => ({
		instructions: form.elements.instructions.value.trim(),
		tense: form.elements.tense.value,
		useCodex: form.elements.use_codex.checked,
		contextPairs: parseInt(form.elements.context_pairs.value, 10) || 0,
		useDictionary: form.elements.use_dictionary.checked
	})
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
let currentActionMarkers = null;

/**
 * Escapes special characters in a string for use in a regular expression.
 * @param {string} str - The string to escape.
 * @returns {string} The escaped string.
 */
function escapeRegex(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function showAiSpinner() {
	const overlay = document.getElementById('ai-action-spinner-overlay');
	if (overlay) {
		overlay.classList.remove('hidden');
	}
}

function hideAiSpinner() {
	const overlay = document.getElementById('ai-action-spinner-overlay');
	if (overlay) {
		overlay.classList.add('hidden');
	}
}

const loadPrompt = async (promptId) => {
	if (!modalEl) {
		return;
	}
	
	const toggleBtn = modalEl.querySelector('.js-toggle-preview-btn');
	if (toggleBtn) {
		toggleBtn.textContent = t('editor.showPreview');
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
		placeholder.innerHTML = `<p class="text-error">${t('prompt.errorNoEditorForPrompt', { promptId })}</p>`;
		return;
	}
	
	placeholder.classList.add('hidden');
	customEditorPane.classList.remove('hidden');
	customPromptTitle.textContent = t(`prompt.${promptId}.title`);
	customFormContainer.innerHTML = `<div class="p-4 text-center"><span class="loading loading-spinner"></span></div>`;
	
	await editorConfig.init(customFormContainer, currentContext);
};

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
	currentActionMarkers = null;
	
	if (currentEditorInterface.type === 'iframe') {
		updateChapterToolbarState(null);
	}
}

async function handleFloatyApply() {
	if (!isAiActionActive || !currentEditorInterface) {
		return;
	}
	
	if (currentPromptId === 'translate' && currentAiParams && currentAiParams.logData) {
		window.api.logTranslationEvent(currentAiParams.logData)
			.catch(err => console.error('Failed to log translation event on apply:', err));
	}
	
	await cleanupAiAction();
}

async function handleFloatyDiscard() {
	if (!isAiActionActive || !currentEditorInterface || !originalFragmentJson) {
		return;
	}
	
	if (currentActionMarkers && currentActionMarkers.opening) {
		try {
			const chapterId = currentContext.chapterId;
			const sourceContainer = document.querySelector(`#source-chapter-scroll-target-${chapterId} .source-content-readonly`);
			if (sourceContainer) {
				let sourceHtml = sourceContainer.innerHTML;
				
				const openingMarkerPattern = `(<a[^>]*>\\s*)?${escapeRegex(currentActionMarkers.opening)}(\\s*<\\/a>)?\\s*`;
				const closingMarkerPattern = `\\s*(<a[^>]*>\\s*)?${escapeRegex(currentActionMarkers.closing)}(\\s*<\\/a>)?`;
				
				const openingRegex = new RegExp(openingMarkerPattern, 'g');
				const closingRegex = new RegExp(closingMarkerPattern, 'g');
				
				sourceHtml = sourceHtml.replace(openingRegex, '').replace(closingRegex, '');
				
				await window.api.updateChapterField({
					chapterId: chapterId,
					field: 'source_content',
					value: sourceHtml
				});
				
				sourceContainer.innerHTML = processSourceContentForMarkers(sourceHtml);
			}
		} catch (error) {
			console.error('Failed to remove translation markers from source on discard:', error);
		}
	}
	
	await currentEditorInterface.discardAiSuggestion(aiActionRange.from, aiActionRange.to, originalFragmentJson);
	await cleanupAiAction();
}

async function handleFloatyRetry() {
	if (!isAiActionActive || !currentEditorInterface || !currentAiParams) {
		return;
	}
	
	const actionToRetry = currentAiParams.action;
	const contextForRetry = currentAiParams.context;
	const previousFormData = currentAiParams.formData;
	
	if (floatingToolbar) {
		floatingToolbar.remove();
		floatingToolbar = null;
	}
	
	// 1. Revert the suggestion in the target editor.
	await currentEditorInterface.discardAiSuggestion(aiActionRange.from, aiActionRange.to, originalFragmentJson);
	
	// 2. Clean up the state to allow a new action, but preserve `currentActionMarkers`.
	await currentEditorInterface.setEditable(true);
	await currentEditorInterface.cleanupSuggestion(); // Removes the highlight mark.
	isAiActionActive = false;
	originalFragmentJson = null;
	aiActionRange = null;
	// `currentActionMarkers` is intentionally NOT cleared here.
	
	if (currentEditorInterface.type === 'iframe') {
		updateChapterToolbarState(null);
	}
	
	// 3. Re-open the prompt editor for the user to try again.
	openPromptEditor(contextForRetry, actionToRetry, previousFormData);
}

function createFloatingToolbar(from, to, model) {
	if (floatingToolbar) {
		floatingToolbar.remove();
	}
	
	const modelName = model.split('/').pop() || model;
	
	const toolbarEl = document.createElement('div');
	toolbarEl.id = 'ai-floating-toolbar';
	toolbarEl.innerHTML = `
        <button data-action="apply" data-i18n-title="editor.aiToolbar.applyTitle"><i class="bi bi-check-lg"></i> <span data-i18n="editor.aiToolbar.apply">Apply</span></button>
        <button data-action="retry" data-i18n-title="editor.aiToolbar.retryTitle"><i class="bi bi-arrow-repeat"></i> <span data-i18n="editor.aiToolbar.retry">Retry</span></button>
        <button data-action="discard" data-i18n-title="editor.aiToolbar.discardTitle"><i class="bi bi-x-lg"></i> <span data-i18n="editor.aiToolbar.discard">Discard</span></button>
        <div class="divider-vertical"></div>
        <span class="text-gray-400">${modelName}</span>
    `;
	
	document.body.appendChild(toolbarEl);
	floatingToolbar = toolbarEl;
	
	applyTranslationsTo(toolbarEl);
	
	toolbarEl.style.left = `40%`;
	toolbarEl.style.top = `20%`;
	
	toolbarEl.addEventListener('mousedown', (e) => e.preventDefault());
	toolbarEl.addEventListener('click', (e) => {
		const button = e.target.closest('button');
		if (!button) {
			return;
		}
		const action = button.dataset.action;
		if (action === 'apply') {
			handleFloatyApply();
		}
		if (action === 'discard') {
			handleFloatyDiscard();
		}
		if (action === 'retry') {
			handleFloatyRetry();
		}
	});
}

async function startAiAction(params) {
	const { prompt, model, temperature, openingMarker, closingMarker } = params;
	
	isAiActionActive = true;
	if (currentEditorInterface.type === 'iframe') {
		updateChapterToolbarState(null);
	}
	await currentEditorInterface.setEditable(false);
	showAiSpinner();
	
	try {
		const result = await window.api.processLLMText({ prompt, model, temperature });
		hideAiSpinner();
		
		if (result.success && result.data.choices && result.data.choices.length > 0) {
			let newContentText = result.data.choices[0].message.content ?? 'No content generated.';
			newContentText = newContentText.trim();
			
			if (currentPromptId === 'translate') {
				const context = currentAiParams.context;
				currentAiParams.logData = {
					novelId: context.novelId,
					chapterId: context.chapterId,
					sourceText: context.selectedText,
					targetText: newContentText,
					marker: openingMarker,
					model: params.model,
					temperature: params.temperature
				};
			}
			
			let newContentHtml;
			const textWithMarkers = openingMarker && closingMarker
				? `${openingMarker} ${newContentText} ${closingMarker}`
				: newContentText;
			
			const isInlineSelection = originalFragmentJson &&
				originalFragmentJson.length > 0 &&
				!['paragraph', 'heading', 'blockquote', 'list_item', 'ordered_list', 'bullet_list', 'horizontal_rule', 'code_block'].includes(originalFragmentJson[0].type);
			
			if (isInlineSelection) {
				newContentHtml = textWithMarkers.replace(/\n/g, '<br>');
			} else {
				newContentHtml = '<p>' + textWithMarkers.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
			}
			
			//console.log('AI Action Result:', newContentText, newContentHtml);
			
			const replacementData = await currentEditorInterface.replaceRangeWithSuggestion(
				aiActionRange.from,
				aiActionRange.to,
				newContentHtml
			);
			
			if (replacementData) {
				aiActionRange.to = replacementData.finalRange.to;
				createFloatingToolbar(aiActionRange.from, aiActionRange.to, model);
				
				if (replacementData.finalRange) {
					setTimeout(() => {
						const iframeEl = currentContext.activeEditorView.frameElement;
						const container = document.getElementById('js-target-column-container');
						const endCoords = replacementData.endCoords;
						
						if (iframeEl && container && endCoords) {
							const iframeRect = iframeEl.getBoundingClientRect();
							const containerRect = container.getBoundingClientRect();
							const contentEndAbsoluteY = iframeRect.top + endCoords.bottom;
							const contentEndRelativeY = contentEndAbsoluteY - containerRect.top;
							const desiredScrollTop = container.scrollTop + contentEndRelativeY - container.clientHeight + 50;
							
							if (desiredScrollTop > container.scrollTop) {
								container.scrollTo({ top: desiredScrollTop, behavior: 'smooth' });
							}
						}
					}, 100);
				}
			} else {
				console.error('Editor did not return a final range after replacement.');
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

async function populateModelDropdown() {
	if (!modalEl) {
		return;
	}
	const select = modalEl.querySelector('.js-llm-model-select');
	if (!select) {
		return;
	}
	
	try {
		const result = await window.api.getModels();
		if (!result.success || !result.models || result.models.length === 0) {
			throw new Error(result.message || 'No models returned from API.');
		}
		
		const modelGroups = result.models;
		const popularDefaultModel = 'openai/gpt-4o';
		
		select.innerHTML = '';
		
		modelGroups.forEach(group => {
			const optgroup = document.createElement('optgroup');
			optgroup.label = group.group;
			group.models.forEach(model => {
				const option = new Option(model.name, model.id);
				optgroup.appendChild(option);
			});
			select.appendChild(optgroup);
		});
		
		const lastUsedModel = localStorage.getItem(AI_SETTINGS_KEYS.MODEL);
		const allModels = modelGroups.flatMap(g => g.models);
		
		if (lastUsedModel && allModels.some(m => m.id === lastUsedModel)) {
			select.value = lastUsedModel;
		} else if (allModels.some(m => m.id === popularDefaultModel)) {
			select.value = popularDefaultModel;
		} else if (allModels.length > 0) {
			select.value = allModels[0].id;
		}
		
		// Ensure the setting is saved, even if it's a fallback.
		localStorage.setItem(AI_SETTINGS_KEYS.MODEL, select.value);
		
	} catch (error) {
		console.error('Failed to populate AI model dropdowns:', error);
		select.innerHTML = '<option value="" disabled selected>Error loading</option>';
	}
}

async function handleModalApply() {
	if (!modalEl || isAiActionActive) {
		return;
	}
	
	const model = modalEl.querySelector('.js-llm-model-select').value;
	const temperature = parseFloat(modalEl.querySelector('.js-ai-temperature-slider').value);
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
		const settingsToSave = { ...formDataObj };
		window.api.updatePromptSettings({ novelId, promptType: action, settings: settingsToSave })
			.catch(err => console.error('Failed to save prompt settings:', err));
	}
	
	let selectionInfo;
	if (action === 'translate') {
		if (!currentContext.insertionPoint) {
			window.showAlert(t('prompt.errorNoInsertionPoint'));
			return;
		}
		selectionInfo = {
			from: currentContext.insertionPoint.from,
			to: currentContext.insertionPoint.to,
			originalFragmentJson: [],
			selectedText: currentContext.selectedText
		};
	} else {
		selectionInfo = await currentEditorInterface.getSelectionInfo(action);
		if (!selectionInfo) {
			window.showAlert(t('prompt.errorNoSelection'));
			return;
		}
	}
	
	aiActionRange = { from: selectionInfo.from, to: selectionInfo.to };
	originalFragmentJson = selectionInfo.originalFragmentJson;
	
	const wordCount = selectionInfo.selectedText ? selectionInfo.selectedText.trim().split(/\s+/).filter(Boolean).length : 0;
	const promptContext = {
		...currentContext,
		selectedText: selectionInfo.selectedText,
		wordCount,
		wordsBefore: selectionInfo.wordsBefore,
		wordsAfter: selectionInfo.wordsAfter
	};
	
	if (formDataObj.useCodex) {
		const novelId = currentContext.novelId;
		if (novelId) {
			try {
				const codexHtml = await window.api.codex.get(novelId);
				promptContext.codexContent = htmlToPlainText(codexHtml);
			} catch (error) {
				console.error('Failed to fetch codex content for prompt:', error);
			}
		}
	}
	
	if (action === 'translate' && formDataObj.contextPairs > 0) {
		try {
			const chapterId = currentContext.chapterId;
			const pairs = await window.api.getTranslationContext({
				chapterId: chapterId,
				pairCount: formDataObj.contextPairs,
				selectedText: selectionInfo.selectedText
			});
			promptContext.translationPairs = pairs;
		} catch (error) {
			console.error('Failed to fetch translation context:', error);
			window.showAlert(t('prompt.errorFetchContext', { message: error.message }));
		}
	}
	
	let dictionaryContextualContent = '';
	if (formDataObj.useDictionary) {
		dictionaryContextualContent = await window.api.getDictionaryContentForAI(novelId, 'translation');
	}
	
	// MODIFICATION START: Fetch learning instructions to include in the prompt
	let learningContent = '';
	try {
		learningContent = await window.api.getLearningInstructionsForAI(novelId);
	} catch (error) {
		console.error('Failed to fetch learning instructions for prompt:', error);
		// Non-critical error, proceed without learning content
	}
	// MODIFICATION END
	
	const prompt = builder(formDataObj, promptContext, dictionaryContextualContent, learningContent);
	
	let openingMarker = '';
	let closingMarker = '';
	if (action === 'translate') {
		if (currentActionMarkers) {
			openingMarker = currentActionMarkers.opening;
			closingMarker = currentActionMarkers.closing;
		} else {
			const allContentResult = await window.api.getAllNovelContent(novelId);
			
			let highestNum = 0;
			if (allContentResult.success) {
				highestNum = await window.api.findHighestMarkerNumber(allContentResult.combinedHtml, '');
			} else {
				console.error('Could not fetch all novel content for marker generation:', allContentResult.message);
				window.showAlert('Could not generate a translation marker. The translation will proceed without it.');
			}
			
			const newMarkerNum = highestNum + 1;
			openingMarker = `[[#${newMarkerNum}]]`;
			closingMarker = `{{#${newMarkerNum}}}`;
			
			currentActionMarkers = { opening: openingMarker, closing: closingMarker };
			
			try {
				const chapterId = currentContext.chapterId;
				const sourceContainer = document.querySelector(`#source-chapter-scroll-target-${chapterId} .source-content-readonly`);
				
				const range = currentContext.sourceSelectionRange;
				const openingMarkerNode = document.createTextNode(openingMarker + ' ');
				const closingMarkerNode = document.createTextNode(' ' + closingMarker);
				
				const endRange = range.cloneRange();
				endRange.collapse(false);
				endRange.insertNode(closingMarkerNode);
				
				range.collapse(true);
				range.insertNode(openingMarkerNode);
				
				const updatedHtmlContent = sourceContainer.innerHTML;
				
				await window.api.updateChapterField({
					chapterId: chapterId,
					field: 'source_content',
					value: updatedHtmlContent
				});
				
				const processedHtml = processSourceContentForMarkers(updatedHtmlContent);
				
				sourceContainer.innerHTML = processedHtml;
			} catch (e) {
				console.error('Could not insert markers into source text:', e);
				openingMarker = '';
				closingMarker = '';
				currentActionMarkers = null;
			}
		}
	}
	
	currentAiParams = { prompt, model, temperature, action, context: promptContext, formData: formDataObj };
	
	startAiAction({
		prompt: currentAiParams.prompt,
		model: currentAiParams.model,
		temperature: currentAiParams.temperature,
		openingMarker,
		closingMarker
	});
}

export function setupPromptEditor() {
	modalEl = document.getElementById('prompt-editor-modal');
	if (!modalEl) {
		return;
	}
	
	const applyBtn = modalEl.querySelector('.js-prompt-apply-btn');
	if (applyBtn) {
		applyBtn.addEventListener('click', handleModalApply);
	}
	
	const toggleBtn = modalEl.querySelector('.js-toggle-preview-btn');
	if (toggleBtn) {
		toggleBtn.addEventListener('click', () => {
			const formContainer = modalEl.querySelector('.js-custom-editor-pane');
			if (!formContainer) {
				return;
			}
			
			const previewSection = formContainer.querySelector('.js-live-preview-section');
			if (!previewSection) {
				return;
			}
			
			const isHidden = previewSection.classList.toggle('hidden');
			toggleBtn.textContent = isHidden ? t('editor.showPreview') : t('editor.hidePreview');
		});
	}
	
	const modelSelect = modalEl.querySelector('.js-llm-model-select');
	const tempSlider = modalEl.querySelector('.js-ai-temperature-slider');
	const tempValue = modalEl.querySelector('.js-ai-temperature-value');
	
	if (modelSelect) {
		modelSelect.addEventListener('change', () => {
			localStorage.setItem(AI_SETTINGS_KEYS.MODEL, modelSelect.value);
		});
	}
	
	if (tempSlider && tempValue) {
		const lastTemp = localStorage.getItem(AI_SETTINGS_KEYS.TEMPERATURE) || '0.7';
		tempSlider.value = lastTemp;
		tempValue.textContent = parseFloat(lastTemp).toFixed(1);
		
		tempSlider.addEventListener('input', () => {
			tempValue.textContent = parseFloat(tempSlider.value).toFixed(1);
		});
		tempSlider.addEventListener('change', () => {
			localStorage.setItem(AI_SETTINGS_KEYS.TEMPERATURE, tempSlider.value);
		});
	}
	
	window.addEventListener('keydown', (e) => {
		if (!isAiActionActive) {
			return;
		}
		
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'enter') {
			e.preventDefault();
			handleFloatyApply();
		} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
			e.preventDefault();
			handleFloatyRetry();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			handleFloatyDiscard();
		}
	});
}

export async function openPromptEditor(context, promptId, initialState = null) {
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
		await populateModelDropdown();
		await loadPrompt(promptId);
		modalEl.showModal();
	} catch (error) {
		console.error('Error loading prompt editor:', error);
		modalEl.showModal();
	}
}
