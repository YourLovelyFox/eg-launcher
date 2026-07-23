<?php
require __DIR__ . '/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];

try {
    $pdo = db();

    if ($method === 'GET') {
        $stmt = $pdo->query('SELECT * FROM partner_config WHERE enabled = 1 ORDER BY title');
        $partners = [];
        foreach ($stmt->fetchAll() as $r) {
            $mods = $r['default_mods_json'];
            if (is_string($mods)) {
                $mods = json_decode($mods, true) ?: [];
            }
            if (!is_array($mods)) {
                $mods = [];
            }
            $partners[] = [
                'id' => $r['id'],
                'title' => $r['title'],
                'menuLabel' => $r['menu_label'],
                'description' => $r['description'] ?? '',
                'gameVersion' => $r['game_version'],
                'loader' => $r['loader'],
                'serverAddress' => $r['server_address'],
                'serverName' => $r['server_name'],
                'instanceName' => $r['instance_name'],
                'newsTag' => $r['news_tag'],
                'newsUsername' => $r['news_username'],
                'defaultMods' => array_values($mods),
                'modrinthPackSlug' => $r['modrinth_pack_slug'],
                'iconUrl' => $r['icon_url'],
                'enabled' => (bool) $r['enabled'],
            ];
        }
        json_out(['ok' => true, 'partners' => $partners]);
    }

    if ($method === 'POST') {
        require_admin();
        $body = json_body();
        $action = $body['action'] ?? 'upsert';

        // Admin image upload (partner icons) — same endpoint so one-file deploy works
        if ($action === 'upload_image' || $action === 'upload') {
            rate_limit_or_fail('admin_upload', 40, 300);
            $filename = basename(trim((string) ($body['filename'] ?? '')));
            $mime = strtolower(trim((string) ($body['mime'] ?? '')));
            $b64 = (string) ($body['data'] ?? '');
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
            if (strlen($raw) > 2 * 1024 * 1024) {
                json_fail('Image too large (max 2 MB)', 400);
            }
            $dir = __DIR__ . '/uploads';
            if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
                json_fail('Could not create uploads directory on server', 500);
            }
            $safeName = 'eg-' . bin2hex(random_bytes(12)) . '.' . $ext;
            if (file_put_contents($dir . '/' . $safeName, $raw) === false) {
                json_fail('Failed to write upload', 500);
            }
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
        }

        if ($action === 'delete') {
            $id = trim((string) ($body['id'] ?? ''));
            if ($id === '') {
                json_fail('id required', 400);
            }
            $row = $pdo->prepare('SELECT news_tag FROM partner_config WHERE id = ?');
            $row->execute([$id]);
            $prev = $row->fetch();
            $pdo->prepare('DELETE FROM partner_config WHERE id = ?')->execute([$id]);
            $pdo->prepare('DELETE FROM partner_auth WHERE id = ?')->execute([$id]);
            if ($prev && !empty($prev['news_tag'])) {
                $pdo->prepare('DELETE FROM news_items WHERE feed_kind = ? AND LOWER(tag) = LOWER(?)')
                    ->execute(['partners', $prev['news_tag']]);
            }
            json_out(['ok' => true]);
        }

        // upsert
        $p = $body['partner'] ?? $body;
        $id = trim((string) ($p['id'] ?? ''));
        $title = trim((string) ($p['title'] ?? ''));
        if ($id === '' || $title === '') {
            json_fail('id and title required', 400);
        }
        if (!preg_match('/^[A-Za-z0-9_-]{1,64}$/', $id)) {
            json_fail('id must be 1–64 letters, numbers, _ or -', 400);
        }
        $newsUsername = trim((string) ($p['newsUsername'] ?? ''));
        $plain = trim((string) ($body['newsPassword'] ?? $p['newsPassword'] ?? ''));

        $mods = $p['defaultMods'] ?? [];
        if (!is_array($mods)) {
            $mods = [];
        }

        $pdo->prepare(
            'INSERT INTO partner_config (
              id, title, menu_label, description, game_version, loader,
              server_address, server_name, instance_name, news_tag, news_username,
              default_mods_json, modrinth_pack_slug, icon_url, enabled
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE
              title=VALUES(title), menu_label=VALUES(menu_label), description=VALUES(description),
              game_version=VALUES(game_version), loader=VALUES(loader),
              server_address=VALUES(server_address), server_name=VALUES(server_name),
              instance_name=VALUES(instance_name), news_tag=VALUES(news_tag),
              news_username=VALUES(news_username), default_mods_json=VALUES(default_mods_json),
              modrinth_pack_slug=VALUES(modrinth_pack_slug), icon_url=VALUES(icon_url),
              enabled=VALUES(enabled)'
        )->execute([
            $id,
            $title,
            trim((string) ($p['menuLabel'] ?? $title)),
            (string) ($p['description'] ?? ''),
            (string) ($p['gameVersion'] ?? ''),
            (string) ($p['loader'] ?? 'fabric'),
            (string) ($p['serverAddress'] ?? ''),
            trim((string) ($p['serverName'] ?? $title)),
            trim((string) ($p['instanceName'] ?? $title)),
            trim((string) ($p['newsTag'] ?? '')),
            $newsUsername,
            json_encode(array_values($mods)),
            $p['modrinthPackSlug'] ?? null,
            $p['iconUrl'] ?? null,
            !empty($p['enabled']) || !isset($p['enabled']) ? 1 : 0,
        ]);

        $hash = null;
        if ($plain !== '') {
            if (strlen($plain) < 8) {
                json_fail('newsPassword must be at least 8 characters', 400);
            }
            $hash = hash_password_secure($plain);
        } else {
            $ex = $pdo->prepare('SELECT password_hash, username FROM partner_auth WHERE id = ?');
            $ex->execute([$id]);
            $prevAuth = $ex->fetch();
            if (!$prevAuth) {
                json_fail('newsPassword required for new partner', 400);
            }
            if ($prevAuth['username'] !== $newsUsername) {
                json_fail('Username changed — provide newsPassword', 400);
            }
            $hash = $prevAuth['password_hash'];
        }

        $pdo->prepare(
            'INSERT INTO partner_auth (id, username, password_hash, news_tag, display_name)
             VALUES (?,?,?,?,?)
             ON DUPLICATE KEY UPDATE username=VALUES(username), password_hash=VALUES(password_hash),
               news_tag=VALUES(news_tag), display_name=VALUES(display_name)'
        )->execute([
            $id,
            $newsUsername,
            $hash,
            trim((string) ($p['newsTag'] ?? '')),
            $title,
        ]);

        json_out(['ok' => true, 'partner' => ['id' => $id, 'title' => $title]]);
    }

    json_fail('Method not allowed', 405);
} catch (Throwable $e) {
    json_fail('Server error', 500, $e);
}
