import { setupTopToolbar, setActiveContentWindow, updateToolbarState, createIframeEditorInterface } from './toolbar.js';
import { setupPromptEditor, openPromptEditor } from '../prompt-editor.js';
import { setupTypographySettings, getTypographySettings, generateTypographyStyleProperties } from './typography-settings.js';
import { initI18n, t } from '../i18n.js';
import { processSourceContentForCodexLinks, processSourceContentForMarkers } from '../../utils/html-processing.js';

const debounce = (func, delay) => {
	let timeout;
	return function(...args) {
		const context = this;
		clearTimeout(timeout);
		timeout = setTimeout(() => func.apply(context, args), delay);
	};
};

let activeChapterId = null;
let isScrollingProgrammatically = false;
const chapterEditorViews = new Map();
let currentSourceSelection = { text: '', hasSelection: false, range: null };
let lastBroadcastedSourceSelectionState = false; // NEW: Track the last broadcasted state
let allCodexEntriesForNovel = [];

// Globals to manage view initialization and prevent race conditions.
let totalIframes = 0;
let iframesReadyCount = 0;
let viewInitialized = false;

let activeEditor = null;
const getActiveEditor = () => activeEditor;
const setActiveEditor = (editorWindow) => {
	activeEditor = editorWindow;
};

// Search state variables
let globalSearchMatches = [];
let currentMatchIndex = -1;
let searchResponsesPending = 0;

/**
 * Synchronizes the scroll position of a chapter between the source and target columns.
 * @param {string} chapterId - The ID of the chapter to sync.
 * @param {string} direction - 'source-to-target' or 'target-to-source'.
 */
function syncChapterScroll(chapterId, direction) {
	const sourceChapterEl = document.getElementById(`source-chapter-scroll-target-${chapterId}`);
	const targetChapterEl = document.getElementById(`target-chapter-scroll-target-${chapterId}`);
	const sourceContainer = document.getElementById('js-source-column-container');
	const targetContainer = document.getElementById('js-target-column-container');
	
	if (!sourceChapterEl || !targetChapterEl || !sourceContainer || !targetContainer) {
		console.warn(`Could not find elements for chapter scroll sync: ${chapterId}`);
		return;
	}
	
	let sourceEl, targetEl, sourceWrapper, targetWrapper;
	
	if (direction === 'source-to-target') {
		sourceEl = sourceContainer;
		targetEl = targetContainer;
		sourceWrapper = sourceChapterEl;
		targetWrapper = targetChapterEl;
	} else {
		sourceEl = targetContainer;
		targetEl = sourceContainer;
		sourceWrapper = targetChapterEl;
		targetWrapper = sourceChapterEl;
	}
	
	// Calculate the relative position of the source chapter's top within its container
	const sourceContainerRect = sourceEl.getBoundingClientRect();
	const sourceWrapperRect = sourceWrapper.getBoundingClientRect();
	const relativeTop = sourceWrapperRect.top - sourceContainerRect.top;
	
	// Calculate the absolute position of the target chapter's top
	const targetContainerRect = targetEl.getBoundingClientRect();
	const targetWrapperRect = targetWrapper.getBoundingClientRect();
	const targetAbsoluteTop = targetWrapperRect.top;
	
	// Calculate the desired scroll position for the target container
	// We want the target chapter's top to be at the same relative position as the source chapter's top
	const desiredScrollTop = targetEl.scrollTop + (targetAbsoluteTop - targetContainerRect.top) - relativeTop;
	
	targetEl.scrollTo({
		top: desiredScrollTop,
		behavior: 'smooth'
	});
}

const debouncedContentSave = debounce(async ({ chapterId, field, value }) => {
	if (field === 'target_content') {
		const tempDiv = document.createElement('div');
		tempDiv.innerHTML = value;
		const wordCount = tempDiv.textContent.trim().split(/\s+/).filter(Boolean).length;
		const chapterItem = document.getElementById(`target-chapter-scroll-target-${chapterId}`);
		if (chapterItem) {
			const wordCountEl = chapterItem.querySelector('.js-target-word-count');
			if (wordCountEl) {
				wordCountEl.textContent = `${wordCount.toLocaleString()} ${t('common.words')}`;
			}
		}
	}
	
	try {
		await window.api.updateChapterField({ chapterId, field, value });
	} catch (error) {
		console.error(`[SAVE] Error saving ${field} for chapter ${chapterId}:`, error);
		window.showAlert(`Could not save ${field} changes.`); // This is not translated as it's a developer-facing error.
	}
}, 1000); // 2 second delay

const debouncedSaveScroll = debounce((novelId, sourceEl, targetEl) => {
	// Don't save scroll position until the view has been fully initialized and restored.
	if (!novelId || !sourceEl || !targetEl || viewInitialized === false) return;
	const positions = {
		source: sourceEl.scrollTop,
		target: targetEl.scrollTop,
	};
	localStorage.setItem(`scroll-position-${novelId}`, JSON.stringify(positions));
}, 500);

/**
 * @param {string} novelId - The ID of the current novel.
 * @param {HTMLElement} sourceEl - The source column container element.
 * @param {HTMLElement} targetEl - The target column container element.
 * @returns {boolean} - True if positions were found and restored, false otherwise.
 */
function restoreScrollPositions(novelId, sourceEl, targetEl) {
	const saved = localStorage.getItem(`scroll-position-${novelId}`);
	if (saved) {
		try {
			const positions = JSON.parse(saved);
			if (positions.source) {
				sourceEl.scrollTop = positions.source;
			}
			if (positions.target) {
				targetEl.scrollTop = positions.target;
			}
			console.log('Scroll positions restored.', positions);
			return true; // Indicate that restoration was successful.
		} catch (e) {
			console.error('Failed to parse saved scroll positions:', e);
			localStorage.removeItem(`scroll-position-${novelId}`); // Clear corrupted data
		}
	}
	return false; // Indicate no saved positions were found or they were corrupt.
}

/**
 * Re-renders a single chapter's source content with codex and marker links.
 * @param {string} chapterId - The ID of the chapter to render.
 * @param {string} rawHtml - The raw HTML content to process and render.
 * @param {Array<object>} allCodexEntries - All codex entries for the novel.
 */
