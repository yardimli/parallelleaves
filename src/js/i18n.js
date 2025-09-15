const LANG_KEY = 'app_lang';
let translations = {};

const supportedLanguages = {
	en: 'English',
	tr: 'Türkçe'
};

/**
 * Fetches and loads a language file.
 * @param {string} lang - The language code (e.g., 'en', 'tr').
 */
async function loadLanguage(lang) {
	try {
		const langData = await window.api.getLangFile(lang);
		translations = JSON.parse(langData);
	} catch (error) {
		console.error(`Could not load language file for: ${lang}`, error);
		// Fallback to English if the requested language fails
		if (lang !== 'en') {
			await loadLanguage('en');
		}
	}
}

/**
 * Gets a translation string for a given key.
 * @param {string} key - The key for the translation string (e.g., 'dashboard.title').
 * @param {object} [substitutions={}] - An object of substitutions for placeholders.
 * @returns {string} The translated string.
 */
export function t(key, substitutions = {}) {
	const keys = key.split('.');
	let result = translations;
	for (const k of keys) {
		result = result?.[k];
		if (result === undefined) {
			return key; // Return the key itself if not found
		}
	}
	
	if (typeof result === 'string') {
		for (const [subKey, subValue] of Object.entries(substitutions)) {
			result = result.replace(`{${subKey}}`, subValue);
		}
	}
	
	return result;
}

/**
 * Applies translations to a single DOM element based on its data-i18n attributes.
 * @param {HTMLElement} element - The element to translate.
 */
function translateElement(element) {
	const key = element.dataset.i18n;
	if (key) {
		// For elements like <title>, we should only set textContent.
		// For others, it might be safer to set innerText if they could contain other nodes,
		// but the current usage is for simple text nodes.
		if (element.children.length === 0 || element.tagName.toLowerCase() === 'title') {
			element.textContent = t(key);
		} else {
			// If the element has children, find the first text node and replace it.
			// This is a simple approach for buttons like "<i>icon</i> Text".
			for (const node of element.childNodes) {
				if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) {
					node.textContent = ` ${t(key)} `; // Add spaces for padding
					break;
				}
			}
		}
	}
	
	if (element.dataset.i18nTitle) {
		element.title = t(element.dataset.i18nTitle);
	}
	
	if (element.dataset.i18nPlaceholder) {
		element.placeholder = t(element.dataset.i18nPlaceholder);
	}
}

/**
 * Scans the entire document and applies all translations.
 */
function applyTranslations() {
	document.querySelectorAll('[data-i18n], [data-i18n-title], [data-i18n-placeholder]').forEach(translateElement);
	document.documentElement.lang = localStorage.getItem(LANG_KEY) || 'en';
}

/**
 * Populates the language switcher dropdown menu.
 */
function populateLanguageSwitcher() {
	const menus = document.querySelectorAll('#js-lang-switcher-menu'); // MODIFIED: Select all menus
	if (menus.length === 0) return;
	
	const currentLang = localStorage.getItem(LANG_KEY) || 'en';
	
	menus.forEach(menu => {
		menu.innerHTML = '';
		for (const [code, name] of Object.entries(supportedLanguages)) {
			const li = document.createElement('li');
			const a = document.createElement('a');
			a.href = '#';
			a.dataset.lang = code;
			a.textContent = name;
			if (code === currentLang) {
				a.classList.add('active');
			}
			a.addEventListener('click', (e) => {
				e.preventDefault();
				if (code !== currentLang) {
					setLanguage(code);
				}
			});
			li.appendChild(a);
			menu.appendChild(li);
		}
	});
}

/**
 * Sets the application language, saves it, and re-renders the UI.
 * @param {string} lang - The language code to set.
 */
async function setLanguage(lang) {
	localStorage.setItem(LANG_KEY, lang);
	await loadLanguage(lang);
	applyTranslations();
	populateLanguageSwitcher();
	// MODIFIED: Reload the page to ensure all JS-generated content is re-translated
	window.location.reload();
}

/**
 * Initializes the internationalization module.
 * @param {boolean} [isDashboard=false] - True if this is the main dashboard page, to handle initial language selection.
 */
export async function initI18n(isDashboard = false) {
	let lang = localStorage.getItem(LANG_KEY);
	
	const setAndApply = async (newLang) => {
		localStorage.setItem(LANG_KEY, newLang);
		await loadLanguage(newLang);
		applyTranslations();
		populateLanguageSwitcher();
	};
	
	if (!lang && isDashboard) {
		return new Promise((resolve) => {
			const modal = document.getElementById('language-selection-modal');
			if (modal) {
				modal.showModal();
				document.getElementById('select-lang-en').onclick = async () => {
					await setAndApply('en');
					modal.close();
					resolve('en');
				};
				document.getElementById('select-lang-tr').onclick = async () => {
					await setAndApply('tr');
					modal.close();
					resolve('tr');
				};
			} else {
				setAndApply('en').then(() => resolve('en'));
			}
		});
	} else {
		await setAndApply(lang || 'en');
	}
}
