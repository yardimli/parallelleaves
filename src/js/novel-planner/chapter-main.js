import { setupTopToolbar, setActiveContentWindow, updateToolbarState } from './toolbar.js';
import { setupPromptEditor, openPromptEditor } from '../prompt-editor.js';
import { setupTypographySettings, getTypographySettings, generateTypographyStyleProperties } from './typography-settings.js';
import { initI18n, t, applyTranslationsTo } from '../i18n.js';
import { processSourceContentForMarkers} from '../../utils/html-processing.js';
import { initDictionaryModal } from '../dictionary/dictionary-modal.js';
import { loadModals } from '../../utils/modal-loader.js';
import { showConfirmationModal, showInputModal } from './modals.js';
import { syncChapterScroll, scrollToChapter, scrollToTargetMarker, scrollToSourceMarker, setupIntersectionObserver } from './scroll-sync.js';
import { setupSearch } from './search.js';
import { setupSearchAndReplace } from './search-replace.js';
import { setupSpellcheckDropdown } from './spellcheck.js';
import { handleOpenDictionaryWithSelection } from './dictionary-handler.js';
import { createIframeEditorInterface } from './editor-interface.js';
import { setupShortcuts } from './shortcuts.js';

const debounce = (func, delay) => {
	let timeout;
	const debounced = function (...args) {
		const context = this;
		clearTimeout(timeout);
		timeout = setTimeout(() => func.apply(context, args), delay);
	};
	
	debounced.cancel = () => {
		clearTimeout(timeout);
	};
	
	return debounced;
};

// --- State Management ---
let activeChapterId = null;
const chapterEditorViews = new Map();
let currentSourceSelection = { text: '', hasSelection: false, range: null };
let lastBroadcastedSourceSelectionState = false;
let totalIframes = 0;
let iframesReadyCount = 0;
let viewInitialized = false;
let activeEditor = null; // contentWindow of the currently focused iframe editor.
let searchResultHandler = null; // Callback for search results from iframes.
let searchReplaceResultHandler = null;
let lastFocusedSourceEditor = null;
let targetEditCount = 0;

// --- State Accessors and Mutators ---
const getActiveEditor = () => activeEditor;
const getLastFocusedSourceEditor = () => lastFocusedSourceEditor;
const setActiveEditor = (editorWindow) => { activeEditor = editorWindow; };
const setActiveChapterId = (chapterId, callback) => {
	if (chapterId && chapterId !== activeChapterId) {
		activeChapterId = chapterId;
		if (callback) callback(activeChapterId);
	}
};

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
		window.showAlert(`Could not save ${field} changes.`);
	}
}, 1000);

const debouncedSaveScroll = debounce((novelId, sourceEl, targetEl) => {
	if (!novelId || !sourceEl || !targetEl || viewInitialized === false) return;
	const positions = {
		source: sourceEl.scrollTop,
		target: targetEl.scrollTop
	};
	localStorage.setItem(`scroll-position-${novelId}`, JSON.stringify(positions));
}, 500);

function restoreScrollPositions (novelId, sourceEl, targetEl) {
	const saved = localStorage.getItem(`scroll-position-${novelId}`);
	if (saved) {
		try {
			const positions = JSON.parse(saved);
			if (positions.source) sourceEl.scrollTop = positions.source;
			if (positions.target) targetEl.scrollTop = positions.target;
			return true;
		} catch (e) {
			console.error('Failed to parse saved scroll positions:', e);
			localStorage.removeItem(`scroll-position-${novelId}`);
		}
	}
	return false;
}

async function renderSourceChapterContent (chapterId, rawHtml) {
	const chapterItem = document.getElementById(`source-chapter-scroll-target-${chapterId}`);
	if (!chapterItem) return;
	const contentContainer = chapterItem.querySelector('.source-content-readonly');
	if (!contentContainer) return;
	contentContainer.innerHTML = processSourceContentForMarkers(rawHtml || '');
}

