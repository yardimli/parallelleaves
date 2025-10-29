<?php

	/**
	 * Translation Memory (TM) Handler for the AI Proxy.
	 *
	 * This script manages all server-side operations for translation memories,
	 * including syncing book content, generating new memory pairs via an LLM,
	 * and retrieving stored memories. It is included and called by ai-proxy.php.
	 *
	 * @version 1.0.0
	 * @author Ekim Emre Yardimli
	 */

	declare(strict_types=1);

	/**
	 * Main entry point for handling all translation memory related actions.
	 *
	 * @param mysqli $db The database connection object.
	 * @param string $action The specific action to perform (e.g., 'tm_sync_blocks').
	 * @param int $userId The authenticated user's ID.
	 * @param array $payload The request payload from the client.
	 * @param string $apiKey The OpenRouter API key.
	 * @param array $tmConfig Configuration for TM generation (model, pair_count).
	 * @return void
	 */
	function handleTranslationMemoryAction(mysqli $db, string $action, int $userId, array $payload, string $apiKey, array $tmConfig): void
	{
		switch ($action) {
			case 'tm_sync_blocks':
				syncBookBlocks($db, $userId, $payload);
				break;
			// MODIFICATION: Renamed to reflect background processing nature
			case 'tm_run_full_generation':
				runFullMemoryGeneration($db, $userId, $payload, $apiKey, $tmConfig);
				break;
			// END MODIFICATION
			case 'tm_get_memory':
				getTranslationMemory($db, $userId, $payload);
				break;
			case 'tm_get_entry_count':
				getTranslationMemoryEntryCount($db, $userId, $payload);
				break;
			case 'tm_get_memory_for_novels':
				getMemoryForNovels($db, $userId, $payload);
				break;
			case 'tm_get_all_with_memory':
				getAllNovelsWithMemory($db, $userId);
				break;
			default:
				sendJsonError(400, 'Invalid translation memory action specified.');
		}
	}

	/**
	 * Calls the OpenRouter API for translation memory generation.
	 *
	 * @param string $model The LLM model to use.
	 * @param float $temperature The temperature for the generation.
	 * @param array $messages The array of messages for the prompt.
	 * @param string $apiKey The OpenRouter API key.
	 * @return array|null The decoded JSON response from the API or null on failure.
	 */
	function callOpenRouterForTm(string $model, float $temperature, array $messages, string $apiKey): ?array
	{
		$payload = [
			'model' => $model,
			'messages' => $messages,
			'temperature' => $temperature,
			'response_format' => ['type' => 'json_object'],
		];

		$ch = curl_init('https://openrouter.ai/api/v1/chat/completions');
		curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
		curl_setopt($ch, CURLOPT_POST, true);
		curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
		curl_setopt($ch, CURLOPT_HTTPHEADER, [
			'Authorization: Bearer ' . $apiKey,
			'HTTP-Referer: https://paralleleaves.com',
			'X-Title: Parallel Leaves',
			'Content-Type: application/json'
		]);

		$response = curl_exec($ch);
		$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
		curl_close($ch);

		if ($httpCode !== 200) {
			error_log("OpenRouter API Error (HTTP $httpCode): $response");
			return null;
		}

		$data = json_decode($response, true);
		if (json_last_error() !== JSON_ERROR_NONE) {
			error_log("Failed to decode OpenRouter JSON response: " . json_last_error_msg());
			return null;
		}

		return $data;
	}

	/**
	 * Synchronizes translation blocks from the client with the server database.
	 *
	 * @param mysqli $db The database connection.
	 * @param int $userId The user's ID.
	 * @param array $payload The request payload containing novel info and pairs.
	 * @return void
	 */
	function syncBookBlocks(mysqli $db, int $userId, array $payload): void
	{
		$novelId = $payload['novel_id'] ?? null;
		$sourceLang = $payload['source_language'] ?? null;
		$targetLang = $payload['target_language'] ?? null;
		$pairs = $payload['pairs'] ?? [];

		if (!$novelId || !$sourceLang || !$targetLang || !is_array($pairs)) {
			sendJsonError(400, 'Missing required fields for syncing book blocks.');
		}

		$db->begin_transaction();
		try {
			// Find or create the user_book entry
			$stmt = $db->prepare('INSERT INTO user_books (book_id, user_id, source_language, target_language) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE source_language = VALUES(source_language), target_language = VALUES(target_language)');
			$stmt->bind_param('iiss', $novelId, $userId, $sourceLang, $targetLang);
			$stmt->execute();
			$stmt->close();

			// Get the user_book_id
			$stmt = $db->prepare('SELECT id FROM user_books WHERE book_id = ? AND user_id = ?');
			$stmt->bind_param('ii', $novelId, $userId);
			$stmt->execute();
			$result = $stmt->get_result();
			$userBook = $result->fetch_assoc();
			$stmt->close();
			$userBookId = $userBook['id'];

			$receivedMarkerIds = [];
			$upsertStmt = $db->prepare('INSERT INTO user_book_blocks (user_book_id, marker_id, source_text, target_text) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE source_text = VALUES(source_text), target_text = VALUES(target_text)');

			foreach ($pairs as $pair) {
				$markerId = $pair['marker'];
				$sourceText = $pair['source'];
				$targetText = $pair['target'];
				$receivedMarkerIds[] = $markerId;
				$upsertStmt->bind_param('iiss', $userBookId, $markerId, $sourceText, $targetText);
				$upsertStmt->execute();
			}
			$upsertStmt->close();

			// Delete blocks that are no longer present in the client
			if (!empty($receivedMarkerIds)) {
				$placeholders = implode(',', array_fill(0, count($receivedMarkerIds), '?'));
				$types = 'i' . str_repeat('i', count($receivedMarkerIds));
				$params = array_merge([$userBookId], $receivedMarkerIds);

				$deleteStmt = $db->prepare("DELETE FROM user_book_blocks WHERE user_book_id = ? AND marker_id NOT IN ($placeholders)");
				$deleteStmt->bind_param($types, ...$params);
				$deleteStmt->execute();
				$deleteStmt->close();
			} else {
				// If no pairs were received, delete all blocks for this book
				$deleteStmt = $db->prepare("DELETE FROM user_book_blocks WHERE user_book_id = ?");
				$deleteStmt->bind_param('i', $userBookId);
				$deleteStmt->execute();
				$deleteStmt->close();
			}

			$db->commit();
			echo json_encode(['success' => true, 'message' => 'Book blocks synchronized successfully.']);
		} catch (Exception $e) {
			$db->rollback();
			error_log("Sync Error: " . $e->getMessage());
			sendJsonError(500, 'Failed to synchronize book blocks.');
		}
	}

	/**
	 * NEW: Runs the memory generation process for all un-analyzed blocks in a novel.
	 *
	 * @param mysqli $db The database connection.
	 * @param int $userId The user's ID.
	 * @param array $payload The request payload.
	 * @param string $apiKey The OpenRouter API key.
	 * @param array $tmConfig Configuration for TM generation (model, pair_count).
	 * @return void
	 */
	function runFullMemoryGeneration(mysqli $db, int $userId, array $payload, string $apiKey, array $tmConfig): void
	{
		$novelId = $payload['novel_id'] ?? null;
		if (!$novelId) {
			sendJsonError(400, 'Missing novel_id for generation.');
		}

		// Get model and pair count from server config
		$model = $tmConfig['model'];
		$pairCount = $tmConfig['pair_count'];
		$temperature = 0.7; // Can be made configurable if needed

		// Get user_book_id and languages
		$stmt = $db->prepare('SELECT id, source_language, target_language FROM user_books WHERE book_id = ? AND user_id = ?');
		$stmt->bind_param('ii', $novelId, $userId);
		$stmt->execute();
		$result = $stmt->get_result();
		$userBook = $result->fetch_assoc();
		$stmt->close();

		if (!$userBook) {
			sendJsonError(404, 'Book not found or not synced for this user.');
		}
		$userBookId = $userBook['id'];
		$sourceLanguage = $userBook['source_language'];
		$targetLanguage = $userBook['target_language'];

		// Find all un-analyzed blocks
		$stmt = $db->prepare('SELECT id, source_text, target_text FROM user_book_blocks WHERE user_book_id = ? AND is_analyzed = 0 ORDER BY marker_id ASC');
		$stmt->bind_param('i', $userBookId);
		$stmt->execute();
		$result = $stmt->get_result();
		$blocks = $result->fetch_all(MYSQLI_ASSOC);
		$stmt->close();

		if (empty($blocks)) {
			echo json_encode(['status' => 'finished', 'processed_count' => 0, 'message' => 'No new blocks to analyze.']);
			return;
		}

		$processedCount = 0;
		foreach ($blocks as $block) {
			// Hard-coded prompts with JSON output requirement
			$systemPrompt = "You are a literary translation analyst. Your task is to analyze a pair of texts—an original and its translation—and generate concise, actionable translation examples for an AI translator to imitate the style of the human translator. The examples should focus on stylistic choices, idioms, or complex phrases. Return your response as a single JSON object with one key: 'pairs'. The value of 'pairs' must be an array of objects, where each object has two keys: 'source' and 'target'.";
			$userPrompt = "Analyze the following pair and generate exactly {$pairCount} translation pair(s) that best reflect the translator's style.\n\nSource ({$sourceLanguage}):\n{$block['source_text']}\n\nTranslation ({$targetLanguage}):\n{$block['target_text']}";

			$messages = [
				['role' => 'system', 'content' => $systemPrompt],
				['role' => 'user', 'content' => $userPrompt]
			];

			$aiResponse = callOpenRouterForTm($model, (float)$temperature, $messages, $apiKey);

			if (!$aiResponse || !isset($aiResponse['choices'][0]['message']['content'])) {
				// Skip this block on AI error and continue with the next
				error_log("AI Error for block ID {$block['id']}: Invalid response.");
				continue;
			}

			$contentJson = json_decode($aiResponse['choices'][0]['message']['content'], true);

			if (json_last_error() !== JSON_ERROR_NONE || !isset($contentJson['pairs']) || !is_array($contentJson['pairs'])) {
				error_log("JSON Error for block ID {$block['id']}: " . $aiResponse['choices'][0]['message']['content']);
				continue;
			}

			$db->begin_transaction();
			try {
				$insertStmt = $db->prepare('INSERT INTO user_books_translation_memory (user_book_id, block_id, source_sentence, target_sentence) VALUES (?, ?, ?, ?)');
				foreach ($contentJson['pairs'] as $pair) {
					if (isset($pair['source']) && isset($pair['target'])) {
						$insertStmt->bind_param('iiss', $userBookId, $block['id'], $pair['source'], $pair['target']);
						$insertStmt->execute();
					}
				}
				$insertStmt->close();

				$updateStmt = $db->prepare('UPDATE user_book_blocks SET is_analyzed = 1 WHERE id = ?');
				$updateStmt->bind_param('i', $block['id']);
				$updateStmt->execute();
				$updateStmt->close();

				$db->commit();
				$processedCount++;
			} catch (Exception $e) {
				$db->rollback();
				error_log("DB Error for block ID {$block['id']}: " . $e->getMessage());
				// Stop the entire process on DB error
				sendJsonError(500, 'Failed to save generated translation memory for block ' . $block['id']);
			}
		}

		echo json_encode(['status' => 'finished', 'processed_count' => $processedCount]);
	}


	/**
	 * Retrieves the formatted translation memory for a single novel.
	 *
	 * @param mysqli $db The database connection.
	 * @param int $userId The user's ID.
	 * @param array $payload The request payload containing the novel_id.
	 * @return void
	 */
	function getTranslationMemory(mysqli $db, int $userId, array $payload): void
	{
		$novelId = $payload['novel_id'] ?? null;
		if (!$novelId) {
			sendJsonError(400, 'Missing novel_id.');
		}

		$stmt = $db->prepare('SELECT b.id, b.source_language, b.target_language FROM user_books b WHERE b.book_id = ? AND b.user_id = ?');
		$stmt->bind_param('ii', $novelId, $userId);
		$stmt->execute();
		$result = $stmt->get_result();
		$userBook = $result->fetch_assoc();
		$stmt->close();

		if (!$userBook) {
			echo json_encode(['content' => '']);
			return;
		}

		$userBookId = $userBook['id'];
		$sourceLang = $userBook['source_language'];
		$targetLang = $userBook['target_language'];

		$stmt = $db->prepare('SELECT tm.source_sentence, tm.target_sentence, bb.marker_id FROM user_books_translation_memory tm JOIN user_book_blocks bb ON tm.block_id = bb.id WHERE tm.user_book_id = ? ORDER BY bb.marker_id ASC, tm.id ASC');
		$stmt->bind_param('i', $userBookId);
		$stmt->execute();
		$result = $stmt->get_result();
		$memories = $result->fetch_all(MYSQLI_ASSOC);
		$stmt->close();

		$content = '';
		$lastMarkerId = null;
		foreach ($memories as $mem) {
			if ($mem['marker_id'] !== $lastMarkerId) {
				$content .= "\n\n#{$novelId}-{$mem['marker_id']}\n";
				$lastMarkerId = $mem['marker_id'];
			}
			$content .= "<{$sourceLang}>{$mem['source_sentence']}</{$sourceLang}>\n";
			$content .= "<{$targetLang}>{$mem['target_sentence']}</{$targetLang}>\n";
		}

		echo json_encode(['content' => trim($content)]);
	}

	/**
	 * Gets the total count of translation memory entries for a novel.
	 *
	 * @param mysqli $db The database connection.
	 * @param int $userId The user's ID.
	 * @param array $payload The request payload containing the novel_id.
	 * @return void
	 */
	function getTranslationMemoryEntryCount(mysqli $db, int $userId, array $payload): void
	{
		$novelId = $payload['novel_id'] ?? null;
		if (!$novelId) {
			sendJsonError(400, 'Missing novel_id.');
		}

		$stmt = $db->prepare('SELECT id FROM user_books WHERE book_id = ? AND user_id = ?');
		$stmt->bind_param('ii', $novelId, $userId);
		$stmt->execute();
		$result = $stmt->get_result();
		$userBook = $result->fetch_assoc();
		$stmt->close();

		if (!$userBook) {
			echo json_encode(['count' => 0]);
			return;
		}

		$stmt = $db->prepare('SELECT COUNT(*) as count FROM user_books_translation_memory WHERE user_book_id = ?');
		$stmt->bind_param('i', $userBook['id']);
		$stmt->execute();
		$result = $stmt->get_result();
		$count = $result->fetch_assoc()['count'];
		$stmt->close();

		echo json_encode(['count' => (int)$count]);
	}

	/**
	 * Retrieves and combines translation memories for multiple novels.
	 *
	 * @param mysqli $db The database connection.
	 * @param int $userId The user's ID.
	 * @param array $payload The request payload containing an array of novel_ids.
	 * @return void
	 */
	function getMemoryForNovels(mysqli $db, int $userId, array $payload): void
	{
		$novelIds = $payload['novel_ids'] ?? [];
		if (empty($novelIds) || !is_array($novelIds)) {
			echo json_encode(['content' => '']);
			return;
		}

		$placeholders = implode(',', array_fill(0, count($novelIds), '?'));
		$types = str_repeat('i', count($novelIds));

		$stmt = $db->prepare("SELECT tm.source_sentence, tm.target_sentence, b.source_language, b.target_language FROM user_books_translation_memory tm JOIN user_books b ON tm.user_book_id = b.id WHERE b.user_id = ? AND b.book_id IN ($placeholders)");
		$stmt->bind_param("i" . $types, $userId, ...$novelIds);
		$stmt->execute();
		$result = $stmt->get_result();
		$memories = $result->fetch_all(MYSQLI_ASSOC);
		$stmt->close();

		$content = '';
		foreach ($memories as $mem) {
			$content .= "<{$mem['source_language']}>{$mem['source_sentence']}</{$mem['source_language']}>\n";
			$content .= "<{$mem['target_language']}>{$mem['target_sentence']}</{$targetLang}>\n";
		}

		echo json_encode(['content' => trim($content)]);
	}

	/**
	 * Gets a list of all novel IDs for a user that have at least one translation memory entry.
	 *
	 * @param mysqli $db The database connection.
	 * @param int $userId The user's ID.
	 * @return void
	 */
	function getAllNovelsWithMemory(mysqli $db, int $userId): void
	{
		$stmt = $db->prepare('SELECT DISTINCT b.book_id FROM user_books_translation_memory tm JOIN user_books b ON tm.user_book_id = b.id WHERE b.user_id = ?');
		$stmt->bind_param('i', $userId);
		$stmt->execute();
		$result = $stmt->get_result();
		$rows = $result->fetch_all(MYSQLI_ASSOC);
		$stmt->close();

		$novelIds = array_map(fn($row) => (int)$row['book_id'], $rows);

		echo json_encode(['novel_ids' => $novelIds]);
	}
