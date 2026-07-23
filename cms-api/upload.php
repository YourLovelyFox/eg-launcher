<?php
/**
 * Admin image upload for partner icons etc.
 * POST JSON: { "filename": "icon.png", "mime": "image/png", "data": "<base64>" }
 * Header: X-EG-Admin-Key
 */
require __DIR__ . '/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_fail('POST required', 405);
}

try {
    require_admin();
    rate_limit_or_fail('admin_upload', 40, 300);

    $body = json_body();
    $filename = basename(trim((string) ($body['filename'] ?? '')));
    $mime = strtolower(trim((string) ($body['mime'] ?? '')));
    $b64 = (string) ($body['data'] ?? '');

    // data:image/png;base64,... support
    if (str_starts_with($b64, 'data:')) {
        if (preg_match('#^data:([^;]+);base64,(.+)$#s', $b64, $m)) {
            if ($mime === '') {
                $mime = strtolower($m[1]);
            }
            $b64 = $m[2];
        }
    }
    $b64 = preg_replace('/\s+/', '', $b64) ?? '';

    if ($filename === '' || $b64 === '') {
        json_fail('filename and data (base64) required', 400);
    }

    $allowed = [
        'image/png' => 'png',
        'image/jpeg' => 'jpg',
        'image/jpg' => 'jpg',
        'image/webp' => 'webp',
        'image/gif' => 'gif',
    ];

    $extFromName = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    $extMap = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'webp' => 'image/webp', 'gif' => 'image/gif'];

    if ($mime === '' && isset($extMap[$extFromName])) {
        $mime = $extMap[$extFromName];
    }
    if (!isset($allowed[$mime])) {
        json_fail('Only PNG, JPEG, WebP, or GIF images are allowed', 400);
    }
    $ext = $allowed[$mime];

    $raw = base64_decode($b64, true);
    if ($raw === false || $raw === '') {
        json_fail('Invalid base64 image data', 400);
    }

    $maxBytes = 2 * 1024 * 1024; // 2 MB
    if (strlen($raw) > $maxBytes) {
        json_fail('Image too large (max 2 MB)', 400);
    }

    // Basic sniff — reject non-images
    if (function_exists('finfo_open')) {
        $fi = finfo_open(FILEINFO_MIME_TYPE);
        if ($fi) {
            $detected = finfo_buffer($fi, $raw) ?: '';
            finfo_close($fi);
            if ($detected !== '' && !isset($allowed[strtolower($detected)]) && $detected !== 'image/jpg') {
                // allow jpeg alias
                if (!str_starts_with(strtolower($detected), 'image/')) {
                    json_fail('File does not look like an image', 400);
                }
            }
        }
    }

    $dir = __DIR__ . '/uploads';
    if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
        json_fail('Could not create uploads directory on server', 500);
    }

    $safeName = 'eg-' . bin2hex(random_bytes(12)) . '.' . $ext;
    $path = $dir . '/' . $safeName;
    if (file_put_contents($path, $raw) === false) {
        json_fail('Failed to write upload', 500);
    }

    // Public URL (site document root)
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (isset($_SERVER['SERVER_PORT']) && (string) $_SERVER['SERVER_PORT'] === '443')
        || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
    $scheme = $https ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $publicUrl = $scheme . '://' . $host . '/uploads/' . $safeName;

    json_out([
        'ok' => true,
        'url' => $publicUrl,
        'path' => 'uploads/' . $safeName,
        'mime' => $mime,
        'size' => strlen($raw),
        'message' => 'Image uploaded',
    ]);
} catch (Throwable $e) {
    json_fail('Server error', 500, $e);
}
