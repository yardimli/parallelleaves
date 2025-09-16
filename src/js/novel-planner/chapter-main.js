import { setupTopToolbar, setActiveContentWindow, updateToolbarState } from './toolbar.js';
import { setupPromptEditor } from '../prompt-editor.js';
import { getActiveEditor, setActiveEditor } from './content-editor.js';
import { setupTypographySettings, getTypographySettings, generateTypographyStyleProperties } from './typography-settings.js';
import { initI18n, t } from '../i18n.js';

const languageCodeToName = {
	'af': 'Afrikaans',
	'bg': 'Bulgarian',
	'ca': 'Catalan',
	'cs': 'Czech',
	'cy': 'Welsh',
	'da': 'Danish',
	'de': 'German',
	'el': 'Greek',
	'en-GB': 'English (UK)',
	'en-US': 'English (US)',
	'es': 'Spanish',
	'es-419': 'Spanish (Latin America)',
	'es-AR': 'Spanish (Argentina)',
	'es-ES': 'Spanish (Spain)',
	'es-MX': 'Spanish (Mexico)',
	'es-US': 'Spanish (US)',
	'et': 'Estonian',
	'fa': 'Persian',
	'fo': 'Faroese',
	'fr': 'French',
	'he': 'Hebrew',
	'hi': 'Hindi',
	'hr': 'Croatian',
	'hu': 'Hungarian',
	'hy': 'Armenian',
	'id': 'Indonesian',
	'it': 'Italian',
	'ja': 'Japanese',
	'ko': 'Korean',
	'lt': 'Lithuanian',
	'lv': 'Latvian',
	'nb': 'Norwegian (Bokmål)',
	'nl': 'Dutch',
	'pl': 'Polish',
	'pt-BR': 'Portuguese (Brazil)',
	'pt-PT': 'Portuguese (Portugal)',
	'ro': 'Romanian',
	'ru': 'Russian',
	'sh': 'Serbo-Croatian',
	'sk': 'Slovak',
	'sl': 'Slovenian',
	'sq': 'Albanian',
	'sr': 'Serbian',
	'sv': 'Swedish',
	'ta': 'Tamil',
	'tg': 'Tajik',
	'tr': 'Turkish',
	'uk': 'Ukrainian',
	'vi': 'Vietnamese',
};

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
 * Replaces {{TranslationBlock-X}} placeholders with styled HTML divs for display.
 * @param {string} sourceHtml - The raw HTML from the database.
 * @returns {string} HTML with placeholders replaced by styled divs.
 */
