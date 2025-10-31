import { t, applyTranslationsTo } from '../i18n.js';
import { htmlToPlainText } from '../../utils/html-processing.js';

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
	tense: 'past'
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

export const buildPromptJson = (formData, context, userDictionary = '') => {
	const { selectedText, wordCount, languageForPrompt, wordsBefore, wordsAfter } = context;
	
	const system = t('prompt.rephrase.system.base', {
		instructions: formData.instructions,
		tense: formData.tense,
		dictionary: userDictionary,
		language: languageForPrompt || 'English'
	});
	
	const truncatedText = selectedText.length > 4096 ? selectedText.substring(0, 4096) + '...' : selectedText;
	
	const surroundingText = buildSurroundingTextBlock(wordsBefore, wordsAfter);
	
	const userParts = [];

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
		tense: form.elements.tense.value
	};
	
	const systemPreview = container.querySelector('.js-preview-system');
	const userPreview = container.querySelector('.js-preview-user');
	const aiPreview = container.querySelector('.js-preview-ai');
	
	if (!systemPreview || !userPreview || !aiPreview) return;
	
	let dictionaryContextualContent = await window.api.getDictionaryContentForAI(context.novelId, 'translation');

	const previewContext = { ...context };
	
	try {
		const promptJson = buildPromptJson(formData, previewContext, dictionaryContextualContent);
		systemPreview.textContent = promptJson.system;
		userPreview.textContent = promptJson.user;
		aiPreview.textContent = promptJson.ai || t('prompt.preview.empty');
	} catch (error) {
		systemPreview.textContent = `Error building preview: ${error.message}`;
		userPreview.textContent = '';
		aiPreview.textContent = '';
	}
};

const populateForm = (container, state, novelId) => {
	const form = container.querySelector('#rephrase-editor-form');
	if (!form) return;
	
	const storageKey = `tense-preference-${novelId}-rephrase`;
	const savedTense = localStorage.getItem(storageKey);
	
	const tense = state.tense || savedTense || defaultState.tense;
	
	form.elements.instructions.value = state.instructions || '';
	
	form.elements.tense.value = tense;
	const tenseButtons = form.querySelectorAll('.js-tense-btn');
	tenseButtons.forEach(btn => {
		btn.classList.toggle('btn-active', btn.dataset.tense === tense);
	});
};

export const init = async (container, context) => {
	try {
		const templateHtml = await window.api.getTemplate('prompt/rephrase-editor');
		container.innerHTML = templateHtml;
		applyTranslationsTo(container);
		
		const wordCount = context.selectedText ? context.selectedText.trim().split(/\s+/).filter(Boolean).length : 0;
		const fullContext = { ...context, wordCount };
		
		populateForm(container, context.initialState || defaultState, context.novelId);
		
		const form = container.querySelector('#rephrase-editor-form');
		
		// Debounce the preview update to prevent sluggishness on input.
		const debouncedUpdatePreview = debounce(() => {
			updatePreview(container, fullContext);
		}, 500); // 300ms delay.
		
		if (form) {
			form.addEventListener('input', () => {
				// Debounce the expensive preview update.
				debouncedUpdatePreview();
			});
			
			const tenseGroup = form.querySelector('.js-tense-group');
			if (tenseGroup) {
				tenseGroup.addEventListener('click', (e) => {
					const button = e.target.closest('.js-tense-btn');
					if (!button) return;
					
					const newTense = button.dataset.tense;
					
					// Update UI
					tenseGroup.querySelectorAll('.js-tense-btn').forEach(btn => btn.classList.remove('btn-active'));
					button.classList.add('btn-active');
					
					// Update hidden input
					form.elements.tense.value = newTense;
					
					// Save preference to localStorage
					const storageKey = `tense-preference-${context.novelId}-rephrase`;
					localStorage.setItem(storageKey, newTense);
					
					// Trigger preview update
					debouncedUpdatePreview();
				});
			}
		}
		
		await updatePreview(container, fullContext);
	} catch (error) {
		container.innerHTML = `<p class="p-4 text-error">${t('prompt.errorLoadForm')}</p>`;
		console.error(error);
	}
};
