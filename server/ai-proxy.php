<?php

	/**
	 * AI Proxy for OpenRouter and Fal.ai APIs
	 *
	 * This script securely forwards requests from the Electron application to various AI APIs.
	 * It validates a user session token for protected actions, logs all interactions to a MySQL database,
	 * and processes the model list before returning it.
	 *
	 * @version 1.6.0
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
				$_ENV[trim($name)] = trim($value);
			}
		}
	}

// Get config from environment variables
	$apiKey = $_ENV['OPEN_ROUTER_API_KEY'] ?? '';
	$falApiKey = $_ENV['FAL_API_KEY'] ?? '';
	$dbHost = $_ENV['DB_HOST'] ?? 'localhost';
	$dbName = $_ENV['DB_NAME'] ?? '';
	$dbUser = $_ENV['DB_USER'] ?? '';
	$dbPass = $_ENV['DB_PASS'] ?? '';

// Set common headers
	header('Content-Type: application/json');
	header('Access-Control-Allow-Origin: *');
	header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
	header('Access-Control-Allow-Headers: Content-Type, Authorization');

// Handle preflight OPTIONS request for CORS
	if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
		http_response_code(204);
		exit;
	}

	/**
	 * Logs an interaction to the database.
	 *
	 * @param mysqli      $db             The mysqli database connection object.
	 * @param int         $userId         The ID of the user making the request.
	 * @param string      $action         The action being performed.
	 * @param array|null  $requestPayload The decoded JSON payload of the request.
	 * @param string      $responseBody   The raw string body of the response.
	 * @param int         $responseCode   The HTTP response code.
	 * @return void
	 */
	function logInteraction(mysqli $db, int $userId, string $action, ?array $requestPayload, string $responseBody, int $responseCode): void
	{
		try {
			$stmt = $db->prepare(
				'INSERT INTO api_logs (user_id, action, request_payload, response_body, response_code) VALUES (?, ?, ?, ?, ?)'
			);
			$payloadJson = $requestPayload ? json_encode($requestPayload) : null;
			$stmt->bind_param('isssi', $userId, $action, $payloadJson, $responseBody, $responseCode);
			$stmt->execute();
			$stmt->close();
		} catch (Exception $e) {
			error_log('Failed to write to database log: ' . $e->getMessage());
		}
	}

	/**
	 * Sends a JSON formatted error response and terminates the script.
	 *
	 * @param int    $statusCode The HTTP status code to send.
	 * @param string $message    The error message.
	 * @return void
	 */
	function sendJsonError(int $statusCode, string $message): void
	{
		http_response_code($statusCode);
		echo json_encode(['error' => ['message' => $message]]);
		exit;
	}

	/**
	 * Processes the raw models list from OpenRouter to create a view-friendly array.
	 *
	 * @param array $modelsData The raw decoded JSON response from OpenRouter.
	 * @return array A sorted array of models ready for a dropdown.
	 */
	function processModelsForView(array $modelsData): array
	{
		$processedModels = [];
		$positiveList = ['openai', 'anthropic', 'mistral', 'google', 'deepseek', 'moonshot', 'glm'];
		$negativeList = [
			'free', '8b', '9b', '3b', '7b', '12b', '22b', '24b', '32b', 'gpt-4 turbo', 'oss', 'tng', 'lite',
			'1.5', '2.0', 'tiny', 'gemma', 'small', 'nemo', 'chat', 'distill', '3.5', 'dolphin', 'codestral',
			'devstral', 'magistral', 'pixtral', 'codex', 'o1-pro', 'o3-pro', 'experimental', 'preview'
		];

		$models = $modelsData['data'] ?? [];

		usort($models, function ($a, $b) {
			return strcmp($a['name'], $b['name']);
		});

		foreach ($models as $model) {
			$id = $model['id'];
			$name = $model['name'];
			$idLower = strtolower($id);
			$nameLower = strtolower($name);

			$isNegativeMatch = false;
			foreach ($negativeList as $word) {
				if (strpos($idLower, $word) !== false || strpos($nameLower, $word) !== false) {
					$isNegativeMatch = true;
					break;
				}
			}
			if ($isNegativeMatch) {
				continue;
			}

			$isPositiveMatch = false;
			foreach ($positiveList as $word) {
				if (strpos($idLower, $word) !== false || strpos($nameLower, $word) !== false) {
					$isPositiveMatch = true;
					break;
				}
			}
			if (!$isPositiveMatch) {
				continue;
			}

			$hasImageSupport = in_array('image', $model['architecture']['input_modalities'] ?? []);
			$hasReasoningSupport = in_array('reasoning', $model['supported_parameters'] ?? []);

			if ($hasImageSupport) {
				$name .= ' (i)';
			}

			if ($hasReasoningSupport && strpos(strtolower($name), 'think') === false) {
				$processedModels[] = ['id' => $id, 'name' => $name];
				$processedModels[] = ['id' => "{$id}--thinking", 'name' => "{$name} (thinking)"];
			} else {
				$processedModels[] = ['id' => $id, 'name' => $name];
			}
		}

		usort($processedModels, function ($a, $b) {
			return strcmp($a['name'], $b['name']);
		});

		return $processedModels;
	}

