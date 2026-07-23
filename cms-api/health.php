<?php
require __DIR__ . '/bootstrap.php';

try {
    $pdo = db();
    $pdo->query('SELECT 1');
    json_out([
        'ok' => true,
        'service' => 'eg-launcher-cms',
        'db' => true,
        'time' => gmdate('c'),
        'images' => 'mariadb',
    ]);
} catch (Throwable $e) {
    json_fail('DB unavailable', 500, $e);
}
