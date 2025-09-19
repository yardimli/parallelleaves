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
	
	// 2. Animate the loader bar to fill over 1 seconds.
	if (loaderBar) {
		loaderBar.style.transition = 'width 1s linear';
		
		setTimeout(() => {
			loaderBar.style.width = '100%';
		}, 10);
	}
	
	// MODIFIED: Instead of just closing itself, the splash screen now signals
	// the main process that it's finished, allowing the main process to
	// coordinate showing the main window.
	setTimeout(() => {
		window.api.splashFinished();
	}, 1000);
});
