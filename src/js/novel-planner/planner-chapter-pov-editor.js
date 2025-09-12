/**
 * This module handles the chapter-specific Point of View (POV) editor modal.
 * @param {HTMLElement} desktop - The main desktop element to attach listeners to.
 */
export function setupChapterPovEditor(desktop) {
	const modal = document.getElementById('chapter-pov-modal');
	if (!modal) return;
	
	const form = document.getElementById('chapter-pov-form');
	const errorContainer = document.getElementById('chapter-pov-error-container');
	const chapterIdInput = document.getElementById('pov-chapter-id');
	const povTypeSelect = document.getElementById('chapter_pov_type');
	const povCharacterSelect = document.getElementById('chapter_pov_character');
	const saveBtn = modal.querySelector('.js-save-pov-btn');
	const deleteBtn = modal.querySelector('.js-delete-pov-override-btn');
	const closeBtn = modal.querySelector('.js-close-pov-modal');
	
	/**
	 * Opens and populates the POV modal with data for a specific chapter.
	 * @param {string} chapterId - The ID of the chapter to edit.
	 */
	async function openPovModal(chapterId) {
		chapterIdInput.value = chapterId;
		errorContainer.classList.add('hidden');
		errorContainer.textContent = '';
		form.reset();
		
		try {
			const data = await window.api.getPovDataForChapter(chapterId);
			
			// Populate POV type dropdown.
			povTypeSelect.value = data.currentPov;
			
			// Populate character dropdown.
			povCharacterSelect.innerHTML = '<option value="">— None —</option>';
			data.characters.forEach(char => {
				const option = new Option(char.title, char.id);
				povCharacterSelect.appendChild(option);
			});
			povCharacterSelect.value = data.currentCharacterId || '';
			
			// Enable or disable the "Delete Override" button based on whether an override exists.
			deleteBtn.disabled = !data.isOverride;
			
			modal.showModal();
		} catch (error) {
			console.error('Failed to load POV data:', error);
			alert('Could not load POV settings for this chapter.');
		}
	}
	
	/**
	 * Updates the POV display within a chapter window after a change.
	 * @param {string} chapterId - The ID of the chapter whose display to update.
	 * @param {object} updatedData - The new POV data from the backend.
	 */
	function updatePovDisplay(chapterId, updatedData) {
		const chapterWindow = document.getElementById(`chapter-${chapterId}`);
		if (!chapterWindow) return;
		
		const povDisplayMap = {
			'first_person': '1st Person',
			'second_person': '2nd Person',
			'third_person': '3rd Person',
			'third_person_limited': '3rd Person (Limited)',
			'third_person_omniscient': '3rd Person (Omniscient)',
		};
		
		const povType = updatedData.pov || updatedData.novel_default_pov;
		const povTypeDisplay = povDisplayMap[povType] || 'Not Set';
		const povCharacterHtml = updatedData.pov_character_name ? ` &ndash; <span class="italic">${updatedData.pov_character_name}</span>` : '';
		const povSourceText = updatedData.pov ? 'This chapter has a custom POV.' : "Using novel's default POV setting.";
		
		const typeEl = chapterWindow.querySelector('.js-pov-display-type');
		const charEl = chapterWindow.querySelector('.js-pov-display-character');
		const sourceEl = chapterWindow.querySelector('.js-pov-display-source-text');
		
		if (typeEl) typeEl.textContent = povTypeDisplay;
		if (charEl) charEl.innerHTML = povCharacterHtml;
		if (sourceEl) sourceEl.textContent = povSourceText;
		
		// Also update the delete button state for the next time the modal is opened.
		const openBtn = chapterWindow.querySelector('.js-open-pov-modal');
		if (openBtn) {
			// This is an indirect way to store state, but it works for now.
			// A better approach might be a data attribute.
			deleteBtn.disabled = !updatedData.pov;
		}
	}
	
	// --- Event Listeners ---
	
	// Listener to open the modal from a chapter window.
	desktop.addEventListener('click', (event) => {
		const openBtn = event.target.closest('.js-open-pov-modal');
		if (openBtn) {
			openPovModal(openBtn.dataset.chapterId);
		}
	});
	
	// Listener for form submission (Save).
	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const chapterId = chapterIdInput.value;
		const pov = povTypeSelect.value;
		const pov_character_id = povCharacterSelect.value;
		
		const btnText = saveBtn.querySelector('.js-btn-text');
		const spinner = saveBtn.querySelector('.js-spinner');
		btnText.classList.add('hidden');
		spinner.classList.remove('hidden');
		saveBtn.disabled = true;
		
		try {
			const result = await window.api.updateChapterPov({chapterId, pov, pov_character_id});
			if (result.success) {
				updatePovDisplay(chapterId, result.updatedChapter);
				modal.close();
			} else {
				throw new Error(result.message || 'Failed to save POV settings.');
			}
		} catch (error) {
			errorContainer.textContent = error.message;
			errorContainer.classList.remove('hidden');
		} finally {
			btnText.classList.remove('hidden');
			spinner.classList.add('hidden');
			saveBtn.disabled = false;
		}
	});
	
	// Listener for the "Delete Override" button.
	deleteBtn.addEventListener('click', async () => {
		const chapterId = chapterIdInput.value;
		if (!confirm("Are you sure you want to remove this chapter's custom POV? It will revert to the novel's default setting.")) {
			return;
		}
		
		deleteBtn.disabled = true;
		
		try {
			const result = await window.api.deleteChapterPovOverride(chapterId);
			if (result.success) {
				updatePovDisplay(chapterId, result.updatedChapter);
				modal.close();
			} else {
				throw new Error(result.message || 'Failed to delete override.');
			}
		} catch (error) {
			errorContainer.textContent = error.message;
			errorContainer.classList.remove('hidden');
		} finally {
			// The button state will be correctly set the next time the modal is opened.
		}
	});
	
	// Listener for the "Cancel" button.
	closeBtn.addEventListener('click', () => {
		modal.close();
	});
}
