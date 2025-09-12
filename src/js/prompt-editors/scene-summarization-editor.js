// This file contains the logic for the "Scene Summarization" prompt builder.

const defaultState = {
	words: 100,
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
	
	codexContainer.innerHTML = `
        <h4 class="label-text font-semibold mb-2">Use Codex Entries</h4>
        <div class="max-h-72 overflow-y-auto pr-2" style="column-count: 2; column-gap: 1.5rem;">
            ${categoriesHtml}
        </div>
    `;
};

// Export this function for use in the main prompt editor module.
export const buildPromptJson = (formData, context) => {
	// MODIFIED: Use the new `languageForPrompt` context variable.
	const { selectedText, allCodexEntries, languageForPrompt } = context;
	
	// MODIFIED: System prompt now explicitly uses the language passed in the context.
	const system = `You are an expert novel summarizer.
Whenever you're given text, summarize it into a concise, condensed version.

Keep the following rules in mind:
- Don't write more than ${formData.words || 100} words.
- Always write in ${languageForPrompt || 'English'} spelling and grammar.
- Only return the summary in running text, don't abbreviate to bullet points.
- Don't start with "In this scene..." or "Here is...". Only write the summary itself.
- Mention characters by name and never by their role (e.g. protagonist, mentor, friend, author).
- Assume the reader is familiar with character or location profiles, so don't explain who everyone is.
- Use third person, regardless of the POV of the scene itself.
- Write in present tense.
- Use nouns instead of pronouns (Don't use he, she, they, etc. instead use actual names).
- If a sequence of events gets too long, or there's a major shift in location, always start a new paragraph within the summary.

A strong summary consists of the following:
- Knowing when and where things happen (don't leave out location or time changes within the scene - remember to start them on a new paragraph).
- No talking about backstory, previous summaries already covered these parts.
- Not talking about day-to-day or mundane actions, unless they're important to the plot and its development.
- No talking about background activities or people/happenings. Only characters/locations/etc. mentioned by name are significant.
- No introspection - neither at the start nor end of the summary.
- Keeping only the most important key details, leaving out sensory details, descriptions and dialogue.

${formData.instructions ? `Additional instructions have been provided to tweak your role, behavior and capabilities. Follow them closely:
<instructions>
${formData.instructions}
</instructions>
` : ''}`;
	
	let codexBlock = '';
	const allEntriesFlat = allCodexEntries.flatMap(category => category.entries);
	if (formData.selectedCodexIds && formData.selectedCodexIds.length > 0) {
		const selectedEntries = allEntriesFlat.filter(entry => formData.selectedCodexIds.includes(String(entry.id)));
		if (selectedEntries.length > 0) {
			const codexContent = selectedEntries.map(entry => {
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
	
	const user = `${codexBlock}

Write the summary in third person, and use present tense.

Text to summarize:
<scene>
${selectedText ? selectedText : '{removeWhitespace(scene.fullText)}'}
</scene>`;
	
	return {
		system: system.replace(/\n\n\n/g, '\n\n'),
		user: user.replace(/\n\n\n/g, '\n\n'),
		ai: '',
	};
};

const updatePreview = (container, context) => {
	const form = container.querySelector('#scene-summarization-editor-form');
	if (!form) return;
	
	const formData = {
		words: form.elements.words.value,
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
	const form = container.querySelector('#scene-summarization-editor-form');
	if (!form) return;
	
	form.elements.words.value = state.words;
	form.elements.instructions.value = state.instructions;
};

export const init = async (container, context) => {
	try {
		const templateHtml = await window.api.getTemplate('prompt/scene-summarization-editor');
		container.innerHTML = templateHtml;
		
		const wordCount = context.selectedText ? context.selectedText.trim().split(/\s+/).filter(Boolean).length : 0;
		const fullContext = { ...context, wordCount };
		
		populateForm(container, context.initialState || defaultState);
		renderCodexList(container, fullContext, context.initialState);
		
		const form = container.querySelector('#scene-summarization-editor-form');
		
		if (form) {
			form.addEventListener('input', () => updatePreview(container, fullContext));
		}
		
		updatePreview(container, fullContext);
	} catch (error) {
		container.innerHTML = `<p class="p-4 text-error">Could not load editor form.</p>`;
		console.error(error);
	}
};
