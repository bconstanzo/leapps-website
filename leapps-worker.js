// LEAPPs GitHub API Cache Worker
// Caches GitHub API responses at the edge for 5 minutes

const CACHE_TTL = 300; // seconds (5 minutes)
const BLOG_CACHE_TTL = 600; // seconds (10 minutes) for blog content

const BLOG_REPO = 'abrignoni/leapps-website';
const BLOG_BRANCH = 'main';

const ALLOWED_REPOS = [
  'abrignoni/iLEAPP',
  'abrignoni/ALEAPP',
  'abrignoni/RLEAPP',
  'abrignoni/VLEAPP',
  'leapps-org/LAVA-releases',
  'leapps-org/leapps-language-resources',
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse('', 204);
    }

    // Only allow GET requests
    if (request.method !== 'GET') {
      return corsResponse(JSON.stringify({ error: 'Method not allowed' }), 405);
    }

    // Blog RSS feed route: /blog/feed
    if (url.pathname === '/blog/feed') {
      return handleBlogFeed(env);
    }

    // Blog content route: /blog/posts/index.json or /blog/posts/{slug}.md
    if (url.pathname.startsWith('/blog/posts/')) {
      return handleBlogRequest(url, env);
    }

    // Parse the path — expected format: /repos/{owner}/{repo}/...
    const path = url.pathname + url.search;

    // Extract owner/repo from path - match first two path segments after /repos/
    const repoMatch = url.pathname.match(/^\/repos\/([^\/]+)\/([^\/]+)/);
    if (!repoMatch) {
      return corsResponse(JSON.stringify({ error: 'Invalid path', path: url.pathname }), 400);
    }

    const repoFullName = `${repoMatch[1]}/${repoMatch[2]}`;

    if (!ALLOWED_REPOS.includes(repoFullName)) {
      return corsResponse(JSON.stringify({ error: 'Repo not allowed', repo: repoFullName }), 403);
    }

    // Build the GitHub API URL
    const githubUrl = `https://api.github.com${path}`;

    // Check Cloudflare cache first
    const cache = caches.default;
    const cacheKey = new Request(githubUrl);
    const cached = await cache.match(cacheKey);
    if (cached) {
      const cachedResponse = new Response(cached.body, cached);
      cachedResponse.headers.set('X-Cache', 'HIT');
      cachedResponse.headers.set('Access-Control-Allow-Origin', '*');
      return cachedResponse;
    }

    // Fetch from GitHub
    const githubResponse = await fetch(githubUrl, {
      headers: {
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'LEAPPs-Worker/1.0',
      },
    });

    if (!githubResponse.ok) {
      return corsResponse(
        JSON.stringify({ error: `GitHub API error: ${githubResponse.status}` }),
        githubResponse.status
      );
    }

    const data = await githubResponse.text();

    // Store in cache
    const responseToCache = new Response(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CACHE_TTL}`,
        'Access-Control-Allow-Origin': '*',
        'X-Cache': 'MISS',
      },
    });
    await cache.put(cacheKey, responseToCache.clone());

    return responseToCache;
  },
};

async function handleBlogRequest(url, env) {
  const filePath = url.pathname.replace(/^\/blog\/posts\//, '');

  // Only allow index.json and .md files, no path traversal
  if (!filePath.match(/^(index\.json|[\w-]+\.md)$/)) {
    return corsResponse(JSON.stringify({ error: 'Not found' }), 404);
  }

  const rawUrl = `https://raw.githubusercontent.com/${BLOG_REPO}/${BLOG_BRANCH}/blog/posts/${filePath}`;

  const cache = caches.default;
  const cacheKey = new Request(rawUrl);
  const cached = await cache.match(cacheKey);
  if (cached) {
    const cachedResponse = new Response(cached.body, cached);
    cachedResponse.headers.set('X-Cache', 'HIT');
    cachedResponse.headers.set('Access-Control-Allow-Origin', '*');
    return cachedResponse;
  }

  const headers = { 'User-Agent': 'LEAPPs-Worker/1.0' };
  if (env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${env.GITHUB_TOKEN}`;

  const upstream = await fetch(rawUrl, { headers });

  if (!upstream.ok) {
    return corsResponse(JSON.stringify({ error: 'Post not found' }), 404);
  }

  const contentType = filePath.endsWith('.json') ? 'application/json' : 'text/markdown; charset=utf-8';
  const body = await upstream.text();

  const responseToCache = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${BLOG_CACHE_TTL}`,
      'Access-Control-Allow-Origin': '*',
      'X-Cache': 'MISS',
    },
  });
  await cache.put(cacheKey, responseToCache.clone());

  return responseToCache;
}

async function handleBlogFeed(env) {
  const indexUrl = `https://raw.githubusercontent.com/${BLOG_REPO}/${BLOG_BRANCH}/blog/posts/index.json`;

  const cache = caches.default;
  const cacheKey = new Request(`${indexUrl}__feed`);
  const cached = await cache.match(cacheKey);
  if (cached) {
    const cachedResponse = new Response(cached.body, cached);
    cachedResponse.headers.set('X-Cache', 'HIT');
    cachedResponse.headers.set('Access-Control-Allow-Origin', '*');
    return cachedResponse;
  }

  const headers = { 'User-Agent': 'LEAPPs-Worker/1.0' };
  if (env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${env.GITHUB_TOKEN}`;

  const upstream = await fetch(indexUrl, { headers });
  if (!upstream.ok) {
    return new Response('Failed to load feed', { status: 502 });
  }

  const posts = await upstream.json();

  const items = posts.map(post => {
    const pubDate = new Date(post.date + 'T00:00:00Z').toUTCString();
    const link = `https://leapps.org/blog-post?post=${encodeURIComponent(post.slug)}`;
    const desc = (post.excerpt || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;');
    const title = (post.title || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `
    <item>
      <title>${title}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${pubDate}</pubDate>
      <author>${post.author || ''}</author>
      <description>${desc}</description>
    </item>`;
  }).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>LEAPPs Blog</title>
    <link>https://leapps.org/blog</link>
    <description>Forensics deep dives, tool updates, artifact write-ups, and community contributions from the LEAPPs project.</description>
    <language>en-us</language>
    <atom:link href="https://leapps-api.4n6-198.workers.dev/blog/feed" rel="self" type="application/rss+xml" />
    ${items}
  </channel>
</rss>`;

  const responseToCache = new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': `public, max-age=${BLOG_CACHE_TTL}`,
      'Access-Control-Allow-Origin': '*',
      'X-Cache': 'MISS',
    },
  });
  await cache.put(cacheKey, responseToCache.clone());

  return responseToCache;
}

function corsResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}