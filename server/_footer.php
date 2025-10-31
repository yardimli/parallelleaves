<?php

	/**
	 * Common footer for the server-side dashboard.
	 * Closes the main content tags opened in _header.php.
	 *
	 * @version 1.0.0
	 * @author Ekim Emre Yardimli
	 */

	declare(strict_types=1);

	$isLoggedIn = isset($_SESSION['user_id']);
?>
<?php
	if ($isLoggedIn): ?>
		</main> <!-- Closes the main content area -->
		</div> <!-- Closes the flex container -->
	<?php
	endif; ?>
</div> <!-- Closes the max-w-7xl container -->
</body>
</html>
