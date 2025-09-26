import { initI18n, t, applyTranslationsTo } from './i18n.js';

let novelId = null;
let localStorageKey = null; // MODIFICATION: Key for storing results in localStorage

const AI_SETTINGS_KEYS = {
	MODEL: 'parallel-leaves-ai-model',
	TEMPERATURE: 'parallel-leaves-ai-temperature'
};

const modelSelect = document.getElementById('js-llm-model-select');
const tempSlider = document.getElementById('js-ai-temperature-slider');
const tempValue = document.getElementById('js-ai-temperature-value');
const startBtn = document.getElementById('js-start-analysis-btn');
const applyBtn = document.getElementById('js-apply-results-btn');
const resultsContainer = document.getElementById('js-analysis-results');
const statusText = document.getElementById('js-status-text');

/**
 * MODIFICATION START: New functions to manage localStorage
 * Saves the current state of the results from the DOM to localStorage.
 */
function saveResultsToLocalStorage() {
	if (!localStorageKey) return;
	
	const resultCards = Array.from(resultsContainer.querySelectorAll('.card'));
	const dataToSave = resultCards.map(card => {
		const marker = card.dataset.marker;
		const changes = {};
		card.querySelectorAll('tbody tr').forEach(row => {
			const original = row.querySelector('td:nth-child(1) textarea').value.trim();
			const edited = row.querySelector('td:nth-child(2) textarea').value.trim();
			if (original && edited) {
				changes[original] = edited;
			}
		});
		return { marker, changes };
	}).filter(item => Object.keys(item.changes).length > 0); // Only save cards that still have pairs
	
	localStorage.setItem(localStorageKey, JSON.stringify(dataToSave));
}

/**
 * Loads and renders results from localStorage when the window is opened.
 */
function loadResultsFromLocalStorage() {
	if (!localStorageKey) return;
	
	const savedData = localStorage.getItem(localStorageKey);
	if (savedData) {
		try {
			const results = JSON.parse(savedData);
			if (Array.isArray(results) && results.length > 0) {
				resultsContainer.innerHTML = ''; // Clear any placeholder text
				const title = document.createElement('h2');
				title.className = 'text-xl font-bold mb-2';
				title.setAttribute('data-i18n', 'editor.analysis.resultsTitle');
				resultsContainer.appendChild(title);
				
				results.forEach(result => renderResult(result));
				applyTranslationsTo(resultsContainer);
			}
		} catch (e) {
			console.error('Failed to parse analysis results from localStorage:', e);
			localStorage.removeItem(localStorageKey); // Clear corrupted data
		}
	}
	updateApplyButtonState();
}
// MODIFICATION END

async function populateModels() {
	try {
		const result = await window.api.getModels();
		if (result.success) {
			modelSelect.innerHTML = '';
			result.models.forEach(group => {
				const optgroup = document.createElement('optgroup');
				optgroup.label = group.group;
				group.models.forEach(model => {
					const option = new Option(`${model.name}`, model.id);
					optgroup.appendChild(option);
				});
				modelSelect.appendChild(optgroup);
			});
			
			const lastModel = localStorage.getItem(AI_SETTINGS_KEYS.MODEL);
			if (lastModel && modelSelect.querySelector(`option[value="${lastModel}"]`)) {
				modelSelect.value = lastModel;
			} else if (modelSelect.options.length > 0) {
				modelSelect.selectedIndex = 0;
				localStorage.setItem(AI_SETTINGS_KEYS.MODEL, modelSelect.value);
			}
		} else {
			throw new Error(result.message);
		}
	} catch (error) {
		console.error('Failed to load models:', error);
		modelSelect.innerHTML = `<option>${t('editor.chat.errorLoadModels')}</option>`;
		modelSelect.disabled = true;
	}
}

/**
 * Checks if any result pairs are left and enables/disables the Apply button.
 */
function updateApplyButtonState() {
	const remainingPairs = resultsContainer.querySelectorAll('tbody tr').length;
	applyBtn.disabled = remainingPairs === 0;
}

