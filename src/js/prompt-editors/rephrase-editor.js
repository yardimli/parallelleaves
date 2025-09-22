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

const defaultState = { // Default state for the rephrase editor form
	instructions: '',
	useCodex: true,
	useDictionary: false
};

const buildSurroundingTextBlock = (wordsBefore, wordsAfter) => {
	if (!wordsBefore && !wordsAfter) {
		return '';
	}
	if (wordsBefore && wordsAfter) {
		return t('prompt.rephrase.user.surroundingTextBlock', { wordsBefore, wordsAfter });
	}
	if (wordsBefore) {
		return t('prompt.rephrase.user.surroundingTextBlockBeforeOnly', { wordsBefore });
	}
	// if (wordsAfter)
	return t('prompt.rephrase.user.surroundingTextBlockAfterOnly', { wordsAfter });
};

export const buildPromptJson = (formData, context, dictionaryContent = '') => {
	const { selectedText, wordCount, languageForPrompt, wordsBefore, wordsAfter } = context;
	
	const instructions = formData.instructions || t('prompt.rephrase.system.defaultInstruction');
	const system = t('prompt.rephrase.system.base', {
		instructions: instructions,
		language: languageForPrompt || 'English'
	});
	
	let codexBlock = '';
	if (formData.useCodex && context.codexContent) {
		const plainCodex = htmlToPlainText(context.codexContent);
		if (plainCodex) {
			codexBlock = t('prompt.rephrase.user.codexBlock', { codexContent: plainCodex });
		}
	}
	
	const truncatedText = selectedText.length > 4096 ? selectedText.substring(0, 4096) + '...' : selectedText;
	
	const surroundingText = buildSurroundingTextBlock(wordsBefore, wordsAfter);
	
	const userParts = [];
	if (formData.useDictionary && dictionaryContent) {
		userParts.push(t('prompt.common.user.dictionaryBlock', { dictionaryContent })); // Use common i18n key for dictionary block.
	}
	userParts.push(codexBlock); // Add codex block if available
	if (surroundingText) {
		userParts.push(surroundingText);
	}
	userParts.push(t('prompt.rephrase.user.textToRewrite', {
		wordCount: wordCount,
		text: wordCount > 0 ? truncatedText : '{message}'
	}));
	
	const user = userParts.filter(Boolean).join('\n\n');
	
	return {
		system: system.replace(/\n\n\n/g, '\n\n'),
		user: user,
		ai: ''
	};
};

const updatePreview = async (container, context) => {
	const form = container.querySelector('#rephrase-editor-form');
	if (!form) return;
	
	const formData = {
		instructions: form.elements.instructions.value.trim(),
		useCodex: form.elements.use_codex.checked,
		useDictionary: form.elements.use_dictionary.checked
	};
	
	const systemPreview = container.querySelector('.js-preview-system');
	const userPreview = container.querySelector('.js-preview-user');
	const aiPreview = container.querySelector('.js-preview-ai');
	
	if (!systemPreview || !userPreview || !aiPreview) return;
	
	let dictionaryContent = '';
	if (formData.useDictionary) {
		dictionaryContent = await window.api.getDictionaryContentForAI(context.novelId);
	}
	
	const previewContext = { ...context };
	if (formData.useCodex) {
		previewContext.codexContent = await window.api.codex.get(context.novelId);
	}
	
	try {
		const promptJson = buildPromptJson(formData, previewContext, dictionaryContent);
		systemPreview.textContent = promptJson.system;
		userPreview.textContent = promptJson.user;
		aiPreview.textContent = promptJson.ai || t('prompt.preview.empty');
	} catch (error) {
		systemPreview.textContent = `Error building preview: ${error.message}`;
		userPreview.textContent = '';
		aiPreview.textContent = '';
	}
};

const populateForm = (container, state) => {
	const form = container.querySelector('#rephrase-editor-form');
	if (!form) return;
	
	form.elements.instructions.value = state.instructions || '';
	form.elements.use_codex.checked = state.useCodex !== undefined ? state.useCodex : defaultState.useCodex;
	form.elements.use_dictionary.checked = state.useDictionary !== undefined ? state.useDictionary : defaultState.useDictionary;
};

export const init = async (container, context) => {
	try {
		const templateHtml = await window.api.getTemplate('prompt/rephrase-editor');
		container.innerHTML = templateHtml;
		applyTranslationsTo(container);
		
		const wordCount = context.selectedText ? context.selectedText.trim().split(/\s+/).filter(Boolean).length : 0;
		const fullContext = { ...context, wordCount };
		
		populateForm(container, context.initialState || defaultState);
		
		const form = container.querySelector('#rephrase-editor-form');
		const editDictionaryBtn = container.querySelector('.js-edit-dictionary-btn');
		
		if (editDictionaryBtn) {
			editDictionaryBtn.addEventListener('click', openDictionaryModal);
		}
		
		// Debounce the preview update to prevent sluggishness on input.
		const debouncedUpdatePreview = debounce(() => {
			updatePreview(container, fullContext);
		}, 500); // 300ms delay.
		
		if (form) {
			form.addEventListener('input', () => {
				// Debounce the expensive preview update.
				debouncedUpdatePreview();
			});
		}
		
		await updatePreview(container, fullContext);
	} catch (error) {
		container.innerHTML = `<p class="p-4 text-error">${t('prompt.errorLoadForm')}</p>`;
		console.error(error);
	}
};
