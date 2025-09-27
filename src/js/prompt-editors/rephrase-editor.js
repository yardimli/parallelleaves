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
	tense: 'past',
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

export const buildPromptJson = (formData, context, contextualContent = '') => {
	const { selectedText, wordCount, languageForPrompt, wordsBefore, wordsAfter } = context;
	
	const instructions = formData.instructions || t('prompt.rephrase.system.defaultInstruction');
	
	const tenseBlock = t('prompt.rephrase.system.tenseInstruction', { tense: formData.tense });
	
	const system = t('prompt.rephrase.system.base', {
		instructions: instructions,
		tenseBlock: tenseBlock,
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
	if (contextualContent) {
		userParts.push(t('prompt.common.user.dictionaryBlock', { dictionaryContent: contextualContent }));
	}
	userParts.push(codexBlock);
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
		tense: form.elements.tense.value,
		useCodex: form.elements.use_codex.checked,
		useDictionary: form.elements.use_dictionary.checked
	};
	
	const systemPreview = container.querySelector('.js-preview-system');
	const userPreview = container.querySelector('.js-preview-user');
	const aiPreview = container.querySelector('.js-preview-ai');
	
	if (!systemPreview || !userPreview || !aiPreview) return;
	
	let dictionaryContent = '';
	if (formData.useDictionary) {
		dictionaryContent = await window.api.getDictionaryContentForAI(context.novelId, ''); //for now to return all without applying filter will test later if its better to filter for 'rephrasing'
	}
	
	let analysisContent = '';
	const analysisKey = `analysis-results-${context.novelId}`;
	const analysisDataRaw = localStorage.getItem(analysisKey);
	if (analysisDataRaw) {
		try {
			const analysisData = JSON.parse(analysisDataRaw);
			const formattedChanges = analysisData.flatMap(item =>
				Object.entries(item.changes).map(([original, edited]) => `${original} = ${edited}`)
			).join('\n');
			
			if (formattedChanges) {
				analysisContent = `\n\n${formattedChanges}`;
			}
		} catch (e) {
			console.error('Failed to parse analysis data for preview:', e);
		}
	}
	
	const combinedContextualContent = (dictionaryContent + analysisContent).trim();
	
	const previewContext = { ...context };
	if (formData.useCodex) {
		previewContext.codexContent = await window.api.codex.get(context.novelId);
	}
	
	try {
		const promptJson = buildPromptJson(formData, previewContext, combinedContextualContent);
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
	form.elements.use_codex.checked = state.useCodex !== undefined ? state.useCodex : defaultState.useCodex;
	form.elements.use_dictionary.checked = state.useDictionary !== undefined ? state.useDictionary : defaultState.useDictionary;
	
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
		const editDictionaryBtn = container.querySelector('.js-edit-dictionary-btn');
		
		if (editDictionaryBtn) {
			editDictionaryBtn.addEventListener('click', () => openDictionaryModal(context.novelId));
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
