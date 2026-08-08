<?php
require __DIR__ . '/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$kind = $_GET['kind'] ?? 'launcher';
if ($kind !== 'launcher' && $kind !== 'partners') {
    json_fail('Invalid kind', 400);
}

try {
    $pdo = db();
    ensure_news_author_schema($pdo);

    if ($method === 'GET') {
        $tag = isset($_GET['tag']) ? trim((string) $_GET['tag']) : '';
        $meta = $pdo->prepare('SELECT title, updated_at FROM feed_meta WHERE feed_kind = ? LIMIT 1');
        $meta->execute([$kind]);
        $m = $meta->fetch() ?: ['title' => $kind === 'launcher' ? 'EG Launcher News' : 'EG Partner News', 'updated_at' => null];

        if ($tag !== '') {
            $stmt = $pdo->prepare(
                'SELECT id, title, summary, body, published_at, tag, url, author_username, author_staff_id
                 FROM news_items WHERE feed_kind = ? AND LOWER(tag) = LOWER(?)
                 ORDER BY sort_date DESC LIMIT 100'
            );
            $stmt->execute([$kind, $tag]);
        } else {
            $stmt = $pdo->prepare(
                'SELECT id, title, summary, body, published_at, tag, url, author_username, author_staff_id
                 FROM news_items WHERE feed_kind = ?
                 ORDER BY sort_date DESC LIMIT 100'
            );
            $stmt->execute([$kind]);
        }
        $items = [];
        foreach ($stmt->fetchAll() as $row) {
            $author = news_author_public($row['author_username'] ?? null);
            $items[] = [
                'id' => $row['id'],
                'title' => $row['title'],
                'summary' => $row['summary'],
                'body' => $row['body'],
                'date' => iso_date($row['published_at']),
                'tag' => $row['tag'] ?: 'info',
                'url' => $row['url'] !== null && $row['url'] !== '' ? $row['url'] : null,
                'authorUsername' => $author['authorUsername'],
                'authorLabel' => $author['authorLabel'],
                'isFounder' => $author['isFounder'],
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
        require_admin();
        $body = json_body();
        $title = trim((string) ($body['title'] ?? ($kind === 'launcher' ? 'EG Launcher News' : 'EG Partner News')));
        $items = $body['items'] ?? [];
        if (!is_array($items)) {
            json_fail('items must be array', 400);
        }
        // Empty array is valid — full feed replace / delete all posts
        if (count($items) > 200) {
            json_fail('Too many items (max 200)', 400);
        }

        // Prefer author from payload; fall back to staff session publisher
        $publisherUser = null;
        $publisherStaffId = null;
        try {
            $sess = staff_session_validate_and_touch();
            if (is_array($sess)) {
                $publisherUser = (string) ($sess['username'] ?? '');
                $publisherStaffId = (string) ($sess['id'] ?? '');
            }
        } catch (Throwable) {
            /* optional */
        }

        $pdo->beginTransaction();
        $pdo->prepare('DELETE FROM news_items WHERE feed_kind = ?')->execute([$kind]);
        $ins = $pdo->prepare(
            'INSERT INTO news_items (id, feed_kind, title, summary, body, published_at, tag, url, sort_date, author_username, author_staff_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $inserted = 0;
        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }
            $id = trim((string) ($item['id'] ?? ''));
            if ($id === '' || strlen($id) > 128) {
                continue;
            }
            $titleItem = trim((string) ($item['title'] ?? ''));
            // Skip blank titles (client may send drafts); empty feed still allowed
            if ($titleItem === '') {
                continue;
            }
            $ts = strtotime((string) ($item['date'] ?? 'now'));
            if ($ts === false) {
                $ts = time();
            }
            $dt = gmdate('Y-m-d H:i:s', $ts);
            $url = $item['url'] ?? null;
            if (is_string($url) && $url !== '') {
                if (!preg_match('#^https?://#i', $url)) {
                    $url = null;
                }
            } else {
                $url = null;
            }
            $authorIn = trim((string) ($item['authorUsername'] ?? $item['author_username'] ?? ''));
            if ($authorIn === '' && $publisherUser) {
                $authorIn = $publisherUser;
            }
            $author = news_author_public($authorIn !== '' ? $authorIn : null);
            $staffId = trim((string) ($item['authorStaffId'] ?? $item['author_staff_id'] ?? ''));
            if ($staffId === '' && $publisherStaffId && strcasecmp($author['authorUsername'], (string) $publisherUser) === 0) {
                $staffId = $publisherStaffId;
            }
            $ins->execute([
                $id,
                $kind,
                mb_substr($titleItem, 0, 512),
                $item['summary'] ?? null,
                $item['body'] ?? ($item['summary'] ?? null),
                $dt,
                mb_substr((string) ($item['tag'] ?? 'info'), 0, 128),
                $url,
                $dt,
                $author['authorUsername'],
                $staffId !== '' ? $staffId : null,
            ]);
            $inserted++;
        }
        $pdo->prepare(
            'INSERT INTO feed_meta (feed_kind, title, updated_at) VALUES (?, ?, UTC_TIMESTAMP())
             ON DUPLICATE KEY UPDATE title = VALUES(title), updated_at = UTC_TIMESTAMP()'
        )->execute([$kind, mb_substr($title, 0, 256)]);
        $pdo->commit();
        json_out([
            'ok' => true,
            'message' => $inserted === 0 ? 'Feed cleared (0 posts)' : 'Feed published',
            'count' => $inserted,
        ]);
    }

    json_fail('Method not allowed', 405);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    json_fail('Server error', 500, $e);
}

/** Founder of EG Launcher (staff username Bee). */
function news_founder_username(): string
{
    return 'Bee';
}

/**
 * @return array{authorUsername:string,authorLabel:string,isFounder:bool}
 */
function news_author_public(?string $username): array
{
    $u = trim((string) $username);
    if ($u === '') {
        $u = news_founder_username();
    }
    $founder = news_founder_username();
    $isFounder = strcasecmp($u, $founder) === 0;
    return [
        'authorUsername' => $u,
        'authorLabel' => $isFounder ? ($founder . ' · Founder') : $u,
        'isFounder' => $isFounder,
    ];
}

function ensure_news_author_schema(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    foreach (
        [
            'ALTER TABLE news_items ADD COLUMN author_username VARCHAR(64) NULL',
            'ALTER TABLE news_items ADD COLUMN author_staff_id VARCHAR(64) NULL',
        ] as $sql
    ) {
        try {
            $pdo->exec($sql);
        } catch (Throwable) {
            /* exists */
        }
    }
    // Legacy posts without author → Bee (founder)
    try {
        $pdo->exec(
            "UPDATE news_items SET author_username = 'Bee'
             WHERE author_username IS NULL OR TRIM(author_username) = ''"
        );
    } catch (Throwable) {
    }
}
