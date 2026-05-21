// LEAPPs GitHub API Cache Worker
// Caches GitHub API responses at the edge for 5 minutes

const CACHE_TTL = 300; // seconds (5 minutes)

const ALLOWED_REPOS = [
  'abrignoni/iLEAPP',
  'abrignoni/ALEAPP',
  'abrignoni/RLEAPP',
  'abrignoni/VLEAPP',
  'leapps-org/LAVA-releases',
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