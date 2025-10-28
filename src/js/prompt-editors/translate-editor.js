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

export const buildPromptJson = (formData, context, contextualContent = '', translationMemoryContent = '') => {
	const { selectedText, languageForPrompt, targetLanguage, translationPairs } = context;
	
	const plainTextToTranslate = selectedText;
	
	const instructionsBlock = formData.instructions
		? t('prompt.translate.system.instructionsBlock', { instructions: formData.instructions })
		: '';
	
	const tenseBlock = t('prompt.translate.system.tenseInstruction', { tense: formData.tense });
	
	const dictionaryBlock = contextualContent
		? t('prompt.translate.system.dictionaryBlock', { dictionaryContent: contextualContent })
		: '';
	
	const examplesBlock = translationMemoryContent
		? t('prompt.translate.system.examplesBlock', { translationExamples: translationMemoryContent })
		: '';
	
	let codexBlock = '';
	if (formData.useCodex && context.codexContent) {
		const plainCodex = htmlToPlainText(context.codexContent);
		if (plainCodex) {
			codexBlock = t('prompt.translate.system.codexBlock', { codexContent: plainCodex });
		}
	}
	
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
	
	const selectedMemoryIds = Array.from(form.querySelectorAll('#js-translation-memory-list input:checked')).map(cb => cb.value);
	
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
	
	if (formData.useCodex) {
		previewContext.codexContent = await window.api.codex.get(context.novelId);
	}
	
	let translationMemoryContent = '';
	if (formData.translationMemoryIds.length > 0) {
		try {
			translationMemoryContent = await window.api.translationMemoryGetForNovels(formData.translationMemoryIds);
		} catch (error) {
			console.error('Failed to fetch translation memory for preview:', error);
		}
	}
	
	try {
		const promptJson = buildPromptJson(formData, previewContext, dictionaryContextualContent, translationMemoryContent);
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
	const list = container.querySelector('#js-translation-memory-list');
	if (!list) return;
	
	try {
		const novels = await window.api.getAllNovelsSimple();
		list.innerHTML = ''; // Clear loading state
		
		if (novels && novels.length > 0) {
			novels.forEach(novel => {
				const li = document.createElement('li');
				const label = document.createElement('label');
				label.className = 'label cursor-pointer';
				
				const span = document.createElement('span');
				span.className = 'label-text';
				span.textContent = novel.title;
				
				const checkbox = document.createElement('input');
				checkbox.type = 'checkbox';
				checkbox.className = 'checkbox checkbox-sm';
				checkbox.value = novel.id;
				
				// By default, check the memory for the current novel
				if (novel.id.toString() === currentNovelId.toString()) {
					checkbox.checked = true;
				}
				
				label.appendChild(span);
				label.appendChild(checkbox);
				li.appendChild(label);
				list.appendChild(li);
			});
		} else {
			list.innerHTML = `<li><span class="text-base-content/60">${t('prompt.translate.noTranslationMemories')}</span></li>`;
		}
	} catch (error) {
		console.error('Failed to load novels for translation memory selection:', error);
		list.innerHTML = `<li><span class="text-error">${t('common.error')}</span></li>`;
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
