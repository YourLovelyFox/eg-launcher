<?php
/**
 * Partner event calendar (MariaDB).
 * GET  ?partner_id=horizons-smp  — public list
 * POST — partner session (own partner only) OR staff admin / admin key
 */
require __DIR__ . '/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];

try {
    $pdo = db();
    try {
        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS partner_events (
              id VARCHAR(64) NOT NULL PRIMARY KEY,
              partner_id VARCHAR(64) NOT NULL,
              title VARCHAR(512) NOT NULL,
              description TEXT NULL,
              starts_at DATETIME(3) NOT NULL,
              ends_at DATETIME(3) NULL,
              location VARCHAR(512) NULL,
              created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
              KEY idx_partner_starts (partner_id, starts_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    } catch (Throwable $e) {
        // table exists
    }

    if ($method === 'GET') {
        $partnerId = trim((string) ($_GET['partner_id'] ?? $_GET['partnerId'] ?? ''));
        if ($partnerId !== '') {
            $stmt = $pdo->prepare(
                'SELECT id, partner_id, title, description, starts_at, ends_at, location
                 FROM partner_events WHERE partner_id = ? ORDER BY starts_at ASC'
            );
            $stmt->execute([$partnerId]);
        } else {
            $stmt = $pdo->query(
                'SELECT id, partner_id, title, description, starts_at, ends_at, location
                 FROM partner_events ORDER BY starts_at ASC LIMIT 200'
            );
        }
        $events = [];
        foreach ($stmt->fetchAll() as $r) {
            $events[] = [
                'id' => $r['id'],
                'partnerId' => $r['partner_id'],
                'title' => $r['title'],
                'description' => $r['description'] ?? '',
                'startsAt' => iso_date($r['starts_at']),
                'endsAt' => $r['ends_at'] ? iso_date($r['ends_at']) : null,
                'location' => $r['location'] ?? null,
            ];
        }
        json_out(['ok' => true, 'events' => $events]);
    }

    if ($method === 'POST') {
        $partnerSess = try_partner_session_row();
        $staffAdmin = try_staff_session_row();
        $isStaffAdmin = $staffAdmin && ($staffAdmin['role'] ?? '') === 'admin';
        $isKeyAdmin = false;
        try {
            // Soft check: only throw if neither partner nor staff
            global $CONFIG;
            $key = $_SERVER['HTTP_X_EG_ADMIN_KEY'] ?? '';
            $expected = (string) ($CONFIG['admin_api_key'] ?? '');
            $isKeyAdmin =
                $expected !== ''
                && strlen($expected) >= 32
                && $key !== ''
                && hash_equals($expected, $key);
        } catch (Throwable $e) {
            $isKeyAdmin = false;
        }

        if (!$partnerSess && !$isStaffAdmin && !$isKeyAdmin) {
            json_fail('Partner login or admin required', 401);
        }

        $body = json_body();
        $action = $body['action'] ?? 'upsert';

        if ($action === 'delete') {
            $id = trim((string) ($body['id'] ?? ''));
            if ($id === '') {
                json_fail('id required', 400);
            }
            if ($partnerSess) {
                $chk = $pdo->prepare('SELECT partner_id FROM partner_events WHERE id = ? LIMIT 1');
                $chk->execute([$id]);
                $row = $chk->fetch();
                if (!$row || (string) $row['partner_id'] !== $partnerSess['partner_id']) {
                    json_fail('Not your event', 403);
                }
            }
            $pdo->prepare('DELETE FROM partner_events WHERE id = ?')->execute([$id]);
            json_out(['ok' => true, 'message' => 'Event deleted']);
        }

        $partnerId = trim((string) ($body['partnerId'] ?? $body['partner_id'] ?? ''));
        if ($partnerSess) {
            // Partners may only manage their own events
            $partnerId = $partnerSess['partner_id'];
        }
        $title = trim((string) ($body['title'] ?? ''));
        $startsAt = trim((string) ($body['startsAt'] ?? $body['starts_at'] ?? ''));
        if ($partnerId === '' || $title === '' || $startsAt === '') {
            json_fail('partnerId, title, and startsAt required', 400);
        }
        $id = trim((string) ($body['id'] ?? ''));
        if ($id === '') {
            $id = 'evt-' . bin2hex(random_bytes(8));
        } elseif ($partnerSess) {
            $chk = $pdo->prepare('SELECT partner_id FROM partner_events WHERE id = ? LIMIT 1');
            $chk->execute([$id]);
            $row = $chk->fetch();
            if ($row && (string) $row['partner_id'] !== $partnerSess['partner_id']) {
                json_fail('Not your event', 403);
            }
        }
        $description = trim((string) ($body['description'] ?? ''));
        $endsAt = trim((string) ($body['endsAt'] ?? $body['ends_at'] ?? ''));
        $location = trim((string) ($body['location'] ?? ''));

        $startsSql = date('Y-m-d H:i:s', strtotime($startsAt) ?: time());
        $endsSql = $endsAt !== '' ? date('Y-m-d H:i:s', strtotime($endsAt) ?: time()) : null;

        $pdo->prepare(
            'INSERT INTO partner_events (id, partner_id, title, description, starts_at, ends_at, location)
             VALUES (?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
               partner_id=VALUES(partner_id), title=VALUES(title), description=VALUES(description),
               starts_at=VALUES(starts_at), ends_at=VALUES(ends_at), location=VALUES(location)'
        )->execute([
            $id,
            $partnerId,
            $title,
            $description !== '' ? $description : null,
            $startsSql,
            $endsSql,
            $location !== '' ? $location : null,
        ]);

        json_out([
            'ok' => true,
            'event' => [
                'id' => $id,
                'partnerId' => $partnerId,
                'title' => $title,
                'description' => $description,
                'startsAt' => iso_date($startsSql),
                'endsAt' => $endsSql ? iso_date($endsSql) : null,
                'location' => $location !== '' ? $location : null,
            ],
            'message' => 'Event saved',
        ]);
    }

    json_fail('Method not allowed', 405);
} catch (Throwable $e) {
    json_fail('Server error', 500, $e);
}
