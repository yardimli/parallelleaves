import WindowManager from './WindowManager.js';
import {
	setupCodexEntryHandler,
	setupChapterHandler,
	setupOpenWindowsMenu,
	setupCanvasControls,
} from './eventHandlers.js';
import {setupChapterEditor} from './planner-chapter-editor.js';
import {setupContentEditor} from './content-editor.js';
import {setupTopToolbar} from './toolbar.js';
import { setupPromptEditor } from '../prompt-editor.js';
import './planner-codex-events.js'; // Import for side-effects (attaches event listeners)
import './planner-chapter-creation.js'; // Import for new chapter modal logic
import { setupChapterPovEditor } from './planner-chapter-pov-editor.js'; // Import for POV editor logic

// NEW: Helper to count words in an HTML string.
const countWordsInHtml = (html) => {
	if (!html) return 0;
	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = html;
	const text = tempDiv.textContent || tempDiv.innerText || '';
	const words = text.trim().split(/\s+/).filter(Boolean);
	return words.length;
};


/**
 * Populates the outline window template with novel data using templates.
 * @param {string} template - The raw HTML template string for the outline window.
 * @param {object} novelData - The full novel data object.
 * @returns {Promise<string>} - The populated HTML string.
 */
async function populateOutlineTemplate(template, novelData) {
	if (!novelData.sections || novelData.sections.length === 0) {
		return '<p class="text-center text-base-content/70 p-4">No sections found for this novel.</p>';
	}
	
	const sectionTemplateHtml = await window.api.getTemplate('planner/outline-section');
	const chapterTemplateHtml = await window.api.getTemplate('planner/outline-chapter');
	
	const stripHtmlAndTruncate = (html, wordLimit) => {
		if (!html) return '';
		const tempDiv = document.createElement('div');
		tempDiv.innerHTML = html;
		const text = tempDiv.textContent || tempDiv.innerText || '';
		const words = text.trim().split(/\s+/).filter(Boolean);
		if (words.length > wordLimit) {
			return words.slice(0, wordLimit).join(' ') + '...';
		}
		return words.join(' ');
	};
	
	const sectionsHtml = novelData.sections.map(section => {
		let sectionTotalWords = 0; // NEW: Initialize section word count.
		const chaptersHtml = section.chapters && section.chapters.length > 0
			? section.chapters.map(chapter => {
				const summaryText = stripHtmlAndTruncate(chapter.summary, 40);
				const summaryHtml = summaryText ? `<p class="text-xs text-base-content/70 mt-1 font-normal normal-case">${summaryText}</p>` : '';
				
				// NEW: Calculate word count for the chapter and add to section total.
				const wordCount = countWordsInHtml(chapter.content);
				sectionTotalWords += wordCount;
				
				return chapterTemplateHtml
					.replace('{{CHAPTER_ID}}', chapter.id)
					.replace(/{{CHAPTER_TITLE}}/g, chapter.title)
					.replace('{{CHAPTER_ORDER}}', chapter.chapter_order)
					.replace('{{CHAPTER_SUMMARY_HTML}}', summaryHtml)
					.replace('{{WORD_COUNT}}', wordCount.toLocaleString()); // NEW: Populate word count.
			}).join('')
			: '<p class="text-sm text-base-content/70 px-2">No chapters in this section yet.</p>';
		
		// NEW: Format stats for the section header.
		const chapterCount = section.chapters ? section.chapters.length : 0;
		const chapterCountText = chapterCount === 1 ? '1 chapter' : `${chapterCount} chapters`;
		const chapterStats = `${chapterCountText} &ndash; ${sectionTotalWords.toLocaleString()} words`;
		
		const descriptionHtml = section.description ? `<p class="text-sm italic text-base-content/70 mt-1">${section.description}</p>` : '';
		return sectionTemplateHtml
			.replace('{{SECTION_ID}}', section.id)
			.replace('{{SECTION_ORDER}}', section.section_order)
			.replace('{{SECTION_TITLE}}', section.title)
			.replace('{{SECTION_DESCRIPTION_HTML}}', descriptionHtml)
			.replace('<!-- CHAPTERS_PLACEHOLDER -->', chaptersHtml)
			.replace('{{CHAPTER_STATS}}', chapterStats); // NEW: Populate section stats.
	}).join('');
	
	return template.replace('<!-- SECTIONS_PLACEHOLDER -->', sectionsHtml);
}

/**
 * Populates the codex window template with novel data using templates.
 * @param {string} template - The raw HTML template string for the codex window.
 * @param {object} novelData - The full novel data object.
 * @returns {Promise<string>} - The populated HTML string.
 */
