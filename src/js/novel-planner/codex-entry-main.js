import { setupTopToolbar } from '../novel-planner/toolbar.js';
import { getCodexEditorView, setupContentEditor } from './planner-codex-content-editor.js';
import { setupPromptEditor } from '../prompt-editor.js';
import { DOMSerializer } from 'prosemirror-model';

// --- Helper Functions ---

function setButtonLoadingState(button, isLoading) {
	const text = button.querySelector('.js-btn-text');
	const spinner = button.querySelector('.js-spinner');
	if (isLoading) {
		button.disabled = true;
		if (text) text.classList.add('hidden');
		if (spinner) spinner.classList.remove('hidden');
	} else {
		button.disabled = false;
		if (text) text.classList.remove('hidden');
		if (spinner) spinner.classList.add('hidden');
	}
}

// --- Mode-Specific Setup Functions ---

/**
 * Configures the editor window for creating a new codex entry.
 * @param {string} novelId - The ID of the novel this entry belongs to.
 * @param {string} selectedText - The text selected in the chapter editor.
 */
async function setupCreateMode(novelId, selectedText) {
	document.body.dataset.novelId = novelId;
	
	// 1. Configure UI for creation
	document.title = 'Create New Codex Entry';
	document.getElementById('js-novel-info').textContent = 'Create New Codex Entry';
	document.getElementById('js-create-meta-section').classList.remove('hidden');
	document.getElementById('js-create-action-section').classList.remove('hidden');
	
	// 2. Setup ProseMirror editor with selected text
	const sourceContainer = document.getElementById('js-pm-content-source');
	sourceContainer.querySelector('[data-name="content"]').innerHTML = `<p>${selectedText.replace(/\n/g, '</p><p>')}</p>`;
	setupContentEditor({}); // No entryId, so no debounced saving
	setupTopToolbar({ isCodexEditor: true, getEditorView: getCodexEditorView });
	setupPromptEditor();
	
	// 3. Fetch categories and populate dropdown
	const categorySelect = document.getElementById('js-codex-category');
	const newCategoryWrapper = document.getElementById('js-new-category-wrapper');
	const newCategoryInput = document.getElementById('js-new-category-name');
	
	const categories = await window.api.getCategoriesForNovel(novelId);
	categories.forEach(cat => categorySelect.add(new Option(cat.name, cat.id)));
	
	categorySelect.addEventListener('change', () => {
		const isNew = categorySelect.value === 'new';
		newCategoryWrapper.classList.toggle('hidden', !isNew);
		newCategoryInput.required = isNew;
	});
	
	// 4. Get AI suggestions and pre-fill form
	const titleInput = document.getElementById('js-codex-title-input');
	const suggestionSpinner = document.getElementById('js-ai-suggestion-spinner');
	suggestionSpinner.classList.remove('hidden');
	try {
		const result = await window.api.suggestCodexDetails(novelId, selectedText);
		if (result.success) {
			titleInput.value = result.title;
			if (result.categoryId) categorySelect.value = result.categoryId;
		}
	} catch (e) {
		console.error('AI suggestion failed', e);
		titleInput.value = selectedText.slice(0, 50); // Fallback
	} finally {
		suggestionSpinner.classList.add('hidden');
	}
	
	// 5. Setup form submission
	const form = document.getElementById('js-codex-form');
	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const createBtn = form.querySelector('.js-create-entry-btn');
		setButtonLoadingState(createBtn, true);
		
		const editorView = getCodexEditorView();
		const serializer = DOMSerializer.fromSchema(editorView.state.schema);
		const fragment = serializer.serializeFragment(editorView.state.doc.content);
		const tempDiv = document.createElement('div');
		tempDiv.appendChild(fragment);
		
		const formData = {
			title: titleInput.value,
			content: tempDiv.innerHTML,
			codex_category_id: categorySelect.value === 'new' ? null : categorySelect.value,
			new_category_name: categorySelect.value === 'new' ? newCategoryInput.value : null,
		};
		
		try {
			const result = await window.api.createCodexEntry(novelId, formData);
			if (result.success) {
				// Transition to edit mode for the newly created entry
				const newEntryId = result.codexEntry.id;
				window.location.search = `?mode=edit&entryId=${newEntryId}`;
			} else {
				throw new Error(result.message || 'Failed to create entry.');
			}
		} catch (error) {
			console.error('Error creating codex entry:', error);
			alert('Error: ' + error.message);
			setButtonLoadingState(createBtn, false);
		}
	});
}

/**
 * Configures the editor window for editing an existing codex entry.
 * @param {string} entryId - The ID of the entry to edit.
 */
async function setupEditMode(entryId) {
	document.body.dataset.entryId = entryId;
	try {
		const entryData = await window.api.getOneCodexForEditor(entryId);
		document.body.dataset.novelId = entryData.novel_id;
		
		document.getElementById('js-novel-info').textContent = `${entryData.novel_title} > Codex`;
		document.getElementById('js-codex-title-input').value = entryData.title;
		document.title = `Editing Codex: ${entryData.title}`;
		
		const sourceContainer = document.getElementById('js-pm-content-source');
		sourceContainer.querySelector('[data-name="content"]').innerHTML = entryData.content || '';
		
		setupContentEditor({ entryId }); // Pass entryId to enable debounced saving
		setupTopToolbar({ isCodexEditor: true, getEditorView: getCodexEditorView });
		setupPromptEditor();
		
	} catch (error) {
		console.error('Failed to load codex entry data:', error);
		document.body.innerHTML = `<p class="text-error p-8">Error: Could not load codex entry data. ${error.message}</p>`;
	}
}

// --- Main Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
	const params = new URLSearchParams(window.location.search);
	const mode = params.get('mode') || 'edit'; // Default to 'edit' for backward compatibility
	
	if (mode === 'new') {
		const novelId = params.get('novelId');
		const selectedText = decodeURIComponent(params.get('selectedText') || '');
		if (!novelId) {
			document.body.innerHTML = '<p class="text-error p-8">Error: Novel ID is missing for new entry.</p>';
			return;
		}
		await setupCreateMode(novelId, selectedText);
	} else {
		const entryId = params.get('entryId');
		if (!entryId) {
			document.body.innerHTML = '<p class="text-error p-8">Error: Codex Entry ID is missing.</p>';
			return;
		}
		await setupEditMode(entryId);
	}
});
