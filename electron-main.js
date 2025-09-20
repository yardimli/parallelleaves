const { app } = require('electron');
const path = require('path');
const fs = require('fs'); // Import the 'fs' module
const { initializeDatabase } = require('./src/database/database.js');
const sessionManager = require('./src/main/sessionManager.js');
const windowManager = require('./src/main/windowManager.js');
const { registerIpcHandlers } = require('./src/main/ipc');

// MODIFIED: Set app name for macOS development
// This ensures the application name in the menu bar is correct when running
// in development mode on macOS, instead of showing "Electron".
if (process.platform === 'darwin' && !app.isPackaged) {
	const packageJson = require('./package.json');
	if (packageJson.build && packageJson.build.productName) {
		app.setName(packageJson.build.productName);
		console.log(`Set app name to ${packageJson.build.productName} for macOS development`);
	}
}

// --- Portable Mode Configuration ---
// This logic makes the app truly portable by storing user data next to the executable.
// It checks for a file or environment variable that indicates a portable build.
// The `portable` target for electron-builder sets the `ELECTRON_IS_PORTABLE` environment variable.
if (process.env.ELECTRON_IS_PORTABLE) {
	const userDataPath = path.join(path.dirname(app.getPath('exe')), 'userData');
	if (!fs.existsSync(userDataPath)) {
		fs.mkdirSync(userDataPath, { recursive: true });
	}
	app.setPath('userData', userDataPath);
}


let db;

// --- App Lifecycle Events ---
app.on('ready', () => {
	// Set the application icon for the macOS Dock.
	if (process.platform === 'darwin') {
		const iconPath = path.join(__dirname, 'public/assets/icon.png');
		app.dock.setIcon(iconPath);
	}
	
	// Initialize core components
	db = initializeDatabase();
	sessionManager.loadSession();
	
	// Register all IPC event listeners, passing necessary dependencies
	registerIpcHandlers(db, sessionManager, windowManager);
	
	// Create initial windows
	windowManager.createSplashWindow();
	windowManager.createMainWindow();
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});

app.on('activate', () => {
	// On macOS it's common to re-create a window in the app when the
	// dock icon is clicked and there are no other windows open.
	if (windowManager.getMainWindow() === null) {
		windowManager.createMainWindow();
	}
});
