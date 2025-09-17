import { initI18n, t } from './i18n.js';

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
	const prevMarkBtn = document.getElementById('prev-mark-btn');
	const nextMarkBtn = document.getElementById('next-mark-btn');
	const titleInput = document.getElementById('title');
	const sourceLangSelect = document.getElementById('source_language');
	const targetLangSelect = document.getElementById('target_language');
	const documentContent = document.getElementById('document-content');
	const importStatus = document.getElementById('js-import-status');
	const popover = document.getElementById('break-type-popover');
	const blockSizeInput = document.getElementById('block_size');
	const importOverlay = document.getElementById('import-overlay');
	const importOverlayStatus = document.getElementById('import-overlay-status');
	
	const autoDetectModal = document.getElementById('auto-detect-modal');
	const runDetectionBtn = document.getElementById('run-detection-btn');
	
	let currentFilePath = null;
	let currentMarkIndex = -1;
	let targetedParagraph = null;
	
	const languages = [
		"English",
		"Norwegian",
		"Turkish",
		"Afrikaans",
		"Albanian",
		"Amharic",
		"Arabic",
		"Basque",
		"Bengali",
		"Bosnian",
		"Bulgarian",
		"Burmese",
		"Catalan",
		"Croatian",
		"Czech",
		"Danish",
		"Dutch",
		"Estonian",
		"Finnish",
		"French",
		"Galician",
		"German",
		"Greek",
		"Gujarati",
		"Hausa",
		"Hebrew",
		"Hindi",
		"Hungarian",
		"Icelandic",
		"Igbo",
		"Indonesian",
		"Irish",
		"Italian",
		"Japanese",
		"Javanese",
		"Kannada",
		"Khmer",
		"Korean",
		"Kurdish",
		"Lao",
		"Latvian",
		"Lithuanian",
		"Luxembourgish",
		"Macedonian",
		"Malayalam",
		"Maltese",
		"Mandarin Chinese",
		"Marathi",
		"Mongolian",
		"Nepali",
		"Oriya",
		"Pashto",
		"Persian",
		"Polish",
		"Portuguese",
		"Romanian",
		"Russian",
		"Serbian",
		"Sinhala",
		"Slovak",
		"Slovenian",
		"Spanish",
		"Swahili",
		"Swedish",
		"Tajik",
		"Tamil",
		"Telugu",
		"Thai",
		"Ukrainian",
		"Urdu",
		"Uzbek",
		"Vietnamese",
		"Welsh",
		"Xhosa",
		"Yoruba",
		"Zulu"
	];
	
	function populateLanguages() {
		languages.forEach(lang => {
			sourceLangSelect.add(new Option(lang, lang));
			targetLangSelect.add(new Option(lang, lang));
		});
		sourceLangSelect.value = 'Norwegian';
		targetLangSelect.value = 'Turkish';
	}
	
	function updateNavButtonState() {
		const marks = documentContent.querySelectorAll('.chapter-break-marker, .act-break-marker');
		const hasMarks = marks.length > 0;
		prevMarkBtn.disabled = !hasMarks;
		nextMarkBtn.disabled = !hasMarks;
	}
	
	function updateStatus() {
		const actBreaks = documentContent.querySelectorAll('.act-break-marker').length;
		const chapterBreaks = documentContent.querySelectorAll('.chapter-break-marker').length;
		const hasContent = documentContent.querySelector('p');
		
		const actCount = hasContent ? actBreaks + 1 : 0;
		const chapterCount = hasContent ? actBreaks + chapterBreaks + 1 : 0;
		
		if (chapterCount === 0) {
			importStatus.textContent = t('import.status');
		} else {
			const actLabel = t(actCount === 1 ? 'import.actLabel_one' : 'import.actLabel_other');
			const chapterLabel = t(chapterCount === 1 ? 'import.chapterLabel_one' : 'import.chapterLabel_other');
			importStatus.textContent = t('import.statusSummary', { actCount, actLabel, chapterCount, chapterLabel });
		}
		
		updateNavButtonState();
	}
	
	function checkFormValidity() {
		const hasTitle = titleInput.value.trim() !== '';
		const hasContent = currentFilePath !== null;
		startImportBtn.disabled = !(hasTitle && hasContent);
		autoDetectBtn.disabled = !hasContent;
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
	
	/**
	 * Processes an array of paragraph texts for a chapter, injecting translation block placeholders.
	 * @param {string[]} paragraphsArray - An array of paragraph strings.
	 * @param {number} blockSize - The number of words before inserting a placeholder.
	 * @param {number} startBlockNumber - The starting number for the translation blocks.
	 * @returns {{html: string, nextBlockNumber: number}} An object containing the final HTML and the next block number to use.
	 */
	function insertTranslationBlockPlaceholders(paragraphsArray, blockSize, startBlockNumber) {
		if (!paragraphsArray || paragraphsArray.length === 0) {
			return { html: '', nextBlockNumber: startBlockNumber };
		}
		
		if (!blockSize || blockSize <= 0) {
			return { html: `<p>${paragraphsArray.join('</p><p>')}</p>`, nextBlockNumber: startBlockNumber };
		}
		
		let finalHtml = '';
		let wordCountSinceLastMarker = 0;
		let blockNumber = startBlockNumber;
		
		finalHtml += `{{TranslationBlock-${blockNumber}}}`;
		blockNumber++;
		
		for (const pText of paragraphsArray) {
			finalHtml += `<p>${pText}</p>`;
			const wordsInP = pText.split(/\s+/).filter(Boolean).length;
			
			if (wordsInP > 0) {
				wordCountSinceLastMarker += wordsInP;
			}
			
			if (wordCountSinceLastMarker >= blockSize && wordsInP > 0) {
				finalHtml += `{{TranslationBlock-${blockNumber}}}`;
				wordCountSinceLastMarker = 0;
				blockNumber++;
			}
		}
		return { html: finalHtml, nextBlockNumber: blockNumber };
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
		
		if (prevSibling && (prevSibling.classList.contains('act-break-marker') || prevSibling.classList.contains('chapter-break-marker'))) {
			prevSibling.remove();
		}
		
		if (action === 'set-act' || action === 'set-chapter') {
			const marker = document.createElement('div');
			const title = targetedParagraph.textContent.trim();
			marker.dataset.title = title;
			
			// MODIFICATION: Add 'not-prose' class directly here.
			const breakClass = action === 'set-act' ? 'act-break-marker' : 'chapter-break-marker';
			marker.className = `${breakClass} not-prose`;
			
			const titleSpan = document.createElement('span');
			titleSpan.className = 'break-title';
			titleSpan.textContent = title;
			marker.appendChild(titleSpan);
			
			documentContent.insertBefore(marker, targetedParagraph);
		}
		
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
		
		documentContent.querySelectorAll('.act-break-marker, .chapter-break-marker').forEach(marker => marker.remove());
		
		let lastBreakIndex = -1;
		
		paragraphs.forEach((p, i) => {
			const text = p.textContent.trim();
			if (!text) return;
			
			let isBreak = false;
			let breakType = 'chapter-break-marker';
			
			if (useNumeric) {
				const isNumeric = /^\d+$/.test(text);
				const isRoman = /^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i.test(text);
				if (isNumeric || isRoman) isBreak = true;
			}
			
			if (!isBreak && useKeyword) {
				if (/^\b(act|perde)\b/i.test(text)) {
					isBreak = true;
					breakType = 'act-break-marker';
				} else if (/^\b(chapter|bölüm)\b/i.test(text)) {
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
				// MODIFICATION: Add 'not-prose' class directly here.
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
	
	nextMarkBtn.addEventListener('click', () => {
		const marks = documentContent.querySelectorAll('.chapter-break-marker, .act-break-marker');
		if (marks.length === 0) return;
		
		currentMarkIndex++;
		if (currentMarkIndex >= marks.length) {
			currentMarkIndex = 0;
		}
		
		marks[currentMarkIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
	});
	
	prevMarkBtn.addEventListener('click', () => {
		const marks = documentContent.querySelectorAll('.chapter-break-marker, .act-break-marker');
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
		
		importOverlayStatus.textContent = t('import.importingContent');
		importOverlay.classList.remove('hidden');
		
		const blockSize = parseInt(blockSizeInput.value, 10);
		const acts = [];
		let currentAct = { title: 'Act 1', chapters: [] };
		let currentChapter = { title: 'Chapter 1', content: [] };
		let globalBlockNumber = 1;
		
		const allNodes = documentContent.childNodes;
		
		for (const node of allNodes) {
			if (node.nodeType !== Node.ELEMENT_NODE) continue;
			
			const isActBreak = node.classList.contains('act-break-marker');
			const isChapterBreak = node.classList.contains('chapter-break-marker');
			
			if (isActBreak || isChapterBreak) {
				if (currentChapter.content.length > 0) {
					const result = insertTranslationBlockPlaceholders(currentChapter.content, blockSize, globalBlockNumber);
					currentChapter.content = result.html;
					globalBlockNumber = result.nextBlockNumber;
					currentAct.chapters.push(currentChapter);
				}
				
				if (isActBreak) {
					if (currentAct.chapters.length > 0) {
						acts.push(currentAct);
					}
					currentAct = { title: node.dataset.title || `Act ${acts.length + 1}`, chapters: [] };
				}
				
				currentChapter = { title: node.dataset.title || `Chapter ${currentAct.chapters.length + 1}`, content: [] };
				
			} else if (node.tagName === 'P') {
				currentChapter.content.push(node.textContent.trim());
			}
		}
		
		if (currentChapter.content.length > 0) {
			const result = insertTranslationBlockPlaceholders(currentChapter.content, blockSize, globalBlockNumber);
			currentChapter.content = result.html;
			currentAct.chapters.push(currentChapter);
		}
		if (currentAct.chapters.length > 0) {
			acts.push(currentAct);
		}
		
		if (acts.length === 0 && allNodes.length > 0) {
			const allContent = Array.from(allNodes)
				.filter(node => node.tagName === 'P')
				.map(p => p.textContent.trim());
			
			if (allContent.length > 0) {
				const result = insertTranslationBlockPlaceholders(allContent, blockSize, globalBlockNumber);
				currentChapter.content = result.html;
				currentAct.chapters.push(currentChapter);
				acts.push(currentAct);
			}
		}
		
		if (acts.length === 0) {
			window.showAlert(t('import.alertNoContent'));
			importOverlay.classList.add('hidden');
			return;
		}
		
		try {
			await window.api.importDocumentAsNovel({
				title: titleInput.value.trim(),
				source_language: sourceLangSelect.value,
				target_language: targetLangSelect.value,
				acts: acts
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
});
