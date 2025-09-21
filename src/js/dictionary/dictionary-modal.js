import { t, applyTranslationsTo } from '../i18n.js';

let dictionaryModal;
let dictionaryTableBody;
let dictionaryNoEntriesMessage;
let dictionaryAddRowBtn;
let dictionaryDeleteSelectedBtn;
let dictionarySaveBtn;
let currentNovelId;
let currentDictionaryData = []; // [{source: "term", target: "translation"}]
let currentSort = { sortBy: null, direction: 'asc' };

/**
 * Updates the currentDictionaryData array with values from the DOM inputs.
 * This is crucial to capture unsaved edits before re-rendering or saving,
 * preventing data loss when the table is refreshed (e.g., after adding a row).
 */
function updateCurrentDictionaryDataFromDOM() {
	const updatedData = [];
	Array.from(dictionaryTableBody.rows).forEach(row => {
		const sourceInput = row.cells[1].querySelector('input');
		const targetInput = row.cells[2].querySelector('input');
		// Always include the row, even if empty, to preserve its position if it's a new, unedited row.
		// Empty rows will be filtered out during the final saveDictionary() call.
		updatedData.push({
			source: sourceInput ? sourceInput.value.trim() : '',
			target: targetInput ? targetInput.value.trim() : ''
		});
	});
	currentDictionaryData = updatedData;
}

/**
 * Renders the dictionary table with the current data.
 */
function renderDictionaryTable() {
	dictionaryTableBody.innerHTML = '';
	if (currentDictionaryData.length === 0) {
		dictionaryNoEntriesMessage.classList.remove('hidden');
		dictionaryDeleteSelectedBtn.disabled = true;
		return;
	}
	
	dictionaryNoEntriesMessage.classList.add('hidden');
	
	currentDictionaryData.forEach((entry, index) => {
		const row = dictionaryTableBody.insertRow();
		row.dataset.index = index; // Store index for easy deletion
		
		const checkboxCell = row.insertCell();
		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.className = 'checkbox checkbox-sm row-select-checkbox';
		checkboxCell.appendChild(checkbox);
		
		const sourceCell = row.insertCell();
		const sourceInput = document.createElement('input');
		sourceInput.type = 'text';
		sourceInput.className = 'input input-ghost input-sm w-full';
		sourceInput.value = entry.source;
		sourceInput.placeholder = t('editor.dictionaryModal.sourceTerm');
		sourceCell.appendChild(sourceInput);
		
		const targetCell = row.insertCell();
		const targetInput = document.createElement('input');
		targetInput.type = 'text';
		targetInput.className = 'input input-ghost input-sm w-full';
		targetInput.value = entry.target;
		targetInput.placeholder = t('editor.dictionaryModal.targetTranslation');
		targetCell.appendChild(targetInput);
	});
	
	updateDeleteButtonState();
	updateSortButtonIcons();
}

/**
 * Adds a new empty row to the dictionary table.
 * When called without arguments (e.g., by clicking the "Add Row" button), it adds a blank row.
 * @param {string} sourceText - Optional text to pre-fill the source column.
 * @param {string} targetText - Optional text to pre-fill the target column.
 */
function addRow(sourceText = '', targetText = '') {
	console.log('addRow called with:', { sourceText, targetText });
	updateCurrentDictionaryDataFromDOM();
	currentDictionaryData.push({ source: sourceText, target: targetText });
	renderDictionaryTable();
}

/**
 * Deletes selected rows from the dictionary table.
 */
function deleteSelectedRows() {
	updateCurrentDictionaryDataFromDOM();
	
	const selectedCheckboxes = Array.from(dictionaryTableBody.querySelectorAll('.row-select-checkbox:checked'));
	if (selectedCheckboxes.length === 0) return;
	
	// Collect indices to delete in reverse order to avoid issues with shifting indices
	const indicesToDelete = selectedCheckboxes
		.map(cb => parseInt(cb.closest('tr').dataset.index, 10))
		.sort((a, b) => b - a);
	
	indicesToDelete.forEach(index => {
		currentDictionaryData.splice(index, 1);
	});
	
	renderDictionaryTable();
}

/**
 * Updates the state of the delete button based on selected checkboxes.
 */
function updateDeleteButtonState() {
	const anySelected = dictionaryTableBody.querySelectorAll('.row-select-checkbox:checked').length > 0;
	dictionaryDeleteSelectedBtn.disabled = !anySelected;
}

/**
 * Saves the current dictionary data to the main process.
 */
async function saveDictionary() {
	const updatedData = [];
	Array.from(dictionaryTableBody.rows).forEach(row => {
		const sourceInput = row.cells[1].querySelector('input');
		const targetInput = row.cells[2].querySelector('input');
		if (sourceInput.value.trim() || targetInput.value.trim()) {
			updatedData.push({
				source: sourceInput.value.trim(),
				target: targetInput.value.trim()
			});
		}
	});
	currentDictionaryData = updatedData;
	
	try {
		await window.api.saveNovelDictionary(currentNovelId, currentDictionaryData);
		dictionaryModal.close();
	} catch (error) {
		console.error('Failed to save dictionary:', error);
		window.showAlert(t('common.error') + ': ' + error.message);
	}
}

/**
 * Loads the dictionary data for the current novel from the main process.
 */
