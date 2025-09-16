// This new file contains all the logic for loading, saving, and applying typography settings.
// It's designed to be reusable between the chapter editor and the codex editor.

const DEFAULTS = {
	font_family: "'Noto Serif', serif",
	text_size: 'lg',
	line_height: '2',
	text_indent: '2',
	paragraph_spacing: '2',
	page_width: '3',
	text_align: 'left',
};
const STORAGE_KEY = 'typographySettings';

// Mappings from setting values to actual CSS values.
const MAPPINGS = {
	text_size: { sm: '0.9rem', base: '1rem', lg: '1.1rem', xl: '1.2rem' },
	line_height: { '1': '1.5', '2': '1.65', '3': '1.8', '4': '2.0' },
	text_indent: { '1': '0', '2': '1.5em', '3': '2em', '4': '2.5em' },
	paragraph_spacing: { '1': '0', '2': '0.75em', '3': '1em', '4': '1.5em' },
	page_width: { '1': '38rem', '2': '42rem', '3': '48rem', '4': '56rem', '5': 'none' },
};

/**
 * Retrieves typography settings from localStorage, falling back to defaults.
 * @returns {object} The typography settings.
 */
export function getTypographySettings() {
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		return saved ? { ...DEFAULTS, ...JSON.parse(saved) } : { ...DEFAULTS };
	} catch (e) {
		console.error('Failed to parse typography settings from localStorage', e);
		return { ...DEFAULTS };
	}
}

/**
 * Saves typography settings to localStorage.
 * @param {object} settings - The settings object to save.
 */
function saveSettings(settings) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/**
 * Generates an object of CSS custom properties from a settings object.
 * @param {object} settings - The typography settings.
 * @returns {object} An object mapping CSS variable names to their values.
 */
export function generateTypographyStyleProperties(settings) {
	return {
		'--editor-font-family': settings.font_family,
		'--editor-font-size': MAPPINGS.text_size[settings.text_size] || MAPPINGS.text_size.lg,
		'--editor-line-height': MAPPINGS.line_height[settings.line_height] || MAPPINGS.line_height['2'],
		'--editor-text-indent': MAPPINGS.text_indent[settings.text_indent] || MAPPINGS.text_indent['2'],
		'--editor-paragraph-spacing': MAPPINGS.paragraph_spacing[settings.paragraph_spacing] || MAPPINGS.paragraph_spacing['2'],
		'--editor-page-width': MAPPINGS.page_width[settings.page_width] || MAPPINGS.page_width['3'],
		'--editor-text-align': settings.text_align,
	};
}

/**
 * Updates the state of the controls in the modal to reflect the current settings.
 * @param {HTMLElement} modal - The modal element.
 * @param {object} settings - The current settings.
 */
function updateModalUI(modal, settings) {
	if (!modal) return;
	
	// Update select dropdowns
	modal.querySelectorAll('select').forEach(select => {
		const settingName = select.name;
		if (settings[settingName] !== undefined) {
			select.value = settings[settingName];
		}
	});
	
	// Update button groups
	modal.querySelectorAll('.btn-group[data-setting]').forEach(group => {
		const settingName = group.dataset.setting;
		const currentValue = settings[settingName];
		group.querySelectorAll('button').forEach(button => {
			button.classList.remove('btn-active');
			if (button.dataset.value === currentValue) {
				button.classList.add('btn-active');
			}
		});
	});
}

/**
 * Initializes the typography settings feature.
 * @param {object} config - Configuration object.
 * @param {string} config.buttonId - The ID of the button that opens the modal.
 * @param {string} config.modalId - The ID of the settings modal.
 * @param {string} config.formId - The ID of the form within the modal.
 * @param {function} config.applyCallback - A function to call to apply the styles.
 */
export function setupTypographySettings({ buttonId, modalId, formId, applyCallback }) {
	const btn = document.getElementById(buttonId);
	const modal = document.getElementById(modalId);
	const form = document.getElementById(formId);
	
	if (!btn || !modal || !form) {
		console.error('Typography settings UI elements not found.');
		return;
	}
	
	let currentSettings = getTypographySettings();
	
	const applyStyles = () => {
		const properties = generateTypographyStyleProperties(currentSettings);
		applyCallback(properties, currentSettings);
	};
	
	// Initial application of styles
	applyStyles();
	updateModalUI(modal, currentSettings);
	
	btn.addEventListener('click', () => modal.showModal());
	
	const handleFormChange = () => {
		const formData = new FormData(form);
		const newSettings = { ...currentSettings };
		
		// Update from selects and text inputs
		for (let [key, value] of formData.entries()) {
			newSettings[key] = value;
		}
		
		currentSettings = newSettings;
		saveSettings(currentSettings);
		applyStyles();
		updateModalUI(modal, currentSettings);
	};
	
	// Listener for selects and checkboxes
	form.addEventListener('input', handleFormChange);
	
	// Listener for button groups
	form.addEventListener('click', (e) => {
		const button = e.target.closest('button[data-value]');
		if (!button) return;
		const group = button.closest('[data-setting]');
		if (!group) return;
		
		const settingName = group.dataset.setting;
		const value = button.dataset.value;
		
		if (currentSettings[settingName] !== value) {
			currentSettings[settingName] = value;
			saveSettings(currentSettings);
			applyStyles();
			updateModalUI(modal, currentSettings);
		}
	});
}
