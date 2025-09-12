/**
 * Manages the creation of new chapters via a modal dialog.
 */

document.addEventListener('DOMContentLoaded', () => {
	const desktop = document.getElementById('desktop');
	if (!desktop) return;
	
	const newChapterModal = document.getElementById('new-chapter-modal');
	const newChapterForm = document.getElementById('new-chapter-form');
	
	if (!newChapterModal || !newChapterForm) return;
	
	// --- Modal Opening/Closing ---
	desktop.addEventListener('click', (event) => {
		if (event.target.closest('.js-open-new-chapter-modal')) {
			newChapterModal.showModal();
		}
	});
	
	newChapterModal.addEventListener('click', (event) => {
		if (event.target.closest('.js-close-new-chapter-modal')) {
			resetAndCloseModal();
		}
	});
	
	// --- Form Submission ---
	newChapterForm.addEventListener('submit', async (event) => {
		event.preventDefault();
		
		const submitBtn = newChapterForm.querySelector('.js-new-chapter-submit-btn');
		setButtonLoadingState(submitBtn, true);
		clearFormErrors();
		
		const formData = new FormData(newChapterForm);
		const data = Object.fromEntries(formData.entries());
		
		try {
			const novelId = document.body.dataset.novelId;
			if (!novelId) throw new Error('Novel ID not found.');
			
			const result = await window.api.createChapter(novelId, data);
			if (!result.success) throw new Error(result.message || 'Failed to create chapter.');
			
			await updateOutlineUI(result.chapter, result.reorderedChapters);
			resetAndCloseModal();
			
		} catch (error) {
			console.error('Error creating chapter:', error);
			displayGenericError(error.message);
		} finally {
			setButtonLoadingState(submitBtn, false);
		}
	});
	
	// --- Helper Functions ---
	
	function setButtonLoadingState(button, isLoading) {
		const text = button.querySelector('.js-btn-text');
		const spinner = button.querySelector('.js-spinner');
		if (isLoading) {
			button.disabled = true;
			if (text) text.classList.add('hidden');
			if (spinner) spinner.classList.remove('hidden');
		} else {
			button.disabled = false;
			if (text) text.classList.remove('hidden');
			if (spinner) spinner.classList.add('hidden');
		}
	}
	
	function resetAndCloseModal() {
		newChapterModal.close();
		newChapterForm.reset();
		clearFormErrors();
	}
	
	function clearFormErrors() {
		const errorContainer = newChapterForm.querySelector('#new-chapter-error-container');
		errorContainer.classList.add('hidden');
		errorContainer.textContent = '';
	}
	
	function displayGenericError(message) {
		const errorContainer = newChapterForm.querySelector('#new-chapter-error-container');
		errorContainer.textContent = message;
		errorContainer.classList.remove('hidden');
	}
	
	async function updateOutlineUI(newChapter, reorderedChapters) {
		const outlineWindow = document.getElementById('planner/outline-window');
		if (!outlineWindow) return;
		
		// 1. Create the new chapter element
		const chapterTemplateHtml = await window.api.getTemplate('planner/outline-chapter');
		const summaryHtml = newChapter.summary ? `<p class="text-xs text-base-content/70 mt-1 font-normal normal-case">${newChapter.summary}</p>` : '';
		const newChapterHtml = chapterTemplateHtml
			.replace('{{CHAPTER_ID}}', newChapter.id)
			.replace(/{{CHAPTER_TITLE}}/g, newChapter.title)
			.replace('{{CHAPTER_ORDER}}', newChapter.chapter_order)
			.replace('{{CHAPTER_SUMMARY_HTML}}', summaryHtml);
		
		const tempDiv = document.createElement('div');
		tempDiv.innerHTML = newChapterHtml.trim();
		const newChapterElement = tempDiv.firstElementChild;
		
		// 2. Find where to insert it
		const position = newChapterForm.querySelector('#new-chapter-position').value;
		const [type, id] = position.split('-');
		
		const sectionContainer = outlineWindow.querySelector(`.p-3[data-section-id="${newChapter.section_id}"]`);
		if (!sectionContainer) return;
		const chaptersList = sectionContainer.querySelector('.space-y-2');
		if (!chaptersList) return;
		
		// Remove any "No chapters" placeholder
		const placeholder = chaptersList.querySelector('p');
		if (placeholder) placeholder.remove();
		
		if (type === 'section') {
			chaptersList.prepend(newChapterElement);
		} else if (type === 'chapter') {
			// Insert after the specified chapter
			const targetChapterElement = chaptersList.querySelector(`.js-open-chapter[data-chapter-id="${id}"]`);
			if (targetChapterElement) {
				targetChapterElement.after(newChapterElement);
			} else {
				// Fallback: append to the end if target not found
				chaptersList.appendChild(newChapterElement);
			}
		}
		
		// 3. Update the order numbers of subsequent chapters
		reorderedChapters.forEach(chapter => {
			const chapterElement = chaptersList.querySelector(`.js-open-chapter[data-chapter-id="${chapter.id}"]`);
			if (chapterElement) {
				const titleElement = chapterElement.querySelector('h4');
				if (titleElement) {
					titleElement.textContent = `${chapter.chapter_order}. ${chapter.title}`;
				}
			}
		});
		
		// 4. Update the position dropdown for the next creation by re-fetching the novel data.
		// This is simpler and more robust than trying to manipulate the DOM directly.
		const chapterPositionSelect = document.getElementById('new-chapter-position');
		if (chapterPositionSelect) {
			chapterPositionSelect.innerHTML = '<option value="" disabled selected>Insert after...</option>';
			const novelData = await window.api.getOneNovel(document.body.dataset.novelId);
			novelData.sections.forEach(section => {
				const sectionOption = new Option(`${section.title}`, `section-${section.id}`);
				sectionOption.classList.add('font-bold', 'text-indigo-500');
				chapterPositionSelect.appendChild(sectionOption);
				if (section.chapters && section.chapters.length > 0) {
					section.chapters.forEach(chapter => {
						const chapterOption = new Option(`  ${chapter.chapter_order}. ${chapter.title}`, `chapter-${chapter.id}`);
						chapterPositionSelect.appendChild(chapterOption);
					});
				}
			});
		}
	}
});