// Establish database connection using mysqli
	mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
	try {
		$db = new mysqli($dbHost, $dbUser, $dbPass, $dbName);
		$db->set_charset('utf8mb4');
	} catch (Exception $e) {
		sendJsonError(500, 'Database connection failed.');
	}

	if (empty($apiKey)) {
		sendJsonError(500, 'API key is not configured on the server.');
	}

// Handle different actions based on a query parameter
	$action = $_GET['action'] ?? 'chat';

// Handle public and private actions separately, using payload for auth token
	if ($action === 'get_models') {
		// This action is public. We'll try to get a user ID for logging but won't fail if it's not present.
		$userId = 0; // Default for anonymous users

		// Get token from payload for logging.
		$requestBody = file_get_contents('php://input');
		$payload = json_decode($requestBody, true) ?? [];
		$token = $payload['auth_token'] ?? null;

		if ($token) {
			$stmt = $db->prepare('SELECT id FROM users WHERE session_token = ? AND token_expires_at > NOW()');
			$stmt->bind_param('s', $token);
			$stmt->execute();
			$result = $stmt->get_result();
			$user = $result->fetch_assoc();
			$stmt->close();
			if ($user) {
				$userId = (int)$user['id'];
			}
		}

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

		// Pass null for requestPayload as we don't want to log the token.
		logInteraction($db, $userId, $action, null, (string)$response, $httpCode);

		if ($httpCode >= 400) {
			sendJsonError($httpCode, 'Failed to fetch models from OpenRouter. ' . $response);
		}

		$modelsData = json_decode($response, true);
		if (json_last_error() !== JSON_ERROR_NONE) {
			sendJsonError(500, 'Failed to parse models data from OpenRouter.');
		}

		$processedModels = processModelsForView($modelsData);

		echo json_encode($processedModels);
		exit;
	}

// All other actions require authentication.
	$requestBody = file_get_contents('php://input');
	$payload = json_decode($requestBody, true);

	if (json_last_error() !== JSON_ERROR_NONE) {
		sendJsonError(400, 'Invalid JSON payload received.');
	}

	$token = $payload['auth_token'] ?? null;
	if (!$token) {
		sendJsonError(401, 'Authentication token missing from payload.');
	}

// Authenticate user
	$userId = null;
	$stmt = $db->prepare('SELECT id FROM users WHERE session_token = ? AND token_expires_at > NOW()');
	$stmt->bind_param('s', $token);
	$stmt->execute();
	$result = $stmt->get_result();
	$user = $result->fetch_assoc();
	$stmt->close();

	if ($user) {
		$userId = (int)$user['id'];
	} else {
		sendJsonError(401, 'Invalid or expired session token.');
	}

// Remove token from payload before logging and forwarding
	unset($payload['auth_token']);

// Handle authenticated actions
	if ($action === 'chat') {
		if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
			sendJsonError(405, 'Method Not Allowed. Please use POST for chat completions.');
		}

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

		logInteraction($db, $userId, $action, $payload, (string)$response, $httpCode);

		http_response_code($httpCode);
		echo $response;
		exit;
	} elseif ($action === 'generate_cover') { // NEW SECTION START
		if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
			sendJsonError(405, 'Method Not Allowed. Please use POST for cover generation.');
		}
		if (empty($falApiKey)) {
			sendJsonError(500, 'Fal.ai API key is not configured on the server.');
		}

		$prompt = $payload['prompt'] ?? '';
		if (empty($prompt)) {
			sendJsonError(400, 'Image prompt is required.');
		}

		$falPayload = [
			'prompt' => $prompt,
			'image_size' => 'portrait_4_3',
		];

		$ch = curl_init('https://fal.run/fal-ai/qwen-image');
		curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
		curl_setopt($ch, CURLOPT_POST, true);
		curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($falPayload));
		curl_setopt($ch, CURLOPT_HTTPHEADER, [
			'Authorization: Key ' . $falApiKey,
			'Content-Type: application/json',
			'Accept: application/json',
		]);

		$response = curl_exec($ch);
		$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
		curl_close($ch);

		logInteraction($db, $userId, 'fal_generate_cover', $falPayload, (string)$response, $httpCode);

		http_response_code($httpCode);
		echo $response;
		exit;
	} // NEW SECTION END
	else {
		sendJsonError(400, 'Invalid action specified. Supported actions are "chat", "get_models", and "generate_cover".');
	}
