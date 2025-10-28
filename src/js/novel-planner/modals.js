import { t } from '../i18n.js';

/**
 * Shows a confirmation modal and returns a promise that resolves with true, false, or 'decline'.
 * @param {string} title - The title of the modal.
 * @param {string} message - The confirmation message.
 * @param {object} [options={}] - Optional settings.
 * @param {boolean} [options.showDecline=false] - If true, shows the "Don't ask again" button.
 * @param {string} [options.declineKey] - An i18n key for the decline button's text.
 * @returns {Promise<boolean|'decline'>} - true if confirmed, false if canceled, 'decline' if the third button is clicked.
 */
export function showConfirmationModal (title, message, options = {}) {
	return new Promise((resolve) => {
		const modal = document.getElementById('confirmation-modal');
		const titleEl = document.getElementById('confirmation-modal-title');
		const contentEl = document.getElementById('confirmation-modal-content');
		const confirmBtn = document.getElementById('confirmation-modal-confirm-btn');
		const cancelBtn = document.getElementById('confirmation-modal-cancel-btn');
		const declineBtn = document.getElementById('confirmation-modal-decline-btn');
		
		const newConfirmBtn = confirmBtn.cloneNode(true);
		confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
		const newCancelBtn = cancelBtn.cloneNode(true);
		cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
		const newDeclineBtn = declineBtn.cloneNode(true);
		declineBtn.parentNode.replaceChild(newDeclineBtn, declineBtn);
		
		titleEl.innerHTML = title; // MODIFIED: Allow HTML in title
		contentEl.innerHTML = message; // MODIFIED: Allow HTML in message
		
		if (options.showDecline) {
			newDeclineBtn.classList.remove('hidden');
			// NEW: Allow custom text for decline button via i18n key
			if (options.declineKey) {
				newDeclineBtn.textContent = t(options.declineKey);
			}
		} else {
			newDeclineBtn.classList.add('hidden');
		}
		
		const cleanup = () => {
			modal.removeEventListener('close', handleClose);
			newConfirmBtn.removeEventListener('click', handleConfirm);
			newCancelBtn.removeEventListener('click', handleCancel);
			newDeclineBtn.removeEventListener('click', handleDecline);
		};
		
		const handleConfirm = () => {
			cleanup();
			modal.close();
			resolve(true);
		};
		
		const handleCancel = () => {
			cleanup();
			modal.close();
			resolve(false);
		};
		
		const handleDecline = () => {
			cleanup();
			modal.close();
			resolve('decline');
		};
		
		// This handles closing the modal with the Escape key.
		const handleClose = () => {
			cleanup();
			resolve(false);
		};
		
		newConfirmBtn.addEventListener('click', handleConfirm, { once: true });
		newCancelBtn.addEventListener('click', handleCancel, { once: true });
		newDeclineBtn.addEventListener('click', handleDecline, { once: true });
		modal.addEventListener('close', handleClose, { once: true });
		
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
