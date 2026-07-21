<?php
require __DIR__ . '/lib/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$kind = $_GET['kind'] ?? 'launcher';
if ($kind !== 'launcher' && $kind !== 'partners') {
    json_out(['ok' => false, 'error' => 'Invalid kind'], 400);
}

try {
    $pdo = db();

    if ($method === 'GET') {
        $tag = isset($_GET['tag']) ? trim((string) $_GET['tag']) : '';
        $meta = $pdo->prepare('SELECT title, updated_at FROM feed_meta WHERE feed_kind = ? LIMIT 1');
        $meta->execute([$kind]);
        $m = $meta->fetch() ?: ['title' => $kind === 'launcher' ? 'EG Launcher News' : 'EG Partner News', 'updated_at' => null];

        if ($tag !== '') {
            $stmt = $pdo->prepare(
                'SELECT id, title, summary, body, published_at, tag, url
                 FROM news_items WHERE feed_kind = ? AND LOWER(tag) = LOWER(?)
                 ORDER BY sort_date DESC LIMIT 100'
            );
            $stmt->execute([$kind, $tag]);
        } else {
            $stmt = $pdo->prepare(
                'SELECT id, title, summary, body, published_at, tag, url
                 FROM news_items WHERE feed_kind = ?
                 ORDER BY sort_date DESC LIMIT 100'
            );
            $stmt->execute([$kind]);
        }
        $items = [];
        foreach ($stmt->fetchAll() as $row) {
            $items[] = [
                'id' => $row['id'],
                'title' => $row['title'],
                'summary' => $row['summary'],
                'body' => $row['body'],
                'date' => iso_date($row['published_at']),
                'tag' => $row['tag'] ?: 'info',
                'url' => $row['url'] !== null && $row['url'] !== '' ? $row['url'] : null,
            ];
        }
        json_out([
            'ok' => true,
            'title' => $m['title'],
            'updated' => $m['updated_at'] ? iso_date($m['updated_at']) : ($items[0]['date'] ?? null),
            'sourceUrl' => 'https://cms/news',
            'sourceType' => 'json',
            'items' => $items,
            'fromCache' => false,
        ]);
    }

    if ($method === 'POST' || $method === 'PUT') {
        // Full feed replace — Admin only (or partner uses partner_news.php)
        require_admin();
        $body = json_body();
        $title = trim((string) ($body['title'] ?? ($kind === 'launcher' ? 'EG Launcher News' : 'EG Partner News')));
        $items = $body['items'] ?? [];
        if (!is_array($items)) {
            json_out(['ok' => false, 'error' => 'items must be array'], 400);
        }

        $pdo->beginTransaction();
        $pdo->prepare('DELETE FROM news_items WHERE feed_kind = ?')->execute([$kind]);
        $ins = $pdo->prepare(
            'INSERT INTO news_items (id, feed_kind, title, summary, body, published_at, tag, url, sort_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }
            $id = trim((string) ($item['id'] ?? ''));
            if ($id === '') {
                continue;
            }
            $dt = date('Y-m-d H:i:s', strtotime((string) ($item['date'] ?? 'now')) ?: time());
            $ins->execute([
                $id,
                $kind,
                mb_substr((string) ($item['title'] ?? 'Untitled'), 0, 512),
                $item['summary'] ?? null,
                $item['body'] ?? ($item['summary'] ?? null),
                $dt,
                mb_substr((string) ($item['tag'] ?? 'info'), 0, 128),
                $item['url'] ?? null,
                $dt,
            ]);
        }
        $pdo->prepare(
            'INSERT INTO feed_meta (feed_kind, title, updated_at) VALUES (?, ?, UTC_TIMESTAMP())
             ON DUPLICATE KEY UPDATE title = VALUES(title), updated_at = UTC_TIMESTAMP()'
        )->execute([$kind, mb_substr($title, 0, 256)]);
        $pdo->commit();
        json_out(['ok' => true, 'message' => 'Feed published', 'count' => count($items)]);
    }

    json_out(['ok' => false, 'error' => 'Method not allowed'], 405);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    json_out(['ok' => false, 'error' => $e->getMessage()], 500);
}