async function toggleSourceEditMode (chapterId, isEditing) {
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
	} else {
		contentContainer.contentEditable = false;
		const rawContent = await window.api.getRawChapterContent({ chapterId, field: 'source_content' });
		await renderSourceChapterContent(chapterId, rawContent);
	}
}

async function saveSourceChanges (chapterId) {
	const chapterItem = document.getElementById(`source-chapter-scroll-target-${chapterId}`);
	if (!chapterItem) return;
	
	const contentContainer = chapterItem.querySelector('.source-content-readonly');
	const newContent = contentContainer.innerHTML;
	
	try {
		await window.api.updateChapterField({ chapterId, field: 'source_content', value: newContent });
		
		const tempDiv = document.createElement('div');
		tempDiv.innerHTML = newContent;
		const wordCount = tempDiv.textContent.trim().split(/\s+/).filter(Boolean).length;
		const wordCountEl = chapterItem.querySelector('.js-source-word-count');
		if (wordCountEl) {
			wordCountEl.textContent = `${wordCount.toLocaleString()} ${t('common.words')}`;
		}
		
		await toggleSourceEditMode(chapterId, false);
		await renderSourceChapterContent(chapterId, newContent);
	} catch (error) {
		console.error(`[SAVE] Error saving source content for chapter ${chapterId}:`, error);
		window.showAlert('Could not save source content changes.');
	}
}

/**
 * MODIFIED: This function now operates on raw HTML strings before rendering
 * and returns the cleaned content. It no longer interacts with the DOM or API.
 * @param {string} rawSourceHtml - The raw source HTML content from the database.
 * @param {string} rawTargetHtml - The raw target HTML content from the database.
 * @returns {{cleanedSourceContent: string, wasModified: boolean}} - The cleaned source content and a flag indicating if changes were made.
 */
