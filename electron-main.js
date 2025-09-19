const { app } = require('electron');
const path = require('path');
const { initializeDatabase } = require('./src/database/database.js');
const sessionManager = require('./src/main/sessionManager.js');
const windowManager = require('./src/main/windowManager.js');
const { registerIpcHandlers } = require('./src/main/ipc');

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
