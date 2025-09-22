import { t, applyTranslationsTo } from '../i18n.js';
import { htmlToPlainText } from '../../utils/html-processing.js';
import { openDictionaryModal } from '../dictionary/dictionary-modal.js';

// Add debounce utility
const debounce = (func, delay) => {
	let timeout;
	return function(...args) {
		const context = this;
		clearTimeout(timeout);
		timeout = setTimeout(() => func.apply(context, args), delay);
	};
};

const defaultState = { // Default state for the translate editor form
	instructions: '',
	useCodex: true,
	contextPairs: 4,
	useDictionary: false
};


const buildTranslationContextBlock = (translationPairs, languageForPrompt, targetLanguage) => {
	if (!translationPairs || translationPairs.length === 0) {
		return [];
	}
	
	const contextMessages = [];
	translationPairs.forEach(pair => {
		const sourceText = htmlToPlainText(pair.source || '');
		const targetText = htmlToPlainText(pair.target || '');
		
		if (sourceText && targetText) {
			contextMessages.push({
				role: 'user',
				content: t('prompt.translate.user.textToTranslate', {
					sourceLanguage: languageForPrompt,
					targetLanguage: targetLanguage,
					text: sourceText
				})
			});
			contextMessages.push({
				role: 'assistant',
				content: targetText
			});
		}
	});
	
	return contextMessages;
};

export const buildPromptJson = (formData, context, dictionaryContent = '') => {
	const { selectedText, languageForPrompt, targetLanguage, translationPairs } = context;
	
	const plainTextToTranslate = selectedText;
	
	const instructionsBlock = formData.instructions
		? t('prompt.translate.system.instructionsBlock', { instructions: formData.instructions })
		: '';
	
	const system = t('prompt.translate.system.base', {
		sourceLanguage: languageForPrompt,
		targetLanguage: targetLanguage,
		instructionsBlock: instructionsBlock
	}).trim();
	
	let codexBlock = '';
	if (formData.useCodex && context.codexContent) {
		const plainCodex = htmlToPlainText(context.codexContent);
		if (plainCodex) {
			codexBlock = t('prompt.translate.user.codexBlockSimple', { codexContent: plainCodex });
		}
	}
	
	const contextMessages = buildTranslationContextBlock(translationPairs, languageForPrompt, targetLanguage);
	
	const finalUserPromptParts = [];
	if (formData.useDictionary && dictionaryContent) {
		finalUserPromptParts.push(t('prompt.common.user.dictionaryBlock', { dictionaryContent }));
	}
	finalUserPromptParts.push(codexBlock);
	finalUserPromptParts.push(t('prompt.translate.user.textToTranslate', {
		sourceLanguage: languageForPrompt,
		targetLanguage: targetLanguage,
		text: plainTextToTranslate
	}));
	const finalUserPrompt = finalUserPromptParts.filter(Boolean).join('\n\n');
	
	return {
		system,
		context_pairs: contextMessages,
		user: finalUserPrompt,
		ai: ''
	};
};

const updatePreview = async (container, context) => {
	console.log('Updating preview with context:', context);
	const form = container.querySelector('#translate-editor-form');
	if (!form) return;
	
	const formData = {
		instructions: form.elements.instructions.value.trim(),
		useCodex: form.elements.use_codex.checked,
		contextPairs: parseInt(form.elements.context_pairs.value, 10) || 0,
		useDictionary: form.elements.use_dictionary.checked
	};
	
	const systemPreview = container.querySelector('.js-preview-system');
	const userPreview = container.querySelector('.js-preview-user');
	const aiPreview = container.querySelector('.js-preview-ai');
	const contextPairsContainer = container.querySelector('.js-preview-context-pairs');
	
	if (!systemPreview || !userPreview || !aiPreview || !contextPairsContainer) return;
	
	const previewContext = { ...context, translationPairs: [] };
	
	if (formData.contextPairs > 0 && context.chapterId) {
		try {
			const pairs = await window.api.getTranslationContext({
				chapterId: context.chapterId,
				pairCount: formData.contextPairs,
				selectedText: context.selectedText
			});
			console.log('Fetched translation pairs for preview:', pairs);
			previewContext.translationPairs = pairs;
		} catch (error) {
			console.error('Failed to fetch translation context for preview:', error);
			userPreview.textContent = `Error fetching context: ${error.message}`;
			return;
		}
	}
	
	let dictionaryContent = '';
	if (formData.useDictionary) {
		dictionaryContent = await window.api.getDictionaryContentForAI(context.novelId);
	}
	
	if (formData.useCodex) {
		previewContext.codexContent = await window.api.codex.get(context.novelId);
	}
	
	try {
		const promptJson = buildPromptJson(formData, previewContext, dictionaryContent);
		systemPreview.textContent = promptJson.system;
		userPreview.textContent = promptJson.user;
		aiPreview.textContent = promptJson.ai || t('prompt.preview.empty');
		
		contextPairsContainer.innerHTML = '';
		if (promptJson.context_pairs && promptJson.context_pairs.length > 0) {
			promptJson.context_pairs.forEach((message, index) => {
				const pairNumber = Math.floor(index / 2) + 1;
				const roleTitle = message.role === 'user' ? t('prompt.preview.contextUser', { number: pairNumber }) : t('prompt.preview.contextAssistant', { number: pairNumber });
				
				const title = document.createElement('h3');
				title.className = 'text-lg font-semibold mt-4 font-mono';
				title.textContent = roleTitle;
				title.classList.add(message.role === 'user' ? 'text-info' : 'text-accent');
				
				const pre = document.createElement('pre');
				pre.className = 'bg-base-200 p-4 rounded-md text-xs whitespace-pre-wrap font-mono';
				const code = document.createElement('code');
				code.textContent = message.content;
				pre.appendChild(code);
				
				contextPairsContainer.appendChild(title);
				contextPairsContainer.appendChild(pre);
			});
		}
	} catch (error) {
		systemPreview.textContent = `Error building preview: ${error.message}`;
		userPreview.textContent = '';
		aiPreview.textContent = '';
		contextPairsContainer.innerHTML = '';
	}
};

const populateForm = (container, state) => {
	const form = container.querySelector('#translate-editor-form');
	if (!form) return;
	form.elements.instructions.value = state.instructions || '';
	form.elements.context_pairs.value = state.contextPairs !== undefined ? state.contextPairs : 4;
	form.elements.use_codex.checked = state.useCodex !== undefined ? state.useCodex : defaultState.useCodex;
	form.elements.use_dictionary.checked = state.useDictionary !== undefined ? state.useDictionary : defaultState.useDictionary;
};

export const init = async (container, context) => {
	try {
		const templateHtml = await window.api.getTemplate('prompt/translate-editor');
		container.innerHTML = templateHtml;
		applyTranslationsTo(container);
		
		const fullContext = { ...context }; // Create full context for use in updatePreview and rendering
		
		populateForm(container, context.initialState || defaultState);
		
		const form = container.querySelector('#translate-editor-form');
		const editDictionaryBtn = container.querySelector('.js-edit-dictionary-btn');
		
		if (editDictionaryBtn) {
			editDictionaryBtn.addEventListener('click', openDictionaryModal);
		}
		
		const debouncedUpdatePreview = debounce(() => {
			updatePreview(container, fullContext);
		}, 500);
		
		if (form) {
			form.addEventListener('input', () => {
				debouncedUpdatePreview();
			});
		}
		
		// Set initial state
		await updatePreview(container, fullContext);
	} catch (error) {
		container.innerHTML = `<p class="p-4 text-error">${t('prompt.errorLoadForm')}</p>`;
		console.error(error);
	}
};