function synchronizeMarkers (rawSourceHtml, rawTargetHtml) {
	const markerRegex = /(\[\[#(\d+)\]\])|(\{\{#(\d+)\}\})/g;
	let sourceHtml = rawSourceHtml || '';
	const targetHtml = rawTargetHtml || '';
	
	const getMarkerNumbers = (html) => {
		const numbers = new Set();
		if (!html) return numbers;
		const matches = [...html.matchAll(markerRegex)];
		matches.forEach(match => numbers.add(parseInt(match[2] || match[4], 10)));
		return numbers;
	};
	
	const sourceMarkerNumbers = getMarkerNumbers(sourceHtml);
	if (sourceMarkerNumbers.size === 0) {
		return { cleanedSourceContent: sourceHtml, wasModified: false };
	}
	
	const targetMarkerNumbers = getMarkerNumbers(targetHtml);
	let wasModified = false;
	
	sourceMarkerNumbers.forEach(number => {
		if (!targetMarkerNumbers.has(number)) {
			const openingMarkerRegex = new RegExp(`\\[\\[#${number}\\]\\]\\s*`, 'g');
			const closingMarkerRegex = new RegExp(`\\{\\{#${number}\\}\\}\\s*`, 'g');
			const originalSourceHtml = sourceHtml;
			sourceHtml = sourceHtml.replace(openingMarkerRegex, '').replace(closingMarkerRegex, '');
			if (sourceHtml !== originalSourceHtml) {
				wasModified = true;
			}
		}
	});
	
	return { cleanedSourceContent: sourceHtml, wasModified };
}

async function renderManuscript (novelData) {
	const sourceContainer = document.getElementById('js-source-column-container');
	const targetContainer = document.getElementById('js-target-column-container');
	const sourceFragment = document.createDocumentFragment();
	const targetFragment = document.createDocumentFragment();
	totalIframes = 0;
	
	const [
		sourceChapterTpl,
		targetChapterTpl
	] = await Promise.all([
		window.api.getTemplate('editor/source-chapter'),
		window.api.getTemplate('editor/target-chapter')
	]);
	
	const tempDiv = document.createElement('div');
	
	if (!novelData.chapters || novelData.chapters.length === 0) {
		const noChaptersMessage = document.createElement('p');
		noChaptersMessage.className = 'px-8 py-6 text-base-content/60';
		noChaptersMessage.textContent = t('editor.noChaptersInBook'); // This translation key can be kept or updated.
		sourceFragment.appendChild(noChaptersMessage);
		targetFragment.appendChild(noChaptersMessage.cloneNode(true));
	} else {
		for (const chapter of novelData.chapters) {
			const { cleanedSourceContent, wasModified } = synchronizeMarkers(chapter.source_content, chapter.target_content);
			
			if (wasModified) {
				window.api.updateChapterField({ chapterId: chapter.id, field: 'source_content', value: cleanedSourceContent });
			}
			
			// Use the cleaned content for rendering.
			const rawSourceContent = cleanedSourceContent || '';
			
			const finalSourceContent = processSourceContentForMarkers(rawSourceContent);
			
			const sourceHtml = sourceChapterTpl
				.replace(/{{id}}/g, chapter.id)
				.replace(/{{title}}/g, chapter.title)
				.replace(/{{source_word_count}}/g, chapter.source_word_count.toLocaleString())
				.replace('{{source_content}}', finalSourceContent);
			
			tempDiv.innerHTML = sourceHtml.trim();
			const sourceChapterWrapper = tempDiv.firstChild;
			sourceFragment.appendChild(sourceChapterWrapper);
			
			const targetHtml = targetChapterTpl
				.replace(/{{id}}/g, chapter.id)
				.replace(/{{title}}/g, chapter.title)
				.replace(/{{target_word_count}}/g, chapter.target_word_count.toLocaleString());
			
			tempDiv.innerHTML = targetHtml.trim();
			const targetChapterWrapper = tempDiv.firstChild;
			targetFragment.appendChild(targetChapterWrapper);
			
			const iframe = targetChapterWrapper.querySelector('iframe');
			
			totalIframes++;
			const viewInfo = { iframe, isReady: false, initialContent: chapter.target_content || '', initialResizeComplete: false };
			chapterEditorViews.set(chapter.id.toString(), viewInfo);
			
			iframe.addEventListener('load', () => {
				viewInfo.contentWindow = iframe.contentWindow;
				viewInfo.isReady = true;
				const settings = getTypographySettings();
				const styleProps = generateTypographyStyleProperties(settings);
				iframe.contentWindow.postMessage({ type: 'updateTypography', payload: { styleProps, settings } }, window.location.origin);
				iframe.contentWindow.postMessage({
					type: 'init',
					payload: {
						initialHtml: viewInfo.initialContent,
						isEditable: true,
						chapterId: chapter.id,
						field: 'target_content',
						theme: document.documentElement.getAttribute('data-theme') || 'light',
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
	
	sourceContainer.querySelectorAll('a.translation-marker-link').forEach(link => {
		if (link.textContent.trim() === '') {
			link.remove();
		}
	});
	
	applyTranslationsTo(sourceContainer);
	applyTranslationsTo(targetContainer);
}

function populateNavDropdown (novelData) {
	const navDropdown = document.getElementById('js-chapter-nav-dropdown');
	navDropdown.innerHTML = '';
	
	if (novelData.chapters?.length > 0) {
		novelData.chapters.forEach(chapter => {
			const option = new Option(chapter.title?.trim() ? ` ${chapter.title}` : `${chapter.chapter_order}. ...`, chapter.id);
			navDropdown.appendChild(option);
		});
	}
	
	navDropdown.addEventListener('change', () => scrollToChapter(navDropdown.value, setActiveChapterId));
}

function initializeView (novelId, novelData, initialChapterId) {
	if (viewInitialized) return;
	viewInitialized = true;
	
	const sourceContainer = document.getElementById('js-source-column-container');
	const targetContainer = document.getElementById('js-target-column-container');
	
	setTimeout(() => {
		if (!restoreScrollPositions(novelId, sourceContainer, targetContainer)) {
			const chapterToLoad = initialChapterId || novelData.chapters[0]?.id;
			if (chapterToLoad) {
				document.getElementById('js-chapter-nav-dropdown').value = chapterToLoad;
				setTimeout(() => scrollToChapter(chapterToLoad, setActiveChapterId), 50);
			}
		}
	}, 500);
}

// --- Main Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
	await loadModals([
		'prompt-editor-modal', 'alert-modal', 'typography-settings-modal',
		'dictionary-modal', 'confirmation-modal', 'input-modal'
	], 'modal-placeholders');
	
	await initI18n();
	
	document.getElementById('js-refresh-page-btn')?.addEventListener('click', () => window.location.reload());
	
	const params = new URLSearchParams(window.location.search);
	const novelId = params.get('novelId');
	const initialChapterId = params.get('chapterId');
	
	window.showAlert = (message, title = t('common.error')) => {
		const modal = document.getElementById('alert-modal');
		if (modal) {
			modal.querySelector('#alert-modal-title').textContent = title;
			modal.querySelector('#alert-modal-content').textContent = message;
			modal.showModal();
		} else {
			alert(message);
		}
	};
	
	if (!novelId) {
		document.body.innerHTML = `<p class="text-error p-8">${t('editor.errorProjectMissing')}</p>`;
		return;
	}
	
	document.body.dataset.novelId = novelId;
	
	try {
		const novelData = await window.api.getFullManuscript(novelId);
		if (!novelData || !novelData.title) throw new Error('Failed to load project data.');
		
		document.title = t('editor.translating', { title: novelData.title });
		document.getElementById('js-novel-title').textContent = novelData.title;
		
		const totalTargetWords = novelData.chapters?.reduce((sum, ch) => sum + ch.target_word_count, 0) || 0;
		document.getElementById('js-total-word-count').textContent = `${totalTargetWords.toLocaleString()} ${t('common.words')}`;
		
		const sourceContainer = document.getElementById('js-source-column-container');
		const targetContainer = document.getElementById('js-target-column-container');
		
		if (!novelData.chapters || novelData.chapters.length === 0) {
			const noContentHtml = `<div class="p-8 text-center text-base-content/70"><p>${t('editor.noProjectContent')}</p><p class="text-sm mt-2">${t('editor.noProjectContentHelp')}</p></div>`;
			sourceContainer.innerHTML = noContentHtml;
			targetContainer.innerHTML = noContentHtml;
			document.getElementById('js-chapter-nav-dropdown').disabled = true;
			return;
		}
		
		await renderManuscript(novelData);
		populateNavDropdown(novelData);
		
		setupTopToolbar({
			isChapterEditor: true,
			getActiveChapterId: () => activeChapterId,
			getChapterViews: (chapterId) => chapterEditorViews.get(chapterId.toString()),
			onOpenDictionary: () => handleOpenDictionaryWithSelection(getActiveEditor(), currentSourceSelection)
		});
		setupPromptEditor();
		setupTypographySettings({
			buttonId: 'typography-settings-btn',
			modalId: 'typography-settings-modal',
			formId: 'typography-settings-form',
			applyCallback: (styleProps, settings) => {
				chapterEditorViews.forEach(viewInfo => {
					if (viewInfo.isReady) {
						viewInfo.contentWindow.postMessage({ type: 'updateTypography', payload: { styleProps, settings } }, window.location.origin);
					}
				});
				document.querySelectorAll('.js-source-column').forEach(col => {
					Object.entries(styleProps).forEach(([prop, value]) => col.style.setProperty(prop, value));
				});
			}
		});
		setupIntersectionObserver(setActiveChapterId);
		setupSpellcheckDropdown();
		
		const searchAPI = setupSearch(chapterEditorViews, (handler) => { searchResultHandler = handler; });
		const searchReplaceAPI = setupSearchAndReplace(chapterEditorViews, (handler) => { searchReplaceResultHandler = handler; });
		
		setupShortcuts({
			searchAPI,
			searchReplaceAPI,
			getActiveEditor,
			getLastFocusedSourceEditor,
			chapterEditorViews
		});
		
		initDictionaryModal(novelId);
		
		document.body.addEventListener('dictionary:find-replace', (event) => {
			const { find, replace } = event.detail;
			if (searchReplaceAPI && searchReplaceAPI.openWithValues) {
				searchReplaceAPI.openWithValues(find, replace);
			}
		});
		
		if (totalIframes === 0) {
			initializeView(novelId, novelData, initialChapterId);
		}
		
		document.getElementById('js-open-chat-btn')?.addEventListener('click', () => window.api.openChatWindow(novelId));
		
		const tmStatusEl = document.getElementById('js-tm-status');
		const codexStatusEl = document.getElementById('js-codex-status');
		
		// Start background codex generation on load
		window.api.codex.startGeneration(novelId);
		
		window.api.codex.onUpdate((event, { statusKey, progress, total }) => {
			if (codexStatusEl) {
				const message = t(statusKey, { progress, total });
				codexStatusEl.textContent = `Codex: ${message}`;
			}
		});
		
		window.api.codex.onFinished((event, { status, message }) => {
			if (codexStatusEl) {
				let statusMessage = '';
				if (status === 'complete') {
					statusMessage = t('editor.codex.status.complete');
				} else if (status === 'error') {
					statusMessage = t('editor.codex.status.error', { message });
				} else if (status === 'cancelled') {
					statusMessage = t('editor.codex.status.cancelled');
				}
				codexStatusEl.textContent = `Codex: ${statusMessage}`;
				
				setTimeout(() => {
					if (status === 'complete') {
						codexStatusEl.textContent = `Codex: ${t('editor.codex.status.ready')}`;
					}
				}, 5000);
			}
		});
		
		let isTmUpdateRunning = false;
		const runTmUpdate = async () => {
			if (isTmUpdateRunning) {
				console.log('TM update is already in progress. Skipping.');
				return;
			}
			isTmUpdateRunning = true;
			try {
				await window.api.translationMemoryGenerateInBackground(novelId);
			} catch (error) {
				tmStatusEl.textContent = t('editor.translationMemory.status.error', { message: error.message });
				isTmUpdateRunning = false; // Reset on error
			}
		};
		
		window.api.onTranslationMemoryProgressUpdate((update) => {
			if (update.error) {
				tmStatusEl.textContent = t('editor.translationMemory.status.error', { message: update.message });
				isTmUpdateRunning = false; // Reset flag
			} else if (update.finished) {
				if (update.processedCount > 0) {
					tmStatusEl.textContent = t('editor.translationMemory.status.complete', { count: update.processedCount });
				} else {
					tmStatusEl.textContent = t('editor.translationMemory.status.complete_none');
				}
				isTmUpdateRunning = false; // Reset flag
				setTimeout(() => {
					tmStatusEl.textContent = ''; // Clear status after 5 seconds
				}, 5000);
			} else if (update.processed !== undefined && update.total !== undefined) {
				tmStatusEl.textContent = t('editor.translationMemory.status.generating', { processed: update.processed, total: update.total });
			} else {
				// Fallback for general status messages like "Syncing..."
				tmStatusEl.textContent = update.message;
			}
		});
		
		// Initial TM update run on load
		runTmUpdate();
		
		// Set interval for subsequent updates every 5 minutes
		setInterval(runTmUpdate, 60000*5);
		
		sourceContainer.addEventListener('scroll', () => debouncedSaveScroll(novelId, sourceContainer, targetContainer));
		targetContainer.addEventListener('scroll', () => debouncedSaveScroll(novelId, sourceContainer, targetContainer));
		
		const debouncedSelectionUiHandler = debounce(() => {
			const selection = window.getSelection();
			let isSourceSelectionHandled = false;
			if (selection?.rangeCount > 0 && !selection.isCollapsed) {
				const range = selection.getRangeAt(0);
				const checkNode = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
				if (checkNode.closest('.source-content-readonly')) {
					const selectedText = selection.toString().trim();
					if (selectedText.length > 0) {
						isSourceSelectionHandled = true;
						const wordCount = selectedText.split(/\s+/).filter(Boolean).length;
						document.getElementById('js-word-count').textContent = t('editor.wordsSelectedSource', { count: wordCount });
					}
				}
			}
			if (!isSourceSelectionHandled) updateToolbarState(null);
		}, 100);
		
		document.addEventListener('selectionchange', () => {
			debouncedSelectionUiHandler();
			const selection = window.getSelection();
			let hasSourceSelection = false;
			let selectedText = '';
			let selectionRange = null;
			
			if (selection?.rangeCount > 0 && !selection.isCollapsed) {
				const range = selection.getRangeAt(0);
				const checkNode = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
				if (checkNode.closest('.source-content-readonly')) {
					selectedText = selection.toString().trim();
					if (selectedText.length > 0) {
						hasSourceSelection = true;
						selectionRange = range.cloneRange();
					}
				}
			}
			
			currentSourceSelection = { text: selectedText, hasSelection: hasSourceSelection, range: selectionRange };
			
			if (hasSourceSelection !== lastBroadcastedSourceSelectionState) {
				lastBroadcastedSourceSelectionState = hasSourceSelection;
				chapterEditorViews.forEach(viewInfo => {
					if (viewInfo.isReady) {
						viewInfo.contentWindow.postMessage({ type: 'sourceSelectionChanged', payload: { hasSelection: hasSourceSelection } }, window.location.origin);
					}
				});
			}
		});
		
		sourceContainer.addEventListener('click', async (event) => {
			const target = event.target;
			const syncBtn = target.closest('.js-sync-scroll-btn');
			if (syncBtn) {
				event.preventDefault();
				syncChapterScroll(syncBtn.dataset.chapterId, syncBtn.dataset.direction);
				return;
			}
			
			const markerLink = target.closest('a.translation-marker-link');
			if (markerLink) {
				event.preventDefault();
				const chapterId = markerLink.closest('.manuscript-chapter-item').dataset.chapterId;
				const markerId = markerLink.dataset.markerId;
				const markerType = markerLink.dataset.markerType;
				if (markerId && chapterId && markerType) {
					scrollToTargetMarker(chapterId, markerId, markerType, chapterEditorViews);
				}
				return;
			}
			
			const chapterItem = target.closest('.manuscript-chapter-item');
			if (chapterItem) {
				const chapterId = chapterItem.dataset.chapterId;
				if (target.closest('.js-edit-source-btn')) await toggleSourceEditMode(chapterId, true);
				if (target.closest('.js-save-source-btn')) await saveSourceChanges(chapterId);
				if (target.closest('.js-cancel-source-btn')) await toggleSourceEditMode(chapterId, false);
			}
			
			const chapterActionBtn = target.closest('.js-chapter-action');
			if (chapterActionBtn) {
				const { action, chapterId } = chapterActionBtn.dataset;
				if (action === 'rename') {
					const currentTitle = chapterActionBtn.closest('.js-source-actions').parentElement.querySelector('h3').textContent.split('(')[0].trim();
					const newTitle = await showInputModal(t('editor.renameChapter'), t('editor.promptNewChapterTitle'), currentTitle);
					if (newTitle) {
						await window.api.renameChapter({ chapterId, newTitle });
						window.location.reload();
					}
				} else if (action === 'delete') {
					if (await showConfirmationModal(t('editor.deleteChapter'), t('editor.confirmDeleteChapter'))) {
						await window.api.deleteChapter({ chapterId });
						window.location.reload();
					}
				} else if (action === 'insert-above' || action === 'insert-below') {
					await window.api.insertChapter({ chapterId, direction: action.replace('insert-', '') });
					window.location.reload();
				}
			}
			
			const contentDiv = target.closest('.source-content-readonly');
			if (contentDiv) {
				sourceContainer.querySelectorAll('.source-content-readonly').forEach(div => {
					if (div !== contentDiv) {
						div.contentEditable = false;
					}
				});
				contentDiv.contentEditable = true;
			}
		});
		
		sourceContainer.addEventListener('focusin', (event) => {
			const contentDiv = event.target.closest('.source-content-readonly');
			if (contentDiv) {
				lastFocusedSourceEditor = contentDiv;
			}
		});
		
		sourceContainer.addEventListener('beforeinput', (event) => {
			const contentDiv = event.target.closest('.source-content-readonly');
			if (contentDiv) {
				const chapterItem = contentDiv.closest('.manuscript-chapter-item');
				const saveBtn = chapterItem?.querySelector('.js-save-source-btn');
				if (saveBtn && saveBtn.classList.contains('hidden')) {
					event.preventDefault();
				}
			}
		});
		
		targetContainer.addEventListener('click', (event) => {
			const syncBtn = event.target.closest('.js-sync-scroll-btn');
			if (syncBtn) {
				event.preventDefault();
				syncChapterScroll(syncBtn.dataset.chapterId, syncBtn.dataset.direction);
			}
		});
		
		window.api?.onManuscriptScrollToChapter((event, chapterId) => {
			if (chapterId) {
				scrollToChapter(chapterId, setActiveChapterId);
				document.getElementById('js-chapter-nav-dropdown').value = chapterId;
			}
		});
		
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
					setActiveChapterId(payload.chapterId, (id) => {
						document.getElementById('js-chapter-nav-dropdown').value = id;
					});
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
					if (getActiveEditor() === sourceWindow) updateToolbarState(payload.state);
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
					const viewInfo = Array.from(chapterEditorViews.values()).find(v => v.contentWindow === event.source);
					if (viewInfo) {
						const iframeRect = viewInfo.iframe.getBoundingClientRect();
						const containerRect = targetContainer.getBoundingClientRect();
						const scrollPosition = targetContainer.scrollTop + (iframeRect.top - containerRect.top) + payload.top - 100;
						targetContainer.scrollTo({ top: scrollPosition, behavior: 'smooth' });
					}
					break;
				}
				case 'search:results':
					if (searchResultHandler) searchResultHandler(payload);
					break;
				case 'search-replace:results':
				case 'search-replace:replaced':
				case 'search-replace:replacedAll':
					if (searchReplaceResultHandler) searchReplaceResultHandler(type, payload);
					break;
				case 'markerClicked': {
					const { markerId, markerType } = payload;
					scrollToSourceMarker(markerId, markerType);
					break;
				}
				case 'requestTranslation': {
					const viewInfo = Array.from(chapterEditorViews.values()).find(v => v.contentWindow === sourceWindow);
					if (!viewInfo || !currentSourceSelection.hasSelection) return;
					
					(async () => {
						const novelData = await window.api.getOneNovel(novelId);
						let settings = {};
						try {
							settings = novelData.translate_settings ? JSON.parse(novelData.translate_settings) : {};
						} catch (e) { console.error('Error parsing translate_settings JSON', e); }
						
						const context = {
							selectedText: currentSourceSelection.text,
							sourceSelectionRange: currentSourceSelection.range,
							languageForPrompt: novelData.source_language || 'English',
							targetLanguage: novelData.target_language || 'English',
							activeEditorView: sourceWindow,
							editorInterface: createIframeEditorInterface(sourceWindow),
							chapterId: viewInfo.iframe.dataset.chapterId,
							novelId: novelId,
							insertionPoint: { from: payload.from, to: payload.to }
						};
						openPromptEditor(context, 'translate', settings);
					})();
					break;
				}
				case 'shortcut:find':
					if (searchReplaceAPI.isHidden()) {
						searchAPI.toggle(true);
					}
					break;
				case 'shortcut:find-replace':
					searchReplaceAPI.toggle(true);
					break;
				case 'shortcut:focus-source':
					if (lastFocusedSourceEditor) {
						lastFocusedSourceEditor.focus();
					} else {
						const sourceContainer = document.getElementById('js-source-column-container');
						const firstEditor = sourceContainer.querySelector('.source-content-readonly');
						if (firstEditor) {
							firstEditor.focus();
						} else {
							sourceContainer.focus({ preventScroll: true });
						}
					}
					break;
				case 'shortcut:focus-target':
					sourceWindow.postMessage({ type: 'focusEditor' }, window.location.origin);
					break;
			}
		});
		
	} catch (error) {
		console.error('Failed to load manuscript data:', error);
		document.body.innerHTML = `<p class="p-8 text-error">${t('editor.errorLoadManuscript', { message: error.message })}</p>`;
	}
});
