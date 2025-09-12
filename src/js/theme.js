document.addEventListener('DOMContentLoaded', () => {
	const themeToggle = document.getElementById('theme-toggle');
	
	// Function to apply the theme
	const applyTheme = (theme) => {
		document.documentElement.setAttribute('data-theme', theme);
		
		// Add or remove the 'dark' class on the body tag to sync with the theme.
		if (theme === 'dark') {
			document.body.classList.add('dark');
		} else {
			document.body.classList.remove('dark');
		}
		
		// If the toggle button exists, update its state
		if (themeToggle) {
			const checkbox = themeToggle.querySelector('input[type="checkbox"]');
			if (checkbox) {
				checkbox.checked = (theme === 'dark');
			}
		}
	};
	
	// Check localStorage on initial load
	const savedTheme = localStorage.getItem('theme');
	const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
	const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');
	applyTheme(initialTheme);
	
	// Add click listener only if the toggle button is on the page
	if (themeToggle) {
		const checkbox = themeToggle.querySelector('input[type="checkbox"]');
		if (checkbox) {
			checkbox.addEventListener('change', (e) => {
				const newTheme = e.target.checked ? 'dark' : 'light';
				localStorage.setItem('theme', newTheme);
				applyTheme(newTheme);
			});
		}
	}
});
