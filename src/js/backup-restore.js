import { t } from './i18n.js';

/**
 * Initiates the backup process for a specific novel.
 * Fetches all novel data, packages it as JSON, and prompts the user to save the file.
 * @param {number} novelId - The ID of the novel to back up.
 * @param {string} novelTitle - The title of the novel, used for the default filename.
 */
export async function backupNovel(novelId, novelTitle) {
	try {
		// 1. Get all data for the novel from the main process.
		const backupData = await window.api.getNovelForBackup(novelId);
		if (!backupData) {
			throw new Error('No data returned for backup.');
		}
		
		// 2. Convert the data to a JSON string.
		const jsonString = JSON.stringify(backupData, null, 2);
		
		// 3. Prompt the user to save the file via the main process.
		const defaultFileName = `${novelTitle.replace(/[^a-z0-9]/gi, '_')}_backup_${new Date().toISOString().split('T')[0]}.json`;
		
		const result = await window.api.saveBackupToFile(defaultFileName, jsonString);
		if (!result.success && result.message !== 'Save cancelled by user.') {
			throw new Error(result.message);
		}
		
	} catch (error) {
		console.error('Backup failed:', error);
		window.showAlert(
			t('dashboard.backupFailed', { message: error.message }),
			t('common.error')
		);
	}
}

/**
 * Initiates the restore process from a backup file.
 * Prompts the user to select a backup file, reads it, and sends the data to the main process for restoration.
 */
export async function restoreNovel() {
	try {
		// 1. Ask the user to select a backup file via the main process.
		const fileContent = await window.api.openBackupFile();
		
		// If the user cancelled the dialog, fileContent will be null.
		if (fileContent === null) {
			console.log('Restore operation cancelled by user.');
			return;
		}
		
		// 2. Parse the file content as JSON.
		const backupData = JSON.parse(fileContent);
		
		// MODIFICATION START: Updated validation to remove obsolete 'codex_categories' check.
		// The presence of 'novel' and 'sections' is sufficient to identify a valid backup file.
		if (!backupData.novel || !backupData.sections) {
			throw new Error('Invalid or corrupted backup file format.');
		}
		// MODIFICATION END
		
		// 3. Send the data to the main process to handle the database operations.
		const result = await window.api.restoreNovelFromBackup(backupData);
		
		if (result.success) {
			window.showAlert(
				t('dashboard.restoreSuccess', { title: backupData.novel.title }),
				t('common.information')
			);
			// Force a reload to show the new project immediately.
			window.location.reload();
		} else {
			throw new Error(result.message || 'Unknown error during restore.');
		}
		
	} catch (error) {
		console.error('Restore failed:', error);
		window.showAlert(
			t('dashboard.restoreFailed', { message: error.message }),
			t('common.error')
		);
	}
}
