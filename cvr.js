export default async (req) => {
  const url = new URL(req.url);
  const cvr = (url.searchParams.get('cvr') || '').replace(/\D+/g, '').slice(0,8);
  if (cvr.length !== 8)
    return new Response(JSON.stringify({ error: 'invalid_cvr' }), { status: 400, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
  try {
    const r = await fetch(`https://cvrapi.dk/api?search=${cvr}&country=dk`, { headers: { Accept: 'application/json' } });
    const data = await r.json();
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'upstream' }), { status: 502, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
  }
}