function renderResult(result) {
	if (!result || !result.changes || Object.keys(result.changes).length === 0) {
		return;
	}
	
	// MODIFICATION: Check if a card for this marker already exists to append to it.
	let card = resultsContainer.querySelector(`.card[data-marker="${result.marker}"]`);
	let tbody;
	
	if (!card) {
		card = document.createElement('div');
		card.className = 'card bg-base-200 shadow-xl';
		card.dataset.marker = result.marker; // MODIFICATION: Add marker data attribute for identification
		
		const cardBody = document.createElement('div');
		cardBody.className = 'card-body';
		
		const cardHeader = document.createElement('div');
		cardHeader.className = 'card-title';
		
		const title = document.createElement('h3');
		title.className = 'text-sm';
		title.textContent = `Changes in Marker #${result.marker}`;
		
		cardHeader.appendChild(title);
		cardBody.appendChild(cardHeader);
		
		const table = document.createElement('table');
		table.className = 'table table-sm';
		
		const thead = document.createElement('thead');
		thead.innerHTML = `
	        <tr>
	            <th class="w-[calc(50%-1.5rem)]" data-i18n="editor.analysis.original">Original</th>
	            <th class="w-[calc(50%-1.5rem)]" data-i18n="editor.analysis.edited">Edited</th>
	            <th class="w-12"></th>
	        </tr>
	    `;
		table.appendChild(thead);
		
		tbody = document.createElement('tbody');
		table.appendChild(tbody);
		cardBody.appendChild(table);
		card.appendChild(cardBody);
		resultsContainer.appendChild(card);
	} else {
		tbody = card.querySelector('tbody');
	}
	
	for (const [original, edited] of Object.entries(result.changes)) {
		const row = document.createElement('tr');
		
		const escapeHtml = (text) => {
			const div = document.createElement('div');
			div.textContent = text;
			return div.innerHTML;
		};
		
		row.innerHTML = `
            <td>
                <textarea class="textarea textarea-bordered textarea-sm w-full" rows="1">${escapeHtml(original)}</textarea>
            </td>
            <td>
                <textarea class="textarea textarea-bordered textarea-sm w-full" rows="1">${escapeHtml(edited)}</textarea>
            </td>
            <td>
                <button class="btn btn-ghost btn-xs btn-square js-delete-pair-btn" data-i18n-title="editor.analysis.deleteRow">
                    <i class="bi bi-x-lg"></i>
                </button>
            </td>
        `;
		tbody.appendChild(row);
	}
	
	// MODIFICATION: Attach event listeners to all textareas in the card for auto-saving and resizing.
	card.querySelectorAll('textarea').forEach(textarea => {
		const resize = () => {
			textarea.style.height = 'auto';
			textarea.style.height = `${textarea.scrollHeight}px`;
		};
		textarea.addEventListener('input', () => {
			resize();
			saveResultsToLocalStorage(); // Save on every edit
		});
		setTimeout(resize, 0); // Initial resize
	});
	
	applyTranslationsTo(card);
}

async function handleStartAnalysis() {
	startBtn.disabled = true;
	startBtn.querySelector('.loading').classList.remove('hidden');
	applyBtn.disabled = true;
	// MODIFICATION: Do not clear the container, just update status text.
	statusText.textContent = t('editor.analysis.loading');
	
	const selectedModel = modelSelect.value;
	const temperature = parseFloat(tempSlider.value);
	
	try {
		// The main process will now run the analysis on un-analyzed edits.
		await window.api.startAnalysis({ novelId, model: selectedModel, temperature });
	} catch (error) {
		statusText.textContent = `Error: ${error.message}`;
		startBtn.disabled = false;
		startBtn.querySelector('.loading').classList.add('hidden');
	}
}

async function handleApplyResults() {
	const resultCards = Array.from(resultsContainer.querySelectorAll('.card'));
	if (resultCards.length === 0) return;
	
	const newPairs = [];
	resultCards.forEach(card => {
		const tableRows = card.querySelectorAll('tbody tr');
		tableRows.forEach(row => {
			const originalTextarea = row.querySelector('td:nth-child(1) textarea');
			const editedTextarea = row.querySelector('td:nth-child(2) textarea');
			if (originalTextarea && editedTextarea && originalTextarea.value && editedTextarea.value) {
				newPairs.push({
					source: originalTextarea.value.trim(),
					target: editedTextarea.value.trim(),
					type: 'rephrasing' // All analyzed pairs are for rephrasing context
				});
			}
		});
	});
	
	applyBtn.disabled = true;
	const applyBtnSpan = applyBtn.querySelector('span');
	if (applyBtnSpan) applyBtnSpan.classList.add('loading');
	
	try {
		if (newPairs.length > 0) {
			const existingDictionary = await window.api.getNovelDictionary(novelId) || [];
			const updatedDictionary = [...existingDictionary];
			
			newPairs.forEach(newPair => {
				const isDuplicate = existingDictionary.some(existingPair =>
					existingPair.source === newPair.source && existingPair.target === newPair.target
				);
				if (!isDuplicate) {
					updatedDictionary.push(newPair);
				}
			});
			
			await window.api.saveNovelDictionary(novelId, updatedDictionary);
		}
		
		// MODIFICATION START: The call to mark edits as analyzed has been removed from this function.
		// It now happens automatically when the analysis finishes.
		
		// Clear localStorage on successful application.
		if (localStorageKey) {
			localStorage.removeItem(localStorageKey);
		}
		// MODIFICATION END
		
		window.close();
		
	} catch (error) {
		console.error('Failed to apply analysis results:', error);
		window.alert(`Error: ${error.message}`);
	} finally {
		applyBtn.disabled = false;
		if (applyBtnSpan) applyBtnSpan.classList.remove('loading');
	}
}

