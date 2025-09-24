import { initI18n, t, applyTranslationsTo } from './i18n.js';

let novelId = null;

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
	
	const card = document.createElement('div');
	card.className = 'card bg-base-200 shadow-xl';
	
	const cardBody = document.createElement('div');
	cardBody.className = 'card-body';
	
	// Card Header with Title (no delete button here anymore)
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
	// Add an actions column to the header
	thead.innerHTML = `
        <tr>
            <th class="w-[calc(50%-1.5rem)]">Original</th>
            <th class="w-[calc(50%-1.5rem)]">Edited</th>
            <th class="w-12"></th>
        </tr>
    `;
	table.appendChild(thead);
	
	const tbody = document.createElement('tbody');
	for (const [original, edited] of Object.entries(result.changes)) {
		const row = document.createElement('tr');
		
		const escapeHtml = (text) => {
			const div = document.createElement('div');
			div.textContent = text;
			return div.innerHTML;
		};
		
		// Add the delete button cell to each row
		row.innerHTML = `
            <td>
                <textarea class="textarea textarea-bordered textarea-sm w-full bg-base-300/50" readonly rows="1">${escapeHtml(original)}</textarea>
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
	table.appendChild(tbody);
	
	table.querySelectorAll('textarea').forEach(textarea => {
		const resize = () => {
			textarea.style.height = 'auto';
			textarea.style.height = `${textarea.scrollHeight}px`;
		};
		textarea.addEventListener('input', resize);
		setTimeout(resize, 0);
	});
	
	cardBody.appendChild(table);
	card.appendChild(cardBody);
	resultsContainer.appendChild(card);
	applyTranslationsTo(card); // Apply translation to the new button's title
}

async function handleStartAnalysis() {
	startBtn.disabled = true;
	startBtn.querySelector('.loading').classList.remove('hidden');
	applyBtn.disabled = true;
	resultsContainer.innerHTML = '';
	statusText.textContent = t('editor.analysis.loading');
	
	const selectedModel = modelSelect.value;
	const temperature = parseFloat(tempSlider.value);
	
	try {
		await window.api.startAnalysis({ novelId, model: selectedModel, temperature });
	} catch (error) {
		statusText.textContent = `Error: ${error.message}`;
		startBtn.disabled = false;
		startBtn.querySelector('.loading').classList.add('hidden');
	}
}

// MODIFICATION START: Removed the confirmation dialog from this function.
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
					type: 'rephrasing'
				});
			}
		});
	});
	
	if (newPairs.length === 0) {
		// If all pairs were deleted, just mark as analyzed and close.
		try {
			await window.api.markEditsAsAnalyzed(novelId);
			window.close();
		} catch (error) {
			console.error('Failed to mark edits as analyzed:', error);
			window.alert(`Error: ${error.message}`);
		}
		return;
	}
	
	applyBtn.disabled = true;
	const applyBtnSpan = applyBtn.querySelector('span');
	if (applyBtnSpan) applyBtnSpan.classList.add('loading');
	
	try {
		// 1. Get existing dictionary
		const existingDictionary = await window.api.getNovelDictionary(novelId) || [];
		
		// 2. Merge new pairs, avoiding duplicates
		let addedCount = 0;
		const updatedDictionary = [...existingDictionary];
		
		newPairs.forEach(newPair => {
			const isDuplicate = existingDictionary.some(existingPair =>
				existingPair.source === newPair.source && existingPair.target === newPair.target
			);
			if (!isDuplicate) {
				updatedDictionary.push(newPair);
				addedCount++;
			}
		});
		
		// 3. Save the updated dictionary
		await window.api.saveNovelDictionary(novelId, updatedDictionary);
		
		// 4. Mark edits as analyzed in the database
		await window.api.markEditsAsAnalyzed(novelId);
		
		// 5. Close the window (success message is now optional or can be a toast notification later)
		window.close();
		
	} catch (error) {
		console.error('Failed to apply analysis results:', error);
		window.alert(`Error: ${error.message}`);
	} finally {
		applyBtn.disabled = false;
		if (applyBtnSpan) applyBtnSpan.classList.remove('loading');
	}
}
// MODIFICATION END

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
			
			if (row) {
				row.remove();
			}
			
			// If the table body is now empty, remove the entire card for a cleaner UI.
			if (tbody && tbody.children.length === 0) {
				if (card) {
					card.remove();
				}
			}
			
			// Update the state of the apply button after any deletion.
			updateApplyButtonState();
		}
	});
	
	let hasResults = false;
	
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
					if (!hasResults) {
						const title = document.createElement('h2');
						title.className = 'text-xl font-bold mb-2';
						title.textContent = t('editor.analysis.resultsTitle');
						resultsContainer.appendChild(title);
						hasResults = true;
					}
					update.data.forEach(renderResult);
				}
				break;
			case 'finished':
				statusText.textContent = update.message;
				startBtn.disabled = false;
				startBtn.querySelector('.loading').classList.add('hidden');
				if (hasResults) {
					applyBtn.disabled = false;
				} else {
					statusText.textContent = t('editor.analysis.noResults');
				}
				break;
			case 'error':
				statusText.textContent = `Error: ${update.message}`;
				startBtn.disabled = false;
				startBtn.querySelector('.loading').classList.add('hidden');
				break;
		}
	});
});
