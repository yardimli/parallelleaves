// src/js/dictionary/dictionary-modal.js
import { t, applyTranslationsTo } from '../i18n.js';

let dictionaryModal;
let dictionaryTableBody;
let dictionaryNoEntriesMessage;
let dictionaryAddRowBtn;
let dictionaryDeleteSelectedBtn;
let dictionarySaveBtn;
let currentNovelId;
let currentDictionaryData = []; // [{source: "term", target: "translation"}]

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
}

/**
 * Adds a new empty row to the dictionary table.
 */
function addRow() {
	currentDictionaryData.push({ source: '', target: '' });
	renderDictionaryTable();
}

/**
 * Deletes selected rows from the dictionary table.
 */
function deleteSelectedRows() {
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
		if (sourceInput.value.trim() || targetInput.value.trim()) { // Only save non-empty rows
			updatedData.push({
				source: sourceInput.value.trim(),
				target: targetInput.value.trim()
			});
		}
	});
	currentDictionaryData = updatedData; // Update local state with cleaned data
	
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
		renderDictionaryTable();
	} catch (error) {
		console.error('Failed to load dictionary:', error);
		window.showAlert(t('common.error') + ': ' + error.message);
		currentDictionaryData = [];
		renderDictionaryTable();
	}
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
	
	dictionaryAddRowBtn.addEventListener('click', addRow);
	dictionaryDeleteSelectedBtn.addEventListener('click', deleteSelectedRows);
	dictionarySaveBtn.addEventListener('click', saveDictionary);
	
	// Event listener for checkbox changes to update delete button state
	dictionaryTableBody.addEventListener('change', (event) => {
		if (event.target.classList.contains('row-select-checkbox')) {
			updateDeleteButtonState();
		}
	});
	
	// When the modal is opened, load the dictionary data
	dictionaryModal.addEventListener('showModal', loadDictionary);
	
	// When the modal is closed via the 'X' button or backdrop click, ensure data is reloaded on next open
	dictionaryModal.addEventListener('close', () => {
		// If not saved, revert to previous state on next open
		currentDictionaryData = [];
	});
}

/**
 * Opens the dictionary modal.
 */
export function openDictionaryModal() {
	if (dictionaryModal) {
		dictionaryModal.showModal();
	}
}

/**
 * Gets the current dictionary content as a plain text string (key = value format).
 * @returns {string} The dictionary content formatted for AI prompt.
 */
export function getDictionaryContentForAI() {
	return currentDictionaryData.map(entry => `${entry.source} = ${entry.target}`).join('\n');
}
