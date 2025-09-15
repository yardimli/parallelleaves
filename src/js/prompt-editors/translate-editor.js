import { t } from '../i18n.js';

const defaultState = {
	instructions: '',
	selectedCodexIds: [],
	contextPairs: 4,
};

/**
 * Finds codex entry IDs within a given text by matching titles and document phrases.
 * @param {string} text - The plain text to scan.
 * @param {Array<object>} codexCategories - The array of codex categories containing entries.
 * @returns {Set<string>} A set of found codex entry IDs.
 */
function findCodexIdsInText(text, codexCategories) {
	if (!codexCategories || codexCategories.length === 0 || !text) {
		return new Set();
	}
	
	// 1. Create a flat list of terms to search for (titles and document phrases).
	const terms = [];
	codexCategories.forEach(category => {
		(category.entries || []).forEach(entry => {
			if (entry.title) {
				terms.push({ text: entry.title, id: entry.id });
			}
			if (entry.document_phrases) {
				const phrases = entry.document_phrases.split(',').map(p => p.trim()).filter(Boolean);
				phrases.forEach(phrase => {
					terms.push({ text: phrase, id: entry.id });
				});
			}
		});
	});
	
	if (terms.length === 0) {
		return new Set();
	}
	
	// Sort by length descending to match longer phrases first (e.g., "King Arthur" before "King").
	terms.sort((a, b) => b.text.length - a.text.length);
	
	const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	// Create a regex that matches any of the terms as whole words.
	const regex = new RegExp(`\\b(${terms.map(term => escapeRegex(term.text)).join('|')})\\b`, 'gi');
	
	// Map lower-cased phrases back to their entry IDs for case-insensitive matching.
	const termMap = new Map();
	terms.forEach(term => {
		termMap.set(term.text.toLowerCase(), term.id);
	});
	
	// 2. Find all matches in the text and collect the corresponding entry IDs.
	const foundIds = new Set();
	const matches = [...text.matchAll(regex)];
	
	matches.forEach(match => {
		const matchedText = match[0];
		const entryId = termMap.get(matchedText.toLowerCase());
		if (entryId) {
			foundIds.add(entryId.toString());
		}
	});
	
	return foundIds;
}
const renderCodexList = (container, context, initialState = null, preselectedIds = new Set()) => {
	const codexContainer = container.querySelector('.js-codex-selection-container');
	if (!codexContainer) return;
	
	const { allCodexEntries } = context;
	
	if (!allCodexEntries || allCodexEntries.length === 0) {
		codexContainer.innerHTML = `<p class="text-sm text-base-content/60">${t('prompt.translate.loadingCodex')}</p>`;
		return;
	}
	
	const categoriesHtml = allCodexEntries.map(category => {
		if (!category.entries || category.entries.length === 0) {
			return '';
		}
		
		const entriesHtml = category.entries.map(entry => {
			const isChecked = preselectedIds.has(entry.id.toString());
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
	
	// MODIFIED: Use translation for "Use Codex Entries as Glossary"
	codexContainer.innerHTML = `
        <h4 class="label-text font-semibold mb-2">${t('prompt.translate.useCodex')}</h4>
        <div class="max-h-72 overflow-y-auto pr-2 space-y-1">
            ${categoriesHtml}
        </div>
    `;
};

const buildTranslationContextBlock = (translationPairs, languageForPrompt, targetLanguage) => {
	if (!translationPairs || translationPairs.length === 0) {
		return [];
	}
	
	const contextMessages = [];
	translationPairs.forEach(pair => {
		const sourceText = (pair.source || '').replace(/<[^>]+>/g, ' ').replace(/\s\s+/g, ' ').trim();
		const targetText = (pair.target || '').replace(/<[^>]+>/g, ' ').replace(/\s\s+/g, ' ').trim();
		
		if (sourceText && targetText) {
			contextMessages.push({
				role: 'user',
				content: `Translate the following text from ${languageForPrompt} to ${targetLanguage}:\n\n<text>\n${sourceText}\n</text>`
			});
			contextMessages.push({
				role: 'assistant',
				content: targetText
			});
		}
	});
	
	return contextMessages;
};


export const buildPromptJson = (formData, context) => {
	const { selectedText, languageForPrompt, targetLanguage, allCodexEntries, translationPairs } = context;
	
	const plainTextToTranslate = selectedText;
	
	const system = `You are an expert literary translator. Your task is to translate a text from ${languageForPrompt} to ${targetLanguage}.
Preserve the original tone, style, and literary devices as much as possible. Maintain the original paragraph breaks.

${formData.instructions ? `Follow these specific instructions: <instructions>${formData.instructions}</instructions>` : ''}

Only return the translated text, nothing else.`;
	
	let codexBlock = '';
	if (formData.selectedCodexIds && formData.selectedCodexIds.length > 0) {
		const allEntriesFlat = allCodexEntries.flatMap(category => category.entries);
		const selectedEntries = allEntriesFlat.filter(entry => formData.selectedCodexIds.includes(String(entry.id)));
		if (selectedEntries.length > 0) {
			const codexContent = selectedEntries.map(entry => {
				const tempDiv = document.createElement('div');
				tempDiv.innerHTML = entry.content || '';
				const plainContent = tempDiv.textContent || tempDiv.innerText || '';
				
				const tempTranslationHintDiv = document.createElement('div');
				tempTranslationHintDiv.innerHTML = entry.target_content || '';
				const plainTranslationHint = tempTranslationHintDiv.textContent || tempTranslationHintDiv.innerText || '';
				
				return `Term (${languageForPrompt}): ${entry.title}\nDescription/Translation Hint: ${plainContent.trim()} \n\nTranslation in ${targetLanguage}: ${plainTranslationHint.trim() || '(No specific translation provided)'}`;
			}).join('\n\n');
			
			codexBlock = `Use the following glossary for consistent translation of key terms. Do not translate the terms literally if the glossary provides a specific translation or context.
<glossary>
${codexContent}
</glossary>`;
		}
	}
	
	const contextMessages = buildTranslationContextBlock(translationPairs, languageForPrompt, targetLanguage);
	
	const finalUserPromptParts = [codexBlock];
	finalUserPromptParts.push(`Translate the following text from ${languageForPrompt} to ${targetLanguage}:\n\n<text>\n${plainTextToTranslate}\n</text>`);
	const finalUserPrompt = finalUserPromptParts.filter(Boolean).join('\n\n');
	
	return {
		system,
		context_pairs: contextMessages,
		user: finalUserPrompt,
		ai: '',
	};
};

const updatePreview = async (container, context) => {
	const form = container.querySelector('#translate-editor-form');
	if (!form) return;
	
	const formData = {
		instructions: form.elements.instructions.value.trim(),
		selectedCodexIds: form.elements.codex_entry ? Array.from(form.elements.codex_entry).filter(cb => cb.checked).map(cb => cb.value) : [],
		contextPairs: parseInt(form.elements.context_pairs.value, 10) || 0,
	};
	
	const systemPreview = container.querySelector('.js-preview-system');
	const userPreview = container.querySelector('.js-preview-user');
	const aiPreview = container.querySelector('.js-preview-ai');
	const contextPairsContainer = container.querySelector('.js-preview-context-pairs');
	
	if (!systemPreview || !userPreview || !aiPreview || !contextPairsContainer) return;
	
	const previewContext = { ...context, translationPairs: [] };
	
	if (formData.contextPairs > 0 && context.translationInfo && context.activeEditorView) {
		try {
			const chapterId = context.activeEditorView.frameElement.dataset.chapterId;
			const blockNumber = context.translationInfo.blockNumber;
			
			const pairs = await window.api.getTranslationContext({
				chapterId: chapterId,
				endBlockNumber: blockNumber,
				pairCount: formData.contextPairs,
			});
			console.log('Fetched translation pairs for preview:', pairs);
			previewContext.translationPairs = pairs;
		} catch (error) {
			console.error('Failed to fetch translation context for preview:', error);
			userPreview.textContent = `Error fetching context: ${error.message}`;
			return;
		}
	}
	
	try {
		const promptJson = buildPromptJson(formData, previewContext);
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
};

export const init = async (container, context) => {
	try {
		const templateHtml = await window.api.getTemplate('prompt/translate-editor');
		container.innerHTML = templateHtml;
		
		const { selectedText, allCodexEntries, translationInfo, activeEditorView } = context;
		
		// 1. Get text from current selection. This is already plain text.
		let textToScan = selectedText;
		
		// 2. Get text from historical pairs.
		const formForDefaults = container.querySelector('#translate-editor-form');
		const contextPairCount = formForDefaults ? parseInt(formForDefaults.elements.context_pairs.value, 10) : (context.initialState?.contextPairs || defaultState.contextPairs);
		
		if (contextPairCount > 0 && translationInfo && activeEditorView) {
			try {
				const chapterId = activeEditorView.frameElement.dataset.chapterId;
				const blockNumber = translationInfo.blockNumber;
				const pairs = await window.api.getTranslationContext({
					chapterId: chapterId,
					endBlockNumber: blockNumber,
					pairCount: contextPairCount,
				});
				
				const tempDiv = document.createElement('div');
				const historyText = pairs.map(p => {
					// Extract plain text from source history
					tempDiv.innerHTML = p.source || '';
					const sourceText = tempDiv.textContent || tempDiv.innerText || '';
					// Extract plain text from target (translated) history
					tempDiv.innerHTML = p.target || '';
					const targetText = tempDiv.textContent || tempDiv.innerText || '';
					return sourceText + ' ' + targetText;
				}).join(' ');
				textToScan += ' ' + historyText;
				
			} catch (error) {
				console.error('Failed to fetch translation context for codex matching:', error);
			}
		}
		
		// 3. Find matching codex entries in the combined text.
		const preselectedIds = findCodexIdsInText(textToScan, allCodexEntries);
		
		const fullContext = { ...context };
		
		populateForm(container, context.initialState || defaultState);
		renderCodexList(container, fullContext, context.initialState, preselectedIds);
		
		const form = container.querySelector('#translate-editor-form');
		if (form) {
			form.addEventListener('input', () => updatePreview(container, fullContext));
		}
		
		await updatePreview(container, fullContext);
		
	} catch (error) {
		// MODIFIED: Use translation for error message
		container.innerHTML = `<p class="p-4 text-error">${t('prompt.errorLoadForm')}</p>`;
		console.error(error);
	}
};
