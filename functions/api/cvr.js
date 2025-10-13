// Cloudflare Pages Function: GET /api/cvr?cvr=XXXXXXXX
// - User-Agent med kontaktmail
// - 24h cache på succes, 10min "negativ" cache på QUOTA_EXCEEDED
export async function onRequest({ request }) {
  const { searchParams } = new URL(request.url);
  const cvr = (searchParams.get('cvr') || '').replace(/\D+/g, '').slice(0, 8);

  const json = (obj, status = 200, cacheSeconds = 0) => {
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*'
    };
    if (cacheSeconds > 0) headers['cache-control'] = `public, max-age=${cacheSeconds}`;
    else headers['cache-control'] = 'no-store';
    return new Response(JSON.stringify(obj, null, 2), { status, headers });
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,OPTIONS',
        'access-control-allow-headers': '*'
      }
    });
  }

  if (cvr.length !== 8) return json({ error: 'invalid_cvr', detail: 'CVR skal være 8 cifre' }, 400);

  // ---- Edge cache ----
  const cache = caches.default;
  const cacheKey = new Request(request.url, request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 8000);

  try {
    const url = `https://cvrapi.dk/api?search=${cvr}&country=dk`;
    const r = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'Fælles Forsikring prisberegner (viggo@fforsikring.dk)'
      },
      signal: controller.signal
    });
    clearTimeout(to);

    const contentType = r.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const raw = isJson ? await r.json() : await r.text();

    // Upstream fejl/kvote
    if (!r.ok || (raw && raw.error)) {
      const quota = raw && typeof raw === 'object' && (raw.error + '').toUpperCase().includes('QUOTA');
      const resp = json(
        {
          error: quota ? 'quota_exceeded' : 'upstream_error',
          status: r.status,
          raw
        },
        quota ? 429 : 502,
        quota ? 600 : 0 // 10 min negativ cache ved kvote
      );
      // læg i cache så vi ikke spammer upstream
      waitUntilSafe(cache.put(cacheKey, resp.clone()));
      return resp;
    }

    if (!isJson || !raw || typeof raw !== 'object') {
      const resp = json({ error: 'not_json', raw }, 502);
      return resp;
    }

    // Normaliser felter
    const payload = {
      cvr: raw.cvr ?? raw.vat ?? null,
      name: raw.name ?? raw.virksomhedsnavn ?? null,
      address: raw.address ?? null,
      zipcode: raw.zip ?? raw.zipcode ?? null,
      city: raw.city ?? null,
      industrycode: raw.industrycode ?? raw.main_industrycode ?? null,
      industrydesc: raw.industrydesc ?? raw.main_industrycode_tekst ?? null,
      employees:
        typeof raw.employees === 'number'
          ? raw.employees
          : (raw.employeesYear ?? raw.antal_ansatte ?? null)
    };

    const resp = json(payload, 200, 86400); // cache succes i 24h
    waitUntilSafe(cache.put(cacheKey, resp.clone()));
    return resp;
  } catch (e) {
    clearTimeout(to);
    return json({ error: 'fetch_failed', detail: String(e?.message || e) }, 502);
  }
}

function waitUntilSafe(p) {
  try { globalThis.waitUntil?.(p); } catch {}
}
