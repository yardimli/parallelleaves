<?php
	
	declare(strict_types=1);
	
	// --- CONFIGURATION ---
	$registrationEnabled = true; // Set to false to disable new user registrations.
	
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
	
	$dbHost = $_ENV['DB_HOST'] ?? 'localhost';
	$dbName = $_ENV['DB_NAME'] ?? '';
	$dbUser = $_ENV['DB_USER'] ?? '';
	$dbPass = $_ENV['DB_PASS'] ?? '';
	
	$message = '';
	$messageType = ''; // 'success' or 'error'
	
	if (!$registrationEnabled) {
		$message = 'User registration is currently disabled.';
		$messageType = 'error';
	} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
		$username = trim($_POST['username'] ?? '');
		$password = $_POST['password'] ?? '';
		
		if (empty($username) || empty($password)) {
			$message = 'Username and password are required.';
			$messageType = 'error';
		} elseif (strlen($password) < 8) {
			$message = 'Password must be at least 8 characters long.';
			$messageType = 'error';
		} else {
			mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
			try {
				$db = new mysqli($dbHost, $dbUser, $dbPass, $dbName);
				$db->set_charset('utf8mb4');
				
				$stmt = $db->prepare('SELECT id FROM users WHERE username = ?');
				$stmt->bind_param('s', $username);
				$stmt->execute();
				$result = $stmt->get_result();
				
				if ($result->fetch_assoc()) {
					$message = 'Username already exists. Please choose another one.';
					$messageType = 'error';
				} else {
					$passwordHash = password_hash($password, PASSWORD_DEFAULT);
					$stmt = $db->prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
					$stmt->bind_param('ss', $username, $passwordHash);
					$stmt->execute();
					// MODIFIED: Updated success message with clear instructions.
					$message = 'Registration successful! You can now close this page and log in through the desktop application.';
					$messageType = 'success';
				}
				$stmt->close();
			} catch (mysqli_sql_exception $e) {
				$message = 'Database error. Could not complete registration.';
				$messageType = 'error';
				// In a real application, you would log this error instead of displaying it.
				// error_log($e->getMessage());
			}
		}
	}
?>
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Register - Parallel Leaves</title>
	<link href="https://cdn.jsdelivr.net/npm/daisyui@4.10.2/dist/full.min.css" rel="stylesheet" type="text/css" />
	<script src="https://cdn.tailwindcss.com"></script>
</head>
<!-- MODIFIED: Switched to a medium-toned background and ensured text is readable. -->
<body class="bg-slate-800 min-h-screen flex flex-col items-center justify-center p-4 text-slate-200">

<div class="text-center">
	<!-- NEW: Added application title header. -->
	<h1 class="text-4xl font-bold text-slate-100 mb-6">Parallel Leaves</h1>
</div>

<div class="card w-full max-w-md bg-slate-700 shadow-xl">
	<div class="card-body">
		<h2 class="card-title text-2xl justify-center mb-2">Create an Account</h2>
		
		<?php if ($message): ?>
			<div role="alert" class="alert <?php echo $messageType === 'success' ? 'alert-success' : 'alert-error'; ?> my-4">
				<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
				<span><?php echo htmlspecialchars($message); ?></span>
			</div>
		<?php endif; ?>
		
		<?php if ($registrationEnabled && $messageType !== 'success'): ?>
			<!-- NEW: Added instruction text for users. -->
			<p class="text-sm text-slate-400 text-center mb-4">
				After registering, please return to the desktop application to sign in.
			</p>
			<form action="register.php" method="POST" class="space-y-4">
				<div class="form-control">
					<label class="label" for="username">
						<span class="label-text text-slate-300">Username</span>
					</label>
					<input type="text" id="username" name="username" required class="input input-bordered w-full bg-slate-600" />
				</div>
				<div class="form-control">
					<label class="label" for="password">
						<span class="label-text text-slate-300">Password (min. 8 characters)</span>
					</label>
					<input type="password" id="password" name="password" required minlength="8" class="input input-bordered w-full bg-slate-600" />
				</div>
				<div class="form-control mt-6">
					<button type="submit" class="btn btn-primary">Register</button>
				</div>
			</form>
		<?php endif; ?>
	</div>
</div>

</body>
</html>
