<?php
/**
 * Staff change verification queue.
 * Staff submits pending changes; Admins approve → apply to live data.
 * Do NOT require staff.php here — that file is a full request handler and would exit.
 */
require __DIR__ . '/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? 'list';

try {
    $pdo = db();
    ensure_approvals_schema($pdo);
    // staff schema for session helpers
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS staff_users (
          id VARCHAR(64) NOT NULL PRIMARY KEY,
          username VARCHAR(64) NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          role ENUM('admin','staff') NOT NULL DEFAULT 'staff',
          offline_quota INT NOT NULL DEFAULT 3,
          enabled TINYINT(1) NOT NULL DEFAULT 1,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          UNIQUE KEY uq_staff_user (username)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS staff_sessions (
          token CHAR(64) NOT NULL PRIMARY KEY,
          staff_id VARCHAR(64) NOT NULL,
          expires_at DATETIME NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    if ($action === 'list' && $method === 'GET') {
        require_admin();
        $status = trim((string) ($_GET['status'] ?? 'pending'));
        if ($status === 'all') {
            $stmt = $pdo->query(
                'SELECT * FROM approval_queue ORDER BY created_at DESC LIMIT 200'
            );
        } else {
            $stmt = $pdo->prepare(
                'SELECT * FROM approval_queue WHERE status = ? ORDER BY created_at DESC LIMIT 100'
            );
            $stmt->execute([$status]);
        }
        $out = [];
        foreach ($stmt->fetchAll() as $r) {
            $out[] = row_approval($r);
        }
        json_out(['ok' => true, 'items' => $out]);
    }

    if ($action === 'submit' && $method === 'POST') {
        // Staff session only — no admin API key required (account-based)
        $staff = require_staff_from_header($pdo);
        $body = json_body();
        $type = trim((string) ($body['type'] ?? ''));
        $payload = $body['payload'] ?? null;
        $summary = trim((string) ($body['summary'] ?? ''));
        if ($type === '' || !is_array($payload)) {
            json_fail('type and payload required', 400);
        }
        $allowed = ['news_launcher', 'partner_upsert', 'partner_delete', 'partner_event', 'offline_create', 'offline_delete', 'featured_pack'];
        if (!in_array($type, $allowed, true)) {
            json_fail('Invalid type', 400);
        }
        // Admins apply immediately without queue
        if ($staff['role'] === 'admin') {
            json_fail('Admins should publish directly (not via queue)', 400);
        }
        $id = 'appr-' . bin2hex(random_bytes(8));
        $pdo->prepare(
            'INSERT INTO approval_queue (id, type, summary, payload_json, submitted_by, submitted_by_name, status)
             VALUES (?,?,?,?,?,?,?)'
        )->execute([
            $id,
            $type,
            $summary !== '' ? $summary : $type,
            json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            $staff['id'],
            $staff['username'],
            'pending',
        ]);
        json_out(['ok' => true, 'id' => $id, 'message' => 'Submitted for admin verification']);
    }

    if ($action === 'review' && $method === 'POST') {
        require_admin();
        $reviewer = try_staff_from_header($pdo);
        if ($reviewer !== null && $reviewer['role'] !== 'admin') {
            json_fail('Only admins can approve/reject', 403);
        }
        $body = json_body();
        $id = trim((string) ($body['id'] ?? ''));
        $decision = strtolower(trim((string) ($body['decision'] ?? '')));
        $note = trim((string) ($body['note'] ?? ''));
        if ($id === '' || !in_array($decision, ['approved', 'rejected'], true)) {
            json_fail('id and decision (approved|rejected) required', 400);
        }
        $stmt = $pdo->prepare('SELECT * FROM approval_queue WHERE id = ? LIMIT 1');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) {
            json_fail('Not found', 404);
        }
        if ($row['status'] !== 'pending') {
            json_fail('Already reviewed', 400);
        }
        if ($decision === 'rejected') {
            $pdo->prepare(
                'UPDATE approval_queue SET status=?, reviewed_at=NOW(3), review_note=? WHERE id=?'
            )->execute(['rejected', $note !== '' ? $note : null, $id]);
            json_out(['ok' => true, 'message' => 'Rejected']);
        }

        $payload = json_decode((string) $row['payload_json'], true);
        if (!is_array($payload)) {
            json_fail('Invalid payload', 500);
        }
        apply_approval($pdo, (string) $row['type'], $payload, (string) $row['submitted_by']);
        $pdo->prepare(
            'UPDATE approval_queue SET status=?, reviewed_at=NOW(3), review_note=? WHERE id=?'
        )->execute(['approved', $note !== '' ? $note : null, $id]);
        json_out(['ok' => true, 'message' => 'Approved and published']);
    }

    json_fail('Unknown action', 400);
} catch (Throwable $e) {
    json_fail('Server error', 500, $e);
}

function ensure_approvals_schema(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS approval_queue (
          id VARCHAR(64) NOT NULL PRIMARY KEY,
          type VARCHAR(64) NOT NULL,
          summary VARCHAR(512) NOT NULL,
          payload_json MEDIUMTEXT NOT NULL,
          submitted_by VARCHAR(64) NOT NULL,
          submitted_by_name VARCHAR(64) NOT NULL,
          status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          reviewed_at DATETIME(3) NULL,
          review_note VARCHAR(512) NULL,
          KEY idx_appr_status (status, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function row_approval(array $r): array
{
    return [
        'id' => $r['id'],
        'type' => $r['type'],
        'summary' => $r['summary'],
        'payload' => json_decode((string) $r['payload_json'], true),
        'submittedBy' => $r['submitted_by'],
        'submittedByName' => $r['submitted_by_name'],
        'status' => $r['status'],
        'createdAt' => iso_date($r['created_at']),
        'reviewedAt' => $r['reviewed_at'] ? iso_date($r['reviewed_at']) : null,
        'reviewNote' => $r['review_note'],
    ];
}

/** @return array{id:string,username:string,role:string,offline_quota:int}|null */
function try_staff_from_header(PDO $pdo): ?array
{
    $tok = header_session();
    if ($tok === '') {
        return null;
    }
    $stmt = $pdo->prepare(
        'SELECT s.expires_at, u.id, u.username, u.role, u.offline_quota, u.enabled
         FROM staff_sessions s JOIN staff_users u ON u.id = s.staff_id
         WHERE s.token = ? LIMIT 1'
    );
    $stmt->execute([$tok]);
    $row = $stmt->fetch();
    if (!$row || !(int) $row['enabled'] || strtotime((string) $row['expires_at']) < time()) {
        return null;
    }
    // Sliding idle timeout
    try {
        $pdo->prepare('UPDATE staff_sessions SET expires_at = ? WHERE token = ?')
            ->execute([date('Y-m-d H:i:s', time() + 5 * 60), $tok]);
    } catch (Throwable $e) {
    }
    return [
        'id' => $row['id'],
        'username' => $row['username'],
        'role' => $row['role'],
        'offline_quota' => (int) $row['offline_quota'],
    ];
}

function require_staff_from_header(PDO $pdo): array
{
    $s = try_staff_from_header($pdo);
    if ($s === null) {
        json_fail('Staff session required (X-EG-Session)', 401);
    }
    return $s;
}

function apply_approval(PDO $pdo, string $type, array $payload, string $staffId): void
{
    if ($type === 'news_launcher') {
        $items = $payload['items'] ?? [];
        $title = (string) ($payload['title'] ?? 'EG Launcher News');
        if (!is_array($items)) {
            throw new RuntimeException('Invalid news items');
        }
        $pdo->prepare('DELETE FROM news_items WHERE feed_kind = ?')->execute(['launcher']);
        $ins = $pdo->prepare(
            'INSERT INTO news_items (id, feed_kind, title, summary, body, published_at, tag, url, sort_date)
             VALUES (?,?,?,?,?,?,?,?,?)'
        );
        foreach ($items as $it) {
            if (!is_array($it)) {
                continue;
            }
            $id = (string) ($it['id'] ?? ('n-' . bin2hex(random_bytes(4))));
            $published = date('Y-m-d H:i:s', strtotime((string) ($it['date'] ?? 'now')) ?: time());
            $ins->execute([
                $id,
                'launcher',
                (string) ($it['title'] ?? ''),
                $it['summary'] ?? null,
                $it['body'] ?? null,
                $published,
                (string) ($it['tag'] ?? 'info'),
                $it['url'] ?? null,
                $published,
            ]);
        }
        $pdo->prepare(
            'INSERT INTO feed_meta (feed_kind, title, updated_at) VALUES (?,?,NOW(3))
             ON DUPLICATE KEY UPDATE title=VALUES(title), updated_at=NOW(3)'
        )->execute(['launcher', $title]);
        return;
    }

    if ($type === 'partner_upsert') {
        // Soft columns
        try {
            $pdo->exec('ALTER TABLE partner_config ADD COLUMN discord_url VARCHAR(1024) NULL');
        } catch (Throwable $e) {
        }
        $p = $payload;
        $id = trim((string) ($p['id'] ?? ''));
        if ($id === '') {
            throw new RuntimeException('partner id required');
        }
        $mods = $p['defaultMods'] ?? [];
        if (!is_array($mods)) {
            $mods = [];
        }
        $pdo->prepare(
            'INSERT INTO partner_config (
              id, title, menu_label, description, game_version, loader, server_address, server_name,
              instance_name, news_tag, news_username, default_mods_json, modrinth_pack_slug, icon_url, discord_url, enabled
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
            ON DUPLICATE KEY UPDATE
              title=VALUES(title), menu_label=VALUES(menu_label), description=VALUES(description),
              game_version=VALUES(game_version), loader=VALUES(loader), server_address=VALUES(server_address),
              server_name=VALUES(server_name), instance_name=VALUES(instance_name), news_tag=VALUES(news_tag),
              news_username=VALUES(news_username), default_mods_json=VALUES(default_mods_json),
              modrinth_pack_slug=VALUES(modrinth_pack_slug), icon_url=VALUES(icon_url), discord_url=VALUES(discord_url)'
        )->execute([
            $id,
            (string) ($p['title'] ?? $id),
            (string) ($p['menuLabel'] ?? $p['title'] ?? $id),
            (string) ($p['description'] ?? ''),
            (string) ($p['gameVersion'] ?? '1.21.1'),
            (string) ($p['loader'] ?? 'fabric'),
            (string) ($p['serverAddress'] ?? ''),
            (string) ($p['serverName'] ?? $p['title'] ?? $id),
            (string) ($p['instanceName'] ?? $p['title'] ?? $id),
            (string) ($p['newsTag'] ?? $id),
            (string) ($p['newsUsername'] ?? ''),
            json_encode(array_values($mods)),
            $p['modrinthPackSlug'] ?? null,
            $p['iconUrl'] ?? null,
            $p['discordUrl'] ?? null,
        ]);
        if (!empty($p['newsPassword'])) {
            $hash = password_hash((string) $p['newsPassword'], PASSWORD_ARGON2ID) ?: password_hash((string) $p['newsPassword'], PASSWORD_BCRYPT);
            $pdo->prepare(
                'INSERT INTO partner_auth (id, username, password_hash, news_tag, display_name)
                 VALUES (?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE username=VALUES(username), password_hash=VALUES(password_hash),
                   news_tag=VALUES(news_tag), display_name=VALUES(display_name)'
            )->execute([
                $id,
                (string) ($p['newsUsername'] ?? $id),
                $hash,
                (string) ($p['newsTag'] ?? $id),
                (string) ($p['title'] ?? $id),
            ]);
        }
        return;
    }

    if ($type === 'partner_delete') {
        $id = trim((string) ($payload['id'] ?? ''));
        if ($id === '') {
            throw new RuntimeException('id required');
        }
        $pdo->prepare('DELETE FROM partner_config WHERE id = ?')->execute([$id]);
        $pdo->prepare('DELETE FROM partner_auth WHERE id = ?')->execute([$id]);
        return;
    }

    if ($type === 'offline_create') {
        $username = trim((string) ($payload['username'] ?? ''));
        $password = (string) ($payload['password'] ?? '');
        if ($username === '' || $password === '') {
            throw new RuntimeException('username/password required');
        }
        $id = 'offline-' . bin2hex(random_bytes(8));
        $uuid = offline_uuid($username);
        $hash = password_hash($password, PASSWORD_ARGON2ID) ?: password_hash($password, PASSWORD_BCRYPT);
        $pdo->prepare(
            'INSERT INTO offline_users (id, username, password_hash, uuid, display_name, created_at, created_by_staff)
             VALUES (?,?,?,?,?,NOW(3),?)'
        )->execute([$id, $username, $hash, $uuid, $username, $staffId]);
        return;
    }

    if ($type === 'offline_delete') {
        $id = trim((string) ($payload['id'] ?? ''));
        $pdo->prepare('DELETE FROM offline_users WHERE id = ?')->execute([$id]);
        return;
    }

    if ($type === 'featured_pack') {
        ensure_featured_schema($pdo);
        $p = $payload;
        $id = trim((string) ($p['id'] ?? ''));
        if ($id === '') {
            $id = 'fp-' . bin2hex(random_bytes(6));
        }
        $pdo->prepare(
            'INSERT INTO featured_packs
              (id, slug, project_id, title, description, menu_label, min_system_ram_gb, recommended_ram_mb, icon_url, enabled, sort_order)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
              slug=VALUES(slug), project_id=VALUES(project_id), title=VALUES(title),
              description=VALUES(description), menu_label=VALUES(menu_label),
              min_system_ram_gb=VALUES(min_system_ram_gb), recommended_ram_mb=VALUES(recommended_ram_mb),
              icon_url=VALUES(icon_url), enabled=VALUES(enabled), sort_order=VALUES(sort_order)'
        )->execute([
            $id,
            (string) ($p['slug'] ?? $id),
            (string) ($p['projectId'] ?? ''),
            (string) ($p['title'] ?? $id),
            (string) ($p['description'] ?? ''),
            (string) ($p['menuLabel'] ?? $p['title'] ?? $id),
            (int) ($p['minSystemRamGb'] ?? 8),
            (int) ($p['recommendedAllocatedMb'] ?? 4096),
            $p['iconUrl'] ?? null,
            !empty($p['enabled']) || !isset($p['enabled']) ? 1 : 0,
            (int) ($p['sortOrder'] ?? 0),
        ]);
        return;
    }

    if ($type === 'partner_event') {
        $p = $payload;
        $partnerId = trim((string) ($p['partnerId'] ?? ''));
        $title = trim((string) ($p['title'] ?? ''));
        $startsAt = trim((string) ($p['startsAt'] ?? ''));
        if ($partnerId === '' || $title === '' || $startsAt === '') {
            throw new RuntimeException('partnerId, title, startsAt required');
        }
        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS partner_events (
              id VARCHAR(64) NOT NULL PRIMARY KEY,
              partner_id VARCHAR(64) NOT NULL,
              title VARCHAR(256) NOT NULL,
              description TEXT NULL,
              starts_at DATETIME NOT NULL,
              ends_at DATETIME NULL,
              location VARCHAR(256) NULL,
              created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
              KEY idx_pe_partner (partner_id, starts_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
        $id = trim((string) ($p['id'] ?? ''));
        if ($id === '') {
            $id = 'ev-' . bin2hex(random_bytes(6));
        }
        $starts = date('Y-m-d H:i:s', strtotime($startsAt) ?: time());
        $ends = !empty($p['endsAt']) ? date('Y-m-d H:i:s', strtotime((string) $p['endsAt']) ?: time()) : null;
        $pdo->prepare(
            'INSERT INTO partner_events (id, partner_id, title, description, starts_at, ends_at, location)
             VALUES (?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
              title=VALUES(title), description=VALUES(description), starts_at=VALUES(starts_at),
              ends_at=VALUES(ends_at), location=VALUES(location)'
        )->execute([
            $id,
            $partnerId,
            $title,
            $p['description'] ?? null,
            $starts,
            $ends,
            $p['location'] ?? null,
        ]);
        return;
    }

    throw new RuntimeException('Unsupported approval type: ' . $type);
}

function ensure_featured_schema(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS featured_packs (
          id VARCHAR(64) NOT NULL PRIMARY KEY,
          slug VARCHAR(128) NOT NULL,
          project_id VARCHAR(64) NOT NULL,
          title VARCHAR(256) NOT NULL,
          description TEXT NULL,
          menu_label VARCHAR(128) NOT NULL,
          min_system_ram_gb INT NOT NULL DEFAULT 8,
          recommended_ram_mb INT NOT NULL DEFAULT 4096,
          icon_url VARCHAR(1024) NULL,
          enabled TINYINT(1) NOT NULL DEFAULT 1,
          sort_order INT NOT NULL DEFAULT 0,
          UNIQUE KEY uq_fp_slug (slug)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function offline_uuid(string $username): string
{
    $data = 'OfflinePlayer:' . $username;
    $md5 = md5($data, true);
    $md5[6] = chr((ord($md5[6]) & 0x0f) | 0x30);
    $md5[8] = chr((ord($md5[8]) & 0x3f) | 0x80);
    $hex = bin2hex($md5);
    return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-' .
        substr($hex, 16, 4) . '-' . substr($hex, 20, 12);
}
