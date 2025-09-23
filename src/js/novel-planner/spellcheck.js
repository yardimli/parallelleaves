import { t } from '../i18n.js';

/**
 * Populates and configures the spellcheck language dropdown.
 */
export async function setupSpellcheckDropdown () {
	const dropdown = document.getElementById('js-spellcheck-lang-dropdown');
	if (!dropdown) {
		console.error('[setupSpellcheckDropdown] Dropdown element not found.');
		return;
	}
	
	try {
		const availableLangs = await window.api.getAvailableSpellCheckerLanguages();
		const currentLang = await window.api.getCurrentSpellCheckerLanguage();
		
		dropdown.innerHTML = ''; // Clear "Loading..."
		
		const disableOption = new Option('Disable Spellcheck', '');
		dropdown.appendChild(disableOption);
		
		const supportedLanguages = await window.api.getSupportedLanguages();
		availableLangs.sort().forEach(code => {
			const name = supportedLanguages[code] || code;
			const option = new Option(name, code);
			dropdown.appendChild(option);
		});
		
		dropdown.value = currentLang || '';
		
		dropdown.addEventListener('change', async () => {
			const selectedLang = dropdown.value;
			try {
				await window.api.setSpellCheckerLanguage(selectedLang);
			} catch (error) {
				console.error('[Spellcheck] Error setting language:', error);
				window.showAlert('Could not set spellcheck language.');
			}
		});
	} catch (error) {
		console.error('[setupSpellcheckDropdown] Failed to initialize:', error);
		dropdown.innerHTML = `<option>${t('common.error')}</option>`;
		dropdown.disabled = true;
	}
}
