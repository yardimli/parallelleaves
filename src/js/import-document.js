import { initI18n, t } from './i18n.js';

document.addEventListener('DOMContentLoaded', async () => { // MODIFIED: Make async
	// MODIFIED: Initialize i18n
	await initI18n();
	
	// ADDED SECTION START
	/**
	 * Displays a custom modal alert to prevent focus issues with native alerts.
	 * @param {string} message - The message to display.
	 * @param {string} [title='Error'] - The title for the alert modal.
	 */
	window.showAlert = function(message, title = t('common.information')) { // MODIFIED
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
	// ADDED SECTION END
	
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
		sourceLangSelect.value = 'English';
		targetLangSelect.value = 'Spanish';
	}
	
	function setButtonLoading(button, isLoading) {
		const content = button.querySelector('.js-btn-content');
		const spinner = button.querySelector('.js-btn-spinner');
		button.disabled = isLoading;
		if (content) content.classList.toggle('hidden', isLoading);
		if (spinner) spinner.classList.toggle('hidden', !isLoading);
	}
	
	function updateNavButtonState() {
		const marks = documentContent.querySelectorAll('.chapter-break, .act-break');
		const hasMarks = marks.length > 0;
		prevMarkBtn.disabled = !hasMarks;
		nextMarkBtn.disabled = !hasMarks;
	}
	
	function updateStatus() {
		const actBreaks = documentContent.querySelectorAll('.act-break').length;
		const chapterBreaks = documentContent.querySelectorAll('.chapter-break').length;
		const hasContent = documentContent.querySelector('p');
		
		const actCount = hasContent ? actBreaks + 1 : 0;
		const chapterCount = hasContent ? actBreaks + chapterBreaks + 1 : 0;
		
		if (chapterCount === 0) {
			importStatus.textContent = t('import.status');
		} else {
			// MODIFIED: Use translation keys for status summary
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
	 * @returns {string} The final HTML content for the chapter with placeholders like {{TranslationBlock-1}}.
	 */
	function insertTranslationBlockPlaceholders(paragraphsArray, blockSize) {
		if (!paragraphsArray || paragraphsArray.length === 0) {
			return '';
		}
		
		// If no block size is specified, just return the joined paragraphs.
		if (!blockSize || blockSize <= 0) {
			return `<p>${paragraphsArray.join('</p><p>')}</p>`;
		}
		
		let finalHtml = '';
		let wordCountSinceLastMarker = 0;
		let blockNumber = 1;
		
		// Always start with the first block marker.
		finalHtml += `{{TranslationBlock-${blockNumber}}}`;
		blockNumber++;
		
		for (const pText of paragraphsArray) {
			finalHtml += `<p>${pText}</p>`;
			const wordsInP = pText.split(/\s+/).filter(Boolean).length;
			
			if (wordsInP > 0) {
				wordCountSinceLastMarker += wordsInP;
			}
			
			// If the word count exceeds the block size, insert a new placeholder.
			if (wordCountSinceLastMarker >= blockSize && wordsInP > 0) {
				finalHtml += `{{TranslationBlock-${blockNumber}}}`;
				wordCountSinceLastMarker = 0; // Reset counter
				blockNumber++;
			}
		}
		return finalHtml;
	}
	
	selectFileBtn.addEventListener('click', async () => {
		const filePath = await window.api.showOpenDocumentDialog();
		if (filePath) {
			currentFilePath = filePath;
			currentMarkIndex = -1;
			const fileName = filePath.split(/[\\/]/).pop();
			titleInput.value = fileName.substring(0, fileName.lastIndexOf('.')).replace(/[-_]/g, ' ');
			
			// MODIFIED: Use translation
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
			} catch (error) {
				console.error('Error reading file:', error);
				// MODIFIED: Use translation
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
		const action = event.target.closest('button')?.dataset.action;
		if (!action || !targetedParagraph) return;
		
		targetedParagraph.classList.remove('act-break', 'chapter-break');
		
		if (action === 'set-act') {
			targetedParagraph.classList.add('act-break');
		} else if (action === 'set-chapter') {
			targetedParagraph.classList.add('chapter-break');
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
		const paragraphs = documentContent.querySelectorAll('p');
		const isNumeric = /^\d+$/;
		const isRoman = /^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i;
		
		paragraphs.forEach(p => {
			const text = p.textContent.trim();
			if (isNumeric.test(text) || isRoman.test(text)) {
				p.classList.remove('act-break');
				p.classList.add('chapter-break');
			}
		});
		
		currentMarkIndex = -1;
		updateStatus();
	});
	
	nextMarkBtn.addEventListener('click', () => {
		const marks = documentContent.querySelectorAll('.chapter-break, .act-break');
		if (marks.length === 0) return;
		
		currentMarkIndex++;
		if (currentMarkIndex >= marks.length) {
			currentMarkIndex = 0;
		}
		
		marks[currentMarkIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
	});
	
	prevMarkBtn.addEventListener('click', () => {
		const marks = documentContent.querySelectorAll('.chapter-break, .act-break');
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
			window.showAlert(t('import.alertNoTitle')); // MODIFIED
			return;
		}
		
		setButtonLoading(startImportBtn, true);
		
		const blockSize = parseInt(blockSizeInput.value, 10);
		const acts = [];
		let currentAct = { title: 'Act 1', chapters: [] };
		let currentChapter = { title: 'Chapter 1', content: [] };
		
		const paragraphs = documentContent.querySelectorAll('p');
		
		for (const p of paragraphs) {
			const isActBreak = p.classList.contains('act-break');
			const isChapterBreak = p.classList.contains('chapter-break');
			
			if (isActBreak || isChapterBreak) {
				if (currentChapter.content.length > 0) {
					currentChapter.content = insertTranslationBlockPlaceholders(currentChapter.content, blockSize);
					currentAct.chapters.push(currentChapter);
				}
				
				if (isActBreak) {
					if (currentAct.chapters.length > 0) {
						acts.push(currentAct);
					}
					currentAct = { title: p.textContent.trim() || `Act ${acts.length + 1}`, chapters: [] };
				}
				
				currentChapter = { title: p.textContent.trim() || `Chapter ${currentAct.chapters.length + 1}`, content: [] };
				
			} else {
				currentChapter.content.push(p.textContent.trim());
			}
		}
		
		if (currentChapter.content.length > 0) {
			currentChapter.content = insertTranslationBlockPlaceholders(currentChapter.content, blockSize);
			currentAct.chapters.push(currentChapter);
		}
		if (currentAct.chapters.length > 0) {
			acts.push(currentAct);
		}
		
		if (acts.length === 0 && paragraphs.length > 0) {
			const allContent = Array.from(paragraphs).map(p => p.textContent.trim());
			currentChapter.content = insertTranslationBlockPlaceholders(allContent, blockSize);
			currentAct.chapters.push(currentChapter);
			acts.push(currentAct);
		}
		
		if (acts.length === 0) {
			window.showAlert(t('import.alertNoContent')); // MODIFIED
			setButtonLoading(startImportBtn, false);
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
			// MODIFIED: Use translation
			window.showAlert(t('import.errorImport', { message: error.message }), t('common.error'));
			setButtonLoading(startImportBtn, false);
		}
	});
	
	populateLanguages();
});
