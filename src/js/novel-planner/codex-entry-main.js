// NEW: Entry point for the dedicated codex entry editor window.
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

function setupImageHandlers(entryId) {
	const openModal = (modal) => {
		if (modal) modal.showModal();
	};
	
	const closeModal = (modal) => {
		if (modal) {
			modal.close();
			const form = modal.querySelector('form');
			if (form) {
				form.reset();
				const previewContainer = form.querySelector('.js-image-preview-container');
				if (previewContainer) previewContainer.classList.add('hidden');
				const fileNameSpan = form.querySelector('.js-file-name');
				if (fileNameSpan) fileNameSpan.textContent = 'Click to select a file';
				const submitBtn = form.querySelector('button[type="submit"]');
				if (submitBtn) submitBtn.disabled = true;
			}
		}
	};
	
	document.body.addEventListener('click', (event) => {
		const target = event.target;
		const openTrigger = target.closest('.js-codex-generate-ai, .js-codex-upload-image');
		if (openTrigger) {
			const entryTitle = document.getElementById('js-codex-title-input').value;
			if (openTrigger.matches('.js-codex-generate-ai')) {
				const modal = document.getElementById('ai-modal');
				const textarea = modal.querySelector('textarea');
				textarea.value = `A detailed portrait of ${entryTitle}, fantasy art.`;
				openModal(modal);
			}
			if (openTrigger.matches('.js-codex-upload-image')) {
				const modal = document.getElementById('upload-modal');
				openModal(modal);
			}
			return;
		}
		const closeTrigger = target.closest('.js-close-modal');
		if (closeTrigger) {
			const modal = closeTrigger.closest('dialog.modal');
			closeModal(modal);
		}
	});
	
	document.body.addEventListener('submit', async (event) => {
		if (event.target.matches('.js-ai-form')) {
			event.preventDefault();
			const form = event.target;
			const modal = form.closest('.js-ai-modal');
			const submitBtn = form.querySelector('.js-ai-submit-btn');
			const prompt = new FormData(form).get('prompt');
			if (!prompt || prompt.trim() === '') {
				alert('Please enter a prompt.');
				return;
			}
			setButtonLoadingState(submitBtn, true);
			const imageContainer = document.getElementById('js-image-container');
			const imgEl = imageContainer.querySelector('img');
			imageContainer.classList.add('opacity-50');
			try {
				const data = await window.api.generateCodexImage(entryId, prompt);
				if (!data.success) throw new Error(data.message || 'An unknown error occurred.');
				imgEl.src = data.image_url;
				closeModal(modal);
			} catch (error) {
				console.error('AI Image Generation Error:', error);
				alert('Failed to generate image: ' + error.message);
			} finally {
				setButtonLoadingState(submitBtn, false);
				imageContainer.classList.remove('opacity-50');
			}
		} else if (event.target.matches('.js-upload-form')) {
			event.preventDefault();
			const form = event.target;
			const modal = form.closest('.js-upload-modal');
			const submitBtn = form.querySelector('.js-upload-submit-btn');
			const filePath = form.dataset.filePath;
			if (!filePath) {
				alert('No file selected.');
				return;
			}
			setButtonLoadingState(submitBtn, true);
			const imageContainer = document.getElementById('js-image-container');
			const imgEl = imageContainer.querySelector('img');
			imageContainer.classList.add('opacity-50');
			try {
				const data = await window.api.uploadCodexImage(entryId, filePath);
				if (!data.success) throw new Error(data.message || 'Upload failed.');
				imgEl.src = data.image_url;
				closeModal(modal);
			} catch (error) {
				console.error('Image Upload Error:', error);
				alert('Failed to upload image: ' + error.message);
			} finally {
				setButtonLoadingState(submitBtn, false);
				imageContainer.classList.remove('opacity-50');
			}
		}
	});
	
	document.body.addEventListener('click', async (event) => {
		if (!event.target.matches('.js-trigger-file-input')) return;
		const button = event.target;
		const form = button.closest('form');
		const filePath = await window.api.showOpenImageDialog();
		if (filePath) {
			const previewContainer = form.querySelector('.js-image-preview-container');
			const previewImg = form.querySelector('.js-image-preview');
			const fileNameSpan = form.querySelector('.js-file-name');
			const submitBtn = form.querySelector('button[type="submit"]');
			form.dataset.filePath = filePath;
			const response = await fetch(`file://${filePath}`);
			const blob = await response.blob();
			const reader = new FileReader();
			reader.readAsDataURL(blob);
			reader.onloadend = () => {
				previewImg.src = reader.result;
				previewContainer.classList.remove('hidden');
			};
			fileNameSpan.textContent = filePath.split(/[\\/]/).pop();
			submitBtn.disabled = false;
		}
	});
}

// --- Mode-Specific Setup Functions ---

/**
 * NEW: Configures the editor window for creating a new codex entry.
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
	document.querySelector('.js-codex-upload-image').classList.add('hidden');
	document.querySelector('.js-codex-generate-ai').classList.add('hidden');
	
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
		document.querySelector('#js-image-container img').src = entryData.image_url;
		
		const sourceContainer = document.getElementById('js-pm-content-source');
		sourceContainer.querySelector('[data-name="content"]').innerHTML = entryData.content || '';
		
		setupContentEditor({ entryId }); // Pass entryId to enable debounced saving
		setupTopToolbar({ isCodexEditor: true, getEditorView: getCodexEditorView });
		setupPromptEditor();
		setupImageHandlers(entryId);
		
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
