<?php
/**
 * Shared EG Launcher FAQ — used by the website (/faq/) and public JSON (/faq/data.php)
 * for the Discord bot. Keep answers under ~1000 chars so Discord embed fields fit.
 *
 * @return list<array{id:string,q:string,a:string}>
 */
function eg_faq_items(): array
{
    $github = (string) cfg('github_url', 'https://github.com/YourLovelyFox/eg-launcher');
    $releases = (string) cfg('github_releases', $github . '/releases/latest');
    $store = (string) cfg('store_url', 'https://apps.microsoft.com/detail/9P32SFSJH9B1');
    $site = rtrim((string) cfg('site_url', 'https://eg-launcher.xyz'), '/');
    $discord = (string) cfg('discord_url', 'https://discord.gg/qzkA3CBex5');
    $info = (string) cfg('contact_email', 'info@eg-launcher.xyz');
    $abuse = (string) cfg('abuse_email', 'abuse@eg-launcher.xyz');

    return [
        [
            'id' => 'what-is',
            'q' => 'What is EG Launcher?',
            'a' => 'A modern **Minecraft: Java Edition** companion launcher — manage instances, browse/install community content (mods), Microsoft login, and launch Vanilla, Fabric, Forge, or NeoForge.',
        ],
        [
            'id' => 'why-choose',
            'q' => 'Why choose EG Launcher?',
            'a' =>
                "EG Launcher focuses on a clean workflow for Java Edition:\n" .
                "• **Open source** — code and builds on GitHub\n" .
                "• Dark glass-style UI with clear instance management\n" .
                "• Mod catalog browse & install (with dependencies)\n" .
                "• Loaders: **Vanilla, Fabric, Forge, NeoForge**\n" .
                "• **Microsoft login** (device code) plus offline accounts where configured\n" .
                "• Auto **Mojang JRE** when a version needs a newer runtime\n" .
                "• Enable / disable / remove mods and update checks\n" .
                "• Featured packs & partners, in-app news\n" .
                "• **Linux AppImage** (GitHub) · **Windows** via Microsoft Store\n\n" .
                "Source: {$github}",
        ],
        [
            'id' => 'download',
            'q' => 'Where do I download it?',
            'a' =>
                "**Linux:** AppImage from GitHub Releases — {$releases}\n" .
                "**Windows:** Microsoft Store — {$store}\n" .
                "Always use official links only (website, GitHub, or this Discord).",
        ],
        [
            'id' => 'no-setup-exe',
            'q' => 'Why is there no Windows setup.exe on GitHub?',
            'a' =>
                'Windows GitHub installers were discontinued because of Smart App Control / SmartScreen false positives. ' .
                'The official Windows path is the **Microsoft Store**. Do not use third-party setups claiming to be EG Launcher.',
        ],
        [
            'id' => 'website',
            'q' => 'What is on the website?',
            'a' =>
                "{$site} — news, community forum, downloads, FAQ, and a contact form.\n" .
                "• News: {$site}/news/\n" .
                "• Forum: {$site}/forum/\n" .
                "• Contact: {$site}/contact/\n" .
                "• FAQ: {$site}/faq/",
        ],
        [
            'id' => 'discord',
            'q' => 'Where is the Discord server?',
            'a' =>
                "Official community & support: {$discord}\n" .
                'Use ❓・faq, ⬇️・download, or open a ticket in 🎫・create-ticket for private help. ' .
                "Also run `/faq` in Discord for these answers.",
        ],
        [
            'id' => 'contact',
            'q' => 'How do I contact the team by email?',
            'a' =>
                "Use the web form at {$site}/contact/ (recommended — you get a confirmation with an inquiry number).\n" .
                "• General: {$info}\n" .
                "• Abuse / reports: {$abuse}\n" .
                "• Automated confirmations come from testemail@eg-launcher.xyz — that is a **no-reply** mailbox; do not reply there.",
        ],
        [
            'id' => 'ticket',
            'q' => 'How do I open a support ticket (Discord)?',
            'a' =>
                'Go to 🎫・create-ticket and use the button, or run `/ticket open`. ' .
                'One ticket per issue. Include EG Launcher version, OS, steps to reproduce, and logs/screenshots when possible.',
        ],
        [
            'id' => 'bug-report',
            'q' => 'What info should a bug report include?',
            'a' =>
                'EG Launcher **version**, **OS** (Windows/Linux), steps to reproduce, expected vs actual result, ' .
                'and screenshots or logs if available. Post in 🐛・bug-reports or open a ticket.',
        ],
        [
            'id' => 'news',
            'q' => 'Where is launcher news posted?',
            'a' =>
                "Website: {$site}/news/\n" .
                'Discord: 📰・launcher-news and 📢・announcements (bot watches GitHub news feed and releases). ' .
                'News also appears in the launcher app.',
        ],
        [
            'id' => 'offline',
            'q' => 'Are there offline / guest limits?',
            'a' =>
                'Offline (cracked-style) play is limited by design: typically **2 instances** and **10 primary mods** ' .
                '(dependency mods do not count toward that cap). Microsoft accounts do not use those offline caps. ' .
                'Exact limits can change with launcher updates.',
        ],
        [
            'id' => 'microsoft-login',
            'q' => 'Microsoft sign-in says “Not signed in” or shows Prism?',
            'a' =>
                'EG Launcher uses the device-code Microsoft flow. The browser may show the OAuth app name ' .
                '(historically shared as Prism-style) while you approve the code — that is expected during login. ' .
                'Finish the browser step, return to the launcher, and wait for the account to refresh. ' .
                'If it still fails, retry once or open a ticket with OS + launcher version.',
        ],
        [
            'id' => 'privacy',
            'q' => 'Where is the privacy policy?',
            'a' =>
                (string) cfg(
                    'privacy_url',
                    'https://github.com/YourLovelyFox/eg-launcher/blob/master/PRIVACY.md'
                ) .
                "\nContact: {$info} · Abuse: {$abuse}",
        ],
    ];
}

/**
 * Markdown-ish **bold** → HTML for the website.
 */
function eg_faq_format_answer(string $text): string
{
    $html = e($text);
    $html = preg_replace('/\*\*(.+?)\*\*/s', '<strong>$1</strong>', $html) ?? $html;
    // Autolink plain URLs
    $html = preg_replace(
        '#(https?://[^\s<]+)#',
        '<a href="$1" target="_blank" rel="noopener">$1</a>',
        $html
    ) ?? $html;
    return nl2br($html, false);
}
