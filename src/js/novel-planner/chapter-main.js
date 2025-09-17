import { setupTopToolbar, setActiveContentWindow, updateToolbarState, createIframeEditorInterface } from './toolbar.js';
import { setupPromptEditor, openPromptEditor } from '../prompt-editor.js';
import { getActiveEditor, setActiveEditor } from './content-editor.js';
import { setupTypographySettings, getTypographySettings, generateTypographyStyleProperties } from './typography-settings.js';
import { initI18n, t } from '../i18n.js';
import { supportedLanguages as languageCodeToName } from '../languages.js';

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
}, 2000); // 2 second delay

/**
 * MODIFICATION START: New function to synchronize translation markers on load.
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
 * Finds codex entry titles and phrases in an HTML string and wraps them in links.
 * @param {string} htmlString - The HTML content to process.
 * @param {Array<object>} codexCategories - The array of codex categories containing entries.
 * @returns {string} The HTML string with codex terms linked.
 */
function processSourceContentForCodexLinks(htmlString, codexCategories) {
	if (!codexCategories || codexCategories.length === 0 || !htmlString) {
		return htmlString;
	}
	
	// 1. Create a flat list of terms to search for (titles and document phrases).
	const terms = [];
	codexCategories.forEach(category => {
		category.entries.forEach(entry => {
			if (entry.title) {
				terms.push({ text: entry.title, id: entry.id });
			}
			if (entry.document_phrases) {
				const phrases = entry.document_phrases.split(',').map(p => p.trim()).filter(Boolean);
				phrases.forEach(phrase => {
					terms.push({ text: phrase, id: entry.id });
				});
			}
		});
	});
	
	if (terms.length === 0) {
		return htmlString;
	}
	
	// Sort by length descending to match longer phrases first (e.g., "King Arthur" before "King").
	terms.sort((a, b) => b.text.length - a.text.length);
	
	const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const regex = new RegExp(`\\b(${terms.map(term => escapeRegex(term.text)).join('|')})\\b`, 'gi');
	
	// Map lower-cased phrases back to their entry IDs for case-insensitive matching.
	const termMap = new Map();
	terms.forEach(term => {
		termMap.set(term.text.toLowerCase(), term.id);
	});
	
	// 2. Parse HTML and walk through all text nodes.
	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = htmlString;
	
	const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT, null, false);
	const nodesToProcess = [];
	let node;
	while ((node = walker.nextNode())) {
		// Avoid creating links inside existing links or other unwanted elements.
		if (node.parentElement.closest('a, script, style')) {
			continue;
		}
		nodesToProcess.push(node);
	}
	
	// 3. For each text node, find matches and replace them with link elements.
	nodesToProcess.forEach(textNode => {
		const text = textNode.textContent;
		const matches = [...text.matchAll(regex)];
		
		if (matches.length > 0) {
			const fragment = document.createDocumentFragment();
			let lastIndex = 0;
			
			matches.forEach(match => {
				const matchedText = match[0];
				const entryId = termMap.get(matchedText.toLowerCase());
				if (!entryId) return;
				
				// Add text before the match.
				if (match.index > lastIndex) {
					fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
				}
				
				// Create and add the link.
				const link = document.createElement('a');
				link.href = '#';
				link.className = 'codex-link';
				link.dataset.codexEntryId = entryId;
				link.textContent = matchedText;
				fragment.appendChild(link);
				
				lastIndex = match.index + matchedText.length;
			});
			
			// Add any remaining text after the last match.
			if (lastIndex < text.length) {
				fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
			}
			
			// Replace the original text node with the new fragment.
			textNode.parentNode.replaceChild(fragment, textNode);
		}
	});
	
	// 4. Return the modified HTML.
	return tempDiv.innerHTML;
}

// MODIFICATION START: New function to wrap translation markers in clickable links.
/**
 * Finds translation markers ([[#123]]) in an HTML string and wraps them in links.
 * @param {string} htmlString - The HTML content to process.
 * @returns {string} The HTML string with markers linked.
 */
