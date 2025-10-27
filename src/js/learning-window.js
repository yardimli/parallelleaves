import { initI18n, t, applyTranslationsTo } from './i18n.js';

let novelId = null;
let lastProcessedMarker = 0; // Keep track of the last marker we processed

const AI_SETTINGS_KEYS = {
	MODEL: 'parallel-leaves-ai-model',
	TEMPERATURE: 'parallel-leaves-ai-temperature'
};

const modelSelect = document.getElementById('js-llm-model-select');
const tempSlider = document.getElementById('js-ai-temperature-slider');
const tempValue = document.getElementById('js-ai-temperature-value');
const startBtn = document.getElementById('js-start-learning-btn');
const resultsContainer = document.getElementById('js-learning-results');
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
 * Renders a result card for a processed translation pair.
 * This function now displays the prompt sent to the AI and the detailed response.
 * @param {object} result - The result data from the main process.
 */
function renderResult(result) {
	if (!result) {
		return;
	}
	
	// Create a header for the results if it doesn't exist
	if (!resultsContainer.querySelector('h2')) {
		const title = document.createElement('h2');
		title.className = 'text-xl font-bold mb-2';
		title.setAttribute('data-i18n', 'editor.learning.resultsTitle');
		resultsContainer.appendChild(title);
		applyTranslationsTo(resultsContainer);
	}
	
	const card = document.createElement('div');
	card.className = 'card bg-base-200 shadow-xl';
	
	const cardBody = document.createElement('div');
	cardBody.className = 'card-body p-4 space-y-4';
	
	// Card Header
	const cardHeader = document.createElement('div');
	cardHeader.className = 'card-title';
	const title = document.createElement('h3');
	title.className = 'text-lg';
	title.textContent = `Pair #${result.marker}`;
	cardHeader.appendChild(title);
	cardBody.appendChild(cardHeader);
	
	// Prompt Sent to LLM
	const promptDetails = document.createElement('details');
	promptDetails.className = 'collapse collapse-arrow bg-base-100';
	promptDetails.innerHTML = `
        <summary class="collapse-title text-md font-medium" data-i18n="editor.learning.promptTitle">Prompt Sent to LLM</summary>
        <div class="collapse-content">
            <h4 class="font-semibold mt-2 font-mono text-success" data-i18n="prompt.preview.system">System Prompt</h4>
            <pre class="bg-base-300 p-2 rounded-md text-xs whitespace-pre-wrap font-mono">${result.prompt.system}</pre>
            <h4 class="font-semibold mt-4 font-mono text-info" data-i18n="prompt.preview.user">User Prompt</h4>
            <pre class="bg-base-300 p-2 rounded-md text-xs whitespace-pre-wrap font-mono">${result.prompt.user}</pre>
        </div>
    `;
	cardBody.appendChild(promptDetails);
	
	// LLM Response
	const responseDiv = document.createElement('div');
	const responseTitle = document.createElement('h4');
	responseTitle.className = 'text-md font-medium';
	responseTitle.setAttribute('data-i18n', 'editor.learning.responseTitle');
	responseTitle.textContent = 'LLM Response';
	responseDiv.appendChild(responseTitle);
	
	if (result.instructions && result.instructions.length > 0) {
		const list = document.createElement('ul');
		list.className = 'list-disc list-inside space-y-1 text-base-content/90 bg-base-100 p-3 rounded-md';
		result.instructions.forEach(instruction => {
			const li = document.createElement('li');
			li.textContent = instruction;
			list.appendChild(li);
		});
		responseDiv.appendChild(list);
		if (result.instructions.length !== 3) {
			const warning = document.createElement('p');
			warning.className = 'text-xs text-warning mt-1';
			warning.setAttribute('data-i18n', 'editor.learning.parseWarning');
			warning.textContent = 'Warning: The response was not in the expected format of 3 distinct instructions.';
			responseDiv.appendChild(warning);
		}
	} else {
		const error = document.createElement('p');
		error.className = 'text-error text-sm bg-base-100 p-3 rounded-md';
		error.setAttribute('data-i18n', 'editor.learning.parseError');
		error.textContent = 'Could not parse instructions from the response.';
		responseDiv.appendChild(error);
		
		const rawResponsePre = document.createElement('pre');
		rawResponsePre.className = 'bg-base-300 p-2 rounded-md text-xs whitespace-pre-wrap font-mono mt-2';
		rawResponsePre.textContent = result.rawResponse || t('editor.learning.noResponse');
		responseDiv.appendChild(rawResponsePre);
	}
	
	cardBody.appendChild(responseDiv);
	card.appendChild(cardBody);
	applyTranslationsTo(card);
	
	resultsContainer.appendChild(card); // MODIFICATION: Ensure the card is appended to the container
	
	// Scroll to the new result
	card.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

async function handleStartLearning() {
	startBtn.disabled = true;
	startBtn.querySelector('.loading').classList.remove('hidden');
	statusText.textContent = t('editor.learning.loading');
	
	const selectedModel = modelSelect.value;
	const temperature = parseFloat(tempSlider.value);
	
	try {
		await window.api.startLearning({
			novelId,
			model: selectedModel,
			temperature,
			lastMarkerNumber: lastProcessedMarker
		});
	} catch (error) {
		statusText.textContent = t('editor.learning.error', { message: error.message });
		startBtn.disabled = false;
		startBtn.querySelector('.loading').classList.add('hidden');
	}
}

document.addEventListener('DOMContentLoaded', async () => {
	await initI18n();
	applyTranslationsTo(document.body);
	document.title = t('editor.learning.windowTitle');
	
	const params = new URLSearchParams(window.location.search);
	novelId = params.get('novelId');
	
	if (!novelId) {
		resultsContainer.innerHTML = `<p class="text-error p-4">${t('editor.learning.error', { message: 'Novel ID is missing.' })}</p>`;
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
	
	startBtn.addEventListener('click', handleStartLearning);
	
	window.api.onLearningUpdate((update) => {
		if (!update || typeof update.type === 'undefined') {
			console.error('Received invalid update from main process:', update);
			statusText.textContent = t('editor.learning.error', { message: 'Received an invalid learning update.' });
			startBtn.disabled = false;
			startBtn.querySelector('.loading').classList.add('hidden');
			return;
		}
		
		let messageText = '';
		if (update.message) {
			messageText = t(update.message, update.params || {});
		}
		
		switch (update.type) {
			case 'results':
				statusText.textContent = '';
				lastProcessedMarker = update.data.marker;
				renderResult(update.data);
				// Change button text to "Next Pair"
				startBtn.querySelector('span:not(.loading)').textContent = t('editor.learning.next');
				startBtn.disabled = false;
				startBtn.querySelector('.loading').classList.add('hidden');
				break;
			case 'finished':
				statusText.textContent = messageText;
				startBtn.disabled = true; // No more pairs, so disable the button
				startBtn.querySelector('.loading').classList.add('hidden');
				break;
			case 'error':
				statusText.textContent = messageText;
				startBtn.disabled = false;
				startBtn.querySelector('.loading').classList.add('hidden');
				break;
		}
	});
});
