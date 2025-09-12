// src/database/database.js

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { app } = require('electron');

let db; // Keep a reference to the database instance

/**
 * Initializes the database connection. This function MUST be called
 * after the Electron 'app' is ready.
 * @returns {Database.Database} The database instance.
 */
function initializeDatabase() {
	// If the database is already initialized, just return it.
	if (db) {
		return db;
	}
	
	// Get the correct user data path. This works because this function
	// will be called after the 'ready' event.
	const userDataPath = app.getPath('userData');
	const dbPath = path.join(userDataPath, 'app.db');
	
	// Ensure the user data directory exists
	if (!fs.existsSync(userDataPath)) {
		fs.mkdirSync(userDataPath, { recursive: true });
	}
	
	db = new Database(dbPath);
	
	// Enable WAL mode for better performance.
	db.pragma('journal_mode = WAL');
	
	// Run schema setup.
	try {
		const schemaPath = path.join(__dirname, 'schema.sql');
		const schema = fs.readFileSync(schemaPath, 'utf8');
		db.exec(schema);
		console.log(`Database initialized successfully at: ${dbPath}`);
	} catch (error) {
		console.error('Failed to initialize database schema:', error);
	}
	
	return db;
}

module.exports = { initializeDatabase };
