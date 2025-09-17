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
		const chapterItem = document.getElementById(`chapter-scroll-target-${chapterId}`);
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

/**
 * Renders the entire manuscript into the container.
 * @param {HTMLElement} container - The manuscript container element.
 * @param {object} novelData - The full novel data.
 * @param {Array<object>} allCodexEntries - All codex entries for the novel.
 */
async function renderManuscript(container, novelData, allCodexEntries) {
	const fragment = document.createDocumentFragment();
	
	for (const section of novelData.sections) {
		const sectionHeader = document.createElement('div');
		sectionHeader.className = 'px-8 py-6 sticky top-0 bg-base-100/90 backdrop-blur-sm z-10 border-b border-base-300';
		sectionHeader.innerHTML = `<h2 class="text-3xl font-bold text-indigo-500">${section.section_order}. ${section.title}</h2>`;
		fragment.appendChild(sectionHeader);
		
		if (!section.chapters || section.chapters.length === 0) {
			const noChaptersMessage = document.createElement('p');
			noChaptersMessage.className = 'px-8 py-6 text-base-content/60';
			noChaptersMessage.textContent = t('editor.noChaptersInSection');
			fragment.appendChild(noChaptersMessage);
			continue;
		}
		
		for (const chapter of section.chapters) {
			const chapterWrapper = document.createElement('div');
			chapterWrapper.id = `chapter-scroll-target-${chapter.id}`;
			chapterWrapper.className = 'manuscript-chapter-item px-8 py-6';
			chapterWrapper.dataset.chapterId = chapter.id;
			
			const layoutGrid = document.createElement('div');
			layoutGrid.className = 'grid grid-cols-2 gap-6';
			
			const sourceCol = document.createElement('div');
			sourceCol.className = 'js-source-column col-span-1 prose prose-sm dark:prose-invert max-w-none bg-base-200 p-4 rounded-lg';
			sourceCol.innerHTML = `<h3 class="!mt-0 text-sm font-semibold uppercase tracking-wider text-base-content/70 border-b pb-1 mb-2">${t('common.source')} (<span class="js-source-word-count">${chapter.source_word_count.toLocaleString()} ${t('common.words')}</span>)</h3>`;
			const sourceContentContainer = document.createElement('div');
			sourceContentContainer.className = 'source-content-readonly';
			
			let processedSourceHtml = processSourceContentForCodexLinks(chapter.source_content || '', allCodexEntries);
			
			sourceContentContainer.innerHTML = processedSourceHtml;
			sourceCol.appendChild(sourceContentContainer);
			
			// The target editor is now an iframe.
			const targetCol = document.createElement('div');
			targetCol.className = 'col-span-1'; // Removed prose styles from the container
			targetCol.innerHTML = `<h3 class="!mt-0 text-sm font-semibold uppercase tracking-wider text-base-content/70 border-b pb-1 mb-2 pt-4">${t('common.target')} (<span class="js-target-word-count">${chapter.target_word_count.toLocaleString()} ${t('common.words')}</span>)</h3>`;
			
			const iframe = document.createElement('iframe');
			iframe.className = 'js-target-content-editable w-full border-0 min-h-[300px]';
			iframe.src = 'editor-iframe.html';
			iframe.dataset.chapterId = chapter.id;
			targetCol.appendChild(iframe);
			
			layoutGrid.appendChild(sourceCol);
			layoutGrid.appendChild(targetCol);
			
			chapterWrapper.appendChild(layoutGrid);
			
			const hr = document.createElement('hr');
			hr.className = 'mt-6';
			chapterWrapper.appendChild(hr);
			
			fragment.appendChild(chapterWrapper);
			
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
	
	container.innerHTML = '';
	container.appendChild(fragment);
}


/**
 * Sets up the intersection observer to track the active chapter during scrolling.
 */
function setupIntersectionObserver() {
	const container = document.getElementById('js-manuscript-container');
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
 * Scrolls the manuscript to a specific chapter.
 * @param {string} chapterId - The ID of the chapter to scroll to.
 */
function scrollToChapter(chapterId) {
	const target = document.getElementById(`chapter-scroll-target-${chapterId}`);
	const container = document.getElementById('js-manuscript-container');
	
	if (target && container) {
		isScrollingProgrammatically = true;
		
		const containerRect = container.getBoundingClientRect();
		const targetRect = target.getBoundingClientRect();
		
		const offsetTop = targetRect.top - containerRect.top;
		const scrollPosition = container.scrollTop + offsetTop - 100;
		
		container.scrollTo({
			top: scrollPosition,
			behavior: 'smooth'
		});
		
		if (chapterId !== activeChapterId) {
			activeChapterId = chapterId;
		}
		setTimeout(() => {
			isScrollingProgrammatically = false;
		}, 1000); // Increased timeout to ensure smooth scroll completes
	} else {
		console.warn(`[scrollToChapter] Could not find target element for chapter ${chapterId}`);
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
		
		const manuscriptContainer = document.getElementById('js-manuscript-container');
		
		if (!novelData.sections || novelData.sections.length === 0) {
			manuscriptContainer.innerHTML = `<div class="p-8 text-center text-base-content/70">
				<p>${t('editor.noProjectContent')}</p>
				<p class="text-sm mt-2">${t('editor.noProjectContentHelp')}</p>
			</div>`;
			document.getElementById('js-chapter-nav-dropdown').disabled = true;
			return;
		}
		
		await renderManuscript(manuscriptContainer, novelData, allCodexEntries);
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
		
		manuscriptContainer.addEventListener('click', (event) => {
			const codexLink = event.target.closest('a.codex-link');
			if (codexLink) {
				event.preventDefault();
				const entryId = codexLink.dataset.codexEntryId;
				if (entryId) {
					window.api.openCodexEditor(entryId);
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
