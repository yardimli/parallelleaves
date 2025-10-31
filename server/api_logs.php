<?php

	/**
	 * API Logs Viewer for the Parallel Leaves dashboard.
	 *
	 * Displays a paginated list of API interactions from the `api_logs` table
	 * for the currently logged-in user.
	 *
	 * @version 1.0.0
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

// --- PAGINATION LOGIC ---
	$limit = 25; // Number of logs per page
	$page = isset($_GET['page']) ? (int)$_GET['page'] : 1;
	$offset = ($page - 1) * $limit;

// Get total number of logs for the user
	$totalResult = $db->query("SELECT COUNT(*) as count FROM api_logs WHERE user_id = $userId");
	$totalLogs = (int)$totalResult->fetch_assoc()['count'];
	$totalPages = ceil($totalLogs / $limit);

// Fetch logs for the current page
	$stmt = $db->prepare(
		'SELECT id, action, request_payload, response_body, response_code, created_at ' .
		'FROM api_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
	);
	$stmt->bind_param('iii', $userId, $limit, $offset);
	$stmt->execute();
	$logs = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
	$stmt->close();

?>

	<h2 class="text-3xl font-semibold mb-4">API Logs</h2>

<?php
	if (empty($logs)): ?>
		<p>No API logs found for your account.</p>
	<?php
	else: ?>
		<div class="overflow-x-auto">
			<table class="table table-zebra w-full">
				<thead>
				<tr>
					<th>Timestamp</th>
					<th>Action</th>
					<th>Status</th>
					<th>Request</th>
					<th>Response</th>
				</tr>
				</thead>
				<tbody>
				<?php
					foreach ($logs as $log): ?>
						<tr>
							<td><?php
									echo htmlspecialchars($log['created_at']); ?></td>
							<td><span class="badge badge-neutral"><?php
										echo htmlspecialchars($log['action']); ?></span></td>
							<td>
						<span class="badge <?php
							echo $log['response_code'] >= 400 ? 'badge-error' : 'badge-success'; ?>">
                            <?php
	                            echo htmlspecialchars((string)$log['response_code']); ?>
                        </span>
							</td>
							<td>
                        <textarea readonly class="textarea textarea-bordered textarea-xs w-64 h-24 font-mono">
                            <?php
	                            echo $log['request_payload']; ?>
                        </textarea>
							</td>
							<td>
                         <textarea readonly class="textarea textarea-bordered textarea-xs w-64 h-24 font-mono">
                             <?php
	                             echo $log['response_body'];
                             ?>
                         </textarea>
							</td>
						</tr>
					<?php
					endforeach; ?>
				</tbody>
			</table>
		</div>

		<!-- Pagination Controls -->
		<div class="join mt-6">
			<?php
				for ($i = 1; $i <= $totalPages; $i++): ?>
					<a href="?page=<?php
						echo $i; ?>" class="join-item btn <?php
						if ($i === $page)
							echo 'btn-active'; ?>">
						<?php
							echo $i; ?>
					</a>
				<?php
				endfor; ?>
		</div>
	<?php
	endif; ?>


<?php
	include_once __DIR__ . '/_footer.php';
?>
