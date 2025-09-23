const LANG_KEY = 'app_lang';
let translations = {};
let enTranslations = {}; // For English fallback translations

export const appLanguages = {
	en: 'English',
	tr: 'Türkçe',
	no: 'Norsk',
	// 'zh-TW': '繁體中文'
};

/**
 * Fetches and loads a single language file.
 * @param {string} lang - The language code (e.g., 'en', 'tr').
 * @returns {Promise<object|null>} The parsed language data or null on error.
 */
async function loadLanguageFile (lang) {
	try {
		const langData = await window.api.getLangFile(lang);
		return JSON.parse(langData);
	} catch (error) {
		console.error(`Could not load language file for: ${lang}`, error);
		return null;
	}
}

/**
 * Helper to get a nested property from an object using a dot-notation string.
 * @param {object} obj - The object to search.
 * @param {string} path - The dot-notation path (e.g., 'common.save').
 * @returns {*} The value if found, otherwise undefined.
 */
function getNested (obj, path) {
	return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

/**
 * Gets a translation string for a given key.
 * @param {string} key - The key for the translation string (e.g., 'dashboard.title').
 * @param {object} [substitutions={}] - An object of substitutions for placeholders.
 * @returns {string} The translated string.
 */
export function t (key, substitutions = {}) {
	let result = getNested(translations, key);
	let isFallback = false;
	
	// If translation is not found in the current language, try the English fallback.
	if (result === undefined) {
		result = getNested(enTranslations, key);
		isFallback = true;
	}
	
	if (result === undefined) {
		return key; // Return the key itself if not found in any language file.
	}
	
	if (typeof result === 'string') {
		// Perform substitutions for placeholders like {username}.
		for (const [subKey, subValue] of Object.entries(substitutions)) {
			result = result.replace(`{${subKey}}`, subValue);
		}
		// Add an asterisk to indicate that a fallback translation was used.
		// Do not add it if the selected language is English.
		if (isFallback && (localStorage.getItem(LANG_KEY) || 'en') !== 'en') {
			result += '*';
		}
	}
	
	return result;
}

/**
 * Applies translations to a single DOM element based on its data-i18n attributes.
 * @param {HTMLElement} element - The element to translate.
 */
function translateElement (element) {
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
export function applyTranslationsTo (rootElement) {
	if (!rootElement) return;
	
	if (rootElement.matches('[data-i18n], [data-i18n-title], [data-i18n-placeholder]')) {
		translateElement(rootElement);
	}
	
	rootElement.querySelectorAll('[data-i18n], [data-i18n-title], [data-i18n-placeholder]').forEach(translateElement);
}

/**
 * Scans the entire document and applies all translations.
 */
function applyTranslations () {
	applyTranslationsTo(document.body);
	document.documentElement.lang = localStorage.getItem(LANG_KEY) || 'en';
}

/**
 * Populates the language switcher dropdown menu.
 */
function populateLanguageSwitcher () {
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
 * Sets the application language, saves it, and reloads the application.
 * @param {string} lang - The language code to set.
 */
export function setLanguage (lang) {
	localStorage.setItem(LANG_KEY, lang);
	window.location.reload();
}

/**
 * Initializes the internationalization module.
 * @param {boolean} [isDashboard=false] - Kept for call compatibility, but no longer used for special logic.
 */
export async function initI18n (isDashboard = false) {
	const lang = localStorage.getItem(LANG_KEY) || 'en';
	
	// Always load English for fallback.
	enTranslations = await loadLanguageFile('en') || {};
	
	// Load the selected language. If it's English, just use the fallback data.
	if (lang !== 'en') {
		translations = await loadLanguageFile(lang) || {};
	} else {
		translations = enTranslations;
	}
	
	localStorage.setItem(LANG_KEY, lang);
	applyTranslations();
	populateLanguageSwitcher();
}
