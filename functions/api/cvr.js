// Cloudflare Pages Function: GET /api/cvr?cvr=XXXXXXXX
// - Returnerer altid raw-data fra cvrapi.dk i feltet `raw`
// - Normaliserer kun felter, hvis de findes (ellers undlader vi dem)
// - Sætter tydelig User-Agent (viggo@fforsikring.dk)
// - Ingen caching før vi kan se data er korrekte

export async function onRequest({ request }) {
  const { searchParams } = new URL(request.url);
  const cvr = (searchParams.get("cvr") || "").replace(/\D+/g, "").slice(0, 8);

  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj, null, 2), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
        "cache-control": "no-store"
      }
    });

  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,OPTIONS",
        "access-control-allow-headers": "*"
      }
    });
  }

  if (cvr.length !== 8) return json({ error: "invalid_cvr", detail: "CVR skal være 8 cifre" }, 400);

  // Timeout
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 8000);

  try {
    const url = `https://cvrapi.dk/api?search=${cvr}&country=dk`;
    const r = await fetch(url, {
      headers: {
        accept: "application/json",
        // VIGTIG: tydelig UA med kontaktmail
        "user-agent": "Fælles Forsikring prisberegner (viggo@fforsikring.dk)"
      },
      signal: controller.signal
    });
    clearTimeout(to);

    const contentType = r.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    // Nogle gange svarer cvrapi med 200 men ikke-JSON (rate-limit/fejltekst)
    const raw = isJson ? await r.json() : await r.text();

    if (!r.ok) {
      return json({ error: "upstream", status: r.status, raw }, 502);
    }

    // Hvis ikke JSON, returnér rå tekst så vi kan se hvorfor.
    if (!isJson) {
      return json({ error: "not_json", detail: "Upstream returned non-JSON", raw }, 502);
    }

    // Hvis raw indeholder fejlmeddelelse el. tomt indhold, vis det
    if (!raw || typeof raw !== "object" || Object.keys(raw).length === 0) {
      return json({ error: "empty_response", raw }, 502);
    }
    if (raw.error || raw.message || raw.msg) {
      return json({ error: "upstream_signaled_error", raw }, 502);
    }

    // Normaliser felter — brug brede alias’er og kun hvis de findes
    const norm = {};
    const pick = (obj, ...keys) => keys.find((k) => obj[k] != null);

    const cvrKey = pick(raw, "cvr", "vat", "CVR");
    if (cvrKey) norm.cvr = raw[cvrKey];

    const nameKey = pick(raw, "name", "virksomhedsnavn", "Navn");
    if (nameKey) norm.name = raw[nameKey];

    const addrKey = pick(raw, "address", "adresse");
    if (addrKey) norm.address = raw[addrKey];

    const zipKey = pick(raw, "zip", "zipcode", "postnr");
    if (zipKey) norm.zipcode = raw[zipKey];

    const cityKey = pick(raw, "city", "bynavn", "postdistrikt");
    if (cityKey) norm.city = raw[cityKey];

    const codeKey = pick(raw, "industrycode", "main_industrycode", "branchekode");
    if (codeKey) norm.industrycode = raw[codeKey];

    const descKey = pick(raw, "industrydesc", "main_industrycode_tekst", "branchetekst");
    if (descKey) norm.industrydesc = raw[descKey];

    const empKey = pick(raw, "employees", "employeesYear", "antal_ansatte");
    if (empKey) norm.employees = raw[empKey];

    // Returnér både normaliserede felter (hvis nogen) og altid rå data
    return json({ ...norm, raw }, 200);
  } catch (e) {
    clearTimeout(to);
    const aborted = e?.name === "AbortError";
    return json({ error: "fetch_failed", aborted, detail: String(e?.message || e) }, 502);
  }
}
