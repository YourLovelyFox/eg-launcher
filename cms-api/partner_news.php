<?php
/** Partner publishes only their tagged posts (session required). */
require __DIR__ . '/lib/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_out(['ok' => false, 'error' => 'POST required'], 405);
}

try {
    $session = require_partner_session();
    $tag = (string) $session['news_tag'];
    $body = json_body();
    $items = $body['items'] ?? [];
    if (!is_array($items)) {
        json_out(['ok' => false, 'error' => 'items array required'], 400);
    }

    $pdo = db();
    // Load existing non-matching tags
    $stmt = $pdo->prepare(
        'SELECT id, title, summary, body, published_at, tag, url FROM news_items
         WHERE feed_kind = ? AND LOWER(tag) <> LOWER(?)'
    );
    $stmt->execute(['partners', $tag]);
    $others = $stmt->fetchAll();

    $pdo->beginTransaction();
    $pdo->prepare('DELETE FROM news_items WHERE feed_kind = ?')->execute(['partners']);
    $ins = $pdo->prepare(
        'INSERT INTO news_items (id, feed_kind, title, summary, body, published_at, tag, url, sort_date)
         VALUES (?,?,?,?,?,?,?,?,?)'
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
            'partners',
            mb_substr((string) ($item['title'] ?? 'Untitled'), 0, 512),
            $item['summary'] ?? null,
            $item['body'] ?? ($item['summary'] ?? null),
            $dt,
            $tag,
            $item['url'] ?? null,
            $dt,
        ]);
    }
    foreach ($others as $row) {
        $dt = $row['published_at'] ?: date('Y-m-d H:i:s');
        $ins->execute([
            $row['id'],
            'partners',
            $row['title'],
            $row['summary'],
            $row['body'],
            $dt,
            $row['tag'],
            $row['url'],
            $dt,
        ]);
    }
    $pdo->prepare(
        "INSERT INTO feed_meta (feed_kind, title, updated_at) VALUES ('partners', 'EG Partner News', UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE updated_at = UTC_TIMESTAMP()"
    )->execute();
    $pdo->commit();

    json_out(['ok' => true, 'message' => 'Partner news published']);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    json_out(['ok' => false, 'error' => $e->getMessage()], 500);
}
