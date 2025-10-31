const { app, session } = require('electron');
const path = require('path');
const fs = require('fs');

// --- Reset Logic on Startup ---
// This block must run before any other app logic that might access the userData path.
// It checks for a 'reset.flag' file located one level above the userData directory.
// If the flag is found, it deletes the entire userData directory and then removes the flag.
try {
	const userDataPath = app.getPath('userData');
	const resetFlagPath = path.join(userDataPath, '..', 'reset.flag');
	
	if (fs.existsSync(resetFlagPath)) {
		console.log('Reset flag found. Deleting user data directory...');
		// Ensure the path exists before trying to delete it.
		if (fs.existsSync(userDataPath)) {
			fs.rmSync(userDataPath, { recursive: true, force: true });
		}
		// Remove the flag file to prevent reset on subsequent launches.
		fs.unlinkSync(resetFlagPath);
		console.log('User data deleted and reset flag removed.');
	}
} catch (error) {
	// If this fails, the app might be in an inconsistent state.
	// We log the error and continue, but a production app might show an error dialog and quit.
	console.error('FATAL: Failed to process application reset:', error);
}


const { initializeDatabase } = require('./src/database/database.js');
const sessionManager = require('./src/main/sessionManager.js');
const windowManager = require('./src/main/windowManager.js');
const { registerIpcHandlers } = require('./src/main/ipc');
const autoBackupManager = require('./src/main/autoBackupManager.js');

// Set app name for macOS development
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
	
	autoBackupManager.initialize(db);
	
	// Create initial windows
	windowManager.createSplashWindow();
	windowManager.createMainWindow();
});

// MODIFIED: The 'will-quit' handler no longer contains the reset logic.
// The reset is now handled at application startup to avoid file lock issues.
app.on('will-quit', async (event) => {
	// The application can perform any other necessary cleanup here.
	// The reset logic has been moved to the startup sequence.
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