async function renderSourceChapterContent(chapterId, rawHtml, allCodexEntries) {
	const chapterItem = document.getElementById(`source-chapter-scroll-target-${chapterId}`);
	if (!chapterItem) return;
	
	const contentContainer = chapterItem.querySelector('.source-content-readonly');
	if (!contentContainer) return;
	
	let processedSourceHtml = processSourceContentForCodexLinks(rawHtml || '', allCodexEntries);
	processedSourceHtml = processSourceContentForMarkers(processedSourceHtml);
	contentContainer.innerHTML = processedSourceHtml;
}

/**
 * Toggles the edit mode for a source chapter content area.
 * @param {string} chapterId - The ID of the chapter.
 * @param {boolean} isEditing - True to enter edit mode, false to cancel/revert.
 */
async function toggleSourceEditMode(chapterId, isEditing) {
	const chapterItem = document.getElementById(`source-chapter-scroll-target-${chapterId}`);
	if (!chapterItem) return;
	
	const actionsContainer = chapterItem.querySelector('.js-source-actions');
	const contentContainer = chapterItem.querySelector('.source-content-readonly');
	if (!actionsContainer || !contentContainer) return;
	
	const editBtn = actionsContainer.querySelector('.js-edit-source-btn');
	const saveBtn = actionsContainer.querySelector('.js-save-source-btn');
	const cancelBtn = actionsContainer.querySelector('.js-cancel-source-btn');
	
	editBtn.classList.toggle('hidden', isEditing);
	saveBtn.classList.toggle('hidden', !isEditing);
	cancelBtn.classList.toggle('hidden', !isEditing);
	
	if (isEditing) {
		const rawContent = await window.api.getRawChapterContent({ chapterId, field: 'source_content' });
		contentContainer.contentEditable = true;
		contentContainer.innerHTML = rawContent || '';
		contentContainer.focus();
	} else { // This is the "cancel" case, reverting to original content
		contentContainer.contentEditable = false;
		const rawContent = await window.api.getRawChapterContent({ chapterId, field: 'source_content' });
		await renderSourceChapterContent(chapterId, rawContent, allCodexEntriesForNovel);
	}
}

/**
 * Saves the edited source content for a chapter.
 * @param {string} chapterId - The ID of the chapter to save.
 */
async function saveSourceChanges(chapterId) {
	const chapterItem = document.getElementById(`source-chapter-scroll-target-${chapterId}`);
	if (!chapterItem) return;
	
	const contentContainer = chapterItem.querySelector('.source-content-readonly');
	const actionsContainer = chapterItem.querySelector('.js-source-actions');
	if (!contentContainer || !actionsContainer) return;
	
	const newContent = contentContainer.innerHTML;
	
	try {
		await window.api.updateChapterField({ chapterId, field: 'source_content', value: newContent });
		
		// Update word count display
		const tempDiv = document.createElement('div');
		tempDiv.innerHTML = newContent;
		const wordCount = tempDiv.textContent.trim().split(/\s+/).filter(Boolean).length;
		const wordCountEl = chapterItem.querySelector('.js-source-word-count');
		if (wordCountEl) {
			wordCountEl.textContent = `${wordCount.toLocaleString()} ${t('common.words')}`;
		}
		
		// Manually revert UI to non-editing state
		contentContainer.contentEditable = false;
		actionsContainer.querySelector('.js-edit-source-btn').classList.remove('hidden');
		actionsContainer.querySelector('.js-save-source-btn').classList.add('hidden');
		actionsContainer.querySelector('.js-cancel-source-btn').classList.add('hidden');
		
		// Re-render with the new saved content to apply links
		await renderSourceChapterContent(chapterId, newContent, allCodexEntriesForNovel);
		
	} catch (error) {
		console.error(`[SAVE] Error saving source content for chapter ${chapterId}:`, error);
		window.showAlert('Could not save source content changes.');
	}
}

/**
 * function to synchronize translation markers on load.
 * Removes markers from the source text if they don't exist in the target text.
 * @param {string} chapterId - The ID of the chapter being processed.
 * @param {HTMLElement} sourceContainer - The DOM element containing the source HTML.
 * @param {string} targetHtml - The initial HTML content of the target.
 */
