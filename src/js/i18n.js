const LANG_KEY = 'app_lang';
let translations = {};

export const appLanguages = {
	en: 'English',
	tr: 'Türkçe',
	tlh: 'Klingon',
	no: 'Norsk',
	'zh-TW': '繁體中文'
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
		if (element.children.length === 0 || element.tagName.toLowerCase() === 'title') {
			element.textContent = t(key);
		} else {
			for (const node of element.childNodes) {
				if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) {
					node.textContent = ` ${t(key)} `;
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
 * Scans a given DOM element and its children and applies all translations.
 * @param {HTMLElement} rootElement - The root element to start scanning from.
 */
export function applyTranslationsTo(rootElement) {
	if (!rootElement) return;
	
	if (rootElement.matches('[data-i18n], [data-i18n-title], [data-i18n-placeholder]')) {
		translateElement(rootElement);
	}
	
	rootElement.querySelectorAll('[data-i18n], [data-i18n-title], [data-i18n-placeholder]').forEach(translateElement);
}

/**
 * Scans the entire document and applies all translations.
 */
function applyTranslations() {
	applyTranslationsTo(document.body);
	document.documentElement.lang = localStorage.getItem(LANG_KEY) || 'en';
}

/**
 * Populates the language switcher dropdown menu.
 */
function populateLanguageSwitcher() {
	const menus = document.querySelectorAll('#js-lang-switcher-menu');
	if (menus.length === 0) return;
	
	const currentLang = localStorage.getItem(LANG_KEY) || 'en';
	
	menus.forEach(menu => {
		menu.innerHTML = '';
		for (const [code, name] of Object.entries(appLanguages)) {
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
export async function setLanguage(lang) {
	localStorage.setItem(LANG_KEY, lang);
	await loadLanguage(lang);
	applyTranslations();
	populateLanguageSwitcher();
	window.location.reload();
}

/**
 * Initializes the internationalization module.
 * @param {boolean} [isDashboard=false] - Kept for call compatibility, but no longer used for special logic.
 */
export async function initI18n(isDashboard = false) {
	// MODIFIED: Default to 'en' if no language is set in localStorage.
	// This removes the initial language selection modal on the dashboard.
	const lang = localStorage.getItem(LANG_KEY) || 'en';
	
	localStorage.setItem(LANG_KEY, lang);
	await loadLanguage(lang);
	applyTranslations();
	populateLanguageSwitcher();
}