async function loadDictionary() {
	try {
		const data = await window.api.getNovelDictionary(currentNovelId);
		currentDictionaryData = data || [];
		if (currentSort.sortBy) {
			sortDictionary(currentSort.sortBy, currentSort.direction, false);
		}
		renderDictionaryTable();
	} catch (error) {
		console.error('Failed to load dictionary:', error);
		window.showAlert(t('common.error') + ': ' + error.message);
		currentDictionaryData = [];
		renderDictionaryTable();
	}
}

/**
 * Sorts the dictionary data by a given key and direction.
 * @param {string} sortBy - 'source' or 'target'.
 * @param {'asc'|'desc'} direction - 'asc' for ascending, 'desc' for descending.
 * @param {boolean} shouldRender - Whether to re-render the table after sorting.
 */
function sortDictionary(sortBy, direction, shouldRender = true) {
	updateCurrentDictionaryDataFromDOM();
	
	currentDictionaryData.sort((a, b) => {
		const valA = a[sortBy].toLowerCase();
		const valB = b[sortBy].toLowerCase();
		
		if (valA < valB) return direction === 'asc' ? -1 : 1;
		if (valA > valB) return direction === 'asc' ? 1 : -1;
		return 0;
	});
	
	currentSort = { sortBy, direction };
	if (shouldRender) {
		renderDictionaryTable();
	}
}

/**
 * Updates the icons of the sort buttons to reflect the current sort state.
 */
function updateSortButtonIcons() {
	const sortButtons = dictionaryModal.querySelectorAll('.js-sort-btn');
	sortButtons.forEach(button => {
		const sortBy = button.dataset.sortBy;
		const icon = button.querySelector('i');
		
		// Reset all icons to default
		icon.className = 'bi bi-sort-alpha-down'; // Default ascending icon
		button.dataset.sortDirection = 'asc'; // Reset data attribute
		
		if (currentSort.sortBy === sortBy) {
			// If this column is currently sorted, update its icon and data attribute
			if (currentSort.direction === 'asc') {
				icon.className = 'bi bi-sort-alpha-down';
				button.dataset.sortDirection = 'asc';
			} else {
				icon.className = 'bi bi-sort-alpha-up';
				button.dataset.sortDirection = 'desc';
			}
		}
	});
}

/**
 * Initializes the dictionary modal and its event listeners.
 * @param {string} novelId - The ID of the current novel.
 */
export function initDictionaryModal(novelId) {
	currentNovelId = novelId;
	dictionaryModal = document.getElementById('dictionary-modal');
	dictionaryTableBody = document.getElementById('dictionary-table-body');
	dictionaryNoEntriesMessage = document.getElementById('dictionary-no-entries');
	dictionaryAddRowBtn = document.getElementById('dictionary-add-row-btn');
	dictionaryDeleteSelectedBtn = document.getElementById('dictionary-delete-selected-btn');
	dictionarySaveBtn = document.getElementById('dictionary-save-btn');
	
	if (!dictionaryModal) {
		console.error('Dictionary modal element not found.');
		return;
	}
	
	applyTranslationsTo(dictionaryModal); // Apply translations on init
	
	dictionaryAddRowBtn.addEventListener('click', () => addRow());
	dictionaryDeleteSelectedBtn.addEventListener('click', deleteSelectedRows);
	dictionarySaveBtn.addEventListener('click', saveDictionary);
	
	dictionaryModal.querySelectorAll('.js-sort-btn').forEach(button => {
		button.addEventListener('click', (event) => {
			const sortBy = event.currentTarget.dataset.sortBy;
			let direction = event.currentTarget.dataset.sortDirection;
			
			if (currentSort.sortBy === sortBy) {
				direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
			} else {
				direction = 'asc';
			}
			
			sortDictionary(sortBy, direction);
		});
	});
	
	dictionaryTableBody.addEventListener('change', (event) => {
		if (event.target.classList.contains('row-select-checkbox')) {
			updateDeleteButtonState();
		}
	});
	
	// When the modal is opened, load the dictionary data
	// The 'showModal' event is custom, triggered by openDictionaryModal
	dictionaryModal.addEventListener('showModal', loadDictionary);
	
	// When the modal is closed via the 'X' button or backdrop click, ensure data is reloaded on next open
	dictionaryModal.addEventListener('close', () => {
		// Removed: currentDictionaryData = [];
		// The dictionary content will now be fetched directly via IPC when needed by AI prompts.
		currentSort = { sortBy: null, direction: 'asc' }; // Reset sort state on close.
	});
}

/**
 * Opens the dictionary modal.
 * @param {string} selectedText - Optional text to pre-fill a new row.
 * @param {'source'|'target'} sourceOrTarget - Indicates if selectedText is for source or target.
 */
export async function openDictionaryModal(selectedText = '', sourceOrTarget = '') {
	if (dictionaryModal) {
		currentDictionaryData = []; // Clear local data before loading to ensure fresh state for modal.
		currentSort = { sortBy: null, direction: 'asc' }; // Reset sort state before loading.
		await loadDictionary(); // Load existing data from file.
		
		if (selectedText) { // If text is selected, add a pre-filled row.
			if (sourceOrTarget === 'source') {
				addRow(selectedText, '');
			} else if (sourceOrTarget === 'target') {
				addRow('', selectedText);
			}
		}
		
		dictionaryModal.showModal();
	}
}
