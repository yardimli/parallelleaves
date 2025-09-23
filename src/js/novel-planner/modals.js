/**
 * Shows a confirmation modal and returns a promise that resolves with true or false.
 * @param {string} title - The title of the modal.
 * @param {string} message - The confirmation message.
 * @returns {Promise<boolean>} - True if confirmed, false otherwise.
 */
export function showConfirmationModal (title, message) {
	return new Promise((resolve) => {
		const modal = document.getElementById('confirmation-modal');
		const titleEl = document.getElementById('confirmation-modal-title');
		const contentEl = document.getElementById('confirmation-modal-content');
		let confirmBtn = document.getElementById('confirmation-modal-confirm-btn');
		const cancelBtn = document.getElementById('confirmation-modal-cancel-btn');
		
		// Clean up old listeners by replacing the button to prevent multiple resolves
		const newConfirmBtn = confirmBtn.cloneNode(true);
		confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
		confirmBtn = newConfirmBtn;
		
		titleEl.textContent = title;
		contentEl.textContent = message;
		
		const handleConfirm = () => {
			modal.close();
			resolve(true);
		};
		
		const handleCancel = () => {
			modal.close();
			resolve(false);
		};
		
		confirmBtn.addEventListener('click', handleConfirm, { once: true });
		cancelBtn.addEventListener('click', handleCancel, { once: true });
		
		// Ensure promise resolves if the modal is closed via Escape key
		const handleModalClose = () => {
			resolve(false);
			modal.removeEventListener('close', handleModalClose);
			confirmBtn.removeEventListener('click', handleConfirm);
			cancelBtn.removeEventListener('click', handleCancel);
		};
		modal.addEventListener('close', handleModalClose);
		
		modal.showModal();
	});
}

/**
 * Shows a modal with a text input and returns a promise that resolves with the input value or null.
 * @param {string} title - The title of the modal.
 * @param {string} label - The label for the input field.
 * @param {string} [initialValue=''] - The initial value for the input field.
 * @returns {Promise<string|null>} - The input value or null if canceled.
 */
export function showInputModal (title, label, initialValue = '') {
	return new Promise((resolve) => {
		const modal = document.getElementById('input-modal');
		const titleEl = document.getElementById('input-modal-title');
		const labelEl = document.getElementById('input-modal-label').querySelector('span');
		const inputEl = document.getElementById('input-modal-input');
		const form = document.getElementById('input-modal-form');
		
		titleEl.textContent = title;
		labelEl.textContent = label;
		inputEl.value = initialValue;
		
		const handleSubmit = (e) => {
			e.preventDefault();
			const value = inputEl.value.trim();
			resolve(value);
			cleanup();
		};
		
		const handleClose = () => {
			resolve(null);
			cleanup();
		};
		
		const cleanup = () => {
			modal.close();
			form.removeEventListener('submit', handleSubmit);
			modal.removeEventListener('close', handleClose);
		};
		
		form.addEventListener('submit', handleSubmit);
		modal.addEventListener('close', handleClose);
		
		modal.showModal();
		inputEl.focus();
		inputEl.select();
	});
}
