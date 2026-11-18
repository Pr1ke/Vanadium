<?php
/*
 * Vanadium self-updater for PHP hosts.
 *
 * The app calls this script (GET update.php) at most every 5 minutes. The script itself
 * also enforces a 5-minute cooldown shared by ALL visitors, so it can't be used to spam
 * GitHub or the host. When it runs, it compares version.json with the copy on GitHub
 * and, if the build differs, downloads the repo zip and installs its site/ folder here.
 *
 * Needs: PHP 7.4+, the zip extension (ZipArchive), curl or allow_url_fopen,
 * and write access for PHP to this folder.
 *
 * Only files that come from the build are written. A file is deleted only if an earlier
 * run of this updater installed it and the new build no longer has it, so your host's
 * own files (.htaccess, other folders, ...) are never touched.
 */

const REPO = 'Pr1ke/Vanadium';
const BRANCH = 'main';
const COOLDOWN = 300; // seconds

header('Content-Type: application/json');
header('Cache-Control: no-store');

$ROOT = __DIR__;
$STATE = $ROOT . '/.vanadium-update.json';

function done(array $r): void { echo json_encode($r); exit; }

function http_get(string $url, int $timeout): string {
    if (function_exists('curl_init')) {
        $c = curl_init($url);
        curl_setopt_array($c, [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_FAILONERROR => true,
            CURLOPT_CONNECTTIMEOUT => 15, CURLOPT_TIMEOUT => $timeout,
            CURLOPT_USERAGENT => 'Vanadium-updater', CURLOPT_HTTPHEADER => ['Cache-Control: no-cache'],
        ]);
        $body = curl_exec($c);
        $err = curl_error($c);
        curl_close($c);
        if ($body === false) throw new RuntimeException("GET $url failed: $err");
        return $body;
    }
    if (ini_get('allow_url_fopen')) {
        $ctx = stream_context_create(['http' => [
            'timeout' => $timeout, 'user_agent' => 'Vanadium-updater', 'header' => "Cache-Control: no-cache\r\n",
        ]]);
        $body = @file_get_contents($url, false, $ctx);
        if ($body === false) throw new RuntimeException("GET $url failed");
        return $body;
    }
    throw new RuntimeException('neither curl nor allow_url_fopen is available');
}

function local_build(string $root): ?string {
    $j = @json_decode((string)@file_get_contents($root . '/version.json'), true);
    return is_array($j) && isset($j['build']) ? (string)$j['build'] : null;
}

function rrmdir(string $dir): void {
    if (!is_dir($dir)) return;
    foreach (scandir($dir) as $f) {
        if ($f === '.' || $f === '..') continue;
        $p = "$dir/$f";
        is_dir($p) && !is_link($p) ? rrmdir($p) : @unlink($p);
    }
    @rmdir($dir);
}

// ---- cooldown + lock (shared by every visitor) ----
$fp = @fopen($STATE, 'c+');
if (!$fp) done(['status' => 'error', 'error' => 'cannot write ' . basename($STATE) . ' (folder not writable by PHP?)']);
if (!flock($fp, LOCK_EX | LOCK_NB)) done(['status' => 'busy']);
$state = json_decode((string)stream_get_contents($fp), true);
if (!is_array($state)) $state = [];
$since = time() - (int)($state['checked'] ?? 0);
if ($since < COOLDOWN) done(['status' => 'cooldown', 'retry_in' => COOLDOWN - $since, 'build' => local_build($ROOT)]);

function save_state($fp, array $state): void {
    ftruncate($fp, 0); rewind($fp); fwrite($fp, json_encode($state)); fflush($fp);
}
$state['checked'] = time(); // failures count too, so a broken network isn't hammered
save_state($fp, $state);

ignore_user_abort(true); // finish the install even if the visitor closes the tab
@set_time_limit(300);

// note: done() exits, and exit skips finally blocks, so the work lives in a function that returns
function run_update(string $ROOT, string $STATE, $fp, array $state): array {
  $stage = null; $zipFile = null;
  try {
    $remote = json_decode(http_get('https://raw.githubusercontent.com/' . REPO . '/' . BRANCH . '/site/version.json', 15), true);
    $remote = is_array($remote) ? ($remote['build'] ?? null) : null;
    if (!$remote) throw new RuntimeException('remote version.json has no build');
    $local = local_build($ROOT);
    if ($remote === $local) return ['status' => 'uptodate', 'build' => $local];

    if (!class_exists('ZipArchive')) throw new RuntimeException('PHP zip extension (ZipArchive) is missing');
    $zipFile = $ROOT . '/.vanadium-download-' . bin2hex(random_bytes(4)) . '.zip';
    if (file_put_contents($zipFile, http_get('https://codeload.github.com/' . REPO . '/zip/refs/heads/' . BRANCH, 280)) === false)
        throw new RuntimeException('cannot save the download');

    $zip = new ZipArchive();
    if ($zip->open($zipFile) !== true) throw new RuntimeException('download is not a valid zip');
    $stage = $ROOT . '/.vanadium-new-' . bin2hex(random_bytes(4));
    $files = [];
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $name = $zip->getNameIndex($i);
        $parts = explode('/', $name);           // "<repo>-<branch>/site/..."
        if (count($parts) < 3 || $parts[1] !== 'site' || substr($name, -1) === '/') continue;
        $relParts = array_slice($parts, 2);
        if (in_array('..', $relParts, true) || in_array('', $relParts, true) || strpbrk($name, "\\:\0") !== false) continue;
        $rel = implode('/', $relParts);
        $out = "$stage/$rel";
        if (!is_dir(dirname($out)) && !mkdir(dirname($out), 0755, true)) throw new RuntimeException("cannot create folder for $rel");
        $in = $zip->getStream($name);
        $dst = fopen($out, 'wb');
        if (!$in || !$dst) throw new RuntimeException("cannot extract $rel");
        stream_copy_to_stream($in, $dst);
        fclose($in); fclose($dst);
        $files[] = $rel;
    }
    $zip->close();
    foreach (['index.html', 'app.js', 'version.json'] as $need)
        if (!in_array($need, $files, true)) throw new RuntimeException("download has no site/$need");

    // version.json goes last, so a browser never sees the new version before its files exist
    usort($files, function ($a, $b) { return ($a === 'version.json') <=> ($b === 'version.json'); });
    foreach ($files as $rel) {
        $dst = "$ROOT/$rel";
        if (!is_dir(dirname($dst)) && !mkdir(dirname($dst), 0755, true)) throw new RuntimeException("cannot create folder for $rel");
        if (!@rename("$stage/$rel", $dst)) {
            if (!@copy("$stage/$rel", $dst)) throw new RuntimeException("cannot write $rel (permissions?)");
        }
    }

    // remove files an earlier update installed that the new build dropped
    $removed = 0;
    foreach (array_diff($state['files'] ?? [], $files) as $rel) {
        if (!is_string($rel) || strpos($rel, '..') !== false || $rel === basename($STATE)) continue;
        if (is_file("$ROOT/$rel") && @unlink("$ROOT/$rel")) $removed++;
    }
    $state['files'] = array_values($files);
    $state['installed'] = time();
    save_state($fp, $state);
    return ['status' => 'updated', 'from' => $local, 'build' => local_build($ROOT), 'files' => count($files), 'removed' => $removed];
  } catch (Throwable $e) {
    return ['status' => 'error', 'error' => $e->getMessage(), 'build' => local_build($ROOT)];
  } finally {
    if ($stage) rrmdir($stage);
    if ($zipFile) @unlink($zipFile);
  }
}

done(run_update($ROOT, $STATE, $fp, $state));
