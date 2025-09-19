const { ipcMain, shell } = require('electron');
const fetch = require('node-fetch');
const config = require('../../../config.js');

/**
 * Registers IPC handlers for authentication.
 * @param {object} sessionManager - The session manager instance.
 */
function registerAuthHandlers(sessionManager) {
	const LOGIN_API_URL = config.LOGIN_API_URL;
	const REGISTER_URL = config.REGISTER_URL;
	
	ipcMain.handle('auth:login', async (event, credentials) => {
		try {
			if (!LOGIN_API_URL) throw new Error('Login API URL is not configured in config.js.');
			
			const response = await fetch(LOGIN_API_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(credentials)
			});
			
			const data = await response.json();
			
			if (response.ok && data.success) {
				const session = {
					token: data.token,
					user: data.user
				};
				sessionManager.setSession(session);
				return { success: true, session: session };
			} else {
				return { success: false, message: data.message || 'Login failed' };
			}
		} catch (error) {
			console.error('Login error:', error);
			return { success: false, message: error.message };
		}
	});
	
	ipcMain.handle('auth:logout', () => {
		sessionManager.clearSession();
		return { success: true };
	});
	
	ipcMain.handle('auth:get-session', () => {
		return sessionManager.getSession();
	});
	
	ipcMain.on('auth:open-register-url', () => {
		if (REGISTER_URL) {
			shell.openExternal(REGISTER_URL);
		} else {
			console.error('REGISTER_URL is not defined in config.js file.');
		}
	});
}

module.exports = { registerAuthHandlers };
