import { initI18n, t, applyTranslationsTo } from './i18n.js';

/**
 * Truncates HTML content to a specific word limit.
 * @param {string} html - The HTML string to truncate.
 * @param {number} wordLimit - The maximum number of words.
 * @returns {string} The truncated (or original) HTML.
 */
const truncateHtml = (html, wordLimit) => {
	if (!html) return '';
	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = html;
	const text = tempDiv.textContent || tempDiv.innerText || '';
	const words = text.trim().split(/\s+/).filter(Boolean);
	if (words.length > wordLimit) {
		return `<p>${words.slice(0, wordLimit).join(' ')}...</p>`;
	}
	return html;
};

/**
 * Renders the entire novel outline into the specified container.
 * @param {HTMLElement} container - The container element for the outline.
 * @param {Array<object>} sections - The array of section data.
 */
async function renderOutline(container, sections) {
	if (!sections || sections.length === 0) {
		container.innerHTML = `<p class="text-base-content/70">${t('outline.noSections')}</p>`;
		return;
	}
	
	const sectionTemplate = await window.api.getTemplate('outline/outline-viewer-section');
	const chapterTemplate = await window.api.getTemplate('outline/outline-viewer-chapter-item');
	
	const fragment = document.createDocumentFragment();
	
	for (const section of sections) {
		const chapterLabel = section.chapter_count === 1 ? t('outline.chapterLabel_one') : t('outline.chapterLabel_other');
		const chapterCountText = `${section.chapter_count} ${chapterLabel}`;
		const chapterStats = `${chapterCountText} - ${section.total_word_count.toLocaleString()} ${t('common.words')}`;
		
		let sectionHtml = sectionTemplate
			.replace('{{SECTION_ID}}', section.id)
			.replace('{{SECTION_ORDER}}', section.section_order)
			.replace('{{SECTION_TITLE}}', section.title)
			.replace('{{SECTION_DESCRIPTION}}', section.description || '')
			.replace('{{CHAPTER_STATS}}', chapterStats);
		
		const sectionEl = document.createElement('div');
		sectionEl.innerHTML = sectionHtml;
		const chaptersContainer = sectionEl.querySelector('.js-chapters-container');
		
		if (section.chapters && section.chapters.length > 0) {
			for (const chapter of section.chapters) {
				const summaryHtml = chapter.summary || `<p class="italic text-base-content/60">${t('outline.noSummary')}</p>`;
				const chapterHtml = chapterTemplate
					.replace(/{{CHAPTER_ID}}/g, chapter.id)
					.replace('{{CHAPTER_ORDER}}', chapter.chapter_order)
					.replace('{{CHAPTER_TITLE}}', chapter.title)
					.replace('{{WORD_COUNT}}', chapter.word_count.toLocaleString())
					.replace('{{CHAPTER_SUMMARY_HTML}}', summaryHtml);
				
				chaptersContainer.innerHTML += chapterHtml;
			}
		} else {
			chaptersContainer.innerHTML = `<p class="text-base-content/70 text-sm">${t('outline.noChapters')}</p>`;
		}
		fragment.appendChild(sectionEl.firstElementChild);
	}
	container.appendChild(fragment);
}

/**
 * Renders all codex entries, grouped by category, into the specified container.
 * @param {HTMLElement} container - The container element for the codex list.
 * @param {Array<object>} categories - The array of category data.
 */
async function renderCodex(container, categories) {
	if (!categories || categories.length === 0) {
		container.innerHTML = `<p class="text-base-content/70">${t('outline.noCodexEntries')}</p>`;
		return;
	}
	
	const categoryTemplate = await window.api.getTemplate('outline/outline-viewer-codex-category');
	const entryTemplate = await window.api.getTemplate('outline/outline-viewer-codex-item');
	
	const fragment = document.createDocumentFragment();
	
	for (const category of categories) {
		let categoryHtml = categoryTemplate
			.replace('{{CATEGORY_ID}}', category.id)
			.replace('{{CATEGORY_NAME}}', category.name);
		
		const categoryEl = document.createElement('div');
		categoryEl.innerHTML = categoryHtml;
		const entriesContainer = categoryEl.querySelector('.js-entries-container');
		
		if (category.entries && category.entries.length > 0) {
			for (const entry of category.entries) {
				const entryHtml = entryTemplate
					.replace(/{{ENTRY_ID}}/g, entry.id)
					.replace(/{{ENTRY_TITLE}}/g, entry.title)
					.replace('{{CONTENT_HTML}}', truncateHtml(entry.content, 30));
				
				entriesContainer.innerHTML += entryHtml;
			}
		} else {
			entriesContainer.innerHTML = `<p class="text-base-content/70 text-sm col-span-full">${t('outline.noEntriesInCategory')}</p>`;
		}
		fragment.appendChild(categoryEl.firstElementChild);
	}
	container.appendChild(fragment);
}