function processSourceContentForMarkers(htmlString) {
	if (!htmlString) {
		return htmlString;
	}
	// This regex finds the marker and captures the number inside.
	const markerRegex = /\[\[#(\d+)\]\]/g;
	// Replace the found marker with an anchor tag.
	return htmlString.replace(markerRegex, (match, number) => {
		return `<a href="#" class="translation-marker-link" data-marker-id="${number}">${match}</a>`;
	});
}
// MODIFICATION END

/**
 * MODIFICATION: Renders the manuscript into two separate, independently scrolling columns.
 * @param {object} novelData - The full novel data.
 * @param {Array<object>} allCodexEntries - All codex entries for the novel.
 */
async function renderManuscript(novelData, allCodexEntries) {
	const sourceContainer = document.getElementById('js-source-column-container');
	const targetContainer = document.getElementById('js-target-column-container');
	
	const sourceFragment = document.createDocumentFragment();
	const targetFragment = document.createDocumentFragment();
	
	for (const section of novelData.sections) {
		// Create and append section headers to both columns
		const sectionHeader = document.createElement('div');
		sectionHeader.className = 'px-8 py-6 sticky top-0 bg-base-100/90 backdrop-blur-sm z-10 border-b border-base-300';
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
			sourceCol.innerHTML = `<h3 class="!mt-0 text-sm font-semibold uppercase tracking-wider text-base-content/70 border-b pb-1 mb-2">${chapter.title} (<span class="js-source-word-count">${chapter.source_word_count.toLocaleString()} ${t('common.words')}</span>)</h3>`;
			const sourceContentContainer = document.createElement('div');
			sourceContentContainer.className = 'source-content-readonly';
			
			// MODIFICATION: Chain processing for codex links and then for markers.
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
			targetCol.innerHTML = `<h3 class="!mt-0 text-sm font-semibold uppercase tracking-wider text-base-content/70 border-b pb-1 mb-2 pt-4">${chapter.title} (<span class="js-target-word-count">${chapter.target_word_count.toLocaleString()} ${t('common.words')}</span>)</h3>`;
			
			const iframe = document.createElement('iframe');
			iframe.className = 'js-target-content-editable w-full border-0 min-h-[300px]';
			iframe.src = 'editor-iframe.html';
			iframe.dataset.chapterId = chapter.id;
			targetCol.appendChild(iframe);
			targetChapterWrapper.appendChild(targetCol);
			targetFragment.appendChild(targetChapterWrapper);
			
			const initialTargetContent = chapter.target_content || '';
			
			synchronizeMarkers(chapter.id, sourceContentContainer, initialTargetContent);
			
			// Store iframe info and initialize it on load.
			const viewInfo = {
				iframe: iframe,
				contentWindow: iframe.contentWindow,
				isReady: false,
				initialContent: initialTargetContent,
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
 * MODIFICATION: Sets up the intersection observer to track the active chapter in the source column.
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
				const option = new Option(`${chapter.chapter_order}. ${chapter.title}`, chapter.id);
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
 * MODIFICATION: Scrolls both manuscript columns to a specific chapter.
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

// MODIFICATION START: This function now only initiates the process. The actual scrolling
// is handled in the 'markerFound' message listener for better accuracy.
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
// MODIFICATION END

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
		
		availableLangs.sort().forEach(code => {
			const name = languageCodeToName[code] || code;
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


// Main Initialization
document.addEventListener('DOMContentLoaded', async () => {
	await initI18n();
	
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
		
		// Fetch all codex entries for the novel.
		const allCodexEntries = await window.api.getAllCodexEntriesForNovel(novelId);
		
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
		
		await renderManuscript(novelData, allCodexEntries);
		populateNavDropdown(novelData);
		
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
			
			// Broadcast the selection state to all editor iframes
			chapterEditorViews.forEach(viewInfo => {
				if (viewInfo.isReady) {
					viewInfo.contentWindow.postMessage({
						type: 'sourceSelectionChanged',
						payload: { hasSelection: hasSourceSelection }
					}, window.location.origin);
				}
			});
		});
		
		// MODIFICATION: Consolidated click handler for the source container.
		sourceContainer.addEventListener('click', (event) => {
			const codexLink = event.target.closest('a.codex-link');
			const markerLink = event.target.closest('a.translation-marker-link');
			
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
		
		const chapterToLoad = initialChapterId || novelData.sections[0]?.chapters[0]?.id;
		if (chapterToLoad) {
			document.getElementById('js-chapter-nav-dropdown').value = chapterToLoad;
			setTimeout(() => scrollToChapter(chapterToLoad), 100);
		}
		
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
				case 'resize':
					const viewInfo = Array.from(chapterEditorViews.values()).find(v => v.contentWindow === sourceWindow);
					if (viewInfo) {
						viewInfo.iframe.style.height = `${payload.height}px`;
					}
					break;
				// MODIFICATION START: New case to handle scrolling to a marker within an iframe.
				case 'markerFound': {
					const { top: markerTopInIframe } = payload;
					const sourceIframeWindow = event.source;
					
					// Find the iframe element that sent the message.
					const viewInfo = Array.from(chapterEditorViews.values()).find(v => v.contentWindow === sourceIframeWindow);
					if (!viewInfo) break;
					
					const iframeEl = viewInfo.iframe;
					const targetContainer = document.getElementById('js-target-column-container');
					
					if (iframeEl && targetContainer) {
						// Get the position of the iframe relative to the scroll container.
						const iframeRect = iframeEl.getBoundingClientRect();
						const containerRect = targetContainer.getBoundingClientRect();
						const iframeOffsetTop = iframeRect.top - containerRect.top;
						
						// Calculate the final scroll position.
						// It's the container's current scroll position, plus the iframe's offset within the container,
						// plus the marker's offset within the iframe. We subtract an offset to position it nicely.
						const scrollPosition = targetContainer.scrollTop + iframeOffsetTop + markerTopInIframe - 100; // 100px offset from top
						
						targetContainer.scrollTo({
							top: scrollPosition,
							behavior: 'smooth'
						});
					}
					break;
				}
				// MODIFICATION END
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