document.addEventListener('DOMContentLoaded', async () => {
	await initI18n();
	applyTranslationsTo(document.body);
	document.title = t('editor.analysis.title');
	
	const params = new URLSearchParams(window.location.search);
	novelId = params.get('novelId');
	
	if (!novelId) {
		resultsContainer.innerHTML = '<p class="text-error p-4">Error: Novel ID is missing.</p>';
		startBtn.disabled = true;
		return;
	}
	
	// MODIFICATION: Set the localStorage key and load any existing data.
	localStorageKey = `analysis-results-${novelId}`;
	loadResultsFromLocalStorage();
	
	// Setup AI settings controls
	const lastTemp = localStorage.getItem(AI_SETTINGS_KEYS.TEMPERATURE) || '0.7';
	tempSlider.value = lastTemp;
	tempValue.textContent = parseFloat(lastTemp).toFixed(1);
	
	tempSlider.addEventListener('input', () => {
		tempValue.textContent = parseFloat(tempSlider.value).toFixed(1);
	});
	tempSlider.addEventListener('change', () => {
		localStorage.setItem(AI_SETTINGS_KEYS.TEMPERATURE, tempSlider.value);
	});
	modelSelect.addEventListener('change', () => {
		localStorage.setItem(AI_SETTINGS_KEYS.MODEL, modelSelect.value);
	});
	
	await populateModels();
	
	startBtn.addEventListener('click', handleStartAnalysis);
	applyBtn.addEventListener('click', handleApplyResults);
	
	resultsContainer.addEventListener('click', (event) => {
		const deleteBtn = event.target.closest('.js-delete-pair-btn');
		if (deleteBtn) {
			const row = deleteBtn.closest('tr');
			const tbody = row.parentElement;
			const card = tbody.closest('.card');
			
			row.remove();
			
			if (tbody.children.length === 0) {
				card.remove();
			}
			
			updateApplyButtonState();
			saveResultsToLocalStorage(); // MODIFICATION: Save state after deletion
		}
	});
	
	let hasResultsHeader = resultsContainer.querySelector('h2') !== null;
	
	window.api.onAnalysisUpdate((update) => {
		if (!update || typeof update.type === 'undefined') {
			console.error('Received invalid update from main process:', update);
			statusText.textContent = 'Error: Received an invalid analysis update.';
			startBtn.disabled = false;
			startBtn.querySelector('.loading').classList.add('hidden');
			return;
		}
		
		switch (update.type) {
			case 'progress':
				statusText.textContent = update.message;
				break;
			case 'results':
				if (update.data && update.data.length > 0) {
					if (!hasResultsHeader) {
						const title = document.createElement('h2');
						title.className = 'text-xl font-bold mb-2';
						title.setAttribute('data-i18n', 'editor.analysis.resultsTitle');
						resultsContainer.insertBefore(title, resultsContainer.firstChild);
						applyTranslationsTo(title.parentElement);
						hasResultsHeader = true;
					}
					update.data.forEach(renderResult);
					// MODIFICATION: Save combined results to localStorage after receiving them.
					saveResultsToLocalStorage();
				}
				break;
			case 'finished':
				statusText.textContent = update.message;
				startBtn.disabled = false;
				startBtn.querySelector('.loading').classList.add('hidden');
				updateApplyButtonState();
				if (resultsContainer.querySelectorAll('tbody tr').length === 0) {
					statusText.textContent = t('editor.analysis.noResults');
				}
				
				// MODIFICATION START: Automatically mark edits as analyzed once the process is complete.
				// This prevents them from being analyzed again on the next run.
				window.api.markEditsAsAnalyzed(novelId).catch(err => {
					console.error('Failed to automatically mark edits as analyzed:', err);
					// This is a non-critical error, so we just log it. The user can still apply results.
				});
				// MODIFICATION END
				break;
			case 'error':
				statusText.textContent = `Error: ${update.message}`;
				startBtn.disabled = false;
				startBtn.querySelector('.loading').classList.add('hidden');
				break;
		}
	});
});