async function synchronizeMarkers(chapterId, sourceContainer, targetHtml) {
	const markerRegex = /\[\[#(\d+)\]\]/g;
	let sourceHtml = sourceContainer.innerHTML;
	
	const sourceMarkers = sourceHtml.match(markerRegex) || [];
	if (sourceMarkers.length === 0) {
		return; // No markers in source, nothing to do.
	}
	
	const targetMarkers = new Set(targetHtml.match(markerRegex) || []);
	
	let wasModified = false;
	const uniqueSourceMarkers = [...new Set(sourceMarkers)]; // Process each unique marker only once
	
	uniqueSourceMarkers.forEach(marker => {
		if (!targetMarkers.has(marker)) {
			// This marker exists in the source but not the target, so remove it.
			// Use a regex with the specific marker to replace all instances of it.
			const escapedMarker = marker.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
			const removalRegex = new RegExp(escapedMarker + '\\s*', 'g');
			sourceHtml = sourceHtml.replace(removalRegex, '');
			wasModified = true;
			console.log(`[Sync] Removing orphaned marker ${marker} from chapter ${chapterId}`);
		}
	});
	
	if (wasModified) {
		sourceContainer.innerHTML = sourceHtml;
		// Persist the cleaned-up source content to the database.
		try {
			await window.api.updateChapterField({
				chapterId: chapterId,
				field: 'source_content',
				value: sourceHtml
			});
		} catch (error) {
			console.error(`[Sync] Failed to save updated source content for chapter ${chapterId}:`, error);
		}
	}
}

/**
 * Renders the manuscript into two separate, independently scrolling columns.
 * @param {object} novelData - The full novel data.
 * @param {Array<object>} allCodexEntries - All codex entries for the novel.
 */
async function renderManuscript(novelData, allCodexEntries) {
	const sourceContainer = document.getElementById('js-source-column-container');
	const targetContainer = document.getElementById('js-target-column-container');
	
	const sourceFragment = document.createDocumentFragment();
	const targetFragment = document.createDocumentFragment();
	
	totalIframes = 0;
	
	for (const section of novelData.sections) {
		// Create and append section headers to both columns
		const sectionHeader = document.createElement('div');
		sectionHeader.className = 'px-8 py-6 top-0 bg-base-100/90 backdrop-blur-sm z-10 border-b border-base-300';
		sectionHeader.innerHTML = `<h2 class="text-3xl font-bold text-indigo-500">${section.section_order}. ${section.title}</h2>`;
		sourceFragment.appendChild(sectionHeader);
		targetFragment.appendChild(sectionHeader.cloneNode(true));
		
		if (!section.chapters || section.chapters.length === 0) {
			const noChaptersMessage = document.createElement('p');
			noChaptersMessage.className = 'px-8 py-6 text-base-content/60';
			noChaptersMessage.textContent = t('editor.noChaptersInSection');
			sourceFragment.appendChild(noChaptersMessage);
			targetFragment.appendChild(noChaptersMessage.cloneNode(true));
			continue;
		}
		
		for (const chapter of section.chapters) {
			// --- Source Column Chapter ---
			const sourceChapterWrapper = document.createElement('div');
			sourceChapterWrapper.id = `source-chapter-scroll-target-${chapter.id}`;
			sourceChapterWrapper.className = 'manuscript-chapter-item px-8 py-6'; // Class for observer
			sourceChapterWrapper.dataset.chapterId = chapter.id;
			
			const sourceCol = document.createElement('div');
			sourceCol.className = 'js-source-column prose prose-sm dark:prose-invert max-w-none bg-base-200 p-4 rounded-lg';
			
			const sourceHeader = document.createElement('div');
			sourceHeader.className = 'flex justify-between items-center border-b pb-1 mb-2';
			// MODIFICATION START: Add sync button to source header
			sourceHeader.innerHTML = `
                <div class="flex items-center gap-2">
                    <h3 class="!mt-0 text-sm font-semibold uppercase tracking-wider text-base-content/70">${chapter.title} (<span class="js-source-word-count">${chapter.source_word_count.toLocaleString()} ${t('common.words')}</span>)</h3>
                    <button class="js-sync-scroll-btn btn btn-ghost btn-xs btn-square" data-chapter-id="${chapter.id}" data-direction="source-to-target" data-i18n-title="editor.syncScrollSourceToTarget">
                        <i class="bi bi-arrow-right-circle"></i>
                    </button>
                </div>
                <div class="js-source-actions">
                    <button class="js-edit-source-btn btn btn-ghost btn-xs">${t('common.edit')}</button>
                    <button class="js-save-source-btn btn btn-success btn-xs hidden">${t('common.save')}</button>
                    <button class="js-cancel-source-btn btn btn-ghost btn-xs hidden">${t('common.cancel')}</button>
                </div>
            `;
			// MODIFICATION END
			sourceCol.appendChild(sourceHeader);
			
			const sourceContentContainer = document.createElement('div');
			sourceContentContainer.className = 'source-content-readonly';
			
			let processedSourceHtml = processSourceContentForCodexLinks(chapter.source_content || '', allCodexEntries);
			processedSourceHtml = processSourceContentForMarkers(processedSourceHtml);
			sourceContentContainer.innerHTML = processedSourceHtml;
			sourceCol.appendChild(sourceContentContainer);
			sourceChapterWrapper.appendChild(sourceCol);
			sourceFragment.appendChild(sourceChapterWrapper);
			
			// --- Target Column Chapter ---
			const targetChapterWrapper = document.createElement('div');
			targetChapterWrapper.id = `target-chapter-scroll-target-${chapter.id}`;
			targetChapterWrapper.className = 'px-8 py-6';
			targetChapterWrapper.dataset.chapterId = chapter.id;
			
			const targetCol = document.createElement('div');
			// MODIFICATION START: Restructure target header to include sync button
			targetCol.innerHTML = `
                <div class="flex justify-between items-center border-b pb-1 mb-2 pt-4">
                    <div class="flex items-center gap-2">
                        <h3 class="!mt-0 text-sm font-semibold uppercase tracking-wider text-base-content/70">${chapter.title} (<span class="js-target-word-count">${chapter.target_word_count.toLocaleString()} ${t('common.words')}</span>)</h3>
                        <button class="js-sync-scroll-btn btn btn-ghost btn-xs btn-square" data-chapter-id="${chapter.id}" data-direction="target-to-source" data-i18n-title="editor.syncScrollTargetToSource">
                            <i class="bi bi-arrow-left-circle"></i>
                        </button>
                    </div>
                </div>
            `;
			// MODIFICATION END
			
			const iframe = document.createElement('iframe');
			iframe.className = 'js-target-content-editable w-full border-0 min-h-[300px]';
			iframe.src = 'editor-iframe.html';
			iframe.dataset.chapterId = chapter.id;
			targetCol.appendChild(iframe);
			targetChapterWrapper.appendChild(targetCol);
			targetFragment.appendChild(targetChapterWrapper);
			
			const initialTargetContent = chapter.target_content || '';
			
			synchronizeMarkers(chapter.id, sourceContentContainer, initialTargetContent);
			
			totalIframes++;
			
			// Store iframe info and initialize it on load.
			const viewInfo = {
				iframe: iframe,
				contentWindow: iframe.contentWindow,
				isReady: false,
				initialContent: initialTargetContent,
				initialResizeComplete: false,
			};
			chapterEditorViews.set(chapter.id.toString(), viewInfo);
			
			iframe.addEventListener('load', () => {
				viewInfo.contentWindow = iframe.contentWindow;
				
				viewInfo.isReady = true;
				const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
				
				// Send typography settings on init
				const settings = getTypographySettings();
				const styleProps = generateTypographyStyleProperties(settings);
				viewInfo.contentWindow.postMessage({
					type: 'updateTypography',
					payload: { styleProps, settings }
				}, window.location.origin);
				
				// Send initialization data to the iframe
				iframe.contentWindow.postMessage({
					type: 'init',
					payload: {
						initialHtml: viewInfo.initialContent,
						isEditable: true,
						chapterId: chapter.id,
						field: 'target_content',
						theme: currentTheme,
						i18n: {}
					}
				}, window.location.origin);
			});
		}
	}
	
	sourceContainer.innerHTML = '';
	targetContainer.innerHTML = '';
	sourceContainer.appendChild(sourceFragment);
	targetContainer.appendChild(targetFragment);
}


/**
 * Sets up the intersection observer to track the active chapter in the source column.
 */
function setupIntersectionObserver() {
	const container = document.getElementById('js-source-column-container');
	const navDropdown = document.getElementById('js-chapter-nav-dropdown');
	
	const observer = new IntersectionObserver((entries) => {
		if (isScrollingProgrammatically) return;
		
		entries.forEach(entry => {
			if (entry.isIntersecting) {
				const chapterId = entry.target.dataset.chapterId;
				if (chapterId && chapterId !== activeChapterId) {
					activeChapterId = chapterId;
					navDropdown.value = chapterId;
				}
			}
		});
	}, {
		root: container,
		rootMargin: '-40% 0px -60% 0px',
		threshold: 0,
	});
	
	container.querySelectorAll('.manuscript-chapter-item').forEach(el => observer.observe(el));
}

/**
 * Populates and configures the navigation dropdown.
 * @param {object} novelData - The full novel data.
 */
function populateNavDropdown(novelData) {
	const navDropdown = document.getElementById('js-chapter-nav-dropdown');
	navDropdown.innerHTML = '';
	
	novelData.sections.forEach(section => {
		const optgroup = document.createElement('optgroup');
		optgroup.label = `${section.section_order}. ${section.title}`;
		if (section.chapters && section.chapters.length > 0) {
			section.chapters.forEach(chapter => {
				const option = new Option(
					chapter.title?.trim() ? ` ${chapter.title}` : `${chapter.chapter_order}. ...`,
					chapter.id
				);
				optgroup.appendChild(option);
			});
		}
		navDropdown.appendChild(optgroup);
	});
	
	navDropdown.addEventListener('change', () => {
		scrollToChapter(navDropdown.value);
	});
}

/**
 * Scrolls both manuscript columns to a specific chapter.
 * @param {string} chapterId - The ID of the chapter to scroll to.
 */
function scrollToChapter(chapterId) {
	const sourceTarget = document.getElementById(`source-chapter-scroll-target-${chapterId}`);
	const targetTarget = document.getElementById(`target-chapter-scroll-target-${chapterId}`);
	const sourceContainer = document.getElementById('js-source-column-container');
	const targetContainer = document.getElementById('js-target-column-container');
	
	isScrollingProgrammatically = true;
	
	if (sourceTarget && sourceContainer) {
		const containerRect = sourceContainer.getBoundingClientRect();
		const targetRect = sourceTarget.getBoundingClientRect();
		const offsetTop = targetRect.top - containerRect.top;
		// Scroll to 100px from the top of the container
		const scrollPosition = sourceContainer.scrollTop + offsetTop - 100;
		
		sourceContainer.scrollTo({
			top: scrollPosition,
			behavior: 'smooth'
		});
	}
	
	if (targetTarget && targetContainer) {
		const containerRect = targetContainer.getBoundingClientRect();
		const targetRect = targetTarget.getBoundingClientRect();
		const offsetTop = targetRect.top - containerRect.top;
		const scrollPosition = targetContainer.scrollTop + offsetTop - 100;
		
		targetContainer.scrollTo({
			top: scrollPosition,
			behavior: 'smooth'
		});
	}
	
	if (chapterId !== activeChapterId) {
		activeChapterId = chapterId;
	}
	
	setTimeout(() => {
		isScrollingProgrammatically = false;
	}, 1000); // Increased timeout to ensure smooth scroll completes
}

/**
 * Finds and scrolls to a specific translation marker in the target editor.
 * @param {string} chapterId - The ID of the chapter containing the marker.
 * @param {string} markerId - The numerical ID of the marker to find.
 */
function scrollToTargetMarker (chapterId, markerId) {
	// 1. Find the target chapter's iframe view info.
	const viewInfo = chapterEditorViews.get(chapterId.toString());
	if (!viewInfo || !viewInfo.isReady) {
		console.warn(`Iframe for chapter ${chapterId} is not ready or not found.`);
		return;
	}
	
	const markerText = `[[#${markerId}]]`;
	
	// 2. Send a message to the iframe, asking it to find the marker.
	// The iframe will find it, get its coordinates, and post a 'markerFound'
	// message back, which is handled by the main window's message listener to perform the scroll.
	viewInfo.contentWindow.postMessage({
		type: 'findAndScrollToText',
		payload: { text: markerText }
	}, window.location.origin);
}

// NEW: Function to scroll the source column to a specific marker.
/**
 * Finds and scrolls to a specific translation marker in the source column.
 * @param {string} markerId - The numerical ID of the marker to find.
 */
function scrollToSourceMarker(markerId) {
	const sourceContainer = document.getElementById('js-source-column-container');
	if (!sourceContainer) return;
	
	const markerLink = sourceContainer.querySelector(`.translation-marker-link[data-marker-id="${markerId}"]`);
	
	if (markerLink) {
		markerLink.scrollIntoView({ behavior: 'smooth', block: 'center' });
		
		// Add a temporary highlight for visual feedback. Uses the same class as active search results.
		markerLink.classList.add('search-highlight-active');
		setTimeout(() => {
			markerLink.classList.remove('search-highlight-active');
		}, 2000); // Highlight for 2 seconds
	} else {
		console.warn(`Source marker with ID ${markerId} not found.`);
	}
}


/**
 * Populates and configures the spellcheck language dropdown.
 */
async function setupSpellcheckDropdown() {
	const dropdown = document.getElementById('js-spellcheck-lang-dropdown');
	if (!dropdown) {
		console.error('[setupSpellcheckDropdown] Dropdown element not found.');
		return;
	}
	
	try {
		const availableLangs = await window.api.getAvailableSpellCheckerLanguages();
		const currentLang = await window.api.getCurrentSpellCheckerLanguage();
		
		dropdown.innerHTML = ''; // Clear "Loading..."
		
		// Add an option to disable spellchecking
		const disableOption = new Option('Disable Spellcheck', '');
		dropdown.appendChild(disableOption);
		
		const supportedLanguages = await window.api.getSupportedLanguages();
		availableLangs.sort().forEach(code => {
			const name = supportedLanguages[code] || code;
			const option = new Option(name, code);
			dropdown.appendChild(option);
		});
		
		if (currentLang) {
			dropdown.value = currentLang;
		} else {
			dropdown.value = ''; // Select "Disable" if none is active
		}
		
		dropdown.addEventListener('change', async () => {
			const selectedLang = dropdown.value;
			try {
				await window.api.setSpellCheckerLanguage(selectedLang);
				// A small notification could be added here in the future.
			} catch (error) {
				console.error('[Spellcheck] Error setting language:', error);
				window.showAlert('Could not set spellcheck language.');
			}
		});
		
	} catch (error) {
		console.error('[setupSpellcheckDropdown] Failed to initialize:', error);
		dropdown.innerHTML = `<option>${t('common.error')}</option>`;
		dropdown.disabled = true;
	}
}

// All search-related functionality is encapsulated here.
function setupSearch() {
	const searchBtn = document.getElementById('js-search-btn');
	const searchBar = document.getElementById('js-search-bar');
	const searchInput = document.getElementById('js-search-input');
	const searchCloseBtn = document.getElementById('js-search-close-btn');
	const searchPrevBtn = document.getElementById('js-search-prev-btn');
	const searchNextBtn = document.getElementById('js-search-next-btn');
	const searchResultsCount = document.getElementById('js-search-results-count');
	const searchScopeRadios = document.querySelectorAll('input[name="search-scope"]');
	
	const toggleSearchBar = (show) => {
		if (show) {
			searchBar.classList.remove('hidden');
			searchInput.focus();
			searchInput.select();
		} else {
			searchBar.classList.add('hidden');
			clearSearch();
		}
	};
	
	const clearHighlightsInSource = () => {
		const sourceContainer = document.getElementById('js-source-column-container');
		const marks = sourceContainer.querySelectorAll('mark.search-highlight');
		marks.forEach(mark => {
			const parent = mark.parentNode;
			parent.replaceChild(document.createTextNode(mark.textContent), mark);
			parent.normalize(); // Merges adjacent text nodes
		});
	};
	
	const clearSearch = () => {
		clearHighlightsInSource();
		chapterEditorViews.forEach(view => {
			if (view.isReady) {
				view.contentWindow.postMessage({ type: 'search:clear' }, window.location.origin);
			}
		});
		globalSearchMatches = [];
		currentMatchIndex = -1;
		searchResultsCount.textContent = '';
		searchPrevBtn.disabled = true;
		searchNextBtn.disabled = true;
	};
	
	const findAndHighlightInSource = (query) => {
		clearHighlightsInSource();
		if (!query) return [];
		
		const sourceContainer = document.getElementById('js-source-column-container');
		const matches = [];
		const walker = document.createTreeWalker(sourceContainer, NodeFilter.SHOW_TEXT, null, false);
		
		// First, collect all text nodes that contain a match without modifying the DOM.
		const nodesToProcess = [];
		let node;
		while (node = walker.nextNode()) {
			if (node.parentElement.closest('script, style')) continue;
			// Use a temporary regex to test for presence without advancing the global one.
			if (new RegExp(query, 'gi').test(node.textContent)) {
				nodesToProcess.push(node);
			}
		}
		
		// Now, iterate over the collected nodes and perform DOM modifications.
		nodesToProcess.forEach(textNode => {
			const text = textNode.textContent;
			const fragment = document.createDocumentFragment();
			let lastIndex = 0;
			// Use a fresh regex for each node to ensure correct state.
			const regex = new RegExp(query, 'gi');
			let match;
			
			while ((match = regex.exec(text)) !== null) {
				// Append text before the match
				if (match.index > lastIndex) {
					fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
				}
				// Create and append the highlighted mark
				const mark = document.createElement('mark');
				mark.className = 'search-highlight';
				mark.textContent = match[0];
				fragment.appendChild(mark);
				matches.push(mark); // Collect the mark element for navigation
				lastIndex = regex.lastIndex;
			}
			
			// Append any remaining text after the last match
			if (lastIndex < text.length) {
				fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
			}
			
			// Replace the original text node with the new fragment
			if (textNode.parentNode) {
				textNode.parentNode.replaceChild(fragment, textNode);
			}
		});
		
		return matches;
	};
	
	const updateSearchResultsUI = () => {
		const total = globalSearchMatches.length;
		if (total > 0) {
			searchResultsCount.textContent = t('editor.searchBar.results', { current: currentMatchIndex + 1, total });
		} else {
			searchResultsCount.textContent = t('editor.searchBar.noResults');
		}
		searchPrevBtn.disabled = total <= 1;
		searchNextBtn.disabled = total <= 1;
	};
	
	const navigateToMatch = (index) => {
		if (index < 0 || index >= globalSearchMatches.length) return;
		
		// De-highlight previous match
		if (currentMatchIndex !== -1) {
			const oldMatch = globalSearchMatches[currentMatchIndex];
			if (oldMatch.scope === 'source') {
				oldMatch.element.classList.remove('search-highlight-active');
			} else {
				const view = chapterEditorViews.get(oldMatch.chapterId.toString());
				if (view && view.isReady) {
					view.contentWindow.postMessage({ type: 'search:navigateTo', payload: { matchIndex: oldMatch.matchIndex, isActive: false } }, window.location.origin);
				}
			}
		}
		
		currentMatchIndex = index;
		const newMatch = globalSearchMatches[currentMatchIndex];
		
		// Highlight new match
		if (newMatch.scope === 'source') {
			newMatch.element.classList.add('search-highlight-active');
			newMatch.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
		} else {
			const view = chapterEditorViews.get(newMatch.chapterId.toString());
			if (view && view.isReady) {
				view.contentWindow.postMessage({ type: 'search:navigateTo', payload: { matchIndex: newMatch.matchIndex, isActive: true } }, window.location.origin);
			}
		}
		
		updateSearchResultsUI();
	};
	
	const startSearch = debounce(() => {
		const query = searchInput.value;
		const scope = document.querySelector('input[name="search-scope"]:checked').value;
		
		clearSearch();
		
		if (query.length < 2) return;
		
		if (scope === 'source') {
			const matches = findAndHighlightInSource(query);
			globalSearchMatches = matches.map(el => ({ scope: 'source', element: el }));
			if (globalSearchMatches.length > 0) {
				navigateToMatch(0);
			}
			updateSearchResultsUI();
		} else { // Target scope
			searchResponsesPending = chapterEditorViews.size;
			globalSearchMatches = [];
			chapterEditorViews.forEach(view => {
				if (view.isReady) {
					view.contentWindow.postMessage({ type: 'search:findAndHighlight', payload: { query } }, window.location.origin);
				} else {
					searchResponsesPending--;
				}
			});
		}
	}, 300);
	
	// Event Listeners
	searchBtn.addEventListener('click', () => toggleSearchBar(true));
	searchCloseBtn.addEventListener('click', () => toggleSearchBar(false));
	searchInput.addEventListener('input', startSearch);
	searchScopeRadios.forEach(radio => radio.addEventListener('change', startSearch));
	
	searchNextBtn.addEventListener('click', () => {
		const nextIndex = (currentMatchIndex + 1) % globalSearchMatches.length;
		navigateToMatch(nextIndex);
	});
	
	searchPrevBtn.addEventListener('click', () => {
		const prevIndex = (currentMatchIndex - 1 + globalSearchMatches.length) % globalSearchMatches.length;
		navigateToMatch(prevIndex);
	});
	
	searchInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault(); // Prevent default form submission behavior
			if (e.shiftKey) {
				// If Shift is held, trigger the "previous" button if it's enabled
				if (!searchPrevBtn.disabled) {
					searchPrevBtn.click();
				}
			} else {
				// Otherwise, trigger the "next" button if it's enabled
				if (!searchNextBtn.disabled) {
					searchNextBtn.click();
				}
			}
		}
	});
	
	document.addEventListener('keydown', (e) => {
		if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
			e.preventDefault();
			toggleSearchBar(true);
		}
		if (e.key === 'Escape' && !searchBar.classList.contains('hidden')) {
			toggleSearchBar(false);
		}
	});
	
	// This function will be called from the main message listener
	window.handleSearchResult = (payload) => {
		const { chapterId, matchCount } = payload;
		for (let i = 0; i < matchCount; i++) {
			globalSearchMatches.push({ scope: 'target', chapterId, matchIndex: i });
		}
		
		searchResponsesPending--;
		if (searchResponsesPending === 0) {
			// Sort matches based on chapter element order in the DOM
			const chapterOrder = Array.from(document.querySelectorAll('.manuscript-chapter-item[data-chapter-id]')).map(el => el.dataset.chapterId);
			globalSearchMatches.sort((a, b) => {
				const orderA = chapterOrder.indexOf(a.chapterId.toString());
				const orderB = chapterOrder.indexOf(b.chapterId.toString());
				if (orderA !== orderB) return orderA - orderB;
				return a.matchIndex - b.matchIndex;
			});
			
			if (globalSearchMatches.length > 0) {
				navigateToMatch(0);
			}
			updateSearchResultsUI();
		}
	};
}

