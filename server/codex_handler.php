<?php

	/**
	 * Codex Handler for the AI Proxy.
	 *
	 * This script manages server-side operations for the novel codex,
	 * including initializing jobs, processing text chunks to generate entries via an LLM,
	 * and tracking progress. It is included and called by ai-proxy.php.
	 *
	 * @version 1.2.0
	 * @author Ekim Emre Yardimli
	 */

	declare(strict_types=1);

	/**
	 * Main entry point for handling all codex-related actions.
	 *
	 * @param mysqli $db The database connection object.
	 * @param string $action The specific action to perform (e.g., 'codex_get_status').
	 * @param int $userId The authenticated user's ID.
	 * @param array $payload The request payload from the client.
	 * @param string $apiKey The OpenRouter API key.
	 * @param array $codexConfig Configuration for codex generation (e.g., model).
	 * @return void
	 */
	function handleCodexAction(mysqli $db, string $action, int $userId, array $payload, string $apiKey, array $codexConfig): void
	{
		switch ($action) {
			case 'codex_get_status':
				getCodexStatus($db, $userId, $payload);
				break;
			case 'codex_start_job':
				startCodexJob($db, $userId, $payload);
				break;
			case 'codex_process_chunk':
				processCodexChunk($db, $userId, $payload, $apiKey, $codexConfig);
				break;
			case 'codex_mark_complete':
				markCodexComplete($db, $userId, $payload);
				break;
			default:
				sendJsonError(400, 'Invalid codex action specified.');
		}
	}

	/**
	 * A helper function to get the internal user_book_id.
	 *
	 * @param mysqli $db The database connection object.
	 * @param int $userId The ID of the current user.
	 * @param int $novelId The public-facing novel_id from the Electron app.
	 * @return int|null The internal ID or null if not found.
	 */
	function getUserBookId(mysqli $db, int $userId, int $novelId): ?int
	{
		$stmt = $db->prepare('SELECT id FROM user_books WHERE user_id = ? AND book_id = ?');
		$stmt->bind_param('ii', $userId, $novelId);
		$stmt->execute();
		$result = $stmt->get_result()->fetch_assoc();
		$stmt->close();
		return $result ? (int)$result['id'] : null;
	}

	/**
	 * Retrieves the current status of codex generation for a novel.
	 *
	 * @param mysqli $db
	 * @param int $userId
	 * @param array $payload
	 * @return void
	 */
	function getCodexStatus(mysqli $db, int $userId, array $payload): void
	{
		$novelId = $payload['novel_id'] ?? null;
		if (!$novelId) {
			sendJsonError(400, 'Missing novel_id for status check.');
		}

		$userBookId = getUserBookId($db, $userId, (int)$novelId);
		if (!$userBookId) {
			echo json_encode(['status' => 'none', 'processed' => 0, 'total' => 0]);
			return;
		}

		$stmt = $db->prepare('SELECT codex_status, codex_chunks_processed, codex_chunks_total FROM user_books WHERE id = ?');
		$stmt->bind_param('i', $userBookId);
		$stmt->execute();
		$result = $stmt->get_result()->fetch_assoc();
		$stmt->close();

		echo json_encode([
			'status' => $result['codex_status'] ?? 'none',
			'processed' => (int)($result['codex_chunks_processed'] ?? 0),
			'total' => (int)($result['codex_chunks_total'] ?? 0),
		]);
	}

	/**
	 * Initializes or resets a codex generation job for a novel.
	 * It now creates the book entry on the server if it doesn't exist.
	 *
	 * @param mysqli $db
	 * @param int $userId
	 * @param array $payload
	 * @return void
	 */
	function startCodexJob(mysqli $db, int $userId, array $payload): void
	{
		$novelId = $payload['novel_id'] ?? null;
		$totalChunks = $payload['total_chunks'] ?? 0;
		$sourceLang = $payload['source_language'] ?? null;
		$targetLang = $payload['target_language'] ?? null;
		$title = $payload['title'] ?? 'Untitled';
		$author = $payload['author'] ?? null;

		if (!$novelId || !$sourceLang || !$targetLang) {
			sendJsonError(400, 'Missing novel_id, source_language, or target_language to start a job.');
		}

		$stmt = $db->prepare(
			'INSERT INTO user_books (book_id, user_id, title, author, source_language, target_language) VALUES (?, ?, ?, ?, ?, ?)
			 ON DUPLICATE KEY UPDATE title = VALUES(title), author = VALUES(author), source_language = VALUES(source_language), target_language = VALUES(target_language)'
		);
		$stmt->bind_param('iissss', $novelId, $userId, $title, $author, $sourceLang, $targetLang);
		$stmt->execute();
		$stmt->close();

		$userBookId = getUserBookId($db, $userId, (int)$novelId);
		if (!$userBookId) {
			sendJsonError(500, 'Failed to find or create book entry in the database.');
		}

		$stmt = $db->prepare(
			'UPDATE user_books SET codex_content = NULL, codex_status = "generating", codex_chunks_total = ?, codex_chunks_processed = 0 WHERE id = ?'
		);
		$stmt->bind_param('ii', $totalChunks, $userBookId);
		$stmt->execute();
		$stmt->close();

		echo json_encode(['success' => true, 'message' => 'Codex job started.']);
	}


	/**
	 * Processes a single text chunk to generate and merge codex entries.
	 *
	 * @param mysqli $db
	 * @param int $userId
	 * @param array $payload
	 * @param string $apiKey
	 * @param array $codexConfig
	 * @return void
	 */
	function processCodexChunk(mysqli $db, int $userId, array $payload, string $apiKey, array $codexConfig): void
	{
		$novelId = $payload['novel_id'] ?? null;
		$chunkText = $payload['chunk_text'] ?? null;

		if (!$novelId || !$chunkText) {
			sendJsonError(400, 'Missing novel_id or chunk_text for processing.');
		}

		$userBookId = getUserBookId($db, $userId, (int)$novelId);
		if (!$userBookId) {
			sendJsonError(404, 'Book not found for this user.');
		}

		$stmt = $db->prepare('SELECT source_language, target_language, codex_content FROM user_books WHERE id = ?');
		$stmt->bind_param('i', $userBookId);
		$stmt->execute();
		$book = $stmt->get_result()->fetch_assoc();
		$stmt->close();

		$systemPrompt = "You are a meticulous world-building assistant for a novelist. Your task is to analyze a chunk of text from a novel and update a codex (an encyclopedia of the world).\n\n**Instructions:**\n1. Read the provided **Text Chunk** (written in {$book['source_language']}).\n2. Review the **Existing Codex Content** to understand what is already documented.\n3. Identify new characters, locations, or significant objects/lore within the text chunk.\n4. Identify if the text chunk provides new information or details about entities that *already exist* in the codex.\n5. For each new or updated entity, write a brief, encyclopedia-style entry.\n6. **IMPORTANT:** All your output must be written in **{$book['target_language']}**.\n7. Format your entire output as plain text. For each entry, put the title on its own line, followed by the description on the next line. Separate entries with two blank lines. Example:\n\nENTITY TITLE\nA paragraph describing the entity.\n\nANOTHER ENTITY\nAnother paragraph for this other entity.\n8. If you are updating an existing entry, your new entry should be a complete replacement, incorporating both old and new information.\n9. Return **only the text for the new or updated entries**. Do not repeat entries from the existing codex that were not changed by the new text chunk.\n10. If you find no new or updated entities worth adding, return an empty string.";
		$userPrompt = "**Existing Codex Content (for context):**\n<codex>\n" . mb_substr($book['codex_content'] ?? '', 0, 8000) . "\n</codex>\n\n**Text Chunk to Analyze (in {$book['source_language']}):**\n<text>\n{$chunkText}\n</text>";

		$messages = [['role' => 'system', 'content' => $systemPrompt], ['role' => 'user', 'content' => $userPrompt]];
		$aiResponse = callOpenRouterForCodex($codexConfig['model'], 0.5, $messages, $apiKey);

		if (!$aiResponse || !isset($aiResponse['choices'][0]['message']['content'])) {
			$stmt = $db->prepare('UPDATE user_books SET codex_chunks_processed = codex_chunks_processed + 1, codex_status = "error" WHERE id = ?');
			$stmt->bind_param('i', $userBookId);
			$stmt->execute();
			$stmt->close();
			sendJsonError(502, 'AI service failed to generate a valid response for the codex chunk.');
		}

		$newlyGeneratedText = $aiResponse['choices'][0]['message']['content'];
		$currentCodexText = $book['codex_content'] ?? '';

		if (!empty(trim($newlyGeneratedText))) {
			// Parse existing and new entries into associative arrays
			$codexMap = parseEntriesFromText($currentCodexText);
			$newEntriesMap = parseEntriesFromText($newlyGeneratedText);

			// Merge new entries into the existing map. array_merge overwrites existing keys, which is perfect for updates.
			$mergedMap = array_merge($codexMap, $newEntriesMap);

			// Rebuild the final codex text from the merged map
			$currentCodexText = buildTextFromEntries($mergedMap);
		}

		$stmt = $db->prepare('UPDATE user_books SET codex_content = ?, codex_chunks_processed = codex_chunks_processed + 1 WHERE id = ?');
		$stmt->bind_param('si', $currentCodexText, $userBookId);
		$stmt->execute();
		$stmt->close();

		echo json_encode(['success' => true, 'message' => 'Codex chunk processed.']);
	}

	/**
	 * Finalizes the codex generation process by marking it as complete.
	 *
	 * @param mysqli $db
	 * @param int $userId
	 * @param array $payload
	 * @return void
	 */
	function markCodexComplete(mysqli $db, int $userId, array $payload): void
	{
		$novelId = $payload['novel_id'] ?? null;
		if (!$novelId) {
			sendJsonError(400, 'Missing novel_id to complete job.');
		}

		$userBookId = getUserBookId($db, $userId, (int)$novelId);
		if (!$userBookId) {
			sendJsonError(404, 'Book not found for this user.');
		}

		$stmt = $db->prepare('UPDATE user_books SET codex_status = "complete" WHERE id = ?');
		$stmt->bind_param('i', $userBookId);
		$stmt->execute();
		$stmt->close();

		echo json_encode(['success' => true, 'message' => 'Codex generation marked as complete.']);
	}

	/**
	 * Helper to call OpenRouter API specifically for codex generation.
	 *
	 * @param string $model
	 * @param float $temperature
	 * @param array $messages
	 * @param string $apiKey
	 * @return array|null
	 */
	function callOpenRouterForCodex(string $model, float $temperature, array $messages, string $apiKey): ?array
	{
		$payload = ['model' => $model, 'messages' => $messages, 'temperature' => $temperature];

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
			error_log("OpenRouter API Error for Codex (HTTP $httpCode): $response");
			return null;
		}

		return json_decode($response, true);
	}

	/**
	 * Helper to parse plain text from AI into an associative array of entries.
	 *
	 * @param string $text The plain text containing codex entries.
	 * @return array An associative array with title => description.
	 */
	function parseEntriesFromText(string $text): array
	{
		$entries = [];
		// Normalize line endings and split by two or more newlines
		$blocks = preg_split('/(\r\n|\n|\r){2,}/', trim($text));

		foreach ($blocks as $block) {
			if (empty(trim($block))) {
				continue;
			}
			// Find the position of the first newline
			$firstNewlinePos = strpos($block, "\n");
			if ($firstNewlinePos === false) {
				// If no newline, the whole block is the title
				$title = trim($block);
				$description = '';
			} else {
				// Title is the first line, description is the rest
				$title = trim(substr($block, 0, $firstNewlinePos));
				$description = trim(substr($block, $firstNewlinePos + 1));
			}

			if (!empty($title)) {
				$entries[$title] = $description;
			}
		}
		return $entries;
	}

	/**
	 * Helper to build a plain text string from an associative array of entries.
	 *
	 * @param array $entries An associative array with title => description.
	 * @return string The formatted plain text string.
	 */
	function buildTextFromEntries(array $entries): string
	{
		$text = '';
		foreach ($entries as $title => $description) {
			$text .= $title . "\n" . $description . "\n\n";
		}
		return trim($text);
	}
