<?php
/**
 * Stream a contact-form screenshot to admins only.
 * GET /admin/contact-file.php?id=INQUIRY_ID&f=STORED_FILENAME
 */
require dirname(__DIR__) . '/lib/bootstrap.php';
require_admin();

$inqId = trim((string) ($_GET['id'] ?? ''));
$file = basename((string) ($_GET['f'] ?? ''));
if ($inqId === '' || $file === '' || !preg_match('/^[a-zA-Z0-9._-]+$/', $file)) {
    http_response_code(400);
    echo 'Bad request';
    exit;
}

$st = db()->prepare('SELECT id, attachments FROM web_contact_inquiries WHERE id = ? LIMIT 1');
$st->execute([$inqId]);
$row = $st->fetch();
if (!$row) {
    http_response_code(404);
    echo 'Not found';
    exit;
}

$atts = json_decode((string) ($row['attachments'] ?? '[]'), true);
if (!is_array($atts)) {
    $atts = [];
}
$meta = null;
foreach ($atts as $a) {
    if (is_array($a) && ($a['stored'] ?? '') === $file) {
        $meta = $a;
        break;
    }
}
if ($meta === null) {
    http_response_code(404);
    echo 'File not found';
    exit;
}

$path = dirname(__DIR__) . '/uploads/contact/' . $file;
if (!is_file($path) || !is_readable($path)) {
    http_response_code(404);
    echo 'Missing on disk';
    exit;
}

$mime = (string) ($meta['mime'] ?? 'application/octet-stream');
$orig = (string) ($meta['name'] ?? $file);
header('Content-Type: ' . $mime);
header('Content-Length: ' . (string) filesize($path));
header('Content-Disposition: inline; filename="' . str_replace('"', '', $orig) . '"');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, no-store');
readfile($path);
exit;
