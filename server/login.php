<?php

	declare(strict_types=1);

// Load environment variables
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

	header('Content-Type: application/json');

	$dbHost = $_ENV['DB_HOST'] ?? 'localhost';
	$dbName = $_ENV['DB_NAME'] ?? '';
	$dbUser = $_ENV['DB_USER'] ?? '';
	$dbPass = $_ENV['DB_PASS'] ?? '';

	function sendJsonError(int $statusCode, string $messageKey): void
	{
		http_response_code($statusCode);
		echo json_encode(['success' => false, 'message' => $messageKey]);
		exit;
	}

	if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
		sendJsonError(405, 'error.methodNotAllowed');
	}

	$input = json_decode(file_get_contents('php://input'), true);
	$username = $input['username'] ?? '';
	$password = $input['password'] ?? '';

	if (empty($username) || empty($password)) {
		sendJsonError(400, 'error.credentialsRequired');
	}

// MODIFIED SECTION START: Switched from PDO to MySQLi
	mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
	try {
		$db = new mysqli($dbHost, $dbUser, $dbPass, $dbName);
		$db->set_charset('utf8mb4');

		$stmt = $db->prepare('SELECT id, username, password_hash FROM users WHERE username = ?');
		$stmt->bind_param('s', $username);
		$stmt->execute();
		$result = $stmt->get_result();
		$user = $result->fetch_assoc();
		$stmt->close();

		if (!$user || !password_verify($password, $user['password_hash'])) {
			sendJsonError(401, 'error.invalidCredentials');
		}

		// Generate a secure token
		$token = bin2hex(random_bytes(32));
		// MODIFIED: Changed token expiration from 30 days to 6 months.
		$expiresAt = (new DateTime())->modify('+6 months')->format('Y-m-d H:i:s');

		$stmt = $db->prepare('UPDATE users SET session_token = ?, token_expires_at = ? WHERE id = ?');
		$stmt->bind_param('ssi', $token, $expiresAt, $user['id']);
		$stmt->execute();
		$stmt->close();

		http_response_code(200);
		echo json_encode([
			'success' => true,
			'token' => $token,
			'user' => [
				'id' => $user['id'],
				'username' => $user['username']
			]
		]);
	} catch (mysqli_sql_exception $e) {
		// In a real application, you would log this error instead of exposing details.
		// error_log($e->getMessage());
		sendJsonError(500, 'error.dbConnection');
	} catch (Exception $e) {
		sendJsonError(500, 'error.unexpected');
	}
	// MODIFIED SECTION END
