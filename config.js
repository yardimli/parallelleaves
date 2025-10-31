/**
 * Application-wide configuration for the Electron app.
 *
 * These settings are bundled with the application and are not intended for end-user modification.
 * The server-side PHP scripts will continue to use their own .env file for configuration,
 * as is standard practice for server environments.
 */
module.exports = {
	/**
	 * The current version of the application.
	 * Used by the splash screen to check for updates.
	 * @type {string}
	 */
	APP_VERSION: '0.1.7',
	
	/**
	 * URL for the server-side version check script (version-check.php).
	 * This endpoint returns the latest available application version.
	 * @type {string}
	 */
	VERSION_CHECK_URL: 'https://playground.computer/parallelleaves/version-check.php',
	
	/**
	 * URL for the server-side AI proxy script (ai-proxy.php).
	 * This script handles authenticated requests to AI services like OpenRouter.
	 * @type {string}
	 */
	AI_PROXY_URL: 'https://playground.computer/parallelleaves/ai-proxy.php',
	
	/**
	 * URL for the server-side login script (login.php).
	 * This endpoint validates user credentials and returns a session token.
	 * @type {string}
	 */
	LOGIN_API_URL: 'https://playground.computer/parallelleaves/login.php',
	
	/**
	 * URL for the external user registration page (register.php).
	 * This link is opened in the user's default browser.
	 * @type {string}
	 */
	REGISTER_URL: 'https://playground.computer/parallelleaves/register.php',
	
	/**
	 * The default AI model.
	 * This can be any model ID supported by your OpenRouter configuration.
	 * @type {string}
	 */
	OPEN_ROUTER_MODEL: 'openai/gpt-4o-mini'
};
