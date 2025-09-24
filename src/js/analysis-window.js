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

// MODIFICATION START: Renders results in a grid of textareas for better viewing and future editing.
function renderResult(result) {
	if (!result || !result.changes || Object.keys(result.changes).length === 0) {
		return;
	}
	
	const card = document.createElement('div');
	card.className = 'card bg-base-200 shadow-xl';
	
	const cardBody = document.createElement('div');
	cardBody.className = 'card-body';
	
	const title = document.createElement('h3');
	title.className = 'card-title text-sm';
	title.textContent = `Changes in Marker #${result.marker}`;
	cardBody.appendChild(title);
	
	const table = document.createElement('table');
	table.className = 'table table-sm';
	
	const thead = document.createElement('thead');
	thead.innerHTML = `
        <tr>
            <th class="w-1/2">Original</th>
            <th class="w-1/2">Edited</th>
        </tr>
    `;
	table.appendChild(thead);
	
	const tbody = document.createElement('tbody');
	for (const [original, edited] of Object.entries(result.changes)) {
		const row = document.createElement('tr');
		
		// Sanitize content to prevent issues within textarea tags
		const escapeHtml = (text) => {
			const div = document.createElement('div');
			div.textContent = text;
			return div.innerHTML;
		};
		
		row.innerHTML = `
            <td>
                <textarea class="textarea textarea-bordered textarea-sm w-full bg-base-300/50" readonly rows="1">${escapeHtml(original)}</textarea>
            </td>
            <td>
                <textarea class="textarea textarea-bordered textarea-sm w-full" rows="1">${escapeHtml(edited)}</textarea>
            </td>
        `;
		tbody.appendChild(row);
	}
	table.appendChild(tbody);
	
	// Add auto-resize logic to all textareas in the table
	table.querySelectorAll('textarea').forEach(textarea => {
		const resize = () => {
			textarea.style.height = 'auto';
			textarea.style.height = `${textarea.scrollHeight}px`;
		};
		textarea.addEventListener('input', resize);
		// Initial resize after a short delay to allow rendering
		setTimeout(resize, 0);
	});
	
	cardBody.appendChild(table);
	card.appendChild(cardBody);
	resultsContainer.appendChild(card);
}
// MODIFICATION END

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
