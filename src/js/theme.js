document.addEventListener('DOMContentLoaded', () => {
	const themeToggle = document.getElementById('theme-toggle');
	// NEW: An array of themes to cycle through.
	const themes = ['light', 'paper', 'dark'];
	
	/**
	 * Applies the selected theme to the document and updates the toggle button's UI.
	 * @param {string} theme - The name of the theme to apply ('light', 'paper', or 'dark').
	 */
	const applyTheme = (theme) => {
		document.documentElement.setAttribute('data-theme', theme);
		
		// Add or remove the 'dark' class for compatibility with custom non-DaisyUI dark styles.
		if (theme === 'dark') {
			document.body.classList.add('dark');
		} else {
			document.body.classList.remove('dark');
		}
		
		// If the toggle button exists, update its icon and title.
		if (themeToggle) {
			const icon = themeToggle.querySelector('i');
			if (icon) {
				// Preserve the icon's original size class.
				const iconSizeClass = icon.classList.contains('text-2xl') ? 'text-2xl' : 'text-xl';
				
				// Determine the next theme for the tooltip text.
				const currentIndex = themes.indexOf(theme);
				const nextThemeName = themes[(currentIndex + 1) % themes.length];
				const capitalizedNextTheme = nextThemeName.charAt(0).toUpperCase() + nextThemeName.slice(1);
				
				// Reset icon classes and apply the new one.
				icon.className = `bi ${iconSizeClass}`; // Reset classes, keeping size.
				if (theme === 'light') {
					icon.classList.add('bi-sun-fill');
				} else if (theme === 'paper') {
					icon.classList.add('bi-journal');
				} else { // 'dark'
					icon.classList.add('bi-moon-fill');
				}
				themeToggle.setAttribute('title', `Switch to ${capitalizedNextTheme} Theme`);
			}
		}
	};
	
	// On initial load, determine the theme from localStorage or system preference.
	const savedTheme = localStorage.getItem('theme');
	const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
	let initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');
	
	// Fallback to 'light' if the saved theme is invalid.
	if (!themes.includes(initialTheme)) {
		initialTheme = 'light';
	}
	applyTheme(initialTheme);
	
	// Add a click listener to the toggle button to cycle through themes.
	if (themeToggle) {
		themeToggle.addEventListener('click', () => {
			const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
			const currentIndex = themes.indexOf(currentTheme);
			const nextIndex = (currentIndex + 1) % themes.length;
			const newTheme = themes[nextIndex];
			localStorage.setItem('theme', newTheme);
			applyTheme(newTheme);
		});
	}
});