document.addEventListener('DOMContentLoaded', async () => {
	await initI18n();
	
	// Added: Refresh button listener
	const refreshBtn = document.getElementById('js-refresh-page-btn');
	if (refreshBtn) {
		refreshBtn.addEventListener('click', () => {
			window.location.reload();
		});
	}
	
	const params = new URLSearchParams(window.location.search);
	const novelId = params.get('novelId');
	
	const novelTitleEl = document.getElementById('js-novel-title');
	const outlineContainer = document.getElementById('js-outline-container');
	const codexContainer = document.getElementById('js-codex-container');
	
	if (!novelId) {
		document.body.innerHTML = `<p class="text-error p-8">${t('outline.errorProjectMissing')}</p>`;
		return;
	}
	
	let isAutogenRunning = false;
	
	async function setupAutogenCodex(novelId) {
		const autogenBtn = document.getElementById('js-autogen-codex');
		const modal = document.getElementById('autogen-codex-modal');
		const modalContent = document.getElementById('js-autogen-codex-modal-content');
		
		if (!autogenBtn || !modal || !modalContent) return;
		
		autogenBtn.addEventListener('click', async () => {
			try {
				// Load template and populate models
				modalContent.innerHTML = await window.api.getTemplate('outline/autogen-codex-modal');
				applyTranslationsTo(modalContent);
				const select = modalContent.querySelector('.js-llm-model-select');
				const result = await window.api.getModels();
				if (result.success && result.models.length > 0) {
					select.innerHTML = '';
					
					const modelGroups = result.models;
					modelGroups.forEach(group => {
						const optgroup = document.createElement('optgroup');
						optgroup.label = group.group;
						group.models.forEach(model => {
							const option = new Option(model.name, model.id);
							optgroup.appendChild(option);
						});
						select.appendChild(optgroup);
					});
					
					const defaultModel = 'openai/gpt-4o';
					const allModels = modelGroups.flatMap(g => g.models);
					if (allModels.some(m => m.id === defaultModel)) {
						select.value = defaultModel;
					}
				} else {
					select.innerHTML = `<option>${t('outline.autoGenModal.errorLoadModels')}</option>`;
				}
				modal.showModal();
			} catch (error) {
				console.error('Failed to open autogen modal:', error);
				modalContent.innerHTML = `<p class="text-error">${t('outline.autoGenModal.errorLoadTool', { message: error.message })}</p>`;
				modal.showModal();
			}
		});
		
		modalContent.addEventListener('submit', (event) => {
			event.preventDefault();
			const form = event.target;
			if (!form) return;
			
			const model = form.querySelector('.js-llm-model-select').value;
			if (!model) {
				alert(t('outline.autoGenModal.alertSelectModel'));
				return;
			}
			
			// Update UI to show progress
			const actionButtons = form.querySelector('#js-autogen-action-buttons');
			const progressSection = form.querySelector('#js-autogen-progress-section');
			const cancelBtn = modal.querySelector('.js-autogen-cancel-btn');
			
			if (actionButtons) actionButtons.classList.add('hidden');
			if (progressSection) progressSection.classList.remove('hidden');
			if (cancelBtn) cancelBtn.textContent = t('common.close');
			
			// Start the backend process and set the flag
			window.api.startCodexAutogen({ novelId, model });
			isAutogenRunning = true;
		});
		
		// Listen for progress updates from the main process
		window.api.onCodexAutogenUpdate((event, { progress, status, statusKey, statusParams }) => {
			const progressBar = document.getElementById('js-autogen-progress-bar');
			const statusText = document.getElementById('js-autogen-status-text');
			
			if (progressBar) progressBar.value = progress;
			if (statusText) {
				statusText.textContent = statusKey ? t(statusKey, statusParams || {}) : status;
			}
			
			if (progress >= 100) {
				isAutogenRunning = false; // Reset the flag when the process is complete
				setTimeout(() => {
					if (modal.open) {
						modal.close();
					}
					// Only reload if the process didn't end in an error state
					if (!status.toLowerCase().includes('error')) {
						window.location.reload(); // Reload to see the new entries
					}
				}, 2000);
			}
		});
	}
	
	try {
		const data = await window.api.getOutlineData(novelId);
		
		document.title = data.novel_title;
		novelTitleEl.textContent = data.novel_title;
		
		await renderOutline(outlineContainer, data.sections);
		await renderCodex(codexContainer, data.codex_categories);
		
		applyTranslationsTo(outlineContainer);
		applyTranslationsTo(codexContainer);
		
		const addCodexBtn = document.getElementById('js-add-codex-entry');
		if (addCodexBtn) {
			addCodexBtn.addEventListener('click', () => {
				window.api.openNewCodexEditor({ novelId, selectedText: '' });
			});
		}
		
		setupAutogenCodex(novelId);
		
		document.body.addEventListener('click', (event) => {
			const editBtn = event.target.closest('.js-edit-chapter');
			if (editBtn) {
				const novelId = params.get('novelId');
				const chapterId = editBtn.dataset.chapterId;
				window.api.openChapterEditor({ novelId, chapterId });
			}
			
			const editCodexBtn = event.target.closest('.js-edit-codex-entry');
			if (editCodexBtn) {
				const entryId = editCodexBtn.dataset.entryId;
				window.api.openCodexEditor(entryId);
			}
		});
		
		let initialState = null;
		try {
			initialState = await window.api.getOutlineState(novelId);
		} catch (e) {
			console.error('Could not get initial outline state for refresh check.', e);
		}
		
		const checkForUpdates = async () => {
			if (isAutogenRunning) {
				console.log('Auto-generation in progress, skipping outline refresh check.');
				return;
			}
			
			if (document.hidden || !initialState || !initialState.success) {
				return;
			}
			try {
				const currentState = await window.api.getOutlineState(novelId);
				if (currentState.success) {
					if (currentState.chapterCount !== initialState.chapterCount || currentState.codexCount !== initialState.codexCount) {
						console.log('Changes detected, reloading outline viewer.');
						window.location.reload();
					}
				}
			} catch (error) {
				console.error('Error checking for outline updates:', error);
			}
		};
		
		setInterval(checkForUpdates, 5000);
		
	} catch (error) {
		console.error('Failed to load outline data:', error);
		document.body.innerHTML = `<p class="text-error p-8">${t('outline.errorLoad', { message: error.message })}</p>`;
	}
});
