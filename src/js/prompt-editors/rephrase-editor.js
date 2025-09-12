// This file contains the logic for the "Rephrase" prompt builder.

// MODIFIED: Removed 'use_surrounding_text' and 'use_pov' from the default state.
const defaultState = {
	instructions: '',
	selectedCodexIds: [],
};

// MODIFIED: Renders codex entries grouped by category into a multi-column layout.
const renderCodexList = (container, context, initialState = null) => {
	const codexContainer = container.querySelector('.js-codex-selection-container');
	if (!codexContainer) return;
	
	const { allCodexEntries, linkedCodexEntryIds } = context; // allCodexEntries is now categories
	
	if (!allCodexEntries || allCodexEntries.length === 0) {
		codexContainer.innerHTML = '<p class="text-sm text-base-content/60">No codex entries found for this novel.</p>';
		return;
	}
	
	const selectedIds = initialState ? initialState.selectedCodexIds : linkedCodexEntryIds.map(String);
	
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
	
	// NEW: Renders a heading and a multi-column, scrollable container for the categories.
	codexContainer.innerHTML = `
        <h4 class="label-text font-semibold mb-2">Use Codex Entries</h4>
        <div class="max-h-72 overflow-y-auto pr-2" style="column-count: 2; column-gap: 1.5rem;">
            ${categoriesHtml}
        </div>
    `;
};

// MODIFIED: Removed the 'use' parameter. This block is now always constructed if context exists.
const buildSurroundingTextBlock = (wordsBefore, wordsAfter) => {
	if (!wordsBefore && !wordsAfter) {
		return '';
	}
	let block = 'For contextual information, refer to surrounding words in the scene, DO NOT REPEAT THEM:\n';
	if (wordsBefore) {
		block += `<textBefore>\n${wordsBefore}\n</textBefore>\n`;
	}
	if (wordsAfter) {
		block += `<textAfter>\n${wordsAfter}\n</textAfter>\n`;
	}
	return block;
};

// Export this function for use in the main prompt editor module.
export const buildPromptJson = (formData, context) => {
	const { selectedText, wordCount, allCodexEntries, novelLanguage, povString, wordsBefore, wordsAfter } = context;
	
	const system = `You are an expert prose editor.

Whenever you're given text, rephrase it using the following instructions: <instructions>${formData.instructions || 'Rephrase the given text.'}</instructions>

Imitiate and keep the current writing style, and leave mannerisms, word choice and sentence structure intact.
You are free to remove redundant lines of speech. Keep the same tense and stylistic choices. Use ${novelLanguage || 'English'} spelling and grammar.

Only return the rephrased text, nothing else.`;
	
	let codexBlock = '';
	// MODIFIED: Flatten the categorized codex entries to search for selected ones.
	const allEntriesFlat = allCodexEntries.flatMap(category => category.entries);
	if (formData.selectedCodexIds && formData.selectedCodexIds.length > 0) {
		const selectedEntries = allEntriesFlat.filter(entry => formData.selectedCodexIds.includes(String(entry.id)));
		if (selectedEntries.length > 0) {
			const codexContent = selectedEntries.map(entry => {
				// Strip HTML from content for a cleaner preview.
				const tempDiv = document.createElement('div');
				tempDiv.innerHTML = entry.content || '';
				const plainContent = tempDiv.textContent || tempDiv.innerText || '';
				return `Title: ${entry.title}\nContent: ${plainContent.trim()}`;
			}).join('\n\n');
			
			codexBlock = `Take into account the following glossary of characters/locations/items/lore... when writing your response:
<codex>
${codexContent}
</codex>`;
		}
	}
	
	const truncatedText = selectedText.length > 4096 ? selectedText.substring(0, 4096) + '...' : selectedText;
	
	// MODIFIED: Call buildSurroundingTextBlock without the 'use' flag.
	const surroundingText = buildSurroundingTextBlock(wordsBefore, wordsAfter);
	
	const userParts = [codexBlock];
	// MODIFIED: Always include POV if it exists.
	if (povString) {
		userParts.push(povString);
	}
	if (surroundingText) {
		userParts.push(surroundingText);
	}
	userParts.push(`Text to rewrite:\n<text words="${wordCount}">\n${wordCount > 0 ? truncatedText : '{message}'}\n</text>`);
	
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
	
	// MODIFIED: Removed reading of checkbox values.
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

// MODIFIED: No longer sets checkbox values.
const populateForm = (container, state) => {
	const form = container.querySelector('#rephrase-editor-form');
	if (!form) return;
	
	form.elements.instructions.value = state.instructions;
};

export const init = async (container, context) => {
	try {
		const templateHtml = await window.api.getTemplate('prompt/rephrase-editor');
		container.innerHTML = templateHtml;
		
		const wordCount = context.selectedText ? context.selectedText.trim().split(/\s+/).filter(Boolean).length : 0;
		const fullContext = { ...context, wordCount };
		
		// MODIFIED: Populate form with initial state from context if it exists, otherwise use defaults.
		populateForm(container, context.initialState || defaultState);
		// MODIFIED: Pass initial state to renderCodexList to check the correct boxes.
		renderCodexList(container, fullContext, context.initialState);
		
		const form = container.querySelector('#rephrase-editor-form');
		
		if (form) {
			form.addEventListener('input', () => updatePreview(container, fullContext));
		}
		
		updatePreview(container, fullContext);
	} catch (error) {
		container.innerHTML = `<p class="p-4 text-error">Could not load editor form.</p>`;
		console.error(error);
	}
};
