/**
 * Loads HTML templates for modals and injects them into a container element.
 * @param {string[]} modalNames - An array of template names (without .html extension).
 * @param {string} containerId - The ID of the DOM element to inject the modals into.
 */
export async function loadModals (modalNames, containerId) {
	const container = document.getElementById(containerId);
	if (!container) {
		console.error(`Modal container #${containerId} not found.`);
		return;
	}
	
	try {
		const templates = await Promise.all(
			modalNames.map(name => window.api.getTemplate(`modals/${name}`))
		);
		container.innerHTML = templates.join('\n');
	} catch (error) {
		console.error('Failed to load modal templates:', error);
		container.innerHTML = '<p class="text-error">Error loading modals.</p>';
	}
}
