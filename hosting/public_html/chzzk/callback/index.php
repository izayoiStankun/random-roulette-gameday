<?php
declare(strict_types=1);

header('Cache-Control: no-store, max-age=0');
header('Pragma: no-cache');
header('Referrer-Policy: no-referrer');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");

function query_value(string $name): string {
    $value = $_GET[$name] ?? '';
    return is_string($value) ? trim($value) : '';
}

$code = query_value('code');
$state = query_value('state');
$validCode = $code !== '' && strlen($code) <= 2048 && !preg_match('/[\x00-\x1F\x7F]/', $code);
$validState = preg_match('/^[a-f0-9]{48}$/', $state) === 1;
$ok = $validCode && $validState;
$localUrl = $ok
    ? 'http://127.0.0.1:17554/oauth/callback?' . http_build_query(
        ['code' => $code, 'state' => $state],
        '',
        '&',
        PHP_QUERY_RFC3986
    )
    : '';
?>
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>치지직 연결</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #071019; color: #f1fffb; }
    main { width: min(560px, calc(100% - 40px)); padding: 36px; border: 1px solid #254657; border-radius: 16px; background: #0d1a24; text-align: center; }
    p { color: #b3c9d4; line-height: 1.7; }
    a { display: inline-block; margin-top: 12px; padding: 13px 18px; border-radius: 9px; background: #20e7b3; color: #071019; font-weight: 800; text-decoration: none; }
  </style>
</head>
<body>
  <main>
    <?php if ($ok): ?>
      <h1>치지직 승인이 완료되었습니다</h1>
      <p>랜덤룰렛게임데이 앱이 실행 중인 PC에서 아래 버튼을 눌러 연결을 마무리해 주세요.</p>
      <a href="<?= htmlspecialchars($localUrl, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?>">앱으로 돌아가기</a>
    <?php else: ?>
      <h1>인증 응답을 확인할 수 없습니다</h1>
      <p>앱에서 치지직 연결을 다시 시작해 주세요. 이 페이지에는 인증 정보가 저장되지 않습니다.</p>
    <?php endif; ?>
  </main>
</body>
</html>
