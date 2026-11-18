<?php
/*
 * Vanadium sync server (PHP). Keeps app data and imported books in step across devices.
 *
 * Every sync key owns a private "space". The data lives in .vanadium-data/ inside the
 * web root (shared hosts often have nothing above it), protected three ways:
 *   1. .htaccess denies all web access to the folder (Apache / LiteSpeed),
 *   2. every data file is a .php file that exits immediately if requested directly,
 *   3. a space's folder name is sha256(key), so it can't be guessed or listed.
 * Data from one key is never readable with another key.
 *
 * The first key ever created on a server becomes the owner. After that new keys can only
 * be created if the owner allows it (so strangers can't fill the disk).
 * Lost the owner key? Delete .vanadium-data/config.php via FTP to reset ownership.
 *
 * API: sync.php?a=<action>, key in the X-Sync-Key header.
 *   POST create                  → {key}
 *   GET  state&since=<rev>       → {rev, items:{k:{t,v}}, packs:{id:meta}, owner, open, usage, quota}
 *   POST put  {items:{k:{t,v}}}  → {rev, rejected:{k:{t,v}}}  (last write wins by t)
 *   POST pack_chunk&id&n (body = raw bytes)
 *   POST pack_done {id,title,t,chunks,size}
 *   GET  pack_chunk&id&n         → raw bytes
 *   POST pack_del {id,t}
 *   POST rotate                  → {key}   (new key, same data; old key stops working)
 *   POST setopen {open}          (owner only)
 */

const QUOTA = 1024 * 1024 * 1024;   // bytes per space
const CHUNK_MAX = 4 * 1024 * 1024;  // client sends 1 MB chunks
const FAIL_LIMIT = 30;              // unknown-key attempts per IP per 15 minutes
const CREATE_LIMIT = 5;             // new spaces per IP per day (only when the owner allows others)
const JF = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE;
const GUARD = "<?php http_response_code(404); exit; ?>\n";

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$DATA = __DIR__ . '/.vanadium-data';

function fail(int $code, string $msg): void { http_response_code($code); header('Content-Type: application/json'); echo json_encode(['error' => $msg]); exit; }
function ok(array $r): void { header('Content-Type: application/json'); echo json_encode($r, JF); exit; }

// ---- guarded file helpers: GUARD prefix + payload ----
function gread(string $f): ?string {
    $s = @file_get_contents($f);
    if ($s === false) return null;
    return strncmp($s, GUARD, strlen(GUARD)) === 0 ? substr($s, strlen(GUARD)) : null;
}
function gwrite(string $f, string $data): void {
    $tmp = $f . '.tmp' . bin2hex(random_bytes(3));
    if (file_put_contents($tmp, GUARD . $data) === false || !rename($tmp, $f)) { @unlink($tmp); fail(500, 'cannot write sync data (is the folder writable by PHP?)'); }
}
function jread(string $f): array { $j = json_decode((string)gread($f), true); return is_array($j) ? $j : []; }
function jwrite(string $f, array $j): void { gwrite($f, json_encode($j, JF)); }
// lock a file for the rest of the request (released automatically on exit)
function lock(string $f) { $fp = fopen($f . '.lock', 'c'); if (!$fp || !flock($fp, LOCK_EX)) fail(500, 'cannot lock'); return $fp; }

function ensure_data_dir(string $DATA): void {
    if (!is_dir($DATA) && !@mkdir($DATA, 0700, true)) fail(500, 'cannot create .vanadium-data (is the folder writable by PHP?)');
    if (!is_file("$DATA/.htaccess"))
        file_put_contents("$DATA/.htaccess", "# Vanadium sync data: never serve anything from here\n<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\nOptions -Indexes\n");
    if (!is_file("$DATA/index.html")) file_put_contents("$DATA/index.html", '');
}

function is_https(): bool {
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') return true;
    if (strtolower($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') return true;
    return in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true); // local testing
}

function new_key(): string { return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '='); }
function space_id(string $key): string { return hash('sha256', 'vanadium-sync:' . $key); }

