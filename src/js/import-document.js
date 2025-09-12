document.addEventListener('DOMContentLoaded', () => {
	const selectFileBtn = document.getElementById('select-file-btn');
	const startImportBtn = document.getElementById('start-import-btn');
	const autoDetectBtn = document.getElementById('auto-detect-btn');
	const prevMarkBtn = document.getElementById('prev-mark-btn');
	const nextMarkBtn = document.getElementById('next-mark-btn');
	const titleInput = document.getElementById('title');
	const authorInput = document.getElementById('author');
	const documentContent = document.getElementById('document-content');
	const importStatus = document.getElementById('js-import-status'); // MODIFIED: Get new status element
	const popover = document.getElementById('break-type-popover'); // NEW: Get popover element
	
	let currentFilePath = null;
	let currentMarkIndex = -1;
	let targetedParagraph = null; // NEW: To store the paragraph that was clicked
	
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
	
	// MODIFIED: Renamed and updated to count both acts and chapters
	function updateStatus() {
		const actBreaks = documentContent.querySelectorAll('.act-break').length;
		const chapterBreaks = documentContent.querySelectorAll('.chapter-break').length;
		const hasContent = documentContent.querySelector('p');
		
		const actCount = hasContent ? actBreaks + 1 : 0;
		const chapterCount = hasContent ? actBreaks + chapterBreaks + 1 : 0;
		
		if (chapterCount === 0) {
			importStatus.textContent = 'No content to import.';
		} else {
			const actText = actCount === 1 ? '1 Act' : `${actCount} Acts`;
			const chapterText = chapterCount === 1 ? '1 Chapter' : `${chapterCount} Chapters`;
			importStatus.textContent = `${actText} and ${chapterText} will be created.`;
		}
		
		updateNavButtonState();
	}
	
	function checkFormValidity() {
		const hasTitle = titleInput.value.trim() !== '';
		const hasAuthor = authorInput.value.trim() !== '';
		const hasContent = currentFilePath !== null;
		startImportBtn.disabled = !(hasTitle && hasAuthor && hasContent);
		autoDetectBtn.disabled = !hasContent;
	}
	
	// NEW: Function to show the popover menu
	function showPopover(event) {
		targetedParagraph = event.target;
		const rect = targetedParagraph.getBoundingClientRect();
		popover.style.left = `${event.clientX}px`;
		popover.style.top = `${event.clientY}px`;
		popover.classList.remove('hidden');
	}
	
	// NEW: Function to hide the popover menu
	function hidePopover() {
		popover.classList.add('hidden');
		targetedParagraph = null;
	}
	
	selectFileBtn.addEventListener('click', async () => {
		const filePath = await window.api.showOpenDocumentDialog();
		if (filePath) {
			currentFilePath = filePath;
			currentMarkIndex = -1;
			const fileName = filePath.split(/[\\/]/).pop();
			titleInput.value = fileName.substring(0, fileName.lastIndexOf('.')).replace(/[-_]/g, ' ');
			
			documentContent.innerHTML = '<div class="text-center"><span class="loading loading-spinner loading-lg"></span><p>Reading file...</p></div>';
			
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
				documentContent.innerHTML = `<p class="text-error">Error: Could not read the file. ${error.message}</p>`;
				currentFilePath = null;
			}
			updateStatus();
			checkFormValidity();
		}
	});
	
	// MODIFIED: Click listener now shows the popover
	documentContent.addEventListener('click', (event) => {
		if (event.target.tagName === 'P') {
			showPopover(event);
		}
	});
	
	// NEW: Handle clicks within the popover
	popover.addEventListener('click', (event) => {
		const action = event.target.closest('button')?.dataset.action;
		if (!action || !targetedParagraph) return;
		
		// Clear existing breaks before setting a new one
		targetedParagraph.classList.remove('act-break', 'chapter-break');
		
		if (action === 'set-act') {
			targetedParagraph.classList.add('act-break');
		} else if (action === 'set-chapter') {
			targetedParagraph.classList.add('chapter-break');
		}
		// If action is 'remove-break', we've already removed the classes.
		
		currentMarkIndex = -1;
		updateStatus();
		hidePopover();
	});
	
	// NEW: Hide popover if clicking outside of it
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
				p.classList.remove('act-break'); // Ensure it's not also an act break
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
	authorInput.addEventListener('input', checkFormValidity);
	
	// MODIFIED: The main import logic now builds a nested act/chapter structure
	startImportBtn.addEventListener('click', async () => {
		if (!titleInput.value.trim() || !authorInput.value.trim()) {
			alert('Please provide a title and author.');
			return;
		}
		
		setButtonLoading(startImportBtn, true);
		
		const acts = [];
		let currentAct = { title: 'Act 1', chapters: [] };
		let currentChapter = { title: 'Chapter 1', content: [] };
		
		const paragraphs = documentContent.querySelectorAll('p');
		
		for (const p of paragraphs) {
			const isActBreak = p.classList.contains('act-break');
			const isChapterBreak = p.classList.contains('chapter-break');
			
			if (isActBreak || isChapterBreak) {
				// Finalize the current chapter if it has content
				if (currentChapter.content.length > 0) {
					currentChapter.content = `<p>${currentChapter.content.join('</p><p>')}</p>`;
					currentAct.chapters.push(currentChapter);
				}
				
				if (isActBreak) {
					// Finalize the current act if it has chapters
					if (currentAct.chapters.length > 0) {
						acts.push(currentAct);
					}
					// Start a new act
					currentAct = { title: p.textContent.trim() || `Act ${acts.length + 1}`, chapters: [] };
				}
				
				// Start a new chapter
				currentChapter = { title: p.textContent.trim() || `Chapter ${currentAct.chapters.length + 1}`, content: [] };
				
			} else {
				// This is a content paragraph
				currentChapter.content.push(p.textContent.trim());
			}
		}
		
		// Finalize the last chapter and act after the loop
		if (currentChapter.content.length > 0) {
			currentChapter.content = `<p>${currentChapter.content.join('</p><p>')}</p>`;
			currentAct.chapters.push(currentChapter);
		}
		if (currentAct.chapters.length > 0) {
			acts.push(currentAct);
		}
		
		// If no breaks were made at all, create a default structure
		if (acts.length === 0 && paragraphs.length > 0) {
			const allContent = Array.from(paragraphs).map(p => p.textContent.trim());
			currentChapter.content = `<p>${allContent.join('</p><p>')}</p>`;
			currentAct.chapters.push(currentChapter);
			acts.push(currentAct);
		}
		
		if (acts.length === 0) {
			alert('No content to import.');
			setButtonLoading(startImportBtn, false);
			return;
		}
		
		try {
			// MODIFIED: Send the new data structure to the backend
			await window.api.importDocumentAsNovel({
				title: titleInput.value.trim(),
				author: authorInput.value.trim(),
				acts: acts
			});
		} catch (error) {
			console.error('Import failed:', error);
			alert(`Error during import: ${error.message}`);
			setButtonLoading(startImportBtn, false);
		}
	});
});
