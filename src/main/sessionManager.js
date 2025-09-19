const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const SESSION_FILE_PATH = path.join(app.getPath('userData'), 'session.json');

let currentUserSession = null;

/**
 * Saves the current user session to a file.
 * @param {object} session - The session object to save.
 */
function saveSession(session) {
	try {
		fs.writeFileSync(SESSION_FILE_PATH, JSON.stringify(session), 'utf8');
	} catch (error) {
		console.error('Failed to save session:', error);
	}
}

/**
 * Loads the user session from a file on startup.
 */
function loadSession() {
	try {
		if (fs.existsSync(SESSION_FILE_PATH)) {
			const sessionData = fs.readFileSync(SESSION_FILE_PATH, 'utf8');
			const session = JSON.parse(sessionData);
			if (session && session.token && session.user) {
				currentUserSession = session;
				console.log('Session loaded successfully for user:', session.user.username);
			}
		}
	} catch (error) {
		console.error('Failed to load session, clearing corrupted file:', error);
		clearSession();
	}
}

/**
 * Deletes the saved session file and clears the in-memory session.
 */
function clearSession() {
	currentUserSession = null;
	try {
		if (fs.existsSync(SESSION_FILE_PATH)) {
			fs.unlinkSync(SESSION_FILE_PATH);
		}
	} catch (error) {
		console.error('Failed to clear session file:', error);
	}
}

/**
 * Gets the currently active user session.
 * @returns {object|null} The current session object or null if not logged in.
 */
function getSession() {
	return currentUserSession;
}

/**
 * Sets the current user session and saves it to disk.
 * @param {object} session - The session object to set.
 */
function setSession(session) {
	currentUserSession = session;
	saveSession(session);
}

module.exports = {
	loadSession,
	clearSession,
	getSession,
	setSession,
};
