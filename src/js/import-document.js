import { initI18n, t } from './i18n.js';

// Debounce utility for search input
const debounce = (func, delay) => {
	let timeout;
	return function(...args) {
		const context = this;
		clearTimeout(timeout);
		timeout = setTimeout(() => func.apply(context, args), delay);
	};
};

document.addEventListener('DOMContentLoaded', async () => {
	await initI18n();
	
	/**
	 * Displays a custom modal alert to prevent focus issues with native alerts.
	 * @param {string} message - The message to display.
	 * @param {string} [title='Error'] - The title for the alert modal.
	 */
	window.showAlert = function(message, title = t('common.information')) {
		const modal = document.getElementById('alert-modal');
		if (modal) {
			const modalTitle = modal.querySelector('#alert-modal-title');
			const modalContent = modal.querySelector('#alert-modal-content');
			if (modalTitle) modalTitle.textContent = title;
			if (modalContent) modalContent.textContent = message;
			modal.showModal();
		} else {
			// Fallback for pages without the modal
			alert(message);
		}
	};
	
	const selectFileBtn = document.getElementById('select-file-btn');
	const startImportBtn = document.getElementById('start-import-btn');
	const autoDetectBtn = document.getElementById('auto-detect-btn');
	const autoSplitBtn = document.getElementById('auto-split-btn');
	const prevMarkBtn = document.getElementById('prev-mark-btn');
	const nextMarkBtn = document.getElementById('next-mark-btn');
	const titleInput = document.getElementById('title');
	const sourceLangSelect = document.getElementById('source_language');
	const targetLangSelect = document.getElementById('target_language');
	const documentContent = document.getElementById('document-content');
	const importStatus = document.getElementById('js-import-status');
	const popover = document.getElementById('break-type-popover');
	const importOverlay = document.getElementById('import-overlay');
	const importOverlayStatus = document.getElementById('import-overlay-status');
	
	const autoDetectModal = document.getElementById('auto-detect-modal');
	const runDetectionBtn = document.getElementById('run-detection-btn');
	
	const WORD_LIMIT = 5000; // Word count limit per chapter
	
	let currentFilePath = null;
	let currentMarkIndex = -1;
	let targetedParagraph = null;
	
	/**
	 * Counts the words in a given string.
	 * @param {string} text - The string to count words in.
	 * @returns {number} The number of words.
	 */
	function countWords(text) {
		if (!text || typeof text !== 'string') {
			return 0;
		}
		return text.trim().split(/\s+/).filter(Boolean).length;
	}
	
	async function populateLanguages() {
		const supportedLanguages = await window.api.getSupportedLanguages();
		const langNames = Object.values(supportedLanguages).sort((a, b) => a.localeCompare(b));
		langNames.forEach(lang => {
			sourceLangSelect.add(new Option(lang, lang));
			targetLangSelect.add(new Option(lang, lang));
		});
		
		sourceLangSelect.value = 'Norwegian (Bokmål)';
		targetLangSelect.value = 'Turkish';
	}
	
	function updateNavButtonState() {
		const marks = documentContent.querySelectorAll('.chapter-break-marker');
		const hasMarks = marks.length > 0;
		prevMarkBtn.disabled = !hasMarks;
		nextMarkBtn.disabled = !hasMarks;
	}
	
	function updateStatus() {
		// MODIFICATION START: Status update now only considers chapters.
		const chapterBreaks = documentContent.querySelectorAll('.chapter-break-marker').length;
		const hasContent = documentContent.querySelector('p');
		
		const chapterCount = hasContent ? chapterBreaks + 1 : 0;
		
		if (chapterCount === 0) {
			importStatus.textContent = t('import.status');
		} else {
			const chapterLabel = t(chapterCount === 1 ? 'import.chapterLabel_one' : 'import.chapterLabel_other');
			importStatus.textContent = t('import.statusSummary', { chapterCount, chapterLabel });
		}
		// MODIFICATION END
		
		updateNavButtonState();
	}
	
	function checkFormValidity() {
		const hasTitle = titleInput.value.trim() !== '';
		const hasContent = currentFilePath !== null;
		startImportBtn.disabled = !(hasTitle && hasContent);
		autoDetectBtn.disabled = !hasContent;
		autoSplitBtn.disabled = !hasContent;
	}
	
	function showPopover(event) {
		targetedParagraph = event.target;
		popover.style.left = `${event.clientX}px`;
		popover.style.top = `${event.clientY}px`;
		popover.classList.remove('hidden');
	}
	
	function hidePopover() {
		popover.classList.add('hidden');
		targetedParagraph = null;
	}
	
	function setupSearch() {
		const searchBtn = document.getElementById('js-search-btn');
		const searchBar = document.getElementById('js-search-bar');
		const searchInput = document.getElementById('js-search-input');
		const searchCloseBtn = document.getElementById('js-search-close-btn');
		const searchPrevBtn = document.getElementById('js-search-prev-btn');
		const searchNextBtn = document.getElementById('js-search-next-btn');
		const searchResultsCount = document.getElementById('js-search-results-count');
		
		let globalSearchMatches = [];
		let currentMatchIndex = -1;
		
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
		
		const clearSearch = () => {
			const marks = documentContent.querySelectorAll('mark.search-highlight');
			marks.forEach(mark => {
				const parent = mark.parentNode;
				parent.replaceChild(document.createTextNode(mark.textContent), mark);
				parent.normalize(); // Merges adjacent text nodes
			});
			globalSearchMatches = [];
			currentMatchIndex = -1;
			searchResultsCount.textContent = '';
			searchPrevBtn.disabled = true;
			searchNextBtn.disabled = true;
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
			
			if (currentMatchIndex !== -1) {
				globalSearchMatches[currentMatchIndex].classList.remove('search-highlight-active');
			}
			
			currentMatchIndex = index;
			const newMatch = globalSearchMatches[currentMatchIndex];
			newMatch.classList.add('search-highlight-active');
			newMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
			
			updateSearchResultsUI();
		};
		
		const startSearch = () => {
			const query = searchInput.value;
			clearSearch();
			if (query.length < 2) return;
			
			const walker = document.createTreeWalker(documentContent, NodeFilter.SHOW_TEXT, null, false);
			const nodesToProcess = [];
			let node;
			while ((node = walker.nextNode())) {
				if (node.parentElement.closest('script, style, .chapter-break-marker')) continue;
				if (new RegExp(query, 'gi').test(node.textContent)) {
					nodesToProcess.push(node);
				}
			}
			
			nodesToProcess.forEach(textNode => {
				const text = textNode.textContent;
				const fragment = document.createDocumentFragment();
				let lastIndex = 0;
				const regex = new RegExp(query, 'gi');
				let match;
				
				while ((match = regex.exec(text)) !== null) {
					if (match.index > lastIndex) {
						fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
					}
					const mark = document.createElement('mark');
					mark.className = 'search-highlight';
					mark.textContent = match[0];
					fragment.appendChild(mark);
					lastIndex = regex.lastIndex;
				}
				
				if (lastIndex < text.length) {
					fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
				}
				
				if (textNode.parentNode) {
					textNode.parentNode.replaceChild(fragment, textNode);
				}
			});
			
			globalSearchMatches = Array.from(documentContent.querySelectorAll('mark.search-highlight'));
			
			if (globalSearchMatches.length > 0) {
				navigateToMatch(0);
			}
			updateSearchResultsUI();
		};
		
		// Event Listeners
		searchBtn.addEventListener('click', () => toggleSearchBar(true));
		searchCloseBtn.addEventListener('click', () => toggleSearchBar(false));
		searchInput.addEventListener('input', debounce(startSearch, 300));
		
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
				e.preventDefault();
				if (e.shiftKey) {
					if (!searchPrevBtn.disabled) searchPrevBtn.click();
				} else {
					if (!searchNextBtn.disabled) searchNextBtn.click();
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
	}
	
	selectFileBtn.addEventListener('click', async () => {
		const filePath = await window.api.showOpenDocumentDialog();
		if (filePath) {
			currentFilePath = filePath;
			currentMarkIndex = -1;
			const fileName = filePath.split(/[\\/]/).pop();
			titleInput.value = fileName.substring(0, fileName.lastIndexOf('.')).replace(/[-_]/g, ' ');
			
			documentContent.innerHTML = `<div class="text-center"><span class="loading loading-spinner loading-lg"></span><p>${t('import.readingFile')}</p></div>`;
			
			try {
				const text = await window.api.readDocumentContent(filePath);
				const paragraphs = text.split(/\n+/).filter(p => p.trim() !== '');
				
				documentContent.innerHTML = '';
				paragraphs.forEach(pText => {
					const p = document.createElement('p');
					p.textContent = pText.trim();
					documentContent.appendChild(p);
				});
				
				autoDetectModal.showModal();
				
			} catch (error) {
				console.error('Error reading file:', error);
				documentContent.innerHTML = `<p class="text-error">${t('import.errorReadFile', { message: error.message })}</p>`;
				currentFilePath = null;
			}
			updateStatus();
			checkFormValidity();
		}
	});
	
	documentContent.addEventListener('click', (event) => {
		if (event.target.tagName === 'P') {
			showPopover(event);
		}
	});
	
	popover.addEventListener('click', (event) => {
		const actionTarget = event.target.closest('[data-action]');
		if (!actionTarget || !targetedParagraph) return;
		
		const action = actionTarget.dataset.action;
		const prevSibling = targetedParagraph.previousElementSibling;
		
		// MODIFICATION START: Simplified popover logic for chapter breaks only.
		if (prevSibling && (prevSibling.classList.contains('chapter-break-marker'))) {
			prevSibling.remove();
		}
		
		if (action === 'set-chapter') {
			const marker = document.createElement('div');
			const title = targetedParagraph.textContent.trim();
			marker.dataset.title = title;
			
			marker.className = 'chapter-break-marker not-prose';
			
			const titleSpan = document.createElement('span');
			titleSpan.className = 'break-title';
			titleSpan.textContent = title;
			marker.appendChild(titleSpan);
			
			documentContent.insertBefore(marker, targetedParagraph);
		}
		// MODIFICATION END
		
		currentMarkIndex = -1;
		updateStatus();
		hidePopover();
	});
	
	document.addEventListener('click', (event) => {
		if (!popover.contains(event.target) && event.target !== targetedParagraph) {
			hidePopover();
		}
	});
	
	autoDetectBtn.addEventListener('click', () => {
		if (autoDetectModal) {
			autoDetectModal.showModal();
		}
	});
	
	runDetectionBtn.addEventListener('click', () => {
		const useNumeric = document.getElementById('detect-numeric').checked;
		const useKeyword = document.getElementById('detect-keyword').checked;
		const useAllCaps = document.getElementById('detect-all-caps').checked;
		
		const paragraphs = Array.from(documentContent.querySelectorAll('p'));
		
		documentContent.querySelectorAll('.chapter-break-marker').forEach(marker => marker.remove());
		
		let lastBreakIndex = -1;
		
		paragraphs.forEach((p, i) => {
			const text = p.textContent.trim();
			if (!text) return;
			
			let isBreak = false;
			// MODIFICATION START: breakType is always for chapters now.
			const breakType = 'chapter-break-marker';
			// MODIFICATION END
			
			if (useNumeric) {
				const isNumeric = /^\d+$/.test(text);
				const isRoman = /^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i.test(text);
				if (isNumeric || isRoman) isBreak = true;
			}
			
			if (!isBreak && useKeyword) {
				if (/^\b(chapter|bölüm)\b/i.test(text)) {
					isBreak = true;
				}
			}
			
			if (!isBreak && useAllCaps) {
				if (text.length > 0 && text.length < 50 && text === text.toUpperCase() && /[A-Z]/i.test(text)) {
					isBreak = true;
				}
			}
			
			if (isBreak) {
				if (lastBreakIndex === -1) {
					lastBreakIndex = i;
				} else {
					let hasContentSinceLastBreak = false;
					for (let j = lastBreakIndex + 1; j < i; j++) {
						if (paragraphs[j].textContent.trim() !== '') {
							hasContentSinceLastBreak = true;
							break;
						}
					}
					if (hasContentSinceLastBreak) {
						lastBreakIndex = i;
					} else {
						isBreak = false;
					}
				}
			}
			
			if (isBreak) {
				const marker = document.createElement('div');
				marker.className = `${breakType} not-prose`;
				marker.dataset.title = text;
				
				const titleSpan = document.createElement('span');
				titleSpan.className = 'break-title';
				titleSpan.textContent = text;
				marker.appendChild(titleSpan);
				
				documentContent.insertBefore(marker, p);
			}
		});
		
		currentMarkIndex = -1;
		updateStatus();
		autoDetectModal.close();
	});
	
	autoSplitBtn.addEventListener('click', () => {
		let currentWordCount = 0;
		const nodes = Array.from(documentContent.childNodes);
		
		for (const node of nodes) {
			if (node.nodeType !== Node.ELEMENT_NODE) continue;
			
			// Reset counter at every existing break marker
			if (node.classList.contains('chapter-break-marker')) {
				currentWordCount = 0;
				continue;
			}
			
			// Only process paragraph nodes
			if (node.tagName === 'P') {
				const paragraphWordCount = countWords(node.textContent);
				
				if (currentWordCount > 0 && currentWordCount + paragraphWordCount > WORD_LIMIT) {
					const marker = document.createElement('div');
					marker.className = 'chapter-break-marker not-prose';
					marker.dataset.title = '';
					
					const titleSpan = document.createElement('span');
					titleSpan.className = 'break-title';
					titleSpan.textContent = '';
					marker.appendChild(titleSpan);
					
					documentContent.insertBefore(marker, node);
					
					currentWordCount = paragraphWordCount;
				} else {
					currentWordCount += paragraphWordCount;
				}
			}
		}
		updateStatus();
	});
	
	nextMarkBtn.addEventListener('click', () => {
		const marks = documentContent.querySelectorAll('.chapter-break-marker');
		if (marks.length === 0) return;
		
		currentMarkIndex++;
		if (currentMarkIndex >= marks.length) {
			currentMarkIndex = 0;
		}
		
		marks[currentMarkIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
	});
	
	prevMarkBtn.addEventListener('click', () => {
		const marks = documentContent.querySelectorAll('.chapter-break-marker');
		if (marks.length === 0) return;
		
		currentMarkIndex--;
		if (currentMarkIndex < 0) {
			currentMarkIndex = marks.length - 1;
		}
		
		marks[currentMarkIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
	});
	
	titleInput.addEventListener('input', checkFormValidity);
	
	startImportBtn.addEventListener('click', async () => {
		if (!titleInput.value.trim()) {
			window.showAlert(t('import.alertNoTitle'));
			return;
		}
		
		// MODIFICATION START: Simplified validation to a flat chapter structure.
		const chaptersForValidation = [];
		let currentChapter = { title: 'Chapter 1', content: [] };
		
		const allNodes = documentContent.childNodes;
		
		for (const node of allNodes) {
			if (node.nodeType !== Node.ELEMENT_NODE) continue;
			
			const isChapterBreak = node.classList.contains('chapter-break-marker');
			
			if (isChapterBreak) {
				if (currentChapter.content.length > 0) {
					chaptersForValidation.push(currentChapter);
				}
				currentChapter = { title: node.dataset.title || `Chapter ${chaptersForValidation.length + 1}`, content: [] };
			} else if (node.tagName === 'P') {
				currentChapter.content.push(node.textContent.trim());
			}
		}
		
		if (currentChapter.content.length > 0) {
			chaptersForValidation.push(currentChapter);
		}
		
		if (chaptersForValidation.length === 0 && allNodes.length > 0) {
			const allContent = Array.from(allNodes)
				.filter(node => node.tagName === 'P')
				.map(p => p.textContent.trim());
			
			if (allContent.length > 0) {
				currentChapter.content = allContent;
				chaptersForValidation.push(currentChapter);
			}
		}
		
		for (const chapter of chaptersForValidation) {
			const wordCount = countWords(chapter.content.join(' '));
			if (wordCount > WORD_LIMIT) {
				window.showAlert(t('import.errorChapterTooLong', { chapterTitle: chapter.title, wordCount: wordCount }), t('common.error'));
				return;
			}
		}
		// MODIFICATION END
		
		importOverlayStatus.textContent = t('import.importingContent');
		importOverlay.classList.remove('hidden');
		
		// MODIFICATION START: Final data structure is a flat 'chapters' array.
		const chapters = [];
		currentChapter = { title: 'Chapter 1', content: [] };
		
		for (const node of allNodes) {
			if (node.nodeType !== Node.ELEMENT_NODE) continue;
			
			const isChapterBreak = node.classList.contains('chapter-break-marker');
			
			if (isChapterBreak) {
				if (currentChapter.content.length > 0) {
					currentChapter.content = `<p>${currentChapter.content.join('</p><p>')}</p>`;
					chapters.push(currentChapter);
				}
				currentChapter = { title: node.dataset.title || `Chapter ${chapters.length + 1}`, content: [] };
			} else if (node.tagName === 'P') {
				currentChapter.content.push(node.textContent.trim());
			}
		}
		
		if (currentChapter.content.length > 0) {
			currentChapter.content = `<p>${currentChapter.content.join('</p><p>')}</p>`;
			chapters.push(currentChapter);
		}
		
		if (chapters.length === 0 && allNodes.length > 0) {
			const allContent = Array.from(allNodes)
				.filter(node => node.tagName === 'P')
				.map(p => p.textContent.trim());
			
			if (allContent.length > 0) {
				currentChapter.content = `<p>${allContent.join('</p><p>')}</p>`;
				chapters.push(currentChapter);
			}
		}
		// MODIFICATION END
		
		if (chapters.length === 0) {
			window.showAlert(t('import.alertNoContent'));
			importOverlay.classList.add('hidden');
			return;
		}
		
		try {
			await window.api.importDocumentAsNovel({
				title: titleInput.value.trim(),
				source_language: sourceLangSelect.value,
				target_language: targetLangSelect.value,
				chapters: chapters // Pass the flat chapters array
			});
		} catch (error) {
			console.error('Import failed:', error);
			window.showAlert(t('import.errorImport', { message: error.message }), t('common.error'));
			importOverlay.classList.add('hidden');
		}
	});
	
	window.api.onImportStatusUpdate((event, { statusKey }) => {
		if (statusKey) {
			importOverlayStatus.textContent = t(statusKey);
		}
	});
	
	populateLanguages();
	setupSearch();
});
