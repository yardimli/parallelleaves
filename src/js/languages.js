/**
 * A centralized list of supported languages for dropdowns and other UI elements.
 * The key is the language code (e.g., 'en', 'fr') and the value is the display name.
 */
const supportedLanguages = {
	'af': 'Afrikaans',
	'bg': 'Bulgarian',
	'ca': 'Catalan',
	'zh-CN': 'Chinese (Simplified)',
	'zh-TW': 'Chinese (Traditional)',
	'cs': 'Czech',
	'cy': 'Welsh',
	'da': 'Danish',
	'de': 'German',
	'el': 'Greek',
	'en-GB': 'English (UK)',
	'en-US': 'English (US)',
	'es-419': 'Spanish (Latin America)',
	'es-AR': 'Spanish (Argentina)',
	'es-ES': 'Spanish (Spain)',
	'es-MX': 'Spanish (Mexico)',
	'es-US': 'Spanish (US)',
	'et': 'Estonian',
	'fa': 'Persian',
	'fo': 'Faroese',
	'fr': 'French',
	'he': 'Hebrew',
	'hi': 'Hindi',
	'hr': 'Croatian',
	'hu': 'Hungarian',
	'hy': 'Armenian',
	'id': 'Indonesian',
	'it': 'Italian',
	'ja': 'Japanese',
	'ko': 'Korean',
	'lt': 'Lithuanian',
	'lv': 'Latvian',
	'nb': 'Norwegian (Bokmål)',
	'nl': 'Dutch',
	'pl': 'Polish',
	'pt-BR': 'Portuguese (Brazil)',
	'pt-PT': 'Portuguese (Portugal)',
	'ro': 'Romanian',
	'ru': 'Russian',
	'sh': 'Serbo-Croatian',
	'sk': 'Slovak',
	'sl': 'Slovenian',
	'sq': 'Albanian',
	'sr': 'Serbian',
	'sv': 'Swedish',
	'ta': 'Tamil',
	'tg': 'Tajik',
	'tr': 'Turkish',
	'uk': 'Ukrainian',
	'vi': 'Vietnamese',
};

/**
 * @param {string} languageName - The full language name (e.g., "English", "Spanish").
 * @returns {string} The corresponding ISO code (e.g., "en-US", "es-ES"). Defaults to "en-US".
 */
function mapLanguageToIsoCode(languageName) {
	if (!languageName) return 'en-US';
	const lowerCaseLangName = languageName.toLowerCase();
	
	// Find the key (ISO code) by matching the value (language name).
	for (const [code, name] of Object.entries(supportedLanguages)) {
		if (name.toLowerCase() === lowerCaseLangName) {
			return code; // Return the ISO code.
		}
	}
	
	return 'en-US'; // Default to English (US) if no match is found.
}

module.exports = { supportedLanguages, mapLanguageToIsoCode };
