#!/usr/bin/env python3
"""Serve Vanadium on http://127.0.0.1:8765/ and keep site/ up to date from GitHub.

At most once every 5 minutes (at startup, and when a page or version.json is requested)
it compares site/version.json with the copy on GitHub. If the build differs, it downloads
the repo zip and swaps the new site/ files in. Open tabs then show a "Reload" bar.

  python serve.py                 serve + auto-update
  python serve.py --no-update     serve only
  python serve.py --check         run one update check now (ignores the cooldown) and exit

In a git checkout auto-update is off by default (it would overwrite your own builds;
use git pull). Pass --update to turn it on anyway.

Only GET requests go to GitHub; nothing about the user or their imports is sent.
"""
import argparse, http.server, io, json, os, shutil, sys, tempfile, threading, time, urllib.request, zipfile

REPO = 'Pr1ke/Vanadium'
BRANCH = 'main'
COOLDOWN = 5 * 60  # seconds between checks, persisted across restarts
REMOTE_VERSION = f'https://raw.githubusercontent.com/{REPO}/{BRANCH}/site/version.json'
REMOTE_ZIP = f'https://codeload.github.com/{REPO}/zip/refs/heads/{BRANCH}'
UA = 'Vanadium-updater'

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(ROOT, 'site')
STATE = os.path.join(ROOT, '.vanadium-update.json')


def log(*a):
    print(time.strftime('[%H:%M:%S]'), '[update]', *a, flush=True)


def fetch(url, timeout):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def read_json(path):
    try:
        with open(path, encoding='utf-8') as f: return json.load(f)
    except Exception:
        return None


def replace_with_retry(src, dst, tries=20):
    # Windows refuses to replace a file another thread is still sending; wait it out.
    for i in range(tries):
        try:
            os.replace(src, dst); return
        except PermissionError:
            if i == tries - 1: raise
            time.sleep(0.25)


class Updater:
    def __init__(self):
        self.lock = threading.Lock()
        st = read_json(STATE) or {}
        self.last = float(st.get('checked', 0))

    def _save(self):
        try:
            with open(STATE, 'w', encoding='utf-8') as f: json.dump({'checked': self.last}, f)
        except OSError:
            pass

    def maybe_check(self):
        """Start a background check unless one ran in the last COOLDOWN seconds."""
        if time.time() - self.last < COOLDOWN or not self.lock.acquire(blocking=False):
            return
        self.last = time.time(); self._save()  # failures count too, so a dead network isn't hammered
        threading.Thread(target=self._run, daemon=True).start()

    def check_now(self):
        with self.lock:
            self.last = time.time(); self._save()
            return self._check()

    def _run(self):
        try: self._check()
        finally: self.lock.release()

    def _check(self):
        try:
            remote = json.loads(fetch(REMOTE_VERSION, 15)).get('build')
        except Exception as e:
            log('check failed:', e); return False
        local = (read_json(os.path.join(SITE, 'version.json')) or {}).get('build')
        if remote and remote == local:
            log('up to date', local); return True
        log(f'new build {remote} (have {local}), downloading...')
        try:
            data = fetch(REMOTE_ZIP, 300)
            self._install(data)
        except Exception as e:
            log('update failed, keeping current files:', e); return False
        log('installed', (read_json(os.path.join(SITE, 'version.json')) or {}).get('build'))
        return True

    def _install(self, data):
        zf = zipfile.ZipFile(io.BytesIO(data))
        stage = tempfile.mkdtemp(prefix='.vanadium-new-', dir=ROOT)  # same drive, so os.replace works
        try:
            files = []
            for info in zf.infolist():
                parts = info.filename.split('/')  # "<repo>-<branch>/site/..."
                if len(parts) < 3 or parts[1] != 'site' or info.is_dir(): continue
                rel = '/'.join(parts[2:])
                if not rel or '..' in parts or rel.startswith('/'): continue
                out = os.path.join(stage, *parts[2:])
                os.makedirs(os.path.dirname(out), exist_ok=True)
                with zf.open(info) as src, open(out, 'wb') as dst: shutil.copyfileobj(src, dst)
                files.append(rel)
            for need in ('index.html', 'app.js', 'version.json'):
                if need not in files: raise RuntimeError(f'download has no site/{need}')
            # version.json goes last, so a tab never sees the new version before its files exist
            files.sort(key=lambda r: r == 'version.json')
            for rel in files:
                dst = os.path.join(SITE, *rel.split('/'))
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                replace_with_retry(os.path.join(stage, *rel.split('/')), dst)
            # drop files the new build no longer has
            keep = {os.path.normcase(os.path.join(SITE, *r.split('/'))) for r in files}
            for dp, dns, fns in os.walk(SITE, topdown=False):
                if os.path.relpath(dp, SITE).split(os.sep)[0].startswith('.vanadium'):
                    continue  # sync data / updater state, never part of the build
                for fn in fns:
                    if dp == SITE and fn.startswith('.vanadium'): continue
                    p = os.path.join(dp, fn)
                    if os.path.normcase(p) not in keep:
                        try: os.remove(p)
                        except OSError: pass
                if dp != SITE and not os.listdir(dp):
                    try: os.rmdir(dp)
                    except OSError: pass
        finally:
            shutil.rmtree(stage, ignore_errors=True)


def make_handler(updater):
    class Handler(http.server.SimpleHTTPRequestHandler):
        # Windows' registry sometimes maps .js to text/plain, which breaks module imports
        extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                          '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json'}

        def __init__(self, *a, **k):
            super().__init__(*a, directory=SITE, **k)

        def end_headers(self):
            self.send_header('Cache-Control', 'no-cache')  # revalidate, so swapped files are picked up
            super().end_headers()

        def do_GET(self):
            if self.path.split('?')[0].endswith('.php'):  # update.php is for PHP hosts; don't hand out its source
                self.send_error(404); return
            if updater and self.path.split('?')[0] in ('/', '/index.html', '/version.json'):
                updater.maybe_check()
            super().do_GET()

        def log_message(self, fmt, *a):
            if not (len(a) > 1 and str(a[1]) in ('200', '304')):  # keep the console readable
                super().log_message(fmt, *a)
    return Handler


def main():
    ap = argparse.ArgumentParser(description='Serve Vanadium with auto-update from GitHub.')
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--site', help='serve this folder instead of site/ (tests); implies --no-update')
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--no-update', action='store_true', help='never update')
    ap.add_argument('--update', action='store_true', help='auto-update even inside a git checkout')
    ap.add_argument('--check', action='store_true', help='check/update once now and exit')
    args = ap.parse_args()
    global SITE
    if args.site:
        SITE = os.path.abspath(args.site); args.no_update = True   # never update a test copy

    if args.check:
        sys.exit(0 if Updater().check_now() else 1)

    updater = None
    if args.no_update:
        log('auto-update off (--no-update)')
    elif os.path.isdir(os.path.join(ROOT, '.git')) and not args.update:
        log('auto-update off: this is a git checkout (use git pull, or pass --update)')
    else:
        updater = Updater()
        updater.maybe_check()

    srv = http.server.ThreadingHTTPServer((args.host, args.port), make_handler(updater))
    print(f'Vanadium on http://{args.host}:{args.port}/  (Ctrl+C to stop)', flush=True)
    try: srv.serve_forever()
    except KeyboardInterrupt: pass


if __name__ == '__main__':
    main()
