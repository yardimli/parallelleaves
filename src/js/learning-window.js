import { initI18n, t, applyTranslationsTo } from './i18n.js';

// MODIFICATION START: Added a debounce utility for auto-saving.
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
// MODIFICATION END

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
 * Finds the last marker number from the editor's content.
 * @returns {number} The highest marker number found, or 0.
 */
function getLastMarkerFromEditor() {
	if (!editor.value) return 0;
	const matches = editor.value.match(/#(\d+)/g);
	if (!matches) return 0;
	const numbers = matches.map(m => parseInt(m.substring(1), 10));
	return Math.max(...numbers);
}

async function findNextPair() {
	startBtn.disabled = true;
	startBtn.querySelector('.loading').classList.remove('hidden');
	statusText.textContent = t('editor.learning.loading');
	
	const selectedModel = modelSelect.value;
	const temperature = parseFloat(tempSlider.value);
	
	lastProcessedMarker = getLastMarkerFromEditor();
	
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

// MODIFICATION START: This function now handles the core save logic without UI updates.
/**
 * Saves the current content of the editor to localStorage.
 */
function saveInstructions() {
	try {
		const storageKey = `learning-instructions-${novelId}`;
		localStorage.setItem(storageKey, editor.value);
		// Console log for debugging purposes, no visible UI feedback to keep it unobtrusive.
		console.log('Learning instructions auto-saved.');
	} catch (error) {
		// This might happen if localStorage is full, which is unlikely.
		console.error('Failed to auto-save learning instructions:', error);
		statusText.textContent = t('editor.learning.error', { message: error.message });
	}
}

// Create a debounced version of the save function for use with the 'input' event.
const debouncedSave = debounce(saveInstructions, 5000); // 5-second delay
// MODIFICATION END

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
	
	// MODIFICATION START: Set up auto-saving event listeners.
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
	// MODIFICATION END
	
	startBtn.addEventListener('click', findNextPair);
	
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
			case 'new_instructions':
				statusText.textContent = '';
				editor.value += update.data.formattedBlock;
				editor.scrollTop = editor.scrollHeight;
				lastProcessedMarker = update.data.marker;
				startBtn.disabled = false;
				startBtn.querySelector('.loading').classList.add('hidden');
				// MODIFICATION: Trigger an immediate save after new content is added.
				saveInstructions();
				break;
			case 'finished':
				statusText.textContent = messageText;
				startBtn.disabled = true;
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
