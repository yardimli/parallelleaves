import { t, applyTranslationsTo } from '../i18n.js';
import { htmlToPlainText } from '../../utils/html-processing.js';

const defaultState = {
	instructions: '',
	selectedCodexIds: [],
};

const renderCodexList = (container, context, initialState = null) => {
	const codexContainer = container.querySelector('.js-codex-selection-container');
	if (!codexContainer) return;
	
	const { allCodexEntries } = context;
	
	if (!allCodexEntries || allCodexEntries.length === 0) {
		codexContainer.innerHTML = `<p class="text-sm text-base-content/60">${t('prompt.rephrase.loadingCodex')}</p>`;
		return;
	}
	
	const categoriesHtml = allCodexEntries.map(category => {
		if (!category.entries || category.entries.length === 0) {
			return '';
		}
		
		const entriesHtml = category.entries.map(entry => {
			const isChecked = false; // Rephrase editor doesn't pre-select.
			return `
                <label class="inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                    <input type="checkbox" name="codex_entry" value="${entry.id}" ${isChecked ? 'checked' : ''} class="checkbox checkbox-xs" />
                    <span class="label-text text-sm">${entry.title}</span>
                </label>
            `;
		}).join('');
		
		return `
            <div class="py-1">
                <div class="label-text font-semibold text-base-content/80 mr-2">${category.name}:</div>
                <div class="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
                    ${entriesHtml}
                </div>
            </div>
        `;
	}).join('');
	
	codexContainer.innerHTML = `
        <h4 class="label-text font-semibold mb-2">${t('prompt.rephrase.useCodex')}</h4>
        <div class="max-h-72 overflow-y-auto pr-2 space-y-1">
            ${categoriesHtml}
        </div>
    `;
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

export const buildPromptJson = (formData, context) => {
	const { selectedText, wordCount, allCodexEntries, languageForPrompt, wordsBefore, wordsAfter } = context;
	
	const instructions = formData.instructions || t('prompt.rephrase.system.defaultInstruction');
	const system = t('prompt.rephrase.system.base', {
		instructions: instructions,
		language: languageForPrompt || 'English'
	});
	
	let codexBlock = '';
	const allEntriesFlat = allCodexEntries.flatMap(category => category.entries);
	if (formData.selectedCodexIds && formData.selectedCodexIds.length > 0) {
		const selectedEntries = allEntriesFlat.filter(entry => formData.selectedCodexIds.includes(String(entry.id)));
		if (selectedEntries.length > 0) {
			const codexContent = selectedEntries.map(entry => {
				const plainContent = htmlToPlainText(entry.content || '');
				return `Title: ${entry.title}\nContent: ${plainContent.trim()}`;
			}).join('\n\n');
			
			codexBlock = t('prompt.rephrase.user.codexBlock', { codexContent });
		}
	}
	
	const truncatedText = selectedText.length > 4096 ? selectedText.substring(0, 4096) + '...' : selectedText;
	
	const surroundingText = buildSurroundingTextBlock(wordsBefore, wordsAfter);
	
	const userParts = [codexBlock];
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
		ai: '',
	};
};

const updatePreview = (container, context) => {
	const form = container.querySelector('#rephrase-editor-form');
	if (!form) return;
	
	const formData = {
		instructions: form.elements.instructions.value.trim(),
		selectedCodexIds: form.elements.codex_entry ? Array.from(form.elements.codex_entry).filter(cb => cb.checked).map(cb => cb.value) : [],
	};
	
	const systemPreview = container.querySelector('.js-preview-system');
	const userPreview = container.querySelector('.js-preview-user');
	const aiPreview = container.querySelector('.js-preview-ai');
	
	if (!systemPreview || !userPreview || !aiPreview) return;
	
	try {
		const promptJson = buildPromptJson(formData, context);
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
};

export const init = async (container, context) => {
	try {
		const templateHtml = await window.api.getTemplate('prompt/rephrase-editor');
		container.innerHTML = templateHtml;
		applyTranslationsTo(container);
		
		const wordCount = context.selectedText ? context.selectedText.trim().split(/\s+/).filter(Boolean).length : 0;
		const fullContext = { ...context, wordCount };
		
		populateForm(container, context.initialState || defaultState);
		renderCodexList(container, fullContext, context.initialState);
		
		const form = container.querySelector('#rephrase-editor-form');
		
		if (form) {
			form.addEventListener('input', () => updatePreview(container, fullContext));
		}
		
		updatePreview(container, fullContext);
	} catch (error) {
		container.innerHTML = `<p class="p-4 text-error">${t('prompt.errorLoadForm')}</p>`;
		console.error(error);
	}
};
