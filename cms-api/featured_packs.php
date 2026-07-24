<?php
/**
 * Featured modpacks list (public GET) + admin CRUD.
 */
require __DIR__ . '/bootstrap.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? ($method === 'GET' ? 'list' : 'upsert');

try {
    $pdo = db();
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

    // Seed Bee's SMP if empty
    $n = (int) $pdo->query('SELECT COUNT(*) c FROM featured_packs')->fetch()['c'];
    if ($n === 0) {
        $pdo->prepare(
            'INSERT INTO featured_packs
              (id, slug, project_id, title, description, menu_label, min_system_ram_gb, recommended_ram_mb, enabled, sort_order)
             VALUES (?,?,?,?,?,?,?,?,1,0)'
        )->execute([
            'beessmp',
            'beessmp',
            'kPorHsl4',
            "Bee's SMP",
            'Heavy tech modpack with custom world generation, Leaving Earth, and space exploration.',
            "Bee's SMP",
            12,
            8192,
        ]);
    }

    if ($method === 'GET') {
        $all = isset($_GET['all']) && $_GET['all'] === '1';
        if ($all) {
            require_admin();
            $stmt = $pdo->query('SELECT * FROM featured_packs ORDER BY sort_order ASC, title ASC');
        } else {
            $stmt = $pdo->query(
                'SELECT * FROM featured_packs WHERE enabled = 1 ORDER BY sort_order ASC, title ASC'
            );
        }
        $packs = [];
        foreach ($stmt->fetchAll() as $r) {
            $packs[] = map_pack($r);
        }
        json_out(['ok' => true, 'packs' => $packs]);
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
            $pdo->prepare('DELETE FROM featured_packs WHERE id = ?')->execute([$id]);
            json_out(['ok' => true, 'message' => 'Deleted']);
        }

        $id = trim((string) ($body['id'] ?? ''));
        $slug = trim((string) ($body['slug'] ?? ''));
        $projectId = trim((string) ($body['projectId'] ?? $body['project_id'] ?? ''));
        $title = trim((string) ($body['title'] ?? ''));
        if ($slug === '' || $projectId === '' || $title === '') {
            json_fail('slug, projectId, and title required', 400);
        }
        if ($id === '') {
            $id = preg_replace('/[^a-z0-9-]+/i', '-', strtolower($slug)) ?: ('fp-' . bin2hex(random_bytes(4)));
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
            $slug,
            $projectId,
            $title,
            trim((string) ($body['description'] ?? '')),
            trim((string) ($body['menuLabel'] ?? $title)),
            (int) ($body['minSystemRamGb'] ?? 8),
            (int) ($body['recommendedAllocatedMb'] ?? $body['recommended_ram_mb'] ?? 4096),
            $body['iconUrl'] ?? null,
            isset($body['enabled']) ? ((int) (bool) $body['enabled']) : 1,
            (int) ($body['sortOrder'] ?? 0),
        ]);
        $row = $pdo->prepare('SELECT * FROM featured_packs WHERE id = ?');
        $row->execute([$id]);
        json_out(['ok' => true, 'pack' => map_pack($row->fetch()), 'message' => 'Saved']);
    }

    json_fail('Method not allowed', 405);
} catch (Throwable $e) {
    json_fail('Server error', 500, $e);
}

function map_pack(array $r): array
{
    return [
        'id' => $r['id'],
        'slug' => $r['slug'],
        'projectId' => $r['project_id'],
        'title' => $r['title'],
        'description' => $r['description'] ?? '',
        'menuLabel' => $r['menu_label'],
        'minSystemRamGb' => (int) $r['min_system_ram_gb'],
        'recommendedAllocatedMb' => (int) $r['recommended_ram_mb'],
        'iconUrl' => $r['icon_url'] ?? null,
        'enabled' => (bool) $r['enabled'],
        'sortOrder' => (int) $r['sort_order'],
    ];
}