async function populateCodexTemplate(template, novelData) {
	if (!novelData.codexCategories || novelData.codexCategories.length === 0) {
		return '<p class="text-center text-base-content/70 p-4">No codex categories found.</p>';
	}
	
	const categoryTemplateHtml = await window.api.getTemplate('planner/codex-category-item');
	const entryTemplateHtml = await window.api.getTemplate('planner/codex-list-item');
	
	const categoriesHtml = novelData.codexCategories.map(category => {
		const entriesHtml = category.entries && category.entries.length > 0
			? category.entries.map(entry => {
				return entryTemplateHtml
					.replace(/{{ENTRY_ID}}/g, entry.id)
					.replace(/{{ENTRY_TITLE}}/g, entry.title)
			}).join('')
			: '<p class="text-sm text-base-content/70 px-2">No entries in this category yet.</p>';
		
		const itemCount = category.entries_count || 0;
		const itemText = itemCount === 1 ? 'item' : 'items';
		
		let populatedCategory = categoryTemplateHtml
			.replace('{{CATEGORY_ID}}', category.id)
			.replace('{{CATEGORY_NAME}}', category.name);
		
		// Replace the count placeholder.
		populatedCategory = populatedCategory.replace(
			'<span class="js-codex-category-count text-sm font-normal text-base-content/70 ml-2">(0 items)</span>',
			`<span class="js-codex-category-count text-sm font-normal text-base-content/70 ml-2">(${itemCount} ${itemText})</span>`
		);
		
		// Replace the entries list placeholder.
		populatedCategory = populatedCategory.replace(
			'<p class="text-sm text-base-content/70 px-2">No entries in this category yet.</p>',
			entriesHtml
		);
		
		return populatedCategory;
	}).join('');
	
	return template.replace('<!-- CATEGORIES_PLACEHOLDER -->', categoriesHtml);
}

/**
 * Initializes the novel editor's multi-window desktop environment.
 */
document.addEventListener('DOMContentLoaded', async () => {
	const viewport = document.getElementById('viewport');
	const desktop = document.getElementById('desktop');
	const taskbar = document.getElementById('taskbar');
	
	const params = new URLSearchParams(window.location.search);
	const novelId = params.get('novelId');
	
	if (!viewport || !desktop || !taskbar || !novelId) {
		console.error('Essential novel editor elements or novelId are missing.');
		document.body.innerHTML = '<p class="text-error p-8">Error: Could not load editor. Novel ID is missing.</p>';
		return;
	}
	
	document.body.dataset.novelId = novelId;
	
	let novelData;
	
	try {
		const outlineTemplateHtml = await window.api.getTemplate('planner/outline-window');
		const codexTemplateHtml = await window.api.getTemplate('planner/codex-window');
		
		novelData = await window.api.getOneNovel(novelId);
		if (!novelData) throw new Error('Novel not found.');
		
		document.body.dataset.outlineContent = await populateOutlineTemplate(outlineTemplateHtml, novelData);
		document.body.dataset.codexContent = await populateCodexTemplate(codexTemplateHtml, novelData);
		
		// Populate the "New Chapter" modal's position dropdown
		const chapterPositionSelect = document.getElementById('new-chapter-position');
		if (chapterPositionSelect) {
			novelData.sections.forEach(section => {
				const sectionOption = new Option(`${section.title}`, `section-${section.id}`);
				sectionOption.classList.add('font-bold', 'text-indigo-500');
				chapterPositionSelect.appendChild(sectionOption);
				
				// Add options for each chapter within the section
				if (section.chapters && section.chapters.length > 0) {
					section.chapters.forEach(chapter => {
						const chapterOption = new Option(`  ${chapter.chapter_order}. ${chapter.title}`, `chapter-${chapter.id}`);
						chapterPositionSelect.appendChild(chapterOption);
					});
				}
			});
		}
		
		// Store the editor state on the body for the WindowManager to find
		document.body.dataset.editorState = JSON.stringify(novelData.editor_state || null);
		document.title = `Planning: ${novelData.title}`;
		
	} catch (error) {
		console.error('Failed to load initial novel data:', error);
		document.body.innerHTML = `<p class="text-error p-8">Error: Could not load novel data. ${error.message}</p>`;
		return;
	}
	
	const windowManager = new WindowManager(desktop, taskbar, novelId, viewport, novelData);
	
	windowManager.initCanvas();
	windowManager.loadState();
	
	// Initialize event handlers for various UI interactions.
	setupTopToolbar();
	setupCodexEntryHandler(desktop, windowManager);
	setupChapterHandler(desktop, windowManager);
	setupChapterEditor(desktop);
	setupContentEditor(desktop);
	setupOpenWindowsMenu(windowManager);
	setupCanvasControls(windowManager);
	setupChapterPovEditor(desktop);
	setupPromptEditor();
});