// ---- per-IP rate limiting for unknown keys and new spaces ----
function rl_hit(string $DATA, string $kind, int $limit, int $window): bool {
    $f = "$DATA/ratelimit.php"; $fp = lock($f);
    $rl = jread($f); $now = time(); $ip = hash('sha256', $_SERVER['REMOTE_ADDR'] ?? '?');
    foreach ($rl as $k => $v) if ($v[1] + 86400 < $now) unset($rl[$k]);   // forget old entries
    $id = "$kind:$ip"; $e = $rl[$id] ?? [0, $now];
    if ($e[1] + $window < $now) $e = [0, $now];
    $e[0]++; $rl[$id] = $e; jwrite($f, $rl);
    flock($fp, LOCK_UN);
    return $e[0] <= $limit;
}
function rl_blocked(string $DATA, string $kind, int $limit, int $window): bool {
    $rl = jread("$DATA/ratelimit.php"); $ip = hash('sha256', $_SERVER['REMOTE_ADDR'] ?? '?');
    $e = $rl["$kind:$ip"] ?? null;
    return $e && $e[1] + $window >= time() && $e[0] >= $limit;
}

function dir_size(string $dir): int { $n = 0; foreach (glob("$dir/*") ?: [] as $f) $n += is_file($f) ? filesize($f) : 0; return $n; }
function body_json(): array { $j = json_decode((string)file_get_contents('php://input'), true); return is_array($j) ? $j : []; }
function valid_pack_id($id): bool { return is_string($id) && preg_match('/^[A-Za-z0-9_-]{1,120}$/', $id) === 1; }