/**
 * Handles the final step of view initialization.
 * Decides whether to restore scroll position or scroll to a specific chapter.
 * @param {string} novelId - The ID of the current novel.
 * @param {object} novelData - The full novel data object.
 * @param {string|null} initialChapterId - The chapter ID passed in the URL, if any.
 */
function initializeView(novelId, novelData, initialChapterId) {
	if (viewInitialized) return;
	viewInitialized = true;
	
	const sourceContainer = document.getElementById('js-source-column-container');
	const targetContainer = document.getElementById('js-target-column-container');
	
	// MODIFIED: Add a delay to allow the DOM to reflow after all iframes have been resized.
	// This ensures that the scrollHeight of the containers is accurate before we try to set scrollTop,
	// which is crucial for large documents where the reflow can take a moment.
	setTimeout(() => {
		// Try to restore scroll position. If successful, we're done with positioning.
		const wasRestored = restoreScrollPositions(novelId, sourceContainer, targetContainer);
		
		if (!wasRestored) {
			// If no saved position, fall back to scrolling to the specified or first chapter.
			const chapterToLoad = initialChapterId || novelData.sections[0]?.chapters[0]?.id;
			if (chapterToLoad) {
				document.getElementById('js-chapter-nav-dropdown').value = chapterToLoad;
				// Use a short timeout to ensure the DOM is fully settled before scrolling.
				setTimeout(() => scrollToChapter(chapterToLoad), 50);
			}
		}
	}, 500); // A 500ms delay should be sufficient for the reflow on most systems.
}

