const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { app } = require('electron');

let db; // Keep a reference to the database instance

/**
 * Reads the schema.sql file and executes it against the database.
 * The schema file uses "CREATE TABLE IF NOT EXISTS" statements, making this function
 * idempotent and safe to run on every app start. It will create any missing tables
 * without altering or throwing errors on existing ones. This effectively verifies
 * that the database schema is up-to-date with the application's requirements.
 * @param {Database.Database} database - The better-sqlite3 database instance.
 */
function verifyAndApplySchema(database) {
	try {
		const schemaPath = path.join(__dirname, 'schema.sql');
		const schema = fs.readFileSync(schemaPath, 'utf8');
		
		// The .exec() method can execute a string containing multiple SQL statements.
		// Because we use "CREATE TABLE IF NOT EXISTS", this operation is safe to run every time.
		// It ensures that all tables defined in the schema file are present in the database.
		database.exec(schema);
		console.log('Database schema verified. All required tables are present.');
	} catch (error) {
		console.error('Failed to apply database schema:', error);
	}
}

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
	
	// Enable WAL mode for better performance and concurrency.
	db.pragma('journal_mode = WAL');
	
	// On startup, verify that all tables from the schema file exist,
	// and create any that are missing.
	verifyAndApplySchema(db);
	
	console.log(`Database initialized successfully at: ${dbPath}`);
	
	return db;
}

module.exports = { initializeDatabase };
