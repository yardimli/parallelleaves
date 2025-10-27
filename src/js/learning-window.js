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
// MODIFICATION: Removed lastProcessedMarker as the logic now scans the editor content directly.
let isLearningRunning = false;

const AI_SETTINGS_KEYS = {
	MODEL: 'parallel-leaves-ai-model',
	TEMPERATURE: 'parallel-leaves-ai-temperature'
};

const modelSelect = document.getElementById('js-llm-model-select');
const tempSlider = document.getElementById('js-ai-temperature-slider');
const tempValue = document.getElementById('js-ai-temperature-value');
const startBtn = document.getElementById('js-start-learning-btn');
const stopBtn = document.getElementById('js-stop-learning-btn');
const editor = document.getElementById('js-learning-results-editor');
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
 * MODIFICATION: New function to scan the editor for already processed markers for the current novel.
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
 * Starts the learning process loop.
 */
async function startLearningProcess() {
	if (isLearningRunning) {
		return;
	}
	
	isLearningRunning = true;
	
	startBtn.disabled = true;
	startBtn.querySelector('.loading').classList.remove('hidden');
	stopBtn.classList.remove('hidden');
	statusText.textContent = t('editor.learning.loading');
	
	// MODIFICATION: The logic no longer depends on a single last marker.
	// We kick off the first request, and the loop continues via the 'onLearningUpdate' handler.
	await sendLearningRequest();
}

/**
 * Stops the learning process.
 */
function stopLearningProcess() {
	isLearningRunning = false;
	
	startBtn.disabled = false;
	startBtn.querySelector('.loading').classList.add('hidden');
	stopBtn.classList.add('hidden');
	statusText.textContent = '';
}

/**
 * MODIFICATION: This function now gets the list of processed markers each time it's called.
 * Sends a single request to the main process to find and analyze the next available pair.
 */
async function sendLearningRequest() {
	if (!isLearningRunning) {
		return;
	}
	
	const selectedModel = modelSelect.value;
	const temperature = parseFloat(tempSlider.value);
	
	// MODIFICATION: Get the list of markers already in the editor.
	const processedMarkerNumbers = getProcessedMarkers();
	
	try {
		// MODIFICATION: Pass the list of processed markers to the main process.
		await window.api.startLearning({
			novelId,
			model: selectedModel,
			temperature,
			processedMarkerNumbers: processedMarkerNumbers, // Pass the array here
			lang: localStorage.getItem('app_lang') || 'en'
		});
	} catch (error) {
		statusText.textContent = t('editor.learning.error', { message: error.message });
		stopLearningProcess();
	}
}

/**
 * Saves the current content of the editor to localStorage.
 */
function saveInstructions() {
	try {
		const storageKey = `learning-instructions-${novelId}`;
		localStorage.setItem(storageKey, editor.value);
		console.log('Learning instructions auto-saved.');
	} catch (error) {
		console.error('Failed to auto-save learning instructions:', error);
		statusText.textContent = t('editor.learning.error', { message: error.message });
	}
}

// Create a debounced version of the save function for use with the 'input' event.
const debouncedSave = debounce(saveInstructions, 5000); // 5-second delay

document.addEventListener('DOMContentLoaded', async () => {
	await initI18n();
	applyTranslationsTo(document.body);
	document.title = t('editor.learning.windowTitle');
	
	const params = new URLSearchParams(window.location.search);
	novelId = params.get('novelId');
	
	if (!novelId) {
		editor.value = t('editor.learning.error', { message: 'Novel ID is missing.' });
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
	
	// Load existing instructions from localStorage
	try {
		const storageKey = `learning-instructions-${novelId}`;
		const savedInstructions = localStorage.getItem(storageKey);
		editor.value = savedInstructions || '';
	} catch (error) {
		editor.value = t('editor.learning.error', { message: `Failed to load instructions from local storage: ${error.message}` });
	}
	
	// Save after 5 seconds of inactivity.
	editor.addEventListener('input', debouncedSave);
	
	// Save immediately when the user clicks away from the textarea.
	editor.addEventListener('blur', () => {
		debouncedSave.cancel(); // Cancel any pending debounced save.
		saveInstructions(); // Save immediately.
	});
	
	// Save immediately before the window is closed.
	window.addEventListener('beforeunload', () => {
		debouncedSave.cancel();
		saveInstructions();
	});
	
	startBtn.addEventListener('click', startLearningProcess);
	stopBtn.addEventListener('click', stopLearningProcess);
	
	window.api.onLearningUpdate((update) => {
		if (!update || typeof update.type === 'undefined') {
			console.error('Received invalid update from main process:', update);
			statusText.textContent = t('editor.learning.error', { message: 'Received an invalid learning update.' });
			stopLearningProcess();
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
				// MODIFICATION: No longer need to track lastProcessedMarker.
				saveInstructions();
				
				// MODIFICATION: Continue the loop by sending the next request.
				if (isLearningRunning) {
					statusText.textContent = t('editor.learning.loading');
					sendLearningRequest(); // This continues the process.
				}
				break;
			case 'finished':
				statusText.textContent = messageText;
				stopLearningProcess();
				break;
			case 'error':
				statusText.textContent = messageText;
				stopLearningProcess();
				break;
		}
	});
});
