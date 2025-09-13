// This file contains the logic for the "Translate" prompt builder.

const defaultState = {
	instructions: '',
	selectedCodexIds: [],
	// NEW: Added default value for context pairs.
	contextPairs: 4,
};

const renderCodexList = (container, context, initialState = null) => {
	const codexContainer = container.querySelector('.js-codex-selection-container');
	if (!codexContainer) return;
	
	const { allCodexEntries } = context;
	
	if (!allCodexEntries || allCodexEntries.length === 0) {
		codexContainer.innerHTML = '<p class="text-sm text-base-content/60">No codex entries found for this project.</p>';
		return;
	}
	
	const categoriesHtml = allCodexEntries.map(category => {
		if (!category.entries || category.entries.length === 0) {
			return '';
		}
		
		const entriesHtml = category.entries.map(entry => {
			const isChecked = false;
			return `
                <div class="form-control">
                    <label class="label cursor-pointer justify-start gap-2 py-0.5">
                        <input type="checkbox" name="codex_entry" value="${entry.id}" ${isChecked ? 'checked' : ''} class="checkbox checkbox-xs" />
                        <span class="label-text text-sm">${entry.title}</span>
                    </label>
                </div>
            `;
		}).join('');
		
		return `
            <div class="break-inside-avoid mb-4">
                <h4 class="label-text font-semibold mb-1 text-base-content/80 border-b border-base-300 pb-1">${category.name}</h4>
                <div class="space-y-1 pt-1">
                    ${entriesHtml}
                </div>
            </div>
        `;
	}).join('');
	
	codexContainer.innerHTML = `
        <h4 class="label-text font-semibold mb-2">Use Codex Entries as Glossary</h4>
        <div class="max-h-72 overflow-y-auto pr-2" style="column-count: 2; column-gap: 1.5rem;">
            ${categoriesHtml}
        </div>
    `;
};

// MODIFIED: This function now returns an array of message objects for conversational context.
const buildTranslationContextBlock = (translationPairs, languageForPrompt, targetLanguage) => {
	if (!translationPairs || translationPairs.length === 0) {
		return [];
	}
	
	const contextMessages = [];
	translationPairs.forEach(pair => {
		// Clean up HTML from the text content
		const sourceText = (pair.source || '').replace(/<[^>]+>/g, ' ').replace(/\s\s+/g, ' ').trim();
		const targetText = (pair.target || '').replace(/<[^>]+>/g, ' ').replace(/\s\s+/g, ' ').trim();
		
		if (sourceText && targetText) {
			// Add the source text as a user message
			contextMessages.push({
				role: 'user',
				content: `Translate the following text from ${languageForPrompt} to ${targetLanguage}:\n\n<text>\n${sourceText}\n</text>`
			});
			// Add the translated text as the assistant's response
			contextMessages.push({
				role: 'assistant',
				content: targetText
			});
		}
	});
	
	return contextMessages;
};


// MODIFIED: This function now builds a prompt object that includes the conversational context pairs.
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
				return `Term (${languageForPrompt}): ${entry.title}\nDescription/Translation Hint: ${plainContent.trim()}`;
			}).join('\n\n');
			
			codexBlock = `Use the following glossary for consistent translation of key terms. Do not translate the terms literally if the glossary provides a specific translation or context.
<glossary>
${codexContent}
</glossary>`;
		}
	}
	
	// Generate the array of context messages.
	const contextMessages = buildTranslationContextBlock(translationPairs, languageForPrompt, targetLanguage);
	
	// The final user prompt includes the glossary (if any) and the text to translate.
	const finalUserPromptParts = [codexBlock];
	finalUserPromptParts.push(`Translate the following text from ${languageForPrompt} to ${targetLanguage}:\n\n<text>\n${plainTextToTranslate}\n</text>`);
	const finalUserPrompt = finalUserPromptParts.filter(Boolean).join('\n\n');
	
	return {
		system,
		context_pairs: contextMessages, // The new field for conversational context
		user: finalUserPrompt,
		ai: '',
	};
};

// MODIFIED: This function is now async and dynamically renders the context pairs in the preview.
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
	const contextPairsContainer = container.querySelector('.js-preview-context-pairs'); // Get the new container
	
	if (!systemPreview || !userPreview || !aiPreview || !contextPairsContainer) return;
	
	const previewContext = { ...context, translationPairs: [] }; // Start with empty pairs
	
	// Fetch real translation pairs for the preview if requested.
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
		aiPreview.textContent = promptJson.ai || '(Empty)';
		
		// NEW: Render the context pairs into their dedicated preview container.
		contextPairsContainer.innerHTML = ''; // Clear previous content
		if (promptJson.context_pairs && promptJson.context_pairs.length > 0) {
			promptJson.context_pairs.forEach((message, index) => {
				const pairNumber = Math.floor(index / 2) + 1;
				const roleTitle = message.role === 'user' ? `Context Pair ${pairNumber} (User)` : `Context Pair ${pairNumber} (Assistant)`;
				
				const title = document.createElement('h3');
				title.className = 'text-lg font-semibold mt-4 font-mono';
				title.textContent = roleTitle;
				// Use different colors to distinguish roles
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
	// NEW: Populate the context pairs input from the state.
	form.elements.context_pairs.value = state.contextPairs !== undefined ? state.contextPairs : 4;
};

export const init = async (container, context) => {
	try {
		const templateHtml = await window.api.getTemplate('prompt/translate-editor');
		container.innerHTML = templateHtml;
		
		const fullContext = { ...context };
		
		populateForm(container, context.initialState || defaultState);
		renderCodexList(container, fullContext, context.initialState);
		
		const form = container.querySelector('#translate-editor-form');
		if (form) {
			// MODIFIED: The event listener now calls the async updatePreview.
			form.addEventListener('input', () => updatePreview(container, fullContext));
		}
		
		// MODIFIED: Initial preview update is now awaited.
		await updatePreview(container, fullContext);
	} catch (error) {
		container.innerHTML = `<p class="p-4 text-error">Could not load editor form.</p>`;
		console.error(error);
	}
};
