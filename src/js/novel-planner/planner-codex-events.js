/**
 * Codex Entry Window Interaction Manager
 */

/**
 * Creates an HTMLElement from an HTML string.
 * @param {string} htmlString The HTML string.
 * @returns {HTMLElement | null} The first element created from the string.
 */
function createElementFromHTML(htmlString) {
	const div = document.createElement('div');
	div.innerHTML = htmlString.trim();
	// Use firstElementChild to correctly handle templates that may start with comment nodes.
	return div.firstElementChild;
}

document.addEventListener('DOMContentLoaded', () => {
	const desktop = document.getElementById('desktop');
	if (!desktop) return;
	
	desktop.addEventListener('dragover', (event) => {
		const dropZone = event.target.closest('.js-codex-drop-zone');
		if (dropZone) {
			event.preventDefault();
			event.dataTransfer.dropEffect = 'link';
		}
	});
	
	desktop.addEventListener('dragenter', (event) => {
		const dropZone = event.target.closest('.js-codex-drop-zone');
		if (dropZone) dropZone.classList.add('bg-blue-100', 'dark:bg-blue-900/50');
	});
	
	desktop.addEventListener('dragleave', (event) => {
		const dropZone = event.target.closest('.js-codex-drop-zone');
		if (dropZone && !dropZone.contains(event.relatedTarget)) {
			dropZone.classList.remove('bg-blue-100', 'dark:bg-blue-900/50');
		}
	});
	
	desktop.addEventListener('drop', async (event) => {
		const dropZone = event.target.closest('.js-codex-drop-zone');
		if (!dropZone) return;
		
		event.preventDefault();
		dropZone.classList.remove('bg-blue-100', 'dark:bg-blue-900/50');
		
		const parentEntryId = dropZone.dataset.entryId;
		const linkedEntryId = event.dataTransfer.getData('application/x-codex-entry-id');
		
		if (!parentEntryId || !linkedEntryId || parentEntryId === linkedEntryId) return;
		if (dropZone.querySelector(`.js-codex-tag[data-entry-id="${linkedEntryId}"]`)) return;
		
		try {
			const data = await window.api.attachCodexToCodex(parentEntryId, linkedEntryId);
			if (!data.success) throw new Error(data.message || 'Failed to link codex entry.');
			
			const tagContainer = dropZone.querySelector('.js-codex-tags-container');
			if (tagContainer) {
				const newTag = await createCodexLinkTagElement(parentEntryId, data.codexEntry);
				tagContainer.appendChild(newTag);
				const tagsWrapper = dropZone.querySelector('.js-codex-tags-wrapper');
				if (tagsWrapper) tagsWrapper.classList.remove('hidden');
			}
		} catch (error) {
			console.error('Error linking codex entry:', error);
			alert(error.message);
		}
	});
	
	// NEW: Add event listener for editing a codex entry from the main codex list.
	desktop.addEventListener('click', (event) => {
		const editBtn = event.target.closest('.js-edit-codex-entry');
		if (editBtn) {
			// No stopPropagation is needed due to the new HTML structure.
			const entryId = editBtn.dataset.entryId;
			if (entryId) {
				window.api.openCodexEditor(entryId);
			}
		}
	});
	
	// --- Unlinking Codex Entries ---
	desktop.addEventListener('click', async (event) => {
		const removeBtn = event.target.closest('.js-remove-codex-codex-link');
		if (!removeBtn) return;
		
		const tag = removeBtn.closest('.js-codex-tag');
		const parentEntryId = removeBtn.dataset.parentEntryId;
		const linkedEntryId = removeBtn.dataset.entryId;
		const entryTitle = tag.querySelector('.js-codex-tag-title').textContent;
		
		if (!confirm(`Are you sure you want to unlink "${entryTitle}" from this entry?`)) return;
		
		try {
			const data = await window.api.detachCodexFromCodex(parentEntryId, linkedEntryId);
			if (!data.success) throw new Error(data.message || 'Failed to unlink codex entry.');
			
			const tagContainer = tag.parentElement;
			tag.remove();
			
			if (tagContainer && tagContainer.children.length === 0) {
				const tagsWrapper = tagContainer.closest('.js-codex-tags-wrapper');
				if (tagsWrapper) tagsWrapper.classList.add('hidden');
			}
		} catch (error) {
			console.error('Error unlinking codex entry:', error);
			alert(error.message);
		}
	});
	
	async function createCodexLinkTagElement(parentEntryId, codexEntry) {
		let template = await window.api.getTemplate('planner/codex-link-tag');
		template = template.replace(/{{PARENT_ENTRY_ID}}/g, parentEntryId);
		template = template.replace(/{{ENTRY_ID}}/g, codexEntry.id);
		template = template.replace(/{{ENTRY_TITLE}}/g, codexEntry.title);
		
		return createElementFromHTML(template);
	}
});
