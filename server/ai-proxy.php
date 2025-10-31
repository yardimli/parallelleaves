<?php

	/**
	 * AI Proxy for OpenRouter and Fal.ai APIs
	 *
	 * This script securely forwards requests from the Electron application to various AI APIs.
	 * It validates a user session token for protected actions, logs all interactions to a MySQL database,
	 * and provides a verified, grouped list of available models.
	 *
	 * @version 1.9.5
	 * @author Ekim Emre Yardimli
	 */

	/*
	 * -- SQL for the new translation_logs table in MySQL
	 * CREATE TABLE `translation_logs` (
	 *   `id` int(11) NOT NULL AUTO_INCREMENT,
	 *   `user_id` int(11) NOT NULL,
	 *   `novel_id` int(11) NOT NULL,
	 *   `chapter_id` int(11) NOT NULL,
	 *   `source_text` text COLLATE utf8mb4_unicode_ci NOT NULL,
	 *   `target_text` text COLLATE utf8mb4_unicode_ci NOT NULL,
	 *   `marker` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
	 *   `model` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
	 *   `temperature` float NOT NULL,
	 *   `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
	 *   PRIMARY KEY (`id`),
	 *   KEY `user_id` (`user_id`)
	 * ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
	 */

	/*
	 * -- MODIFIED: SQL for new server-side translation memory tables
	 *
	 * CREATE TABLE `user_books` (
	 *   `id` int(11) NOT NULL AUTO_INCREMENT,
	 *   `book_id` int(11) NOT NULL COMMENT 'The novel_id from the Electron app''s local DB',
	 *   `user_id` int(11) NOT NULL,
	 *   `source_language` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
	 *   `target_language` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
	 *   `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
	 *   `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
	 *   PRIMARY KEY (`id`),
	 *   UNIQUE KEY `book_id_user_id` (`book_id`,`user_id`)
	 * ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
	 *
	 * CREATE TABLE `user_book_blocks` (
	 *   `id` int(11) NOT NULL AUTO_INCREMENT,
	 *   `user_book_id` int(11) NOT NULL,
	 *   `marker_id` int(11) NOT NULL,
	 *   `source_text` text COLLATE utf8mb4_unicode_ci NOT NULL,
	 *   `target_text` text COLLATE utf8mb4_unicode_ci NOT NULL,
	 *   `is_analyzed` tinyint(1) NOT NULL DEFAULT 0,
	 *   PRIMARY KEY (`id`),
	 *   UNIQUE KEY `user_book_id_marker_id` (`user_book_id`,`marker_id`),
	 *   KEY `user_book_id` (`user_book_id`)
	 * ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
	 *
	 * CREATE TABLE `user_books_translation_memory` (
	 *   `id` int(11) NOT NULL AUTO_INCREMENT,
	 *   `user_book_id` int(11) NOT NULL,
	 *   `block_id` int(11) NOT NULL,
	 *   `source_sentence` text COLLATE utf8mb4_unicode_ci NOT NULL,
	 *   `target_sentence` text COLLATE utf8mb4_unicode_ci NOT NULL,
	 *   PRIMARY KEY (`id`),
	 *   KEY `user_book_id` (`user_book_id`),
	 *   KEY `block_id` (`block_id`)
	 * ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
	 *
	 * -- NEW: SQL for the new TM generation jobs table
     * CREATE TABLE `tm_generation_jobs` (
     *  `id` int(11) NOT NULL AUTO_INCREMENT,
     *  `user_book_id` int(11) NOT NULL,
     *  `status` enum('pending','running','complete','error') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
     *  `total_blocks` int(11) NOT NULL DEFAULT 0,
     *  `processed_blocks` int(11) NOT NULL DEFAULT 0,
     *  `error_message` text COLLATE utf8mb4_unicode_ci DEFAULT NULL,
     *  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
     *  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
     *  PRIMARY KEY (`id`),
     *  KEY `user_book_id` (`user_book_id`)
     * ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
     *
     * -- NEW: SQL for server-side codex generation
     * ALTER TABLE `user_books` ADD `codex_content` MEDIUMTEXT NULL AFTER `target_language`;
	 * ALTER TABLE `user_books` ADD `codex_status` ENUM('none','pending','generating','complete','error') NOT NULL DEFAULT 'none' AFTER `codex_content`;
	 * ALTER TABLE `user_books` ADD `codex_chunks_total` INT NOT NULL DEFAULT 0 AFTER `codex_status`;
	 * ALTER TABLE `user_books` ADD `codex_chunks_processed` INT NOT NULL DEFAULT 0 AFTER `codex_chunks_total`;
	 *
	 * CREATE TABLE `user_book_codex_chunks` (
	 *  `id` int(11) NOT NULL AUTO_INCREMENT,
	 *  `user_book_id` int(11) NOT NULL,
	 *  `chunk_index` int(11) NOT NULL,
	 *  `chunk_text` MEDIUMTEXT COLLATE utf8mb4_unicode_ci NOT NULL,
	 *  `is_processed` tinyint(1) NOT NULL DEFAULT 0,
	 *  PRIMARY KEY (`id`),
	 *  UNIQUE KEY `user_book_id_chunk_index` (`user_book_id`,`chunk_index`),
	 *  KEY `user_book_id` (`user_book_id`)
	 * ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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

	$tmModel = $_ENV['TM_MODEL'] ?? 'openai/gpt-4o-mini';
	$tmPairCount = (int)($_ENV['TM_PAIR_COUNT'] ?? 2);
	$codexModel = $_ENV['CODEX_MODEL'] ?? 'openai/gpt-4o-mini';

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
	 * @param mysqli $db The mysqli database connection object.
	 * @param int $userId The ID of the user making the request.
	 * @param string $action The action being performed.
	 * @param array|null $requestPayload The decoded JSON payload of the request.
	 * @param string $responseBody The raw string body of the response.
	 * @param int $responseCode The HTTP response code.
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
	 * @param int $statusCode The HTTP status code to send.
	 * @param string $message The error message.
	 * @return void
	 */
	function sendJsonError(int $statusCode, string $message): void
	{
		http_response_code($statusCode);
		echo json_encode(['error' => ['message' => $message]]);
		exit;
	}

	/**
	 * Returns a statically defined, grouped list of AI models for the UI.
	 * This list represents the desired order and grouping for the application.
	 *
	 * @return array A structured array of model groups.
	 */
	function getStaticGroupedModels(): array
	{
		// This structure is based on the user-provided image for the desired model list.
		return [
			[
				'group' => 'Popular',
				'models' => [
					['id' => 'openrouter/sonoma-dusk-alpha', 'name' => 'Sonoma Dusk Alpha'],
					['id' => 'openrouter/sonoma-sky-alpha', 'name' => 'Sonoma Sky Alpha'],
					['id' => 'openai/gpt-4o', 'name' => 'OpenAI GPT-4o'],
					['id' => 'anthropic/claude-3.7-sonnet', 'name' => 'Claude 3.7 Sonnet'],
					['id' => 'anthropic/claude-3.7-sonnet:thinking', 'name' => 'Claude 3.7 Sonnet (Thinking)'],
					['id' => 'google/gemini-2.5-pro', 'name' => 'Google: Gemini 2.5 Pro'],
					['id' => 'deepseek/deepseek-chat-v3.1', 'name' => 'DeepSeek Chat V3.1'],
				],
			],
			[
				'group' => 'New',
				'models' => [
					['id' => 'anthropic/claude-sonnet-4', 'name' => 'Claude Sonnet 4'],
					['id' => 'openai/gpt-5', 'name' => 'OpenAI GPT-5'],
					['id' => 'openai/gpt-oss-120b', 'name' => 'OpenAI: gpt-oss-120b'],
					['id' => 'openai/gpt-5-chat', 'name' => 'OpenAI GPT-5 Chat'],
					['id' => 'openai/gpt-5-mini', 'name' => 'OpenAI GPT-5 mini'],
					['id' => 'moonshotai/kimi-k2-0905', 'name' => 'MoonshotAI: Kimi K2 0905'],
					['id' => 'z-ai/glm-4.5', 'name' => 'Z.AI: GLM 4.5'],
				],
			],
			[
				'group' => 'Other',
				'models' => [
					['id' => 'google/gemini-2.5-flash', 'name' => 'Gemini 2.5 Flash'],
					['id' => 'openai/gpt-4.1', 'name' => 'OpenAI GPT-4.1'],
					['id' => 'openai/gpt-4o-mini', 'name' => 'OpenAI GPT-4o mini'],
				],
			],
			[
				'group' => 'NSFW',
				'models' => [
					['id' => 'qwen/qwen3-235b-a22b-2507', 'name' => 'Qwen 3 235b'],
					['id' => 'google/gemma-3-27b-it', 'name' => 'Gemma 3 27b'],
					['id' => 'mistralai/mistral-medium-3.1', 'name' => 'Mistral Medium 3.1'],
					['id' => 'mistralai/mistral-large-2411', 'name' => 'Mistral Large'],
					['id' => 'microsoft/wizardlm-2-8x22b', 'name' => 'WizardLM 2 8x22b'],
					['id' => 'x-ai/grok-4', 'name' => 'Grok 4'],
				],
			],
		];
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
			'HTTP-Referer: https://paralleleaves.com', // Recommended by OpenRouter
			'X-Title: Parallel Leaves', // Recommended by OpenRouter
		]);

		$liveResponse = curl_exec($ch);
		$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
		curl_close($ch);

		if ($httpCode !== 200) {
			logInteraction($db, $userId, $action, null, (string)$liveResponse, $httpCode);
			sendJsonError($httpCode, 'Failed to fetch models from OpenRouter to verify availability.');
		}

		$liveModelsData = json_decode($liveResponse, true);
		if (json_last_error() !== JSON_ERROR_NONE) {
			logInteraction($db, $userId, $action, null, (string)$liveResponse, 500);
			sendJsonError(500, 'Failed to parse models data from OpenRouter.');
		}

		// Create a lookup map of available model IDs for efficient checking.
		$availableModelIds = array_flip(array_column($liveModelsData['data'] ?? [], 'id'));

		// Get our desired static, grouped list.
		$staticGroupedModels = getStaticGroupedModels();

		// Filter the static list against the live data.
		$verifiedGroupedModels = [];
		foreach ($staticGroupedModels as $group) {
			$verifiedModelsInGroup = [];
			foreach ($group['models'] as $model) {
				// Check if the model from our static list exists in the live data.
				if (isset($availableModelIds[$model['id']])) {
					$verifiedModelsInGroup[] = $model;
				}
			}

			// Only include the group in the final list if it contains at least one available model.
			if (!empty($verifiedModelsInGroup)) {
				$verifiedGroupedModels[] = [
					'group' => $group['group'],
					'models' => $verifiedModelsInGroup,
				];
			}
		}

		$responseBody = json_encode($verifiedGroupedModels);
		logInteraction($db, $userId, $action, null, $responseBody, 200);

		http_response_code(200);
		echo $responseBody;
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

		$chat_payload = $payload;
		unset($chat_payload['messages']);

		if (!empty($payload['novel_id'])) {
			$chat_payload['novel_id'] = $payload['novel_id'];
		}

		$tmContent = '';
		$hasTmPlaceholder = false;
		if (isset($payload['messages']) && is_array($payload['messages'])) {
			foreach ($payload['messages'] as $message) {
				if ($message['role'] === 'system' && isset($message['content']) && strpos($message['content'], '##TRANSLATION_MEMORY##') !== false) {
					$hasTmPlaceholder = true;
					break;
				}
			}
		}

		if ($hasTmPlaceholder) {
			$lastUserMessage = '';
			if (isset($payload['messages']) && is_array($payload['messages'])) {
				for ($i = count($payload['messages']) - 1; $i >= 0; $i--) {
					if ($payload['messages'][$i]['role'] === 'user') {
						$lastUserMessage = $payload['messages'][$i]['content'] ?? '';
						break;
					}
				}
			}

			$words = preg_split('/[\s,.;:!?()"-]+/', strtolower($lastUserMessage), -1, PREG_SPLIT_NO_EMPTY);
			$uniqueWords = array_unique($words);
			$uniqueWords = array_filter($uniqueWords, fn($word) => mb_strlen($word) > 2);

			if (!empty($uniqueWords)) {
				$allMemories = [];
				$maxPairs = 100;
				$currentNovelId = $payload['novel_id'] ?? null;

				// NEW: First pass - get memories from the current novel first.
				if ($currentNovelId) {
					$stmt = $db->prepare(
						"SELECT tm.id, tm.source_sentence, tm.target_sentence, b.source_language, b.target_language " .
						"FROM user_books_translation_memory tm " .
						"JOIN user_books b ON tm.user_book_id = b.id " .
						"WHERE b.user_id = ? AND b.book_id = ? AND tm.source_sentence REGEXP ?"
					);

					foreach ($uniqueWords as $word) {
						if (count($allMemories) >= $maxPairs) {
							break;
						}
						$regexpPattern = '[[:<:]]' . $db->real_escape_string($word) . '[[:>:]]';
						$stmt->bind_param("iis", $userId, $currentNovelId, $regexpPattern);
						$stmt->execute();
						$result = $stmt->get_result();
						$memoriesForWord = $result->fetch_all(MYSQLI_ASSOC);

						if (count($memoriesForWord) > 3) {
							continue;
						}

						foreach ($memoriesForWord as $memory) {
							if (count($allMemories) >= $maxPairs) {
								break 2;
							}
							$allMemories[$memory['id']] = $memory;
						}
					}
					$stmt->close();
				}

				// NEW: Second pass - fill remaining slots with memories from other novels.
				if (count($allMemories) < $maxPairs) {
					$sql = "SELECT tm.id, tm.source_sentence, tm.target_sentence, b.source_language, b.target_language " .
						"FROM user_books_translation_memory tm " .
						"JOIN user_books b ON tm.user_book_id = b.id " .
						"WHERE b.user_id = ? ";
					if ($currentNovelId) {
						$sql .= "AND b.book_id != ? ";
					}
					$sql .= "AND tm.source_sentence REGEXP ?";
					$stmt = $db->prepare($sql);

					foreach ($uniqueWords as $word) {
						if (count($allMemories) >= $maxPairs) {
							break;
						}
						$regexpPattern = '[[:<:]]' . $db->real_escape_string($word) . '[[:>:]]';
						if ($currentNovelId) {
							$stmt->bind_param("iis", $userId, $currentNovelId, $regexpPattern);
						} else {
							$stmt->bind_param("is", $userId, $regexpPattern);
						}
						$stmt->execute();
						$result = $stmt->get_result();
						$memoriesForWord = $result->fetch_all(MYSQLI_ASSOC);

						if (count($memoriesForWord) > 3) {
							continue;
						}

						foreach ($memoriesForWord as $memory) {
							if (count($allMemories) >= $maxPairs) {
								break 2;
							}
							if (!isset($allMemories[$memory['id']])) {
								$allMemories[$memory['id']] = $memory;
							}
						}
					}
					$stmt->close();
				}


				// Format the unique TM pairs for injection
				foreach ($allMemories as $mem) {
					$tmContent .= "<{$mem['source_language']}>{$mem['source_sentence']}</{$mem['source_language']}>\n";
					$tmContent .= "<{$mem['target_language']}>{$mem['target_sentence']}</{$mem['target_language']}>\n";
				}
				$tmContent = trim($tmContent);
			}
		}


		$codexContent = '';
		if (!empty($payload['novel_id'])) {
			$novelId = $payload['novel_id'];
			$stmt = $db->prepare("SELECT codex_content FROM user_books WHERE user_id = ? AND book_id = ?");
			$stmt->bind_param("ii", $userId, $novelId);
			$stmt->execute();
			$result = $stmt->get_result()->fetch_assoc();
			$stmt->close();
			if ($result && !empty($result['codex_content'])) {
				$codexContent = "Use the following glossary for consistent translation:\n<glossary>\n" . $result['codex_content'] . "\n</glossary>";
			}
		}


		// Inject TM and Codex content or remove the placeholders
		if (isset($payload['messages']) && is_array($payload['messages'])) {
			foreach ($payload['messages'] as &$message) {
				if ($message['role'] === 'system' && isset($message['content'])) {
					// Handle Translation Memory
					if (strpos($message['content'], '##TRANSLATION_MEMORY##') !== false) {
						if (!empty($tmContent)) {
							$message['content'] = str_replace('##TRANSLATION_MEMORY##', $tmContent, $message['content']);
						} else {
							// Clean up the entire block if no TM is available
							$message['content'] = preg_replace("/Use the following translation examples to guide the translation:\n##TRANSLATION_MEMORY##\n*/", '', $message['content']);
						}
					}
					// Handle Codex
					if (strpos($message['content'], '##CODEX_BLOCK##') !== false) {
						if (!empty($codexContent)) {
							$message['content'] = str_replace('##CODEX_BLOCK##', $codexContent, $message['content']);
						} else {
							// Just remove the placeholder if no codex is available
							$message['content'] = str_replace("##CODEX_BLOCK##\n", '', $message['content']);
						}
					}
					// General cleanup of excessive newlines
					$message['content'] = trim(preg_replace('/\n{3,}/', "\n\n", $message['content']));
				}
			}
			unset($message);
		}


		$promptLength = 0;
		if (isset($payload['messages']) && is_array($payload['messages'])) {
			foreach ($payload['messages'] as $message) {
				if (isset($message['content'])) {
					$promptLength += strlen($message['content']);
				}
			}
		}

		if ($promptLength > 100000) {
			$errorResponse = ['error' => ['message' => 'The total length of the prompt is more than 100000 characters.']];
			$errorResponseJson = json_encode($errorResponse);
			logInteraction($db, $userId, $action, array('chat_payload' => $chat_payload, "payload" => $payload), $errorResponseJson, 413); // 413 Payload Too Large
			http_response_code(413);
			echo $errorResponseJson;
			exit;
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
			'HTTP-Referer: https://paralleleaves.com', // Recommended by OpenRouter
			'X-Title: Parallel Leaves', // Recommended by OpenRouter
			'Content-Type: application/json'
		]);

		$response = curl_exec($ch);
		$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
		curl_close($ch);

		logInteraction($db, $userId, $action, array('chat_payload' => $chat_payload, "payload" => $payload), (string)$response, $httpCode);

		http_response_code($httpCode);
		echo $response;
		exit;
	} elseif ($action === 'generate_cover') {
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
	} elseif ($action === 'log_translation') {
		if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
			sendJsonError(405, 'Method Not Allowed. Please use POST for logging translations.');
		}

		// Extract data from the payload
		$novelId = $payload['novel_id'] ?? null;
		$chapterId = $payload['chapter_id'] ?? null;
		$sourceText = $payload['source_text'] ?? null;
		$targetText = $payload['target_text'] ?? null;
		$marker = $payload['marker'] ?? null;
		$model = $payload['model'] ?? null;
		$temperature = $payload['temperature'] ?? null;

		// Basic validation
		if (!$novelId || !$chapterId || !$sourceText || !$targetText || !$model || !isset($temperature)) {
			sendJsonError(400, 'Missing required fields for translation logging.');
		}

		try {
			$stmt = $db->prepare(
				'INSERT INTO translation_logs (user_id, novel_id, chapter_id, source_text, target_text, marker, model, temperature) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
			);
			// Note: bind_param types must match the columns: i, i, i, s, s, s, s, d
			$stmt->bind_param('iiissssd', $userId, $novelId, $chapterId, $sourceText, $targetText, $marker, $model, $temperature);
			$stmt->execute();
			$stmt->close();

			http_response_code(201); // 201 Created
			echo json_encode(['success' => true, 'message' => 'Translation logged successfully.']);
		} catch (Exception $e) {
			// Log the actual DB error server-side for debugging, but don't expose it to the client.
			error_log('Failed to write to translation_logs: ' . $e->getMessage());
			sendJsonError(500, 'Failed to log translation to the database.');
		}
		exit;
	} else {
		if (str_starts_with($action, 'tm_')) {
			include_once 'tm_handler.php';
			$tmConfig = ['model' => $tmModel, 'pair_count' => $tmPairCount];
			handleTranslationMemoryAction($db, $action, $userId, $payload, $apiKey, $tmConfig);
			exit;
		} elseif (str_starts_with($action, 'codex_')) {
			include_once 'codex_handler.php';
			$codexConfig = ['model' => $codexModel];
			handleCodexAction($db, $action, $userId, $payload, $apiKey, $codexConfig);
			exit;
		}
		sendJsonError(400, 'Invalid action specified. Supported actions are "chat", "get_models", "generate_cover", "log_translation".');
	}