// Main Initialization
document.addEventListener('DOMContentLoaded', async () => {
	await initI18n();
	
	// Added: Refresh button functionality
	const refreshBtn = document.getElementById('js-refresh-page-btn');
	if (refreshBtn) {
		refreshBtn.addEventListener('click', () => {
			window.location.reload();
		});
	}
	
	const openChatBtn = document.getElementById('js-open-chat-btn');
	if (openChatBtn) {
		openChatBtn.addEventListener('click', () => {
			window.api.openChatWindow();
		});
	}
	
	window.showAlert = function(message, title = t('common.error')) {
		const modal = document.getElementById('alert-modal');
		if (modal) {
			const modalTitle = modal.querySelector('#alert-modal-title');
			const modalContent = modal.querySelector('#alert-modal-content');
			if (modalTitle) modalTitle.textContent = title;
			if (modalContent) modalContent.textContent = message;
			modal.showModal();
		} else {
			alert(message);
		}
	};
	
	const params = new URLSearchParams(window.location.search);
	const novelId = params.get('novelId');
	const initialChapterId = params.get('chapterId');
	
	if (!novelId) {
		document.body.innerHTML = `<p class="text-error p-8">${t('editor.errorProjectMissing')}</p>`;
		return;
	}
	
	document.body.dataset.novelId = novelId;
	
	try {
		const novelData = await window.api.getFullManuscript(novelId);
		if (!novelData || !novelData.title) {
			throw new Error('Failed to load project data from the database.');
		}
		
		allCodexEntriesForNovel = await window.api.getAllCodexEntriesForNovel(novelId);
		
		// Check if codex is empty and show the welcome modal
		if (!allCodexEntriesForNovel || allCodexEntriesForNovel.length === 0) {
			const codexModal = document.getElementById('codex-welcome-modal');
			if (codexModal) {
				codexModal.showModal();
				
				const createBtn = document.getElementById('codex-welcome-create-btn');
				
				createBtn.addEventListener('click', () => {
					window.api.openOutlineAndAutogenCodex(novelId);
					codexModal.close();
				}, { once: true }); // Use once to avoid multiple listeners
			}
		}
		
		document.title = t('editor.translating', { title: novelData.title });
		document.getElementById('js-novel-title').textContent = novelData.title;
		
		let totalTargetWords = 0;
		if (novelData.sections) {
			novelData.sections.forEach(section => {
				if (section.chapters) {
					section.chapters.forEach(chapter => {
						totalTargetWords += chapter.target_word_count;
					});
				}
			});
		}
		document.getElementById('js-total-word-count').textContent = `${totalTargetWords.toLocaleString()} ${t('common.words')}`;
		
		const sourceContainer = document.getElementById('js-source-column-container');
		const targetContainer = document.getElementById('js-target-column-container');
		
		if (!novelData.sections || novelData.sections.length === 0) {
			const noContentHtml = `<div class="p-8 text-center text-base-content/70">
                <p>${t('editor.noProjectContent')}</p>
                <p class="text-sm mt-2">${t('editor.noProjectContentHelp')}</p>
            </div>`;
			sourceContainer.innerHTML = noContentHtml;
			targetContainer.innerHTML = noContentHtml;
			document.getElementById('js-chapter-nav-dropdown').disabled = true;
			return;
		}
		
		await renderManuscript(novelData, allCodexEntriesForNovel);
		populateNavDropdown(novelData);
		
		sourceContainer.addEventListener('scroll', () => {
			debouncedSaveScroll(novelId, sourceContainer, targetContainer);
		});
		targetContainer.addEventListener('scroll', () => {
			debouncedSaveScroll(novelId, sourceContainer, targetContainer);
		});
		
		setupTopToolbar({
			isChapterEditor: true,
			getActiveChapterId: () => activeChapterId,
			getChapterViews: (chapterId) => chapterEditorViews.get(chapterId.toString()),
		});
		setupPromptEditor();
		setupTypographySettings({
			buttonId: 'typography-settings-btn',
			modalId: 'typography-settings-modal',
			formId: 'typography-settings-form',
			applyCallback: (styleProps, settings) => {
				// Apply to iframes (target columns)
				chapterEditorViews.forEach(viewInfo => {
					if (viewInfo.isReady) {
						viewInfo.contentWindow.postMessage({
							type: 'updateTypography',
							payload: { styleProps, settings }
						}, window.location.origin);
					}
				});
				
				// Apply styles to all source columns in the manuscript view
				const sourceColumns = document.querySelectorAll('.js-source-column');
				sourceColumns.forEach(col => {
					Object.entries(styleProps).forEach(([prop, value]) => {
						col.style.setProperty(prop, value);
					});
				});
			}
		});
		setupIntersectionObserver();
		setupSpellcheckDropdown();
		setupSearch(); // Initialize search functionality
		
		if (totalIframes === 0) {
			initializeView(novelId, novelData, initialChapterId);
		}
		
		const throttledUpdateToolbar = debounce(() => {
			updateToolbarState(null); // Pass null to indicate it's not a PM editor state
		}, 100);
		
		document.addEventListener('selectionchange', () => {
			throttledUpdateToolbar();
			
			const selection = window.getSelection();
			let hasSourceSelection = false;
			let selectedText = '';
			let selectionRange = null; // Variable to hold the Range object
			
			// Check if the selection is valid and within a source content area
			if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
				const range = selection.getRangeAt(0);
				let checkNode = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
				const sourceContainer = checkNode.closest('.source-content-readonly');
				if (sourceContainer) {
					selectedText = selection.toString().trim();
					if (selectedText.length > 0) {
						hasSourceSelection = true;
						selectionRange = range.cloneRange(); // Store a copy of the range
					}
				}
			}
			
			// Store the current state, including the range
			currentSourceSelection = { text: selectedText, hasSelection: hasSourceSelection, range: selectionRange };
			
			// MODIFIED: Only broadcast the selection state to all editor iframes if it has changed.
			// This prevents a flood of postMessage calls on every keystroke when typing in the modal,
			// which was the likely cause of the UI sluggishness.
			if (hasSourceSelection !== lastBroadcastedSourceSelectionState) {
				lastBroadcastedSourceSelectionState = hasSourceSelection;
				chapterEditorViews.forEach(viewInfo => {
					if (viewInfo.isReady) {
						viewInfo.contentWindow.postMessage({
							type: 'sourceSelectionChanged',
							payload: { hasSelection: hasSourceSelection }
						}, window.location.origin);
					}
				});
			}
		});
		
		sourceContainer.addEventListener('click', async (event) => {
			// MODIFICATION START: Handle sync scroll button
			const syncBtn = event.target.closest('.js-sync-scroll-btn');
			if (syncBtn) {
				event.preventDefault();
				const chapterId = syncBtn.dataset.chapterId;
				const direction = syncBtn.dataset.direction;
				syncChapterScroll(chapterId, direction);
				return;
			}
			// MODIFICATION END
			
			const codexLink = event.target.closest('a.codex-link');
			const markerLink = event.target.closest('a.translation-marker-link');
			
			// Handle edit/save/cancel buttons
			const editBtn = event.target.closest('.js-edit-source-btn');
			const saveBtn = event.target.closest('.js-save-source-btn');
			const cancelBtn = event.target.closest('.js-cancel-source-btn');
			const chapterItem = event.target.closest('.manuscript-chapter-item');
			
			if (chapterItem) {
				const chapterId = chapterItem.dataset.chapterId;
				if (editBtn) {
					event.preventDefault();
					await toggleSourceEditMode(chapterId, true);
					return; // Prevent other handlers from firing
				} else if (saveBtn) {
					event.preventDefault();
					await saveSourceChanges(chapterId);
					return;
				} else if (cancelBtn) {
					event.preventDefault();
					await toggleSourceEditMode(chapterId, false); // This is the cancel action
					return;
				}
			}
			
			if (codexLink) {
				event.preventDefault();
				const entryId = codexLink.dataset.codexEntryId;
				if (entryId) {
					window.api.openCodexEditor(entryId);
				}
			} else if (markerLink) {
				event.preventDefault();
				const markerId = markerLink.dataset.markerId;
				const chapterId = markerLink.closest('.manuscript-chapter-item').dataset.chapterId;
				if (markerId && chapterId) {
					scrollToTargetMarker(chapterId, markerId);
				}
			}
		});
		
		// MODIFICATION START: Add event listener for sync buttons in the target column
		targetContainer.addEventListener('click', (event) => {
			const syncBtn = event.target.closest('.js-sync-scroll-btn');
			if (syncBtn) {
				event.preventDefault();
				const chapterId = syncBtn.dataset.chapterId;
				const direction = syncBtn.dataset.direction;
				syncChapterScroll(chapterId, direction);
			}
		});
		// MODIFICATION END
		
		if (window.api && typeof window.api.onManuscriptScrollToChapter === 'function') {
			window.api.onManuscriptScrollToChapter((event, chapterId) => {
				if (chapterId) {
					scrollToChapter(chapterId);
					const navDropdown = document.getElementById('js-chapter-nav-dropdown');
					if (navDropdown) {
						navDropdown.value = chapterId;
					}
				}
			});
		}
		
		window.addEventListener('message', (event) => {
			const isFromKnownIframe = Array.from(chapterEditorViews.values()).some(view => view.iframe.contentWindow === event.source);
			if (!isFromKnownIframe) return;
			
			const { type, payload } = event.data;
			const sourceWindow = event.source;
			
			switch (type) {
				case 'editorFocused':
					setActiveEditor(sourceWindow);
					setActiveContentWindow(sourceWindow);
					updateToolbarState(payload.state);
					activeChapterId = payload.chapterId;
					document.getElementById('js-chapter-nav-dropdown').value = payload.chapterId;
					break;
				case 'editorBlurred':
					setTimeout(() => {
						if (document.activeElement.closest('#top-toolbar') || document.activeElement.closest('.modal')) return;
						setActiveEditor(null);
						setActiveContentWindow(null);
						updateToolbarState(null);
					}, 100);
					break;
				case 'stateUpdate':
					if (getActiveEditor() === sourceWindow) {
						updateToolbarState(payload.state);
					}
					break;
				case 'contentChanged':
					debouncedContentSave(payload);
					break;
				case 'resize': {
					const viewInfo = Array.from(chapterEditorViews.values()).find(v => v.contentWindow === sourceWindow);
					if (viewInfo) {
						viewInfo.iframe.style.height = `${payload.height}px`;
						
						if (!viewInfo.initialResizeComplete) {
							viewInfo.initialResizeComplete = true;
							iframesReadyCount++;
							if (iframesReadyCount >= totalIframes && !viewInitialized) {
								initializeView(novelId, novelData, initialChapterId);
							}
						}
					}
					break;
				}
				case 'scrollToCoordinates': {
					const { top: targetTopInIframe } = payload;
					const sourceIframeWindow = event.source;
					
					const viewInfo = Array.from(chapterEditorViews.values()).find(v => v.contentWindow === sourceIframeWindow);
					if (!viewInfo) break;
					
					const iframeEl = viewInfo.iframe;
					const targetContainer = document.getElementById('js-target-column-container');
					
					if (iframeEl && targetContainer) {
						const iframeRect = iframeEl.getBoundingClientRect();
						const containerRect = targetContainer.getBoundingClientRect();
						const iframeOffsetTop = iframeRect.top - containerRect.top;
						
						const scrollPosition = targetContainer.scrollTop + iframeOffsetTop + targetTopInIframe - 100; // 100px offset from top
						
						targetContainer.scrollTo({
							top: scrollPosition,
							behavior: 'smooth'
						});
					}
					break;
				}
				// Handle search results from iframes
				case 'search:results': {
					if (typeof window.handleSearchResult === 'function') {
						window.handleSearchResult(payload);
					}
					break;
				}
				// NEW: Handle clicks on markers in the target editor.
				case 'markerClicked': {
					scrollToSourceMarker(payload.markerId);
					break;
				}
				case 'requestTranslation': {
					const { from, to } = payload;
					const viewInfo = Array.from(chapterEditorViews.values()).find(v => v.contentWindow === sourceWindow);
					if (!viewInfo || !currentSourceSelection.hasSelection) return;
					
					const chapterId = viewInfo.iframe.dataset.chapterId;
					
					// Use an async IIFE to handle async operations
					(async () => {
						const novelData = await window.api.getOneNovel(novelId);
						const allCodexEntries = await window.api.getAllCodexEntriesForNovel(novelId);
						let settings = {};
						if (novelData.translate_settings) {
							try {
								settings = JSON.parse(novelData.translate_settings);
							} catch (e) {
								console.error('Error parsing translate_settings JSON', e);
							}
						}
						
						// Construct the context needed for the prompt editor
						const context = {
							selectedText: currentSourceSelection.text,
							sourceSelectionRange: currentSourceSelection.range,
							allCodexEntries,
							languageForPrompt: novelData.source_language || 'English',
							targetLanguage: novelData.target_language || 'English',
							activeEditorView: sourceWindow,
							editorInterface: createIframeEditorInterface(sourceWindow),
							chapterId: chapterId,
							insertionPoint: { from, to } // Pass the insertion point
						};
						openPromptEditor(context, 'translate', settings);
					})();
					break;
				}
			}
		});
		
	} catch (error) {
		console.error('Failed to load manuscript data:', error);
		document.body.innerHTML = `<p class="p-8 text-error">${t('editor.errorLoadManuscript', { message: error.message })}</p>`;
	}
});
