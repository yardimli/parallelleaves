<?php

	/**
	 * Codex Viewer/Editor for the Parallel Leaves dashboard.
	 *
	 * Allows users to view a list of their books and edit the codex content
	 * for each one.
	 *
	 * @version 1.1.0
	 * @author Ekim Emre Yardimli
	 */

	declare(strict_types=1);

	include_once __DIR__ . '/_header.php';

// Redirect to login page if the user is not authenticated.
	if (!$isLoggedIn) {
		header('Location: index.php');
		exit;
	}

	$userId = (int)$_SESSION['user_id'];
	$view = 'list'; // Default view
	$books = [];
	$selectedBook = null;
	$updateMessage = '';
	$updateMessageType = ''; // 'success' or 'error'

// MODIFIED: Handle saving codex content OR resetting the codex
	if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['user_book_id'])) {
		$userBookId = (int)$_POST['user_book_id'];

		// Verify the user owns this book before updating
		$stmt = $db->prepare('SELECT id FROM user_books WHERE id = ? AND user_id = ?');
		$stmt->bind_param('ii', $userBookId, $userId);
		$stmt->execute();
		$result = $stmt->get_result();

		if ($result->num_rows > 0) {
			// Check which action is being performed (save or reset)
			if (isset($_POST['codex_content'])) {
				// Action: Save Codex Content
				$codexContent = $_POST['codex_content'];
				$updateStmt = $db->prepare('UPDATE user_books SET codex_content = ? WHERE id = ?');
				$updateStmt->bind_param('si', $codexContent, $userBookId);
				if ($updateStmt->execute()) {
					$updateMessage = 'Codex updated successfully!';
					$updateMessageType = 'success';
				} else {
					$updateMessage = 'Failed to update codex.';
					$updateMessageType = 'error';
				}
				$updateStmt->close();
			} elseif (isset($_POST['action']) && $_POST['action'] === 'reset_codex') {
				// NEW: Action: Reset Codex
				$updateStmt = $db->prepare('UPDATE user_books SET codex_content = NULL, codex_status = "none", codex_chunks_total = 0, codex_chunks_processed = 0 WHERE id = ?');
				$updateStmt->bind_param('i', $userBookId);
				if ($updateStmt->execute()) {
					$updateMessage = 'Codex has been reset. It will be regenerated the next time the app syncs.';
					$updateMessageType = 'success';
				} else {
					$updateMessage = 'Failed to reset codex.';
					$updateMessageType = 'error';
				}
				$updateStmt->close();
			}
		} else {
			$updateMessage = 'Error: You do not have permission to edit this codex.';
			$updateMessageType = 'error';
		}
		$stmt->close();
	}


// Determine view based on GET parameter
	if (isset($_GET['book_id'])) {
		$view = 'edit';
		$userBookId = (int)$_GET['book_id'];

		// Fetch the selected book's details to ensure ownership
		$stmt = $db->prepare('SELECT id, book_id, codex_content, codex_status FROM user_books WHERE id = ? AND user_id = ?');
		$stmt->bind_param('ii', $userBookId, $userId);
		$stmt->execute();
		$selectedBook = $stmt->get_result()->fetch_assoc();
		$stmt->close();

		if (!$selectedBook) {
			// If book not found or doesn't belong to user, redirect to the list view
			header('Location: codex.php');
			exit;
		}
	} else {
		// Fetch the list of all books for the user
		$view = 'list';
		$stmt = $db->prepare(
			'SELECT id, book_id, source_language, target_language, codex_status FROM user_books WHERE user_id = ? ORDER BY updated_at DESC'
		);
		$stmt->bind_param('i', $userId);
		$stmt->execute();
		$books = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
		$stmt->close();
	}

?>

<?php
	if ($view === 'list'): ?>
		<h2 class="text-3xl font-semibold mb-4">Codex Editor</h2>
		<p class="mb-6">Select a novel to view or edit its codex.</p>

		<?php // NEW: Display success or error messages from reset action
		if ($updateMessage): ?>
			<div role="alert" class="alert alert-<?php
				echo $updateMessageType; ?> mb-4">
				<span><?php
						echo htmlspecialchars($updateMessage); ?></span>
			</div>
		<?php
		endif; ?>

		<?php
		if (empty($books)): ?>
			<p>You have not synced any books yet.</p>
		<?php
		else: ?>
			<div class="overflow-x-auto">
				<table class="table w-full">
					<thead>
					<tr>
						<th>Novel ID</th>
						<th>Languages</th>
						<th>Codex Status</th>
						<th>Actions</th>
					</tr>
					</thead>
					<tbody>
					<?php
						foreach ($books as $book): ?>
							<tr>
								<td><?php
										echo htmlspecialchars((string)$book['book_id']); ?></td>
								<td>
							<span class="badge badge-ghost"><?php
									echo htmlspecialchars($book['source_language']); ?></span>
									→
									<span class="badge badge-ghost"><?php
											echo htmlspecialchars($book['target_language']); ?></span>
								</td>
								<td><span class="badge badge-info"><?php
											echo htmlspecialchars($book['codex_status']); ?></span></td>
								<td>
									<!-- MODIFIED: Flex container for buttons -->
									<div class="flex items-center gap-2">
										<a href="codex.php?book_id=<?php
											echo $book['id']; ?>" class="btn btn-sm btn-primary">
											Edit Codex
										</a>
										<!-- NEW: Reset Codex form and button -->
										<form action="codex.php" method="POST" class="inline"
										      onsubmit="return confirm('Are you sure you want to reset the codex for this book? All content will be deleted and regenerated.');">
											<input type="hidden" name="action" value="reset_codex">
											<input type="hidden" name="user_book_id" value="<?php
												echo $book['id']; ?>">
											<button type="submit" class="btn btn-sm btn-outline btn-warning" <?php
												if ($book['codex_status'] === 'none')
													echo 'disabled'; ?>>
												Reset
											</button>
										</form>
									</div>
								</td>
							</tr>
						<?php
						endforeach; ?>
					</tbody>
				</table>
			</div>
		<?php
		endif; ?>

	<?php
	elseif ($view === 'edit' && $selectedBook): ?>
		<div class="mb-4">
			<a href="codex.php" class="btn btn-sm btn-outline">&larr; Back to Book List</a>
		</div>
		<h2 class="text-3xl font-semibold mb-4">
			Editing Codex for Novel ID: <?php
				echo htmlspecialchars((string)$selectedBook['book_id']); ?>
		</h2>

		<?php
		if ($updateMessage): ?>
			<div role="alert" class="alert alert-<?php
				echo $updateMessageType; ?> mb-4">
			<span><?php
					echo htmlspecialchars($updateMessage); ?></span>
			</div>
		<?php
		endif; ?>

		<form action="codex.php?book_id=<?php
			echo $selectedBook['id']; ?>" method="POST">
			<input type="hidden" name="user_book_id" value="<?php
				echo $selectedBook['id']; ?>">
			<div class="form-control">
				<label class="label" for="codex_content">
					<span class="label-text">Codex HTML Content</span>
				</label>
				<textarea id="codex_content" name="codex_content" class="textarea textarea-bordered w-full h-96 font-mono"
				          placeholder="Enter codex content as HTML (e.g., <h3>Character</h3><p>Description...</p>)"><?php
						echo htmlspecialchars($selectedBook['codex_content'] ?? ''); ?></textarea>
			</div>
			<div class="form-control mt-6">
				<button type="submit" class="btn btn-success">Save Codex</button>
			</div>
		</form>

	<?php
	endif; ?>


<?php
	include_once __DIR__ . '/_footer.php';
?>
