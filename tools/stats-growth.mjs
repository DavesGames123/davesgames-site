// ============================================================================
//  tools/stats-growth.mjs — write the site growth history for the #stats page
// ----------------------------------------------------------------------------
//  Usage (from the repo root, in a full clone):
//    node tools/stats-growth.mjs          write stella-nova/pages/stats/data/growth.json
//    node tools/stats-growth.mjs --check  change nothing, exit 1 if the file is old
//
//  The site had no visit counter before the sn-stats Worker, so git is the
//  one history there is. The file holds, from git log on this repo:
//    commits   [[day, count], ...]   commits per day
//    pages     [[day, folder], ...]  the day each pages/<folder>/index.html
//                                    first came into the repo
//    first, last                     the first and the last commit day
//  Only dates and counts go out: no commit text, names or e-mails.
//
//  The deploy checkout is shallow (one commit), so the deploy cannot make
//  this file. Run the tool and commit its output.
//
//  grep -n targets: "function gitLines", "commits per day", "page first-add"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'stella-nova/pages/stats/data/growth.json');
const CHECK = process.argv.includes('--check');

function gitLines(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n').filter(Boolean);
}

// commits per day (author date, the committer's own time zone)
const perDay = new Map();
for (const d of gitLines(['log', '--format=%ad', '--date=short'])) perDay.set(d, (perDay.get(d) || 0) + 1);
const commits = [...perDay].sort((a, b) => (a[0] < b[0] ? -1 : 1));

// page first-add: the oldest commit that added pages/<folder>/index.html
const added = new Map();
let day = '';
for (const l of gitLines(['log', '--reverse', '--diff-filter=A', '--format=@%ad', '--date=short', '--name-only', '--', 'stella-nova/pages/*/index.html'])) {
  if (l.startsWith('@')) { day = l.slice(1); continue; }
  const m = /^stella-nova\/pages\/([^/]+)\/index\.html$/.exec(l);
  if (m && !added.has(m[1])) added.set(m[1], day);
}
const pages = [...added].map(([k, d]) => [d, k]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));

const data = { first: commits.length ? commits[0][0] : null, last: commits.length ? commits[commits.length - 1][0] : null, commits, pages };
const text = JSON.stringify(data) + '\n';
const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
const total = commits.reduce((s, c) => s + c[1], 0);
if (CHECK) {
  console.log(old === text ? 'up to date' : 'out of date', path.relative(ROOT, OUT));
  process.exit(old === text ? 0 : 1);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, text);
console.log(`growth.json: ${total} commits on ${commits.length} days (${data.first} .. ${data.last}), ${pages.length} pages`);
