// NEW: Entry point for the dedicated outline viewer window.

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
		container.innerHTML = '<p class="text-base-content/70">No sections in this project yet.</p>';
		return;
	}
	
	const sectionTemplate = await window.api.getTemplate('outline/outline-viewer-section');
	const chapterTemplate = await window.api.getTemplate('outline/outline-viewer-chapter-item');
	const tagTemplate = await window.api.getTemplate('outline/chapter-codex-tag-readonly');
	
	const fragment = document.createDocumentFragment();
	
	for (const section of sections) {
		const chapterCountText = section.chapter_count === 1 ? '1 chapter' : `${section.chapter_count} chapters`;
		const chapterStats = `${chapterCountText} - ${section.total_word_count.toLocaleString()} words`;
		
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
				const tagsHtml = chapter.linked_codex.map(entry =>
					tagTemplate
						.replace(/{{ENTRY_ID}}/g, entry.id)
						.replace(/{{ENTRY_TITLE}}/g, entry.title)
				).join('');
				
				// MODIFIED: Removed the replacement for POV_TYPE and POV_CHARACTER.
				const chapterHtml = chapterTemplate
					.replace(/{{CHAPTER_ID}}/g, chapter.id)
					.replace('{{CHAPTER_ORDER}}', chapter.chapter_order)
					.replace('{{CHAPTER_TITLE}}', chapter.title)
					.replace('{{WORD_COUNT}}', chapter.word_count.toLocaleString())
					.replace('{{CHAPTER_SUMMARY_HTML}}', chapter.summary || '<p class="italic text-base-content/60">No summary.</p>')
					.replace('{{TAGS_WRAPPER_HIDDEN}}', tagsHtml ? '' : 'hidden')
					.replace('{{CODEX_TAGS_HTML}}', tagsHtml);
				
				chaptersContainer.innerHTML += chapterHtml;
			}
		} else {
			chaptersContainer.innerHTML = '<p class="text-base-content/70 text-sm">No chapters in this section yet.</p>';
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
		container.innerHTML = '<p class="text-base-content/70">No codex entries in this project yet.</p>';
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
			entriesContainer.innerHTML = '<p class="text-base-content/70 text-sm col-span-full">No entries in this category yet.</p>';
		}
		fragment.appendChild(categoryEl.firstElementChild);
	}
	container.appendChild(fragment);
}


document.addEventListener('DOMContentLoaded', async () => {
	const params = new URLSearchParams(window.location.search);
	const novelId = params.get('novelId');
	
	const novelTitleEl = document.getElementById('js-novel-title');
	const outlineContainer = document.getElementById('js-outline-container');
	const codexContainer = document.getElementById('js-codex-container');
	
	if (!novelId) {
		document.body.innerHTML = '<p class="text-error p-8">Error: Project ID is missing.</p>';
		return;
	}
	
	try {
		const data = await window.api.getOutlineData(novelId);
		
		document.title = `Outline: ${data.novel_title}`;
		novelTitleEl.textContent = `Outline: ${data.novel_title}`;
		
		await renderOutline(outlineContainer, data.sections);
		await renderCodex(codexContainer, data.codex_categories);
		
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
		
	} catch (error) {
		console.error('Failed to load outline data:', error);
		document.body.innerHTML = `<p class="text-error p-8">Error: Could not load outline data. ${error.message}</p>`;
	}
});
