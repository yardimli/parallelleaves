<?php

	/**
	 * Translation Memory viewer for the Parallel Leaves dashboard.
	 *
	 * Displays a list of user's books and the detailed translation memory
	 * pairs for a selected book.
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
	$translationMemories = [];
// NEW: Variables for handling update/delete messages
	$updateMessage = '';
	$updateMessageType = ''; // 'success' or 'error'

// NEW: Handle POST request for deleting TM for a book
	if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'], $_POST['user_book_id'])) {
		if ($_POST['action'] === 'delete_tm') {
			$userBookId = (int)$_POST['user_book_id'];
			// Verify the user owns this book before deleting
			$stmt = $db->prepare('SELECT id FROM user_books WHERE id = ? AND user_id = ?');
			$stmt->bind_param('ii', $userBookId, $userId);
			$stmt->execute();
			$result = $stmt->get_result();
			if ($result->num_rows > 0) {
				$db->begin_transaction();
				try {
					// 1. Delete all entries from the translation memory table for this book
					$deleteStmt = $db->prepare('DELETE FROM user_books_translation_memory WHERE user_book_id = ?');
					$deleteStmt->bind_param('i', $userBookId);
					$deleteStmt->execute();
					$deleteStmt->close();

					// 2. Reset the analysis status on all blocks for this book so they can be re-processed
					$updateStmt = $db->prepare('UPDATE user_book_blocks SET is_analyzed = 0 WHERE user_book_id = ?');
					$updateStmt->bind_param('i', $userBookId);
					$updateStmt->execute();
					$updateStmt->close();

					$db->commit();
					$updateMessage = 'Translation Memory for this book has been deleted. It will be regenerated the next time the app syncs.';
					$updateMessageType = 'success';
				} catch (Exception $e) {
					$db->rollback();
					error_log("TM Deletion Error: " . $e->getMessage());
					$updateMessage = 'An error occurred while deleting the Translation Memory.';
					$updateMessageType = 'error';
				}
			} else {
				$updateMessage = 'You do not have permission to perform this action.';
				$updateMessageType = 'error';
			}
			$stmt->close();
		}
	}

// Determine view based on GET parameter
	if (isset($_GET['book_id'])) {
		$view = 'details';
		$userBookId = (int)$_GET['book_id'];

		// Fetch the selected book's details to ensure ownership
		$stmt = $db->prepare('SELECT id, book_id, source_language, target_language FROM user_books WHERE id = ? AND user_id = ?');
		$stmt->bind_param('ii', $userBookId, $userId);
		$stmt->execute();
		$selectedBook = $stmt->get_result()->fetch_assoc();
		$stmt->close();

		// If the book exists and belongs to the user, fetch its TM entries
		if ($selectedBook) {
			$stmt = $db->prepare(
				'SELECT source_sentence, target_sentence FROM user_books_translation_memory WHERE user_book_id = ? ORDER BY id ASC'
			);
			$stmt->bind_param('i', $userBookId);
			$stmt->execute();
			$translationMemories = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
			$stmt->close();
		} else {
			// If book not found or doesn't belong to user, redirect to the list view
			header('Location: translation_memory.php');
			exit;
		}
	} else {
		// Fetch the list of all books for the user
		$view = 'list';
		$stmt = $db->prepare(
			'SELECT ub.id, ub.book_id, ub.source_language, ub.target_language, ' .
			'(SELECT COUNT(*) FROM user_books_translation_memory WHERE user_book_id = ub.id) as tm_count ' .
			'FROM user_books ub WHERE ub.user_id = ? ORDER BY ub.updated_at DESC'
		);
		$stmt->bind_param('i', $userId);
		$stmt->execute();
		$books = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
		$stmt->close();
	}

?>

<?php
	if ($view === 'list'): ?>
		<h2 class="text-3xl font-semibold mb-4">Translation Memory</h2>
		<p class="mb-6">Select a novel to view its generated translation memory pairs.</p>

		<?php // NEW: Display success or error messages
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
			<p>You have not synced any books with translation memories yet.</p>
		<?php
		else: ?>
			<div class="overflow-x-auto">
				<table class="table w-full">
					<thead>
					<tr>
						<th>Novel ID</th>
						<th>Languages</th>
						<th>TM Entries</th>
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
								<td><?php
										echo htmlspecialchars((string)$book['tm_count']); ?></td>
								<td>
									<!-- MODIFIED: Flex container for buttons -->
									<div class="flex items-center gap-2">
										<a href="translation_memory.php?book_id=<?php
											echo $book['id']; ?>"
										   class="btn btn-sm btn-primary <?php
											   if ($book['tm_count'] == 0)
												   echo 'btn-disabled'; ?>">
											View Details
										</a>
										<!-- NEW: Delete TM form and button -->
										<form action="translation_memory.php" method="POST" class="inline"
										      onsubmit="return confirm('Are you sure you want to delete all TM entries for this book? This cannot be undone.');">
											<input type="hidden" name="action" value="delete_tm">
											<input type="hidden" name="user_book_id" value="<?php
												echo $book['id']; ?>">
											<button type="submit" class="btn btn-sm btn-outline btn-error" <?php
												if ($book['tm_count'] == 0)
													echo 'disabled'; ?>>
												Delete
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
	elseif ($view === 'details' && $selectedBook): ?>
		<!-- TM Details View -->
		<div class="mb-4">
			<a href="translation_memory.php" class="btn btn-sm btn-outline">&larr; Back to Book List</a>
		</div>
		<h2 class="text-3xl font-semibold mb-4">
			Translation Memory for Novel ID: <?php
				echo htmlspecialchars((string)$selectedBook['book_id']); ?>
		</h2>

		<?php
		if (empty($translationMemories)): ?>
			<p>No translation memory entries found for this book.</p>
		<?php
		else: ?>
			<div class="overflow-x-auto">
				<table class="table w-full table-zebra">
					<thead>
					<tr>
						<th class="w-1/2">Source (<?php
								echo htmlspecialchars($selectedBook['source_language']); ?>)
						</th>
						<th class="w-1/2">Target (<?php
								echo htmlspecialchars($selectedBook['target_language']); ?>)
						</th>
					</tr>
					</thead>
					<tbody>
					<?php
						foreach ($translationMemories as $tm): ?>
							<tr>
								<td><?php
										echo htmlspecialchars($tm['source_sentence']); ?></td>
								<td><?php
										echo htmlspecialchars($tm['target_sentence']); ?></td>
							</tr>
						<?php
						endforeach; ?>
					</tbody>
				</table>
			</div>
		<?php
		endif; ?>
	<?php
	endif; ?>


<?php
	include_once __DIR__ . '/_footer.php';
?>