function processSourceContentForDisplay(sourceHtml) {
	if (!sourceHtml) return '';
	// This regex finds all instances of {{TranslationBlock-NUMBER}} and replaces them.
	return sourceHtml.replace(/{{TranslationBlock-(\d+)}}/g, (match, blockNumber) => {
		const stylingClasses = 'note-wrapper not-prose p-1 my-1 border-l-4 border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-600 rounded-r-md flex justify-between items-center';
		return `<div class="${stylingClasses}" data-block-number="${blockNumber}">
                    <p class="m-0 text-sm font-semibold">Translation Block #${blockNumber}</p>
                    <button type="button" class="js-translate-block-btn btn btn-xs btn-ghost gap-1" title="${t('editor.translate')}">
                        <i class="bi bi-translate"></i> <span data-i18n="editor.translate">${t('editor.translate')}</span>
                    </button>
                </div>`;
	});
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
			
			const titleInput = document.createElement('input');
			titleInput.type = 'text';
			titleInput.value = chapter.title;
			titleInput.className = 'text-2xl font-bold w-full bg-transparent border-0 p-0 focus:ring-0 focus:border-b-2 focus:border-indigo-500 mb-4';
			titleInput.placeholder = t('editor.chapterTitlePlaceholder');
			
			const debouncedTitleSave = debounce(async (value) => {
				try {
					await window.api.updateChapterField({ chapterId: chapter.id, field: 'title', value });
				} catch (error) {
					console.error(`[SAVE] Error saving title for chapter ${chapter.id}:`, error);
					window.showAlert('Could not save title changes.');
				}
			}, 1500); // 1.5 second delay for title
			titleInput.addEventListener('input', () => debouncedTitleSave(titleInput.value));
			
			const layoutGrid = document.createElement('div');
			layoutGrid.className = 'grid grid-cols-2 gap-6';
			
			const sourceCol = document.createElement('div');
			sourceCol.className = 'js-source-column col-span-1 prose prose-sm dark:prose-invert max-w-none bg-base-200 p-4 rounded-lg';
			sourceCol.innerHTML = `<h3 class="!mt-0 text-sm font-semibold uppercase tracking-wider text-base-content/70 border-b pb-1 mb-2">${t('common.source')} (<span class="js-source-word-count">${chapter.source_word_count.toLocaleString()} ${t('common.words')}</span>)</h3>`;
			const sourceContentContainer = document.createElement('div');
			sourceContentContainer.className = 'source-content-readonly';
			
			// Process source content for both translation blocks and codex links.
			let processedSourceHtml = processSourceContentForDisplay(chapter.source_content || '');
			processedSourceHtml = processSourceContentForCodexLinks(processedSourceHtml, allCodexEntries);
			
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
			
			chapterWrapper.appendChild(titleInput);
			chapterWrapper.appendChild(layoutGrid);
			
			const hr = document.createElement('hr');
			hr.className = 'mt-6';
			chapterWrapper.appendChild(hr);
			
			fragment.appendChild(chapterWrapper);
			
			let initialTargetContent = chapter.target_content;
			if (!initialTargetContent && chapter.source_content) {
				const tempDiv = document.createElement('div');
				tempDiv.innerHTML = processedSourceHtml;
				const markers = tempDiv.querySelectorAll('.note-wrapper');
				
				let skeletonHtml = '';
				markers.forEach(markerNode => {
					skeletonHtml += markerNode.outerHTML;
					skeletonHtml += '<p></p>';
				});
				initialTargetContent = skeletonHtml;
			}
			
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
						i18n: {
							editNote: t('editor.note.editTitle'),
							deleteNote: t('editor.note.deleteTitle')
						}
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
 * Sets up the note editor modal for creating and editing notes.
 */
function setupNoteEditorModal() {
	const modal = document.getElementById('note-editor-modal');
	const form = document.getElementById('note-editor-form');
	const closeBtn = modal.querySelector('.js-close-note-modal');
	if (!modal || !form || !closeBtn) {
		console.error('[setupNoteEditorModal] Could not find all required modal elements.');
		return;
	}
	
	form.addEventListener('submit', (event) => {
		event.preventDefault();
		
		const activeContentWindow = getActiveEditor();
		if (!activeContentWindow) {
			console.error('[NoteEditor] No active editor iframe to save note to.');
			window.showAlert(t('editor.noteModal.errorNoEditor'), t('common.error'));
			return;
		}
		
		const contentInput = document.getElementById('note-content-input');
		const posInput = document.getElementById('note-pos');
		const noteText = contentInput.value.trim();
		
		if (!noteText) {
			window.showAlert(t('editor.noteModal.errorEmpty'), t('common.error'));
			return;
		}
		
		const pos = posInput.value ? parseInt(posInput.value, 10) : null;
		
		activeContentWindow.postMessage({
			type: 'saveNote',
			payload: { pos, noteText }
		}, window.location.origin);
		
		modal.close();
		form.reset();
	});
	
	closeBtn.addEventListener('click', () => {
		modal.close();
		form.reset();
	});
}

/**
 * Sets up the event listener for the "Translate Block" button in the source panel.
 */
function setupTranslateBlockAction() {
	const container = document.getElementById('js-manuscript-container');
	container.addEventListener('click', (event) => {
		const translateBtn = event.target.closest('.js-translate-block-btn');
		if (!translateBtn) return;
		
		event.preventDefault();
		event.stopPropagation();
		
		const marker = translateBtn.closest('[data-block-number]');
		const sourceContainer = marker.closest('.source-content-readonly');
		const blockNumber = parseInt(marker.dataset.blockNumber, 10);
		
		if (!sourceContainer || isNaN(blockNumber)) {
			console.error('[TranslateBlock] Could not find source container or block number for translation.');
			return;
		}
		
		const allMarkers = Array.from(sourceContainer.querySelectorAll('[data-block-number]'));
		const currentMarkerIndex = allMarkers.findIndex(m => parseInt(m.dataset.blockNumber, 10) === blockNumber);
		if (currentMarkerIndex === -1) return;
		
		const startNode = allMarkers[currentMarkerIndex];
		const endNode = (currentMarkerIndex + 1 < allMarkers.length) ? allMarkers[currentMarkerIndex + 1] : null;
		
		const range = document.createRange();
		range.setStartAfter(startNode);
		
		if (endNode) {
			range.setEndBefore(endNode);
		} else {
			range.selectNodeContents(sourceContainer);
			range.setStartAfter(startNode);
		}
		
		const selection = window.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
		
		const toolbarTranslateBtn = document.querySelector('#top-toolbar .js-ai-action-btn[data-action="translate"]');
		if (toolbarTranslateBtn) {
			setTimeout(() => {
				if (!toolbarTranslateBtn.disabled) {
					toolbarTranslateBtn.click();
				} else {
					console.warn('[TranslateBlock] Translate button was disabled after block selection, likely empty block.');
				}
			}, 500);
		}
	});
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
				
				// NEW SECTION START: Apply styles to all source columns in the manuscript view
				const sourceColumns = document.querySelectorAll('.js-source-column');
				sourceColumns.forEach(col => {
					Object.entries(styleProps).forEach(([prop, value]) => {
						col.style.setProperty(prop, value);
					});
				});
				// NEW SECTION END
			}
		});
		setupIntersectionObserver();
		setupNoteEditorModal();
		setupTranslateBlockAction();
		setupSpellcheckDropdown();
		
		const throttledUpdateToolbar = debounce(() => {
			updateToolbarState(null); // Pass null to indicate it's not a PM editor state
		}, 100);
		
		document.addEventListener('selectionchange', throttledUpdateToolbar);
		
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
				case 'openNoteModal': {
					const noteModal = document.getElementById('note-editor-modal');
					const form = document.getElementById('note-editor-form');
					const title = noteModal.querySelector('.js-note-modal-title');
					const contentInput = document.getElementById('note-content-input');
					const posInput = document.getElementById('note-pos');
					
					title.textContent = t(payload.title);
					contentInput.value = payload.content;
					posInput.value = payload.pos;
					noteModal.showModal();
					break;
				}
			}
		});
		
	} catch (error) {
		console.error('Failed to load manuscript data:', error);
		document.body.innerHTML = `<p class="text-error p-8">${t('editor.errorLoadManuscript', { message: error.message })}</p>`;
	}
});
