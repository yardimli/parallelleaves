const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const imageHandler = require('../utils/image-handler.js');

// Define paths for backup and data directories
const DOCUMENTS_PATH = app.getPath('documents');
const BACKUPS_BASE_DIR = path.join(DOCUMENTS_PATH, 'ParallelLeaves', 'Backups');
const CODEX_DIR = path.join(app.getPath('userData'), 'codex');
const DICTIONARIES_DIR = path.join(app.getPath('userData'), 'dictionaries');

/**
 * Sanitizes a string to be used as a directory or file name.
 * @param {string} name - The string to sanitize.
 * @returns {string} The sanitized string.
 */
function sanitizeName(name) {
	if (!name) return 'untitled';
	return name.replace(/[^a-z0-9\s-]/gi, '').replace(/\s+/g, '_').trim() || 'untitled';
}

/**
 * Gathers all data for a specific novel for backup purposes.
 * This function is shared between automatic and manual backups.
 * @param {Database.Database} db - The application's database connection.
 * @param {number} novelId - The ID of the novel to back up.
 * @returns {object|null} The complete backup data object, or null if the novel is not found.
 */
function getNovelBackupData(db, novelId) {
	try {
		const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(novelId);
		if (!novel) {
			console.error(`[Backup] Novel not found for ID: ${novelId}`);
			return null;
		}
		
		const chapters = db.prepare('SELECT * FROM chapters WHERE novel_id = ? ORDER BY chapter_order').all(novelId);
		
		// Image data
		let image = null;
		const imageRecord = db.prepare('SELECT image_local_path FROM images WHERE novel_id = ?').get(novelId);
		if (imageRecord && imageRecord.image_local_path) {
			const imagePath = path.join(imageHandler.IMAGES_DIR, imageRecord.image_local_path);
			if (fs.existsSync(imagePath)) {
				const imageData = fs.readFileSync(imagePath);
				image = {
					filename: path.basename(imageRecord.image_local_path),
					data: imageData.toString('base64')
				};
			}
		}
		
		// Codex data
		let codexHtml = null;
		const codexPath = path.join(CODEX_DIR, `codex-${novelId}.html`);
		if (fs.existsSync(codexPath)) {
			codexHtml = fs.readFileSync(codexPath, 'utf8');
		}
		
		// Dictionary data
		let dictionaryJson = null;
		const dictionaryPath = path.join(DICTIONARIES_DIR, `${novelId}.json`);
		if (fs.existsSync(dictionaryPath)) {
			dictionaryJson = fs.readFileSync(dictionaryPath, 'utf8');
		}
		
		return { novel, chapters, image, codexHtml, dictionaryJson };
	} catch (error) {
		console.error(`[Backup] Failed to gather backup data for novel ${novelId}:`, error);
		return null;
	}
}

/**
 * Deletes backup files older than 30 days from a specific novel's backup directory.
 * @param {string} novelBackupDir - The directory containing the backups for a single novel.
 */
function cleanupOldBackups(novelBackupDir) {
	if (!fs.existsSync(novelBackupDir)) return;
	
	const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
	
	try {
		const files = fs.readdirSync(novelBackupDir);
		for (const file of files) {
			const filePath = path.join(novelBackupDir, file);
			const stats = fs.statSync(filePath);
			if (stats.mtime.getTime() < thirtyDaysAgo) {
				fs.unlinkSync(filePath);
				console.log(`[AutoBackup] Deleted old backup: ${filePath}`);
			}
		}
	} catch (error) {
		console.error(`[AutoBackup] Error cleaning up old backups in ${novelBackupDir}:`, error);
	}
}

/**
 * Performs a backup for a single novel and saves it to the designated backup folder.
 * @param {Database.Database} db - The application's database connection.
 * @param {object} novel - The novel object from the database (must contain id and title).
 */
async function performNovelBackup(db, novel) {
	try {
		const backupData = getNovelBackupData(db, novel.id);
		if (!backupData) {
			return; // Error is already logged by getNovelBackupData
		}
		
		const novelBackupDir = path.join(BACKUPS_BASE_DIR, sanitizeName(novel.title));
		fs.mkdirSync(novelBackupDir, { recursive: true });
		
		const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, ''); // Format: YYYY-MM-DDTHH-MM-SS
		const backupFileName = `backup-${timestamp}.json`;
		const backupFilePath = path.join(novelBackupDir, backupFileName);
		
		const jsonString = JSON.stringify(backupData, null, 2);
		fs.writeFileSync(backupFilePath, jsonString);
		
		console.log(`[AutoBackup] Successfully backed up '${novel.title}' to ${backupFilePath}`);
		
		// After a successful backup, clean up old files for this novel.
		cleanupOldBackups(novelBackupDir);
	} catch (error) {
		console.error(`[AutoBackup] Failed to back up novel '${novel.title}' (ID: ${novel.id}):`, error);
	}
}

/**
 * Iterates through all novels in the database and triggers a backup for each one.
 * @param {Database.Database} db - The application's database connection.
 */
async function backupAllNovels(db) {
	console.log('[AutoBackup] Starting backup cycle for all novels...');
	try {
		const novels = db.prepare('SELECT id, title FROM novels').all();
		if (novels.length === 0) {
			console.log('[AutoBackup] No novels found to back up.');
			return;
		}
		
		for (const novel of novels) {
			await performNovelBackup(db, novel);
		}
		console.log('[AutoBackup] Backup cycle finished.');
	} catch (error) {
		console.error('[AutoBackup] A critical error occurred during the backup cycle:', error);
	}
}

/**
 * Initializes the auto-backup manager.
 * This function performs an initial backup and then sets up the hourly interval for subsequent backups.
 * @param {Database.Database} db - The application's database connection.
 */
function initialize(db) {
	if (!db) {
		console.error('[AutoBackup] Database connection not provided. Auto-backup is disabled.');
		return;
	}
	
	console.log('[AutoBackup] Initializing auto-backup manager.');
	
	// 1. Perform an initial backup for all books shortly after the app starts.
	// A short delay prevents this from interfering with app startup performance.
	setTimeout(() => backupAllNovels(db), 5000); // 5-second delay
	
	// 2. Set up the recurring hourly backup schedule.
	const oneHour = 60 * 60 * 1000;
	setInterval(() => backupAllNovels(db), oneHour);
	
	console.log(`[AutoBackup] Scheduled to run every hour. Backups will be stored in: ${BACKUPS_BASE_DIR}`);
}

module.exports = {
	initialize,
	getNovelBackupData // Export for use in manual backup IPC handler
};
