<?php
require __DIR__ . '/lib/bootstrap.php';

try {
    $pdo = db();
    $pdo->query('SELECT 1');
    json_out([
        'ok' => true,
        'service' => 'eg-launcher-cms',
        'db' => true,
        'time' => gmdate('c'),
    ]);
} catch (Throwable $e) {
    json_out(['ok' => false, 'error' => 'DB unavailable', 'detail' => $e->getMessage()], 500);
}
