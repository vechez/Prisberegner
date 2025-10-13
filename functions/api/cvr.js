export async function onRequest({ request }) {
  const { searchParams } = new URL(request.url);
  const cvr = (searchParams.get('cvr') || '').replace(/\D+/g, '').slice(0, 8);

  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*'
      }
    });

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,OPTIONS',
        'access-control-allow-headers': '*'
      }
    });
  }

  if (cvr.length !== 8) return json({ error: 'invalid_cvr' }, 400);

  try {
    const r = await fetch(`https://cvrapi.dk/api?search=${cvr}&country=dk`, {
      headers: {
        'accept': 'application/json',
        'user-agent': 'Fælles Forsikring prisberegner (kontakt@fforsikring.dk)'
      }
    });
    if (!r.ok) return json({ error: 'upstream', status: r.status }, 502);
    const d = await r.json();
    return json({
      cvr: d.cvr || d.vat || null,
      name: d.name || d.virksomhedsnavn || null,
      address: d.address || null,
      zipcode: d.zip || d.zipcode || null,
      city: d.city || null,
      industrycode: d.industrycode || d.main_industrycode || null,
      industrydesc: d.industrydesc || d.main_industrycode_tekst || null,
      employees: typeof d.employees === 'number' ? d.employees : (d.employeesYear || d.antal_ansatte || null)
    });
  } catch (e) {
    return json({ error: 'fetch_failed', detail: String(e?.message || e) }, 502);
  }
}
