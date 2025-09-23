import { t, applyTranslationsTo } from '../i18n.js';

let dictionaryModal;
let dictionaryTableBody;
let dictionaryNoEntriesMessage;
let dictionaryAddRowBtn;
let dictionaryDeleteSelectedBtn;
let dictionarySaveBtn;
let currentNovelId;
let currentDictionaryData = []; // [{source: "term", target: "translation", type: "translation"}]
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
		const typeSelect = row.cells[3].querySelector('select'); // Modified: Get type select element
		// Always include the row, even if empty, to preserve its position if it's a new, unedited row.
		// Empty rows will be filtered out during the final saveDictionary() call.
		updatedData.push({
			source: sourceInput ? sourceInput.value.trim() : '',
			target: targetInput ? targetInput.value.trim() : '',
			type: typeSelect ? typeSelect.value : 'translation' // Modified: Get type value, default to translation
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
		sourceInput.placeholder = t('dictionary.sourceTerm');
		sourceCell.appendChild(sourceInput);
		
		const targetCell = row.insertCell();
		const targetInput = document.createElement('input');
		targetInput.type = 'text';
		targetInput.className = 'input input-ghost input-sm w-full';
		targetInput.value = entry.target;
		targetInput.placeholder = t('dictionary.targetTranslation');
		targetCell.appendChild(targetInput);
		
		// New: Add type cell with a select dropdown
		const typeCell = row.insertCell();
		const typeSelect = document.createElement('select');
		typeSelect.className = 'select select-ghost select-sm w-full max-w-xs';
		
		const optionTranslation = document.createElement('option');
		optionTranslation.value = 'translation';
		optionTranslation.setAttribute('data-i18n', 'dictionary.typeTranslation');
		
		const optionRephrasing = document.createElement('option');
		optionRephrasing.value = 'rephrasing';
		optionRephrasing.setAttribute('data-i18n', 'dictionary.typeRephrasing');
		
		typeSelect.appendChild(optionTranslation);
		typeSelect.appendChild(optionRephrasing);
		
		// Set the selected option. Default to 'translation' if type is missing for backward compatibility.
		typeSelect.value = entry.type || 'translation';
		typeCell.appendChild(typeSelect);
		
		const actionsCell = row.insertCell();
		actionsCell.className = 'w-12'; // Set a fixed width for the actions cell
		const findReplaceBtn = document.createElement('button');
		findReplaceBtn.className = 'js-dictionary-find-replace-btn btn btn-ghost btn-xs btn-square';
		findReplaceBtn.setAttribute('data-i18n-title', 'dictionary.findAndReplace');
		findReplaceBtn.innerHTML = '<i class="bi bi-search-heart"></i>';
		actionsCell.appendChild(findReplaceBtn);
	});
	
	updateDeleteButtonState();
	updateSortButtonIcons();
	applyTranslationsTo(dictionaryTableBody); // Apply translations to newly created elements like tooltips and options
}

/**
 * Adds a new empty row to the dictionary table.
 * This is called by the "Add Row" button and preserves existing edits.
 * @param {string} sourceText - Optional text to pre-fill the source column.
 * @param {string} targetText - Optional text to pre-fill the target column.
 */
function addRow(sourceText = '', targetText = '') {
	updateCurrentDictionaryDataFromDOM(); // Save any unsaved edits before re-rendering
	// Modified: Add 'type' field to new row object, defaulting to 'translation'.
	currentDictionaryData.push({ source: sourceText, target: targetText, type: 'translation' });
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
		const typeSelect = row.cells[3].querySelector('select'); // Modified: Get type select element
		
		if (sourceInput.value.trim() || targetInput.value.trim()) {
			updatedData.push({
				source: sourceInput.value.trim(),
				target: targetInput.value.trim(),
				// Modified: Save type, defaulting to 'translation' if it's somehow missing.
				type: typeSelect ? typeSelect.value : 'translation'
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
 * Sorts the dictionary data by a given key and direction.
 * @param {string} sortBy - 'source', 'target', or 'type'.
 * @param {'asc'|'desc'} direction - 'asc' for ascending, 'desc' for descending.
 * @param {boolean} shouldRender - Whether to re-render the table after sorting.
 */
function sortDictionary(sortBy, direction, shouldRender = true) {
	updateCurrentDictionaryDataFromDOM();
	
	currentDictionaryData.sort((a, b) => {
		// Modified: Default type to 'translation' for sorting if it's missing from an old entry.
		const valA = (a[sortBy] || (sortBy === 'type' ? 'translation' : '')).toLowerCase();
		const valB = (b[sortBy] || (sortBy === 'type' ? 'translation' : '')).toLowerCase();
		
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
	
	dictionaryTableBody.addEventListener('click', (event) => {
		const findReplaceBtn = event.target.closest('.js-dictionary-find-replace-btn');
		if (findReplaceBtn) {
			const row = findReplaceBtn.closest('tr');
			// Get the current values from the input fields in the same row.
			const sourceInput = row.querySelector('td:nth-child(2) input');
			const targetInput = row.querySelector('td:nth-child(3) input');
			
			const sourceTerm = sourceInput.value.trim();
			const targetTerm = targetInput.value.trim();
			
			// Dispatch a custom event for the chapter editor to listen for.
			// This allows us to communicate with the editor without a direct dependency.
			if (sourceTerm) { // Only dispatch if there's a term to find.
				document.body.dispatchEvent(new CustomEvent('dictionary:find-replace', {
					detail: {
						find: sourceTerm,
						replace: targetTerm
					}
				}));
				dictionaryModal.close(); // Close the modal after triggering the action.
			}
		}
	});
	
	// When the modal is closed via the 'X' button or backdrop click, reset the sort state.
	dictionaryModal.addEventListener('close', () => {
		currentSort = { sortBy: null, direction: 'asc' }; // Reset sort state on close.
	});
}

/**
 * Opens the dictionary modal, loads data, and optionally pre-fills a new row.
 * @param {string} selectedText - Optional text to pre-fill a new row.
 * @param {'source'|'target'} sourceOrTarget - Indicates if selectedText is for source or target.
 */
export async function openDictionaryModal(selectedText = '', sourceOrTarget = '') {
	if (!dictionaryModal) return;
	
	try {
		// This new flow fetches data, modifies it in memory, and then renders the table just once.
		currentSort = { sortBy: null, direction: 'asc' }; // Reset sort state before loading.
		
		const data = await window.api.getNovelDictionary(currentNovelId);
		currentDictionaryData = data || [];
		
		// If text is selected, add a pre-filled row directly to the data array.
		if (selectedText) {
			// Modified: Add 'type' field to new row object.
			if (sourceOrTarget === 'source') {
				currentDictionaryData.push({ source: selectedText, target: '', type: 'translation' });
			} else if (sourceOrTarget === 'target') {
				currentDictionaryData.push({ source: '', target: selectedText, type: 'translation' });
			}
		}
		
		renderDictionaryTable(); // Render the table once with the final data.
		dictionaryModal.showModal();
	} catch (error) {
		console.error('Failed to open or load dictionary modal:', error);
		window.showAlert(t('common.error') + ': ' + error.message);
	}
}
