// Validates the blog manifest against the post files on disk, so a malformed
// blog PR fails fast instead of silently breaking the site.
//
// Checks (errors fail the build; warnings are advisory):
//   - index.json parses as a JSON array
//   - each entry has a URL-safe, unique slug matching the worker's /^[\w-]+$/
//     contract (an unsafe slug fails per-post OG injection silently)
//   - a blog/posts/<slug>.md exists for every entry, and every .md has an entry
//   - required fields present and well-formed: title, date (YYYY-MM-DD, real
//     calendar date), author, tags (non-empty array), excerpt
//   - the date field drives ordering, prev/next, related posts and the OG card
//     cache-bust, so it is validated strictly
//
// Warnings: uppercase in a slug (URLs prefer lowercase), a dated slug prefix
// that disagrees with the date field, an empty tags array, and a missing OG
// card (the og-cards Action generates those after merge, so it isn't an error).
//
// No dependencies — run: node tools/validate-blog.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const postsDir = path.join(repo, 'blog', 'posts');
const ogDir = path.join(repo, 'blog', 'og');
const indexPath = path.join(postsDir, 'index.json');

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const SLUG_RE = /^[\w-]+$/;            // exactly what worker.js accepts
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATED_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})-/;

function isRealDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === iso;
}

// --- load manifest ---
let index;
try {
  index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
} catch (e) {
  err(`blog/posts/index.json could not be read or parsed: ${e.message}`);
  report();
}
if (!Array.isArray(index)) {
  err('blog/posts/index.json must be a JSON array of post objects.');
  report();
}

// --- per-entry checks ---
const seen = new Map();
for (let i = 0; i < index.length; i++) {
  const p = index[i] || {};
  const where = p.slug ? `"${p.slug}"` : `entry #${i + 1}`;

  // slug
  if (typeof p.slug !== 'string' || !p.slug) {
    err(`${where}: missing "slug".`);
  } else {
    if (!SLUG_RE.test(p.slug)) {
      err(`${where}: slug is not URL-safe — must match /^[\\w-]+$/ (letters, digits, hyphen, underscore). Spaces/punctuation break OG injection.`);
    }
    if (/[A-Z]/.test(p.slug)) warn(`${where}: slug has uppercase letters; lowercase is recommended for URLs.`);
    if (seen.has(p.slug)) err(`${where}: duplicate slug (also entry #${seen.get(p.slug) + 1}).`);
    seen.set(p.slug, i);

    // matching markdown file
    if (!fs.existsSync(path.join(postsDir, `${p.slug}.md`))) {
      err(`${where}: no blog/posts/${p.slug}.md found for this manifest entry.`);
    }
    // OG card (generated post-merge → warning only)
    if (!fs.existsSync(path.join(ogDir, `${p.slug}.png`))) {
      warn(`${where}: blog/og/${p.slug}.png not present yet (the og-cards Action generates it on merge).`);
    }
  }

  // date — strict, because every date-driven feature relies on it
  if (typeof p.date !== 'string' || !p.date) {
    err(`${where}: missing "date" (ordering, prev/next, related posts and the OG cache-bust all depend on it).`);
  } else if (!DATE_RE.test(p.date) || !isRealDate(p.date)) {
    err(`${where}: date "${p.date}" is not a valid YYYY-MM-DD calendar date.`);
  } else if (typeof p.slug === 'string') {
    const m = p.slug.match(DATED_PREFIX_RE);
    if (m && m[1] !== p.date) {
      warn(`${where}: slug date prefix (${m[1]}) disagrees with the date field (${p.date}).`);
    }
  }

  // other required fields
  if (typeof p.title !== 'string' || !p.title.trim()) err(`${where}: missing "title".`);
  if (typeof p.author !== 'string' || !p.author.trim()) err(`${where}: missing "author".`);
  if (typeof p.excerpt !== 'string' || !p.excerpt.trim()) err(`${where}: missing "excerpt" (used for the meta description and OG card).`);
  if (!Array.isArray(p.tags)) {
    err(`${where}: "tags" must be an array.`);
  } else if (p.tags.some((t) => typeof t !== 'string' || !t.trim())) {
    err(`${where}: every tag must be a non-empty string.`);
  } else if (p.tags.length === 0) {
    warn(`${where}: empty tags array (the OG card accent falls back to gold).`);
  }
}

// --- reverse check: every .md must be in the manifest ---
const slugs = new Set(index.map((p) => p && p.slug).filter(Boolean));
for (const f of fs.readdirSync(postsDir)) {
  if (!f.endsWith('.md')) continue;
  const slug = f.slice(0, -3);
  if (!slugs.has(slug)) err(`blog/posts/${f}: file has no matching entry in index.json (orphan post).`);
}

report();

function report() {
  for (const w of warnings) console.warn(`  ⚠  ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`  ✗  ${e}`);
    console.error(`\nBlog validation FAILED — ${errors.length} error(s), ${warnings.length} warning(s).`);
    process.exit(1);
  }
  console.log(`Blog validation passed — ${index ? index.length : 0} post(s), ${warnings.length} warning(s).`);
  process.exit(0);
}
