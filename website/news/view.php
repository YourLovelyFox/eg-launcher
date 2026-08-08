<?php
require dirname(__DIR__) . '/lib/bootstrap.php';

$id = trim((string) ($_GET['id'] ?? ''));
if ($id === '') {
    redirect('/news/');
}

$item = null;
try {
    try {
        db()->exec('ALTER TABLE news_items ADD COLUMN author_username VARCHAR(64) NULL');
    } catch (Throwable) {
    }
    $st = db()->prepare(
        "SELECT id, title, summary, body, published_at, tag, url, author_username
         FROM news_items WHERE feed_kind = 'launcher' AND id = ? LIMIT 1"
    );
    $st->execute([$id]);
    $row = $st->fetch();
    if ($row) {
        $author = news_author_public($row['author_username'] ?? null);
        $item = [
            'id' => $row['id'],
            'title' => $row['title'],
            'summary' => $row['summary'] ?? '',
            'body' => $row['body'] ?? '',
            'date' => $row['published_at'],
            'tag' => $row['tag'] ?: 'info',
            'url' => $row['url'] ?: null,
            'authorUsername' => $author['authorUsername'],
            'authorLabel' => $author['authorLabel'],
            'isFounder' => $author['isFounder'],
        ];
    }
} catch (Throwable) {
    // ignore
}

if (!$item) {
    foreach (load_news_items(100) as $n) {
        if ((string) $n['id'] === $id) {
            $item = $n;
            break;
        }
    }
}

if (!$item) {
    http_response_code(404);
    layout_header('Not found', 'news');
    echo '<div class="panel"><h1>Post not found</h1><p class="hint"><a href="/news/">← Back to news</a></p></div>';
    layout_footer();
    exit;
}

layout_header((string) $item['title'], 'news');
?>
<article class="article panel">
  <p class="hint"><a href="/news/">← News</a></p>
  <div class="kicker"><?= e((string) $item['tag']) ?></div>
  <h1><?= e((string) $item['title']) ?></h1>
  <p class="meta muted">
    <?= e(format_dt((string) $item['date'])) ?>
    · by
    <?= render_news_author_html(
        $item['authorUsername'] ?? null,
        $item['authorLabel'] ?? null,
        $item['isFounder'] ?? null
    ) ?>
  </p>
  <?php if (!empty($item['summary'])): ?>
    <p class="hint" style="margin-top: 12px; font-size: 15px;"><?= e((string) $item['summary']) ?></p>
  <?php endif; ?>
  <div class="body">
    <?php
    $body = (string) ($item['body'] ?? '');
    // Staff news may be HTML — only allow a small tag set
    if ($body !== '' && preg_match('/<\s*(p|br|strong|em|a|ul|ol|li|h[1-6]|span)\b/i', $body)) {
        $safe = strip_tags($body, '<p><br><br/><strong><b><em><i><a><ul><ol><li><h1><h2><h3><h4><span>');
        $safe = preg_replace_callback(
            '/<a\s+[^>]*href=(["\'])(.*?)\1[^>]*>/i',
            static function ($m) {
                $href = $m[2];
                if (!preg_match('#^https?://#i', $href)) {
                    return '<a href="#">';
                }
                return '<a href="' . e($href) . '" target="_blank" rel="noopener noreferrer">';
            },
            $safe
        );
        echo $safe;
    } else {
        echo format_body($body !== '' ? $body : (string) ($item['summary'] ?? ''));
    }
    ?>
  </div>
  <?php if (!empty($item['url'])): ?>
    <p style="margin-top: 18px;"><a class="btn btn-secondary" href="<?= e((string) $item['url']) ?>" target="_blank" rel="noopener">Open link</a></p>
  <?php endif; ?>
</article>
<?php layout_footer(); ?>
