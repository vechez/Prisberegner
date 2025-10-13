// Cloudflare Pages Function: GET /api/cvr?cvr=XXXXXXXX
// - Bruger tydelig User-Agent med kontaktmail (viggo@fforsikring.dk)
// - Edge-cache i 5 min for at mindske rate limits

export async function onRequest({ request }) {
  const { searchParams } = new URL(request.url);
  const cvr = (searchParams.get('cvr') || '').replace(/\D+/g, '').slice(0, 8);

  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
        'cache-control': status === 200 ? 'public, max-age=300' : 'no-store'
      }
    });

  // CORS preflight
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

  // ---- 5 min edge-cache ----
  const cache = caches.default;
  const cacheKey = new Request(request.url, request); // samme URL = samme cache
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  // Timeout-kontrol
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 8000);

  try {
    const url = `https://cvrapi.dk/api?search=${cvr}&country=dk`;
    const r = await fetch(url, {
      headers: {
        accept: 'application/json',
        // VIGTIG: tydelig UA + kontaktmail
        'user-agent': 'Fælles Forsikring prisberegner (viggo@fforsikring.dk)'
      },
      signal: controller.signal
    });
    clearTimeout(to);

    if (!r.ok) {
      const body = await r.text().catch(() => null);
      return json({ error: 'upstream', status: r.status, body: body?.slice(0, 400) || null }, 502);
    }

    const d = await r.json();

    // Normaliser svar (stabile felter til frontend)
    const payload = {
      cvr: d.cvr || d.vat || null,
      name: d.name || d.virksomhedsnavn || null,
      address: d.address || null,
      zipcode: d.zip || d.zipcode || null,
      city: d.city || null,
      industrycode: d.industrycode || d.main_industrycode || null,
      industrydesc: d.industrydesc || d.main_industrycode_tekst || null,
      employees:
        typeof d.employees === 'number'
          ? d.employees
          : (d.employeesYear || d.antal_ansatte || null)
    };

    const resp = json(payload, 200);
    // læg i cache i 5 min
    eventWaitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
  } catch (e) {
    clearTimeout(to);
    const aborted = e?.name === 'AbortError';
    return json({ error: 'fetch_failed', aborted, detail: String(e?.message || e) }, 502);
  }
}

// Hjælp til at bruge waitUntil i Pages Functions uden direkte adgang til event
function eventWaitUntil(promise) {
  // I Pages Functions kan man kalde waitUntil via globalThis if available
  try { (globalThis as any)?.waitUntil?.(promise); } catch {}
}
