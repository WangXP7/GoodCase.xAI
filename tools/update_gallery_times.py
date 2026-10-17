#!/usr/bin/env python3
"""Refresh case commit timestamps using GitHub REST only; no checkout required.

Print JSON by default; --publish updates only gallery-commits.json on latest main.
Requires GITHUB_TOKEN for publication; uses the standard library only.
"""
import argparse
import base64
import concurrent.futures
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

REPO = os.environ.get('GITHUB_REPOSITORY', 'WangXP7/GoodCase.xAI')
TOKEN = os.environ.get('GITHUB_TOKEN', '')
BASE = 'https://api.github.com/repos/' + REPO + '/'


def api(path, method='GET', data=None):
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'GoodCase-timestamps'}
    if TOKEN:
        headers['Authorization'] = 'Bearer ' + TOKEN
    if data is not None:
        headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(BASE + path, method=method, headers=headers,
                                     data=None if data is None else json.dumps(data).encode('utf-8'))
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if method != 'GET' or error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise
            time.sleep(2 ** attempt)
        except (TimeoutError, urllib.error.URLError):
            if method != 'GET' or attempt == 2:
                raise
            time.sleep(2 ** attempt)


def collect(head):
    content = api('contents/gallery.json?ref=' + head)
    manifest = json.loads(base64.b64decode(content['content']).decode('utf-8'))
    entries = [entry for entry in manifest['entries'] if not entry.get('_hidden')]

    def latest(entry):
        scope = entry['ns'] + '/' + (entry['entry'] if entry['dir'] == '.' else entry['dir'])
        path = entry['ns'] + '/' + ('' if entry['dir'] == '.' else entry['dir'] + '/') + entry['entry']
        commits = api('commits?' + urllib.parse.urlencode({'sha': head, 'per_page': 1, 'path': scope}))
        if not commits:
            raise RuntimeError('No Git history for registered case: ' + path)
        commit = commits[0]
        return path, {'committedAt': commit['commit']['committer']['date'],
                      'commit': commit['sha'], 'scope': scope}

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        records = dict(pool.map(latest, entries))
    if len(records) != len(entries):
        raise RuntimeError('Duplicate case IDs in gallery.json')
    return {'schemaVersion': 1,
            'timeBasis': 'Latest Git committer timestamp for the case directory (standalone entries use their own file)',
            'snapshot': head, 'entries': dict(sorted(records.items()))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    if args.publish and not TOKEN:
        raise RuntimeError('GITHUB_TOKEN is required to publish')
    for _ in range(4):
        head = api('git/ref/heads/main')['object']['sha']
        result = collect(head)
        if not args.publish:
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return
        try:
            previous = api('contents/gallery-commits.json?ref=' + head)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            previous = None
        if previous:
            old = json.loads(base64.b64decode(previous['content']).decode('utf-8'))
            if old.get('entries') == result['entries']:
                print('Case timestamps are already current; no commit needed.')
                return
        if api('git/ref/heads/main')['object']['sha'] != head:
            continue
        encoded = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
        tree = api('git/trees', 'POST', {'base_tree': api('git/commits/' + head)['tree']['sha'],
                   'tree': [{'path': 'gallery-commits.json', 'mode': '100644', 'type': 'blob', 'content': encoded}]})
        commit = api('git/commits', 'POST', {'message': 'Refresh gallery case commit timestamps',
                                           'tree': tree['sha'], 'parents': [head]})
        try:
            api('git/refs/heads/main', 'PATCH', {'sha': commit['sha'], 'force': False})
            print('Updated timestamps for', len(result['entries']), 'cases:', commit['sha'])
            # A GITHUB_TOKEN commit does not start a Pages build automatically.
            api('pages/builds', 'POST', {})
            return
        except urllib.error.HTTPError as error:
            if error.code not in (409, 422):
                raise
    raise RuntimeError('main changed repeatedly; rerun to refresh safely')


if __name__ == '__main__':
    main()
