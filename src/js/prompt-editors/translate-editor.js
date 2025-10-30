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

let translationMemoryChoices = null;

export const getTranslationMemoryChoices = () => translationMemoryChoices;

const defaultState = { // Default state for the translate editor form
	instructions: '',
	tense: 'past',
	useCodex: true,
	contextPairs: 4,
	useDictionary: false,
	translationMemoryIds: []
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

export const buildPromptJson = (formData, context, contextualContent = '') => {
	const { selectedText, languageForPrompt, targetLanguage, translationPairs } = context;
	
	const plainTextToTranslate = selectedText;
	
	const instructionsBlock = formData.instructions
		? t('prompt.translate.system.instructionsBlock', { instructions: formData.instructions })
		: '';
	
	const tenseBlock = t('prompt.translate.system.tenseInstruction', { tense: formData.tense });
	
	const dictionaryBlock = contextualContent
		? t('prompt.translate.system.dictionaryBlock', { dictionaryContent: contextualContent })
		: '';
	
	const examplesBlock = (formData.translationMemoryIds && formData.translationMemoryIds.length > 0)
		? t('prompt.translate.system.examplesBlock')
		: '';
	
	const codexBlock = (formData.useCodex)
			? t('prompt.translate.system.codexBlock')
			: '';

	const system = t('prompt.translate.system.base', {
		sourceLanguage: languageForPrompt,
		targetLanguage: targetLanguage,
		tenseBlock: tenseBlock,
		instructionsBlock: instructionsBlock,
		dictionaryBlock: dictionaryBlock,
		examplesBlock: examplesBlock,
		codexBlock: codexBlock
	}).trim();
	
	const contextMessages = buildTranslationContextBlock(translationPairs, languageForPrompt, targetLanguage);
	
	const finalUserPromptParts = [];
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
	const form = container.querySelector('#translate-editor-form');
	if (!form) {
		return;
	}
	
	// MODIFICATION: Get selected values from Choices.js instance
	const selectedMemoryIds = translationMemoryChoices ? translationMemoryChoices.getValue(true) : [];
	
	const formData = {
		instructions: form.elements.instructions.value.trim(),
		tense: form.elements.tense.value,
		useCodex: form.elements.use_codex.checked,
		contextPairs: parseInt(form.elements.context_pairs.value, 10) || 0,
		useDictionary: form.elements.use_dictionary.checked,
		translationMemoryIds: selectedMemoryIds
	};
	
	const systemPreview = container.querySelector('.js-preview-system');
	const userPreview = container.querySelector('.js-preview-user');
	const aiPreview = container.querySelector('.js-preview-ai');
	const contextPairsContainer = container.querySelector('.js-preview-context-pairs');
	
	if (!systemPreview || !userPreview || !aiPreview || !contextPairsContainer) {
		return;
	}
	
	const previewContext = { ...context, translationPairs: [] };
	
	if (formData.contextPairs > 0 && context.chapterId) {
		try {
			const pairs = await window.api.getTranslationContext({
				chapterId: context.chapterId,
				pairCount: formData.contextPairs,
				selectedText: context.selectedText
			});
			previewContext.translationPairs = pairs;
		} catch (error) {
			console.error('Failed to fetch translation context for preview:', error);
			userPreview.textContent = `Error fetching context: ${error.message}`;
			return;
		}
	}
	
	let dictionaryContextualContent = '';
	if (formData.useDictionary) {
		dictionaryContextualContent = await window.api.getDictionaryContentForAI(context.novelId, 'translation');
	}
	
	try {
		const promptJson = buildPromptJson(formData, previewContext, dictionaryContextualContent);
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

const populateForm = (container, state, novelId) => {
	const form = container.querySelector('#translate-editor-form');
	if (!form) {
		return;
	}
	
	const storageKey = `tense-preference-${novelId}-translate`;
	const savedTense = localStorage.getItem(storageKey);
	
	const tense = state.tense || savedTense || defaultState.tense;
	
	form.elements.instructions.value = state.instructions || '';
	form.elements.context_pairs.value = state.contextPairs !== undefined ? state.contextPairs : 4;
	form.elements.use_codex.checked = state.useCodex !== undefined ? state.useCodex : defaultState.useCodex;
	form.elements.use_dictionary.checked = state.useDictionary !== undefined ? state.useDictionary : defaultState.useDictionary;
	
	form.elements.tense.value = tense;
	const tenseButtons = form.querySelectorAll('.js-tense-btn');
	tenseButtons.forEach(btn => {
		btn.classList.toggle('btn-active', btn.dataset.tense === tense);
	});
};

const populateTranslationMemoriesDropdown = async (container, currentNovelId) => {
	const select = container.querySelector('#js-translation-memory-select');
	if (!select) return;
	
	if (translationMemoryChoices) {
		translationMemoryChoices.destroy();
		translationMemoryChoices = null;
	}
	
	translationMemoryChoices = new Choices(select, {
		removeItemButton: true,
		placeholder: true,
		placeholderValue: t('prompt.translate.selectTranslationMemories'),
		classNames: {
			containerOuter: 'choices',
			containerInner: 'choices__inner',
		}
	});
	
	try {
		const novels = await window.api.getAllNovelsWithTM();
		if (!novels || novels.length === 0) {
			translationMemoryChoices.disable();
			return;
		}
		
		const storageKey = `translation-memory-selection-${currentNovelId}`;
		const savedSelectionJson = localStorage.getItem(storageKey);
		let idsToSelect = [];
		
		if (savedSelectionJson) {
			try {
				const savedIds = JSON.parse(savedSelectionJson);
				if (Array.isArray(savedIds)) {
					idsToSelect = savedIds;
				}
			} catch (e) {
				console.error('Failed to parse saved translation memory selection:', e);
				idsToSelect = [currentNovelId.toString()];
			}
		} else {
			idsToSelect = [currentNovelId.toString()];
		}
		
		const choices = novels.map(novel => ({
			value: novel.id.toString(),
			label: novel.title,
			selected: idsToSelect.includes(novel.id.toString())
		}));
		
		translationMemoryChoices.setChoices(choices, 'value', 'label', true);
		
	} catch (error) {
		console.error('Failed to load novels for translation memory selection:', error);
		translationMemoryChoices.disable();
	}
};


export const init = async (container, context) => {
	try {
		const templateHtml = await window.api.getTemplate('prompt/translate-editor');
		container.innerHTML = templateHtml;
		applyTranslationsTo(container);
		
		const fullContext = { ...context };
		
		populateForm(container, context.initialState || defaultState, context.novelId);
		await populateTranslationMemoriesDropdown(container, context.novelId);
		
		const form = container.querySelector('#translate-editor-form');
		
		const debouncedUpdatePreview = debounce(() => {
			updatePreview(container, fullContext);
		}, 500);
		
		if (form) {
			form.addEventListener('input', debouncedUpdatePreview);
			
			const selectEl = form.querySelector('#js-translation-memory-select');
			if (selectEl) {
				selectEl.addEventListener('change', () => {
					if (translationMemoryChoices) {
						const selectedIds = translationMemoryChoices.getValue(true);
						const storageKey = `translation-memory-selection-${context.novelId}`;
						localStorage.setItem(storageKey, JSON.stringify(selectedIds));
					}
					debouncedUpdatePreview();
				});
			}
			
			form.addEventListener('change', (e) => {
				if (e.target.type === 'checkbox') {
					debouncedUpdatePreview();
				}
			});
			
			const tenseGroup = form.querySelector('.js-tense-group');
			if (tenseGroup) {
				tenseGroup.addEventListener('click', (e) => {
					const button = e.target.closest('.js-tense-btn');
					if (!button) {
						return;
					}
					
					const newTense = button.dataset.tense;
					
					tenseGroup.querySelectorAll('.js-tense-btn').forEach(btn => btn.classList.remove('btn-active'));
					button.classList.add('btn-active');
					
					form.elements.tense.value = newTense;
					
					const storageKey = `tense-preference-${context.novelId}-translate`;
					localStorage.setItem(storageKey, newTense);
					
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
