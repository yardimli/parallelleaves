const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { app } = require('electron');

// Define a consistent place to store user-generated images.
const IMAGES_DIR = path.join(app.getPath('userData'), 'images');

/**
 * Downloads an image from a URL and saves it locally.
 * Creates necessary directories.
 * @param {string} url - The URL of the image to download.
 * @param {string} novelId - The ID of the novel to associate the image with.
 * @param {string} filenameBase - The base name for the file (e.g., 'cover').
 * @returns {Promise<object|null>} An object containing the local paths to the saved image or null on failure.
 */
async function storeImageFromUrl(url, novelId, filenameBase) {
	try {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to download image: ${response.statusText}`);
		}
		
		const buffer = await response.buffer();
		const novelDir = path.join(IMAGES_DIR, 'novels', String(novelId));
		
		// Ensure the directory exists.
		fs.mkdirSync(novelDir, { recursive: true });
		
		let extension = '.png'; // Default to png for AI generated images
		try {
			const urlPath = new URL(url).pathname;
			const urlExt = path.extname(urlPath);
			if (['.png', '.jpg', '.jpeg', '.webp'].includes(urlExt)) {
				extension = urlExt;
			}
		} catch (e) {
			console.warn("Could not parse URL to determine extension, defaulting to .png");
		}
		
		const filename = `${filenameBase}-${Date.now()}${extension}`;
		const localPath = path.join(novelDir, filename);
		
		fs.writeFileSync(localPath, buffer);
		console.log(`Image saved to: ${localPath}`);
		
		const relativePath = path.join('novels', String(novelId), filename);
		
		// The calling function expects an object with an `original_path` property.
		return {
			original_path: relativePath,
			thumbnail_path: relativePath,
		};
		
	} catch (error) {
		console.error(`Failed to store image from URL '${url}':`, error);
		return null;
	}
}

/**
 * Copies an image from a local file path to the application's storage.
 * This is used for user uploads.
 * @param {string} sourcePath - The absolute path of the file to copy.
 * @param {string} novelId - The ID of the novel.
 * @param {string} filenameBase - The base name for the new file.
 * @returns {Promise<{original_path: string, thumbnail_path: string|null}>} The relative paths for DB storage.
 */
async function storeImageFromPath(sourcePath, novelId, filenameBase) {
	try {
		if (!fs.existsSync(sourcePath)) {
			throw new Error('Source file does not exist.');
		}
		
		const buffer = fs.readFileSync(sourcePath);
		
		// Build target directory path conditionally.
		let targetDir = path.join(IMAGES_DIR, 'novels', String(novelId));
		
		// Ensure the directory exists.
		fs.mkdirSync(targetDir, { recursive: true });
		
		const extension = path.extname(sourcePath);
		const filename = `${filenameBase}-${Date.now()}${extension}`;
		const localPath = path.join(targetDir, filename);
		
		fs.writeFileSync(localPath, buffer);
		
		// Build relative path for DB storage conditionally.
		let relativePath = path.join('novels', String(novelId));
		relativePath = path.join(relativePath, filename);
		
		return {
			original_path: relativePath,
			thumbnail_path: relativePath, // Using original as thumbnail for now
		};
		
	} catch (error) {
		console.error(`Failed to store image from path '${sourcePath}':`, error);
		throw error;
	}
}

module.exports = { storeImageFromUrl, storeImageFromPath, IMAGES_DIR };
