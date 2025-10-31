<?php

	/**
	 * Common header for the server-side dashboard.
	 *
	 * Initializes the session, connects to the database, and renders the
	 * HTML head and navigation bar for all dashboard pages.
	 *
	 * @version 1.0.0
	 * @author Ekim Emre Yardimli
	 */

	declare(strict_types=1);

// Start the session to manage user login state across all pages.
	session_start();

// --- CONFIGURATION & INITIALIZATION ---

// Load environment variables from .env file
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

// Get database credentials from environment variables
	$dbHost = $_ENV['DB_HOST'] ?? 'localhost';
	$dbName = $_ENV['DB_NAME'] ?? '';
	$dbUser = $_ENV['DB_USER'] ?? '';
	$dbPass = $_ENV['DB_PASS'] ?? '';

// Establish database connection
	mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
	try {
		$db = new mysqli($dbHost, $dbUser, $dbPass, $dbName);
		$db->set_charset('utf8mb4');
	} catch (mysqli_sql_exception $e) {
		die("Database connection failed. Please check server configuration.");
	}

	$isLoggedIn = isset($_SESSION['user_id']);
	$current_page = basename($_SERVER['PHP_SELF']);

?>
	<!DOCTYPE html>
	<html lang="en" data-theme="dark">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>Parallel Leaves - Server Dashboard</title>
		<link href="https://cdn.jsdelivr.net/npm/daisyui@4.10.2/dist/full.min.css" rel="stylesheet" type="text/css"/>
		<script src="https://cdn.tailwindcss.com"></script>
	</head>
<body class="bg-base-100 min-h-screen flex flex-col items-center p-4 text-base-content">

<div class="w-full max-w-7xl">
	<header class="flex justify-between items-center mb-6 pb-4 border-b border-base-300">
		<h1 class="text-4xl font-bold">Parallel Leaves Dashboard</h1>
		<?php
			if ($isLoggedIn): ?>
				<div class="flex items-center gap-4">
				<span>Welcome, <?php
						echo htmlspecialchars($_SESSION['username']); ?>!</span>
					<a href="index.php?action=logout" class="btn btn-sm btn-outline btn-error">Logout</a>
				</div>
			<?php
			endif; ?>
	</header>

<?php
	if ($isLoggedIn): ?>
		<div class="flex gap-8">
		<aside class="w-1/5">
			<ul class="menu bg-base-200 rounded-box">
				<li>
					<a href="index.php" class="<?php
						if ($current_page === 'index.php')
							echo 'active'; ?>">
						<i class="bi bi-house-door-fill"></i> Dashboard
					</a>
				</li>
				<li>
					<a href="translation_memory.php" class="<?php
						if ($current_page === 'translation_memory.php')
							echo 'active'; ?>">
						<i class="bi bi-book-fill"></i> Translation Memory
					</a>
				</li>
				<li>
					<a href="codex.php" class="<?php
						if ($current_page === 'codex.php')
							echo 'active'; ?>">
						<i class="bi bi-journal-bookmark-fill"></i> Codex Editor
					</a>
				</li>
				<li>
					<a href="api_logs.php" class="<?php
						if ($current_page === 'api_logs.php')
							echo 'active'; ?>">
						<i class="bi bi-terminal-fill"></i> API Logs
					</a>
				</li>
			</ul>
		</aside>
		<main class="w-4/5">
	<?php
	endif; ?>
