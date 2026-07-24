<?php
/**
 * Public site homepage — required for Google AdSense site verification.
 * Includes the AdSense code snippet in <head> so Google can crawl it.
 */
$ADSENSE_CLIENT = 'ca-pub-5720902457622957';
header('Content-Type: text/html; charset=utf-8');
header('X-Content-Type-Options: nosniff');
?><!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>EG Launcher</title>
  <!-- Google AdSense site verification / ads code -->
  <script async
    src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=<?php echo htmlspecialchars($ADSENSE_CLIENT, ENT_QUOTES, 'UTF-8'); ?>"
    crossorigin="anonymous"></script>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      font-family: system-ui, Segoe UI, sans-serif;
      background: #0b0e14;
      color: #f4f7fb;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .card {
      max-width: 520px;
      padding: 28px;
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,.1);
      background: rgba(22,26,36,.9);
    }
    h1 { font-size: 1.4rem; margin: 0 0 8px; }
    p { color: #a8b0c0; line-height: 1.5; margin: 0 0 12px; }
    a { color: #3dffb0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>EG Launcher</h1>
    <p>Official site for EG Launcher CMS and ad units.</p>
    <p>
      <a href="https://github.com/YourLovelyFox/eg-launcher">Download / releases</a>
    </p>
  </div>
</body>
</html>
