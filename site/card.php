<?php
/*
 * Public card images: the QR code on a printed card's back points to card.php?id=<id>,
 * which returns that card as a JPG. Images are uploaded by the Director's browser through
 * sync.php (card_put, needs a sync key). Ids are 22 random-looking characters derived from
 * the uploader's private key, so they can't be guessed or listed.
 *
 * Counts views per day in .vanadium-data/cards/stats.php (shown to the server owner on the
 * Sync page), so you can keep an eye on traffic.
 */
const GUARD = "<?php http_response_code(404); exit; ?>\n";
header('X-Content-Type-Options: nosniff');

function missing(): void {
    http_response_code(404); header('Content-Type: text/plain; charset=utf-8');
    echo "This card image isn't available (any more).\n"; exit;
}

$id = $_GET['id'] ?? '';
if (!is_string($id) || !preg_match('/^[A-Za-z0-9_-]{22}$/', $id)) missing();
$dir = __DIR__ . '/.vanadium-data/cards';
$s = @file_get_contents("$dir/$id.php");
if ($s === false || strncmp($s, GUARD, strlen(GUARD)) !== 0) missing();

$etag = '"' . $id . '"';
header('Cache-Control: public, max-age=86400');   // a day; the id always means the same picture
header('ETag: ' . $etag);
if (trim($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) { http_response_code(304); exit; }

$jpg = substr($s, strlen(GUARD));
header('Content-Type: image/jpeg');
header('Content-Disposition: inline; filename="vanadium-card.jpg"');
header('Content-Length: ' . strlen($jpg));
echo $jpg;

// ---- daily view counter (best effort: skipped if another request holds the lock) ----
$sf = "$dir/stats.php";
if ($fp = @fopen("$sf.lock", 'c')) {
    if (flock($fp, LOCK_EX | LOCK_NB)) {
        $raw = @file_get_contents($sf);
        $st = ($raw !== false && strncmp($raw, GUARD, strlen(GUARD)) === 0) ? json_decode(substr($raw, strlen(GUARD)), true) : [];
        if (!is_array($st)) $st = [];
        $day = date('Y-m-d');
        $st[$day] = [($st[$day][0] ?? 0) + 1, ($st[$day][1] ?? 0) + strlen($jpg)];
        $cut = date('Y-m-d', time() - 90 * 86400);
        foreach (array_keys($st) as $d) if ($d < $cut) unset($st[$d]);   // keep 90 days
        @file_put_contents($sf, GUARD . json_encode($st));
        flock($fp, LOCK_UN);
    }
    fclose($fp);
}
