<?php
/**
 * Public FAQ JSON for the Discord bot and third-party clients.
 * GET https://eg-launcher.xyz/faq/data.php
 */
require dirname(__DIR__) . '/lib/bootstrap.php';
require_once dirname(__DIR__) . '/lib/faq.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: public, max-age=300');

$items = eg_faq_items();
$out = [
    'source' => 'eg-launcher.xyz',
    'url' => rtrim((string) cfg('site_url', 'https://eg-launcher.xyz'), '/') . '/faq/',
    'discord' => (string) cfg('discord_url', 'https://discord.gg/qzkA3CBex5'),
    'updated' => gmdate('c'),
    'items' => array_map(static function (array $it): array {
        return [
            'id' => (string) $it['id'],
            'q' => (string) $it['q'],
            'a' => (string) $it['a'],
        ];
    }, $items),
];

echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
