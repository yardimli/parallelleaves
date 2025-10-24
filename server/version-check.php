<?php

	declare(strict_types=1);

// Set the current latest version of the application.
// This should be updated whenever a new version is released.
	$latestVersion = '0.1.5';

	header('Content-Type: application/json');
	header('Access-Control-Allow-Origin: *'); // Allow requests from any origin

	echo json_encode(['latest_version' => $latestVersion]);
