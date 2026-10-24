<?php
/**
 * Shared EG Launcher FAQ — used by the website (/faq/) and public JSON (/faq/data.php)
 * for the Discord bot. Keep answers under ~1000 chars so Discord embed fields fit.
 *
 * @return list<array{id:string,q:string,a:string}>
 */
function eg_faq_items(?string $lang = null): array
{
    $lang = $lang ?? (function_exists('current_lang') ? current_lang() : 'en');
    $github = (string) cfg('github_url', 'https://github.com/YourLovelyFox/eg-launcher');
    $releases = (string) cfg('github_releases', $github . '/releases');
    $site = rtrim((string) cfg('site_url', 'https://eg-launcher.xyz'), '/');
    $discord = (string) cfg('discord_url', 'https://discord.gg/qzkA3CBex5');
    $info = (string) cfg('contact_email', 'info@eg-launcher.xyz');
    $abuse = (string) cfg('abuse_email', 'abuse@eg-launcher.xyz');

    $en = [
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
                "• Signed **Windows installer** and **Linux AppImage** on GitHub\n\n" .
                "Source: {$github}",
        ],
        [
            'id' => 'download',
            'q' => 'Where do I download it?',
            'a' =>
                "**Windows:** signed installer (`setup.exe`) from GitHub Releases.\n" .
                "**Linux:** AppImage from the same page — make it executable, then run it.\n" .
                "Downloads: {$releases}\n" .
                "Always use official links only (website, GitHub, or this Discord).",
        ],
        [
            'id' => 'no-setup-exe',
            'q' => 'Is the Windows installer signed?',
            'a' =>
                'Yes. The Windows `setup.exe` is signed with Azure Trusted Signing (publisher **Egyéni Vállalkozás**). ' .
                'SmartScreen may still warn for a while after a new release. ' .
                "Get it from GitHub Releases ({$releases}). Do not use third-party setups claiming to be EG Launcher.",
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
                '(dependency mods do not count toward that cap). Featured packs in the launcher can be installed and ' .
                'played with Microsoft or offline accounts, and they do not count toward those caps. ' .
                'Microsoft accounts do not use those offline caps. Exact limits can change with launcher updates.',
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

    if ($lang !== 'hu') {
        return $en;
    }

    $hu = [
        'what-is' => [
            'q' => 'Mi az EG Launcher?',
            'a' => 'Modern **Minecraft: Java Edition** kísérő launcher — példányok kezelése, közösségi tartalom (modok) böngészése/telepítése, Microsoft belépés, Vanilla, Fabric, Forge vagy NeoForge indítás.',
        ],
        'why-choose' => [
            'q' => 'Miért az EG Launcher?',
            'a' =>
                "Az EG Launcher tiszta Java Edition munkafolyamatot ad:\n" .
                "• **Nyílt forrás** — kód és buildek GitHubon\n" .
                "• Sötét üveges UI, átlátható példánykezelés\n" .
                "• Modkatalógus böngészés és telepítés (függőségekkel)\n" .
                "• Loaderok: **Vanilla, Fabric, Forge, NeoForge**\n" .
                "• **Microsoft belépés** (eszközkód) plusz offline fiókok, ha be van állítva\n" .
                "• Automatikus **Mojang JRE**, ha egy verzió újabb futtatóközeget kér\n" .
                "• Modok ki/be, törlés, frissítésellenőrzés\n" .
                "• Kiemelt packek és partnerek, in-app hírek\n" .
                "• Aláírt **Windows telepítő** és **Linux AppImage** a GitHubon\n\n" .
                "Forrás: {$github}",
        ],
        'download' => [
            'q' => 'Honnan tölthetem le?',
            'a' =>
                "**Windows:** aláírt telepítő (`setup.exe`) a GitHub Releasesről.\n" .
                "**Linux:** AppImage ugyanarról az oldalról — tedd futtathatóvá, majd indítsd.\n" .
                "Letöltések: {$releases}\n" .
                "Csak hivatalos linkeket használj (weboldal, GitHub vagy ez a Discord).",
        ],
        'no-setup-exe' => [
            'q' => 'Alá van írva a Windows telepítő?',
            'a' =>
                'Igen. A Windows `setup.exe` Azure Trusted Signing aláírással készül (kiadó: **Egyéni Vállalkozás**). ' .
                'A SmartScreen egy ideig még figyelmeztethet új kiadás után. ' .
                "Innen: GitHub Releases ({$releases}). Ne használj harmadik féltől származó, EG Launchernek kiadott telepítőket.",
        ],
        'website' => [
            'q' => 'Mi van a weboldalon?',
            'a' =>
                "{$site} — hírek, közösségi fórum, letöltések, GYIK és kapcsolati űrlap.\n" .
                "• Hírek: {$site}/news/\n" .
                "• Fórum: {$site}/forum/\n" .
                "• Kapcsolat: {$site}/contact/\n" .
                "• GYIK: {$site}/faq/",
        ],
        'discord' => [
            'q' => 'Hol a Discord szerver?',
            'a' =>
                "Hivatalos közösség és support: {$discord}\n" .
                'Használd a ❓・faq, ⬇️・download csatornákat, vagy nyiss ticketet a 🎫・create-ticketben. ' .
                "Discordon a `/faq` is ezeket a válaszokat adja.",
        ],
        'contact' => [
            'q' => 'Hogyan írok a csapatnak e-mailben?',
            'a' =>
                "A webes űrlap: {$site}/contact/ (ajánlott — visszaigazolást kapsz ügyazonosítóval).\n" .
                "• Általános: {$info}\n" .
                "• Visszaélés: {$abuse}\n" .
                "• Az automatikus visszaigazolás a testemail@eg-launcher.xyz címről jön — ez **no-reply**, ne válaszolj oda.",
        ],
        'ticket' => [
            'q' => 'Hogyan nyitok support ticketet (Discord)?',
            'a' =>
                'Menj a 🎫・create-ticketre és használd a gombot, vagy írd: `/ticket open`. ' .
                'Egy ticket = egy ügy. Írd bele az EG Launcher verziót, OS-t, reprodukálási lépéseket, logot/képernyőképet, ha van.',
        ],
        'bug-report' => [
            'q' => 'Mit tartalmazzon egy hibajelentés?',
            'a' =>
                'EG Launcher **verzió**, **OS** (Windows/Linux), reprodukálási lépések, várt vs. tényleges eredmény, ' .
                'képernyőkép vagy log, ha van. Posztold a 🐛・bug-reportsbe, vagy nyiss ticketet.',
        ],
        'news' => [
            'q' => 'Hol jelennek meg a launcher hírek?',
            'a' =>
                "Weboldal: {$site}/news/\n" .
                'Discord: 📰・launcher-news és 📢・announcements (a bot figyeli a GitHub hírfolyamot és a kiadásokat). ' .
                'A hírek a launcher appban is megjelennek.',
        ],
        'offline' => [
            'q' => 'Vannak offline / vendég korlátok?',
            'a' =>
                'Az offline (cracked-szerű) játék szándékosan korlátos: általában **2 példány** és **10 elsődleges mod** ' .
                '(a függőség-modok nem számítanak). A launcher kiemelt modpackjei Microsoft és offline fiókkal is ' .
                'telepíthetők és játszhatók, és nem számítanak ezekbe a korlátokba. ' .
                'Microsoft fiókra ezek a sapkák nem vonatkoznak. A pontos számok launcher-frissítéssel változhatnak.',
        ],
        'microsoft-login' => [
            'q' => 'A Microsoft belépés „Not signed in”, vagy Prismot mutat?',
            'a' =>
                'Az EG Launcher eszközkódos Microsoft folyamatot használ. A böngésző mutathatja az OAuth app nevét ' .
                '(korábban Prism-stílusú név) amíg jóváhagyod a kódot — ez belépéskor várható. ' .
                'Fejezd be a böngészős lépést, térj vissza a launcherbe, és várd meg a fiók frissülését. ' .
                'Ha még mindig elhasal, próbáld újra, vagy nyiss ticketet OS + launcher verzióval.',
        ],
        'privacy' => [
            'q' => 'Hol az adatvédelmi irányelv?',
            'a' =>
                (string) cfg(
                    'privacy_url',
                    'https://github.com/YourLovelyFox/eg-launcher/blob/master/PRIVACY.md'
                ) .
                "\nKapcsolat: {$info} · Visszaélés: {$abuse}",
        ],
    ];

    foreach ($en as $i => $item) {
        $id = (string) $item['id'];
        if (isset($hu[$id])) {
            $en[$i]['q'] = $hu[$id]['q'];
            $en[$i]['a'] = $hu[$id]['a'];
        }
    }
    return $en;
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
