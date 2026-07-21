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
