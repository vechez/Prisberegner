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

  if (cvr.length !== 8) return json({ error: 'invalid_cvr' }, 400);

  try {
    const r = await fetch(`https://cvrapi.dk/api?search=${cvr}&country=dk`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!r.ok) return json({ error: 'upstream', status: r.status }, 502);
    const data = await r.json();
    return json(data);
  } catch (e) {
    return json({ error: 'upstream' }, 502);
  }
}
