<?php
/**
 * Serve CMS images stored in MariaDB (cms_images).
 *
 * GET icon.php?id=eg-<24hex>
 *
 * This host only executes PHP — static /uploads/* returns 404 — so BLOBs
 * are stored in MariaDB and streamed here.
 */
declare(strict_types=1);

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Server configuration missing';
    exit;
}

/** @var array $CONFIG */
$CONFIG = require $configPath;

$id = trim((string) ($_GET['id'] ?? $_GET['f'] ?? ''));
// Accept legacy file-style names: eg-abc…png → eg-abc…
if (preg_match('/^(eg-[a-f0-9]{24})(?:\.[a-z0-9]+)?$/i', $id, $m)) {
    $id = strtolower($m[1]);
} else {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Not found';
    exit;
}

try {
    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
        $CONFIG['db_host'],
        (int) $CONFIG['db_port'],
        $CONFIG['db_name']
    );
    $pdo = new PDO($dsn, $CONFIG['db_user'], $CONFIG['db_pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);

    // Soft-create table if missing (first hit before any admin upload)
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS cms_images (
          id VARCHAR(64) NOT NULL PRIMARY KEY,
          mime VARCHAR(64) NOT NULL,
          bytes MEDIUMBLOB NOT NULL,
          size INT UNSIGNED NOT NULL,
          original_name VARCHAR(255) NULL,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $stmt = $pdo->prepare('SELECT mime, bytes, size FROM cms_images WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) {
        http_response_code(404);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Not found';
        exit;
    }

    $mime = (string) ($row['mime'] ?? 'application/octet-stream');
    $bytes = $row['bytes'];
    if (is_resource($bytes)) {
        $bytes = stream_get_contents($bytes);
    }
    $bytes = (string) $bytes;
    if ($bytes === '') {
        http_response_code(404);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Not found';
        exit;
    }

    $allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
    if (!in_array(strtolower($mime), $allowed, true)) {
        $mime = 'application/octet-stream';
    }
    if (strtolower($mime) === 'image/jpg') {
        $mime = 'image/jpeg';
    }

    header('Content-Type: ' . $mime);
    header('Content-Length: ' . (string) strlen($bytes));
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: public, max-age=604800, immutable');
    header('Access-Control-Allow-Origin: *');
    echo $bytes;
    exit;
} catch (Throwable $e) {
    error_log('[eg-cms] icon.php: ' . $e->getMessage());
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Server error';
    exit;
}
