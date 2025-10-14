// functions/api/lead.js
// Forward lead to Zapier Webhook (Catch Hook)
// Requires env var: ZAPIER_HOOK_URL

export async function onRequest({ request, env }) {
  // CORS / OPTIONS
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST,OPTIONS",
        "access-control-allow-headers": "*",
      },
    });
  }

  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  if (!env.ZAPIER_HOOK_URL) {
    return json(
      { error: "missing_config", detail: "Set ZAPIER_HOOK_URL in Pages → Settings → Environment variables" },
      500
    );
  }

  // Parse lead body
  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  // Basic normalization
  const phone = String(body.phone || "").replace(/\D+/g, "").slice(-8);
  const cvr = String(body.cvr || "").replace(/\D+/g, "").slice(-8);

  if (phone.length !== 8) return json({ error: "invalid_phone" }, 400);
  if (cvr.length !== 8) return json({ error: "invalid_cvr" }, 400);

  // Extra context (nice to have in Zap)
  const ua = request.headers.get("user-agent") || "";
  const referer = request.headers.get("referer") || body.referrer || "";
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    "";

  // Build payload for Zapier
  const payload = {
    // Primary fields
    cvr,
    phone: `+45 ${phone.replace(/(\d{2})(?=\d)/g, "$1 ")}`.trim(),
    total: body.total ?? null,
    roles: body.roles ?? [],
    // VIRK (if present)
    virk: body.virk ?? {},
    // Attribution
    page: body.page || "",
    referrer: referer,
    utm_source: body.utm_source || "",
    utm_medium: body.utm_medium || "",
    utm_campaign: body.utm_campaign || "",
    utm_term: body.utm_term || "",
    utm_content: body.utm_content || "",
    // Meta
    ts: body.ts || Date.now(),
    user_agent: ua,
    ip,
  };

  // Send to Zapier
  const resp = await fetch(env.ZAPIER_HOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return json({ error: "zapier_failed", status: resp.status, detail: text.slice(0, 500) }, 502);
  }

  return json({ ok: true }, 200);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}