// ---------------------------------------------------------------------------
if (!is_https()) fail(403, 'Sync needs HTTPS, so your key is never sent unencrypted.');
ensure_data_dir($DATA);
$a = $_GET['a'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET' && $method !== 'POST') fail(405, 'method not allowed');
// pack_chunk takes GET (download) and POST (upload); state is GET; everything else changes data and must be POST
if ($a === 'state' && $method !== 'GET') fail(405, 'use GET');
if (!in_array($a, ['state', 'pack_chunk'], true) && $method !== 'POST') fail(405, 'use POST');

$CFG = "$DATA/config.php";

if ($a === 'create') {
    $fp = lock($CFG); $cfg = jread($CFG);
    if (!empty($cfg['owner'])) {
        if (empty($cfg['open'])) fail(403, 'This server only allows its owner to create sync keys. Ask the owner, or connect with an existing key.');
        if (!rl_hit($DATA, 'create', CREATE_LIMIT, 86400)) fail(429, 'Too many new keys from this address today.');
    }
    $key = new_key(); $id = space_id($key); $dir = "$DATA/s-$id";
    if (!@mkdir($dir, 0700)) fail(500, 'cannot create space');
    file_put_contents("$dir/index.html", '');
    jwrite("$dir/state.php", ['rev' => 0, 'items' => [], 'packs' => [], 'created' => time()]);
    if (empty($cfg['owner'])) { $cfg['owner'] = $id; $cfg['open'] = false; jwrite($CFG, $cfg); }
    ok(['key' => $key, 'owner' => $cfg['owner'] === $id]);
}

// everything else needs a valid key
$key = $_SERVER['HTTP_X_SYNC_KEY'] ?? '';
if (rl_blocked($DATA, 'fail', FAIL_LIMIT, 900)) fail(429, 'Too many attempts with unknown keys. Try again in 15 minutes.');
if (!preg_match('/^[A-Za-z0-9_-]{43}$/', $key) || !is_dir($dir = "$DATA/s-" . ($id = space_id($key)))) {
    rl_hit($DATA, 'fail', FAIL_LIMIT, 900);
    fail(401, 'Unknown sync key.');
}
$ST = "$dir/state.php";
$cfg = jread($CFG);
$isOwner = ($cfg['owner'] ?? '') === $id;

switch ($a) {
case 'state': {
    $st = jread($ST); $since = (int)($_GET['since'] ?? 0); $items = [];
    foreach ($st['items'] ?? [] as $k => $it) if (($it['r'] ?? 0) > $since) $items[$k] = ['t' => $it['t'], 'v' => $it['v']];
    ok(['rev' => $st['rev'] ?? 0, 'items' => (object)$items, 'packs' => (object)($st['packs'] ?? []),
        'owner' => $isOwner, 'open' => !empty($cfg['open']), 'usage' => dir_size($dir), 'quota' => QUOTA]);
}
case 'put': {
    $in = body_json()['items'] ?? [];
    if (!is_array($in)) fail(400, 'bad items');
    $fp = lock($ST); $st = jread($ST); $rev = $st['rev'] ?? 0; $rejected = [];
    foreach ($in as $k => $it) {
        if (!is_string($k) || strlen($k) > 200 || !is_array($it) || !is_numeric($it['t'] ?? null)) continue;
        $v = $it['v'] ?? null;
        if ($v !== null && !is_string($v)) continue;
        $cur = $st['items'][$k] ?? null;
        if ($cur && $cur['t'] >= $it['t']) { if ($cur['t'] > $it['t']) $rejected[$k] = ['t' => $cur['t'], 'v' => $cur['v']]; continue; }
        $st['items'][$k] = ['t' => (float)$it['t'], 'v' => $v, 'r' => ++$rev];
    }
    $st['rev'] = $rev;
    if (strlen(json_encode($st, JF)) + dir_size($dir) > QUOTA) fail(413, 'Sync storage is full.');
    jwrite($ST, $st);
    ok(['rev' => $rev, 'rejected' => (object)$rejected]);
}
case 'pack_chunk': {
    $pid = $_GET['id'] ?? ''; $n = $_GET['n'] ?? '';
    if (!valid_pack_id($pid) || !preg_match('/^\d{1,6}$/', (string)$n)) fail(400, 'bad chunk');
    $f = "$dir/p-$pid-$n.php";
    if ($method === 'GET') {
        $data = gread($f);
        if ($data === null) fail(404, 'no such chunk');
        header('Content-Type: application/octet-stream'); echo $data; exit;
    }
    $data = file_get_contents('php://input');
    if ($data === false || $data === '' || strlen($data) > CHUNK_MAX) fail(400, 'bad chunk size');
    if (dir_size($dir) + strlen($data) > QUOTA) fail(413, 'Sync storage is full.');
    gwrite($f, $data);
    ok(['ok' => true]);
}
case 'pack_done': {
    $b = body_json(); $pid = $b['id'] ?? ''; $chunks = (int)($b['chunks'] ?? 0);
    if (!valid_pack_id($pid) || $chunks < 1) fail(400, 'bad pack');
    for ($i = 0; $i < $chunks; $i++) if (!is_file("$dir/p-$pid-$i.php")) fail(400, "chunk $i missing");
    $fp = lock($ST); $st = jread($ST);
    $old = $st['packs'][$pid] ?? null;
    if ($old && !empty($old['deleted']) && $old['t'] >= ($b['t'] ?? 0)) fail(409, 'pack was deleted on another device');
    for ($i = $chunks; is_file("$dir/p-$pid-$i.php"); $i++) @unlink("$dir/p-$pid-$i.php"); // leftovers of an older upload
    $st['rev'] = ($st['rev'] ?? 0) + 1;
    $st['packs'][$pid] = ['t' => (float)($b['t'] ?? time() * 1000), 'title' => substr((string)($b['title'] ?? $pid), 0, 200),
                          'chunks' => $chunks, 'size' => (int)($b['size'] ?? 0), 'r' => $st['rev']];
    jwrite($ST, $st);
    ok(['ok' => true]);
}
case 'pack_del': {
    $b = body_json(); $pid = $b['id'] ?? '';
    if (!valid_pack_id($pid)) fail(400, 'bad pack');
    $fp = lock($ST); $st = jread($ST);
    foreach (glob("$dir/p-$pid-*.php") ?: [] as $f) @unlink($f);
    $st['rev'] = ($st['rev'] ?? 0) + 1;
    $st['packs'][$pid] = ['t' => (float)($b['t'] ?? time() * 1000), 'deleted' => true, 'r' => $st['rev']];
    jwrite($ST, $st);
    ok(['ok' => true]);
}
case 'rotate': {
    $cfp = lock($CFG); $fp = lock($ST);
    $nk = new_key(); $nid = space_id($nk);
    if (!rename($dir, "$DATA/s-$nid")) fail(500, 'cannot rotate key');
    $cfg = jread($CFG);
    if (($cfg['owner'] ?? '') === $id) { $cfg['owner'] = $nid; jwrite($CFG, $cfg); }
    ok(['key' => $nk]);
}
case 'setopen': {
    if (!$isOwner) fail(403, 'Only the owner can change this.');
    $fp = lock($CFG); $cfg = jread($CFG); $cfg['open'] = !empty(body_json()['open']); jwrite($CFG, $cfg);
    ok(['open' => $cfg['open']]);
}
default:
    fail(400, 'unknown action');
}
