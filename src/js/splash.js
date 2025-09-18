/**
 * This script handles the splash screen functionality.
 * It displays user and version info, shows a fake loading animation,
 * and closes itself after a fixed duration.
 */
document.addEventListener('DOMContentLoaded', async () => {
	const userGreetingEl = document.getElementById('user-greeting');
	const versionInfoEl = document.getElementById('version-info');
	const loaderBar = document.getElementById('loader-bar');
	
	// Fetch initial data like version and user session from the main process.
	const { version, user } = await window.api.splashGetInitData();
	
	// 1. Populate UI elements with fetched data.
	versionInfoEl.textContent = `Version ${version}`;
	if (user) {
		userGreetingEl.textContent = `Welcome, ${user.username}`;
	} else {
		userGreetingEl.textContent = 'Welcome to Parallel Leaves';
	}
	
	// 2. Animate the loader bar to fill over 2 seconds.
	if (loaderBar) {
		// This transition will animate the 'width' property over 2 seconds.
		loaderBar.style.transition = 'width 2s linear';
		
		// We use a minimal timeout to ensure the CSS transition is applied correctly
		// after the element has been rendered in the DOM.
		setTimeout(() => {
			loaderBar.style.width = '100%';
		}, 10);
	}
	
	// 3. Send a message to the main process to close the splash screen after 2 seconds.
	setTimeout(() => {
		window.api.splashClose();
	}, 2000);
});
