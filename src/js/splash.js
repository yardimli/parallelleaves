/**
 * Compares two semantic version strings (e.g., '1.10.2' vs '1.2.0').
 * @param {string} v1 The first version string.
 * @param {string} v2 The second version string.
 * @returns {number} 1 if v1 > v2, -1 if v1 < v2, 0 if v1 === v2.
 */
function compareVersions(v1, v2) {
	const parts1 = v1.split('.').map(Number);
	const parts2 = v2.split('.').map(Number);
	const len = Math.max(parts1.length, parts2.length);
	for (let i = 0; i < len; i++) {
		const p1 = parts1[i] || 0;
		const p2 = parts2[i] || 0;
		if (p1 > p2) return 1;
		if (p1 < p2) return -1;
	}
	return 0;
}


document.addEventListener('DOMContentLoaded', async () => {
	const userGreetingEl = document.getElementById('user-greeting');
	const versionInfoEl = document.getElementById('version-info');
	const updateStatusEl = document.getElementById('update-status');
	const websiteLink = document.getElementById('website-link');
	
	const { version, user, websiteUrl } = await window.api.splashGetInitData();
	
	// 1. Populate initial UI elements
	versionInfoEl.textContent = `Version ${version}`;
	if (user) {
		userGreetingEl.textContent = `Welcome, ${user.username}`;
	} else {
		userGreetingEl.textContent = 'Welcome to Parallel Leaves';
	}
	
	websiteLink.addEventListener('click', (e) => {
		e.preventDefault();
		window.api.openExternalUrl(websiteUrl);
	});
	
	// 2. Check for updates
	try {
		const latestVersion = await window.api.splashCheckForUpdates();
		
		// MODIFICATION: Use a robust version comparison function.
		if (latestVersion && compareVersions(latestVersion, version) > 0) {
			// New version available
			updateStatusEl.innerHTML = `A new version (${latestVersion}) is available! <a id="update-link" href="#" class="link link-accent">Update Now</a>`;
			
			// MODIFICATION: Add a clear message telling the user how to proceed.
			const continueEl = document.createElement('p');
			continueEl.className = 'text-xs text-base-content/60 mt-1';
			continueEl.textContent = '(Click anywhere to continue)';
			updateStatusEl.insertAdjacentElement('afterend', continueEl);
			
			document.getElementById('update-link').addEventListener('click', (e) => {
				e.preventDefault();
				window.api.openExternalUrl(websiteUrl); // Or a specific download link
			});
			// Don't auto-close, wait for user click
			document.body.addEventListener('click', (e) => {
					window.api.splashClose();
			});
		} else {
			// Up to date or check failed
			updateStatusEl.textContent = 'You are up to date!';
			// Auto-close after a delay
			setTimeout(() => {
				window.api.splashClose();
			}, 2500);
		}
	} catch (error) {
		console.error('Update check failed:', error);
		updateStatusEl.textContent = 'Could not check for updates.';
		// Auto-close after a delay on error
		setTimeout(() => {
			window.api.splashClose();
		}, 2500);
	}
});
