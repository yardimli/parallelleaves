<?php

	/**
	 * AI Proxy for OpenRouter API
	 *
	 * This script securely forwards requests from the Electron application to the OpenRouter API.
	 * It handles the API key on the server-side to prevent exposure in the client application.
	 * It also logs all requests and responses to a local file for debugging.
	 *
	 * @version 1.1.0
	 * @author locutus de borg
	 */

// Enforce PSR-12 standards
	declare(strict_types=1);

// Load environment variables from a .env file in the same directory
	if (file_exists(__DIR__ . '/.env')) {
		$lines = file(__DIR__ . '/.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
		if ($lines !== false) {
			foreach ($lines as $line) {
				if (strpos(trim($line), '#') === 0) {
					continue;
				}
				list($name, $value) = explode('=', $line, 2);
				$name = trim($name);
				$value = trim($value);
				if (!array_key_exists($name, $_SERVER) && !array_key_exists($name, $_ENV)) {
					putenv(sprintf('%s=%s', $name, $value));
					$_ENV[$name] = $value;
					$_SERVER[$name] = $value;
				}
			}
		}
	}

// Get API Key from environment variables
	$apiKey = getenv('OPEN_ROUTER_API_KEY');

// Set common headers
	header('Content-Type: application/json');
	header('Access-Control-Allow-Origin: *'); // Consider locking down to your app's origin for production
	header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
	header('Access-Control-Allow-Headers: Content-Type');

// Handle preflight OPTIONS request for CORS
	if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
		http_response_code(204);
		exit;
	}

// NEW SECTION START: Logging functionality
	/**
	 * Logs an interaction to a file.
	 *
	 * @param string      $action         The action being performed (e.g., 'chat', 'get_models', 'error').
	 * @param array|null  $requestPayload The decoded JSON payload of the request, if any.
	 * @param string      $responseBody   The raw string body of the response.
	 * @param int         $responseCode   The HTTP response code.
	 * @return void
	 */
	function logInteraction(string $action, ?array $requestPayload, string $responseBody, int $responseCode): void
	{
		try {
			$logFile = __DIR__ . '/ai_proxy.log';
			$timestamp = date('Y-m-d H:i:s');

			$formattedRequest = $requestPayload ? json_encode($requestPayload, JSON_PRETTY_PRINT) : 'N/A (GET Request)';

			// Attempt to pretty-print JSON responses for readability
			$jsonDecodedResponse = json_decode($responseBody);
			$formattedResponse = (json_last_error() === JSON_ERROR_NONE)
				? json_encode($jsonDecodedResponse, JSON_PRETTY_PRINT)
				: $responseBody;

			$logEntry = "==================================================\n";
			$logEntry .= "Timestamp: {$timestamp}\n";
			$logEntry .= "Action: {$action}\n";
			$logEntry .= "Response Code: {$responseCode}\n";
			$logEntry .= "------------------ Request ------------------\n";
			$logEntry .= "{$formattedRequest}\n";
			$logEntry .= "------------------ Response ------------------\n";
			$logEntry .= "{$formattedResponse}\n";
			$logEntry .= "==================================================\n\n";

			// Append to the log file, creating it if it doesn't exist.
			// LOCK_EX prevents concurrent writes from corrupting the file.
			file_put_contents($logFile, $logEntry, FILE_APPEND | LOCK_EX);
		} catch (Exception $e) {
			// Suppress logging errors to prevent infinite loops or script failure
			error_log('Failed to write to proxy log file: ' . $e->getMessage());
		}
	}
// NEW SECTION END

	/**
	 * Sends a JSON formatted error response, logs it, and terminates the script.
	 *
	 * @param int        $statusCode     The HTTP status code to send.
	 * @param string     $message        The error message.
	 * @param array|null $requestPayload The request payload to include in the log.
	 * @return void
	 */
	function sendJsonError(int $statusCode, string $message, ?array $requestPayload = null): void
	{
		$responseBody = json_encode(['error' => ['message' => $message]]);
		// MODIFIED: Log the error interaction before exiting.
		logInteraction('error', $requestPayload, $responseBody, $statusCode);

		http_response_code($statusCode);
		echo $responseBody;
		exit;
	}

	if ($apiKey === false || $apiKey === '') {
		sendJsonError(500, 'API key is not configured on the server.');
	}

// Handle different actions based on a query parameter
	$action = $_GET['action'] ?? 'chat';

	if ($action === 'get_models') {
		// Proxy request for fetching models
		$ch = curl_init('https://openrouter.ai/api/v1/models');
		curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
		curl_setopt($ch, CURLOPT_HTTPHEADER, [
			'Accept: application/json',
			'HTTP-Referer: https://github.com/locutusdeborg/novel-skriver',
			'X-Title: Parallel Leaves',
		]);

		$response = curl_exec($ch);
		$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
		curl_close($ch);

		// MODIFIED: Log the interaction.
		logInteraction($action, null, (string)$response, $httpCode);

		if ($httpCode >= 400) {
			// Note: sendJsonError also logs, so we don't need a separate log call here.
			sendJsonError($httpCode, 'Failed to fetch models from OpenRouter. ' . $response);
		}

		echo $response;
		exit;
	} elseif ($action === 'chat') {
		// Handle chat completions
		if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
			sendJsonError(405, 'Method Not Allowed. Please use POST for chat completions.');
		}

		$requestBody = file_get_contents('php://input');
		$payload = json_decode($requestBody, true);

		if (json_last_error() !== JSON_ERROR_NONE) {
			sendJsonError(400, 'Invalid JSON payload received.');
		}

		// Ensure streaming is disabled, as this proxy does not support it.
		if (isset($payload['stream'])) {
			unset($payload['stream']);
		}

		$ch = curl_init('https://openrouter.ai/api/v1/chat/completions');
		curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
		curl_setopt($ch, CURLOPT_POST, true);
		curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
		curl_setopt($ch, CURLOPT_HTTPHEADER, [
			'Authorization: Bearer ' . $apiKey,
			'Content-Type: application/json'
		]);

		$response = curl_exec($ch);
		$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
		curl_close($ch);

		// MODIFIED: Log the interaction before sending the response to the client.
		logInteraction($action, $payload, (string)$response, $httpCode);

		// Forward the response (success or error) from OpenRouter directly to the client
		http_response_code($httpCode);
		echo $response;
		exit;
	} else {
		sendJsonError(400, 'Invalid action specified. Supported actions are "chat" and "get_models".');
	}
