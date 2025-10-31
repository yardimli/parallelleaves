<?php

	/**
	 * Main dashboard and login page for Parallel Leaves server.
	 *
	 * This script handles user login/logout and serves as the main entry
	 * point for logged-in users, directing them to other parts of the dashboard.
	 *
	 * @version 2.0.0
	 * @author Ekim Emre Yardimli
	 */

	declare(strict_types=1);

// Include the common header which handles session start and DB connection.
	include_once __DIR__ . '/_header.php';

// --- VARIABLE INITIALIZATION ---
	$loginError = '';

// --- LOGIC & ROUTING ---

// Handle Logout
	if (isset($_GET['action']) && $_GET['action'] === 'logout') {
		session_destroy();
		header('Location: index.php');
		exit;
	}

// Handle Login Form Submission
	if (!$isLoggedIn && $_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['username'], $_POST['password'])) {
		$username = $_POST['username'];
		$password = $_POST['password'];

		$stmt = $db->prepare('SELECT id, username, password_hash FROM users WHERE username = ?');
		$stmt->bind_param('s', $username);
		$stmt->execute();
		$result = $stmt->get_result();
		$user = $result->fetch_assoc();
		$stmt->close();

		if ($user && password_verify($password, $user['password_hash'])) {
			// Login successful
			$_SESSION['user_id'] = $user['id'];
			$_SESSION['username'] = $user['username'];
			header('Location: index.php'); // Redirect to avoid form resubmission
			exit;
		} else {
			// Login failed
			$loginError = 'Invalid username or password.';
		}
	}

?>

<?php
	if (!$isLoggedIn): ?>
		<!-- Login Form -->
		<div class="card w-full max-w-md bg-base-200 shadow-xl mx-auto mt-16">
			<div class="card-body">
				<h2 class="card-title text-2xl justify-center mb-4">Login</h2>
				<?php
					if ($loginError): ?>
						<div role="alert" class="alert alert-error">
					<span><?php
							echo htmlspecialchars($loginError); ?></span>
						</div>
					<?php
					endif; ?>
				<form action="index.php" method="POST" class="space-y-4">
					<div class="form-control">
						<label class="label" for="username">
							<span class="label-text">Username</span>
						</label>
						<input type="text" id="username" name="username" required class="input input-bordered w-full"/>
					</div>
					<div class="form-control">
						<label class="label" for="password">
							<span class="label-text">Password</span>
						</label>
						<input type="password" id="password" name="password" required
						       class="input input-bordered w-full"/>
					</div>
					<div class="form-control mt-6">
						<button type="submit" class="btn btn-primary">Login</button>
					</div>
				</form>
			</div>
		</div>
	<?php
	else: ?>
		<!-- Logged-in Dashboard Content -->
		<h2 class="text-3xl font-semibold mb-4">Dashboard</h2>
		<p class="mb-6">Welcome to the Parallel Leaves server dashboard. From here, you can manage and view data associated with your account.</p>

		<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
			<!-- Translation Memory Card -->
			<div class="card bg-base-200 shadow-xl">
				<div class="card-body">
					<h3 class="card-title">Translation Memory</h3>
					<p>View the translation memory pairs that have been generated from your synced novels.</p>
					<div class="card-actions justify-end">
						<a href="translation_memory.php" class="btn btn-primary">View TM</a>
					</div>
				</div>
			</div>

			<!-- Codex Editor Card -->
			<div class="card bg-base-200 shadow-xl">
				<div class="card-body">
					<h3 class="card-title">Codex Editor</h3>
					<p>Review and edit the auto-generated codex (world encyclopedia) for each of your novels.</p>
					<div class="card-actions justify-end">
						<a href="codex.php" class="btn btn-primary">Edit Codex</a>
					</div>
				</div>
			</div>

			<!-- API Logs Card -->
			<div class="card bg-base-200 shadow-xl">
				<div class="card-body">
					<h3 class="card-title">API Logs</h3>
					<p>Browse a detailed log of all API requests made from your account to the AI services.</p>
					<div class="card-actions justify-end">
						<a href="api_logs.php" class="btn btn-primary">View Logs</a>
					</div>
				</div>
			</div>
		</div>

	<?php
	endif; ?>

<?php
// Include the common footer.
	include_once __DIR__ . '/_footer.php';
?>
