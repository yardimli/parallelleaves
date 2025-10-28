import { initI18n, t, applyTranslationsTo } from './i18n.js';

/**
 * Creates a debounced function that delays invoking func until after wait milliseconds have elapsed
 * since the last time the debounced function was invoked.
 * @param {Function} func The function to debounce.
 * @param {number} delay The number of milliseconds to delay.
 * @returns {Function} Returns the new debounced function.
 */
const debounce = (func, delay) => {
	let timeout;
	const debounced = function (...args) {
		const context = this;
		clearTimeout(timeout);
		timeout = setTimeout(() => func.apply(context, args), delay);
	};
	// Add a method to cancel the pending debounced call.
	debounced.cancel = () => {
		clearTimeout(timeout);
	};
	return debounced;
};

let novelId = null;
let isGenerationRunning = false;

const AI_SETTINGS_KEYS = {
	MODEL: 'parallel-leaves-ai-model',
	TEMPERATURE: 'parallel-leaves-ai-temperature'
};

const modelSelect = document.getElementById('js-llm-model-select');
const tempSlider = document.getElementById('js-ai-temperature-slider');
const tempValue = document.getElementById('js-ai-temperature-value');
const startBtn = document.getElementById('js-start-generating-btn');
const stopBtn = document.getElementById('js-stop-generating-btn');
const editor = document.getElementById('js-memory-editor');
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
 * Scans the editor's content to find all processed markers for the current novel.
 * @returns {number[]} An array of marker numbers that have already been processed.
 */
function getProcessedMarkers() {
	if (!editor.value || !novelId) {
		return [];
	}
	
	const processedMarkers = [];
	// Regex to find markers in the format #{novelId}-{markerNumber}
	const markerRegex = /#(\d+)-(\d+)/g;
	let match;
	
	while ((match = markerRegex.exec(editor.value)) !== null) {
		const foundNovelId = parseInt(match[1], 10);
		const markerNumber = parseInt(match[2], 10);
		
		// Only add the marker if it belongs to the currently active novel.
		if (foundNovelId === parseInt(novelId, 10)) {
			processedMarkers.push(markerNumber);
		}
	}
	
	return processedMarkers;
}

/**
 * Starts the generation process loop.
 */
async function startGenerationProcess() {
	if (isGenerationRunning) {
		return;
	}
	
	isGenerationRunning = true;
	
	startBtn.disabled = true;
	startBtn.querySelector('.loading').classList.remove('hidden');
	stopBtn.classList.remove('hidden');
	statusText.textContent = t('editor.translationMemory.loading');
	
	await sendGenerationRequest();
}

/**
 * Stops the generation process.
 */
function stopGenerationProcess() {
	isGenerationRunning = false;
	
	startBtn.disabled = false;
	startBtn.querySelector('.loading').classList.add('hidden');
	stopBtn.classList.add('hidden');
	statusText.textContent = '';
}

/**
 * Sends a single request to the main process to find and analyze the next available pair.
 */
async function sendGenerationRequest() {
	if (!isGenerationRunning) {
		return;
	}
	
	const selectedModel = modelSelect.value;
	const temperature = parseFloat(tempSlider.value);
	const pairCountInput = document.getElementById('js-analysis-pairs-count');
	const pairCount = parseInt(pairCountInput.value, 10) || 2;
	
	const processedMarkerNumbers = getProcessedMarkers();
	
	try {
		await window.api.translationMemoryStart({
			novelId,
			model: selectedModel,
			temperature,
			processedMarkerNumbers: processedMarkerNumbers,
			pairCount: pairCount,
			lang: localStorage.getItem('app_lang') || 'en'
		});
	} catch (error) {
		statusText.textContent = t('editor.translationMemory.error', { message: error.message });
		stopGenerationProcess();
	}
}

/**
 * Saves the current content of the editor to a file via the main process.
 */
async function saveMemory() {
	try {
		await window.api.translationMemorySave({ novelId, content: editor.value });
		console.log('Translation memory auto-saved.');
	} catch (error) {
		console.error('Failed to auto-save translation memory:', error);
		statusText.textContent = t('editor.translationMemory.error', { message: error.message });
	}
}

const debouncedSave = debounce(saveMemory, 5000); // 5-second delay

document.addEventListener('DOMContentLoaded', async () => {
	await initI18n();
	applyTranslationsTo(document.body);
	document.title = t('editor.translationMemory.windowTitle');
	
	const params = new URLSearchParams(window.location.search);
	novelId = params.get('novelId');
	
	if (!novelId) {
		editor.value = t('editor.translationMemory.error', { message: 'Novel ID is missing.' });
		startBtn.disabled = true;
		return;
	}
	
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
	
	const pairsCountInput = document.getElementById('js-analysis-pairs-count');
	const PAIRS_COUNT_KEY = `translation-memory-pairs-count-${novelId}`;
	
	const savedPairsCount = localStorage.getItem(PAIRS_COUNT_KEY) || '2';
	pairsCountInput.value = savedPairsCount;
	
	pairsCountInput.addEventListener('change', () => {
		let value = parseInt(pairsCountInput.value, 10);
		if (isNaN(value) || value < 1) value = 1;
		if (value > 10) value = 10;
		pairsCountInput.value = value;
		localStorage.setItem(PAIRS_COUNT_KEY, value);
	});
	
	await populateModels();
	
	try {
		const result = await window.api.translationMemoryLoad(novelId);
		if (result.success) {
			editor.value = result.content || '';
		} else {
			throw new Error(result.message);
		}
	} catch (error) {
		editor.value = t('editor.translationMemory.error', { message: `Failed to load memory: ${error.message}` });
	}
	
	editor.addEventListener('input', debouncedSave);
	
	editor.addEventListener('blur', () => {
		debouncedSave.cancel();
		saveMemory();
	});
	
	window.addEventListener('beforeunload', () => {
		debouncedSave.cancel();
		saveMemory();
	});
	
	startBtn.addEventListener('click', startGenerationProcess);
	stopBtn.addEventListener('click', stopGenerationProcess);
	
	window.api.onTranslationMemoryUpdate((update) => {
		if (!update || typeof update.type === 'undefined') {
			console.error('Received invalid update from main process:', update);
			statusText.textContent = t('editor.translationMemory.error', { message: 'Received an invalid update.' });
			stopGenerationProcess();
			return;
		}
		
		let messageText = '';
		if (update.message) {
			messageText = t(update.message, update.params || {});
		}
		
		switch (update.type) {
			case 'new_instructions':
				editor.value += update.data.formattedBlock;
				editor.scrollTop = editor.scrollHeight;
				saveMemory();
				
				if (isGenerationRunning) {
					statusText.textContent = t('editor.translationMemory.loading');
					sendGenerationRequest();
				}
				break;
			case 'finished':
				statusText.textContent = messageText;
				stopGenerationProcess();
				break;
			case 'error':
				statusText.textContent = messageText;
				stopGenerationProcess();
				break;
		}
	});
});
