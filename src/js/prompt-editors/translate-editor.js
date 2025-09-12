// This file contains the logic for the "Translate" prompt builder.

const defaultState = {
	instructions: '',
	selectedCodexIds: [],
};

const renderCodexList = (container, context, initialState = null) => {
	const codexContainer = container.querySelector('.js-codex-selection-container');
	if (!codexContainer) return;
	
	const { allCodexEntries, linkedCodexEntryIds } = context;
	
	if (!allCodexEntries || allCodexEntries.length === 0) {
		codexContainer.innerHTML = '<p class="text-sm text-base-content/60">No codex entries found for this project.</p>';
		return;
	}
	
	// MODIFIED: Robustly determine selected IDs from initial state or linked entries.
	// This prevents an error if `initialState` exists but `selectedCodexIds` is missing or not an array.
	let selectedIds;
	if (initialState && Array.isArray(initialState.selectedCodexIds)) {
		selectedIds = initialState.selectedCodexIds;
	} else {
		selectedIds = (linkedCodexEntryIds || []).map(String);
	}
	
	const categoriesHtml = allCodexEntries.map(category => {
		if (!category.entries || category.entries.length === 0) {
			return '';
		}
		
		const entriesHtml = category.entries.map(entry => {
			const isChecked = selectedIds.includes(String(entry.id));
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


export const buildPromptJson = (formData, context) => {
	const { selectedText, languageForPrompt, targetLanguage, allCodexEntries } = context;
	
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
	
	const userParts = [codexBlock];
	userParts.push(`Translate the following text from ${languageForPrompt} to ${targetLanguage}:

<text>
${plainTextToTranslate}
</text>`);
	
	const user = userParts.filter(Boolean).join('\n\n');
	
	return {
		system,
		user,
		ai: '',
	};
};

const updatePreview = (container, context) => {
	const form = container.querySelector('#translate-editor-form');
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
		aiPreview.textContent = promptJson.ai || '(Empty)';
	} catch (error) {
		systemPreview.textContent = `Error building preview: ${error.message}`;
		userPreview.textContent = '';
		aiPreview.textContent = '';
	}
};

const populateForm = (container, state) => {
	const form = container.querySelector('#translate-editor-form');
	if (!form) return;
	form.elements.instructions.value = state.instructions || '';
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
			form.addEventListener('input', () => updatePreview(container, fullContext));
		}
		
		updatePreview(container, fullContext);
	} catch (error) {
		container.innerHTML = `<p class="p-4 text-error">Could not load editor form.</p>`;
		console.error(error);
	}
};
