(function () {
  /* ============================
     Konfiguration
  ============================ */
  const THINK_MS = 750; // “tænke”-tid mellem step 2 → 3 (ms). Justér frit.

  /* ============================
     Webflow/iframe højde (throttlet + pausable)
  ============================ */
  let _heightTick = null, _heightTimer = null;
  let _heightPaused = false;

  function safePostHeight() {
    if (_heightPaused) return;      // respekter pause under batch
    if (_heightTick) return;        // saml flere kald i samme frame
    _heightTick = requestAnimationFrame(() => {
      _heightTick = null;
      if (_heightTimer) clearTimeout(_heightTimer);
      _heightTimer = setTimeout(() => {
        const h = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
        try { parent.postMessage({ type: "FF_CALC_HEIGHT", height: h }, "*"); } catch (_) {}
      }, 90); // kan sættes til 60–140 afhængigt af embed
    });
  }

  /* ============================
     Markup
  ============================ */
  const root = document.createElement("div");
  root.className = "wrap";
  root.innerHTML = `
    <div class="card" role="region" aria-label="Arbejdsskade - prisberegner">
      <div class="hdr"><div class="dot" aria-hidden="true"></div><h2 class="title">Arbejdsskade - prisberegner</h2></div>

      <div class="steps" aria-hidden="true">
        <div class="step is" data-step="1">1. CVR</div>
        <div class="step" data-step="2">2. Stillinger</div>
        <div class="step" data-step="3">3. Se pris</div>
      </div>

      <div class="body">
        <!-- Step 1 -->
        <section class="pane" data-step="1">
          <div class="grid">
            <div>
              <label for="cvr">CVR-nummer</label>
              <input id="cvr" name="cvr" type="text" inputmode="numeric" placeholder="XXXXXXXX" maxlength="8" autocomplete="off" />
              <div class="hint">Indtast CVR (8 cifre) – vi henter automatisk data fra VIRK.</div>
            </div>
            <div id="virk-box" class="review muted" aria-live="polite">Ingen virksomhedsdata endnu.</div>
            <div class="actions"><button id="next1" class="btn">Næste</button></div>
          </div>
        </section>

        <!-- Step 2 -->
        <section class="pane" data-step="2" hidden>
          <div class="grid">
            <div class="row">
              <div>
                <label for="antal">Antal medarbejdere</label>
                <select id="antal" name="antal"></select>
              </div>
            </div>
            <div class="hint">Vælg stilling for hver medarbejder.</div>
            <div id="roles" class="list"></div>
            <div class="actions">
              <button id="back2" class="btn secondary">Tilbage</button>
              <button id="next2" class="btn">Se pris</button>
            </div>
          </div>
        </section>

        <!-- Step 3 -->
        <section class="pane" data-step="3" hidden>
          <div class="two-col">
            <div class="col-price">
              <div class="kicker">Beregnet pris</div>
              <div id="breakdown" class="grid role-list"></div>
              <div class="total">
                <div class="total-label">Årlig pris (inkl. gebyrer og afgifter)</div>
                <div class="total-amount" id="total">0 kr.</div>
              </div>
              <div id="price-disclaimer" class="disclaimer">
                Den viste pris er vejledende og ikke garanteret, da skadeshistorik, indeksering og øvrige forsikringsforhold kan påvirke den endelige pris. Priserne er baseret på tilbud fra en af vores mange samarbejdspartnere.
              </div>
              <button id="price-disclaimer-toggle" class="disclaimer-toggle" type="button">Læs mere …</button>
            </div>

            <aside class="col-aside">
              <h3 class="lead-title">Lyder det interessant?</h3>
              <h4 class="lead-subtitle">Så indtast dit telefonnummer</h4>

              <div class="phone-field">
                <label for="lead-phone">Telefonnummer</label>
                <input id="lead-phone" name="phone" type="tel" inputmode="tel" placeholder="XXXXXXXX" autocomplete="tel">
              </div>

              <div class="privacy disclaimer">
                Vi behandler din data ordentligt.
                <a href="https://www.fforsikring.dk/politikker/privatlivspolitik" target="_blank" rel="noopener noreferrer">Læs vores privatlivspolitik</a>.
              </div>

              <div class="actions cta-area">
                <button id="submit" class="btn fullwidth">Bliv kontaktet af en rådgiver</button>
              </div>
            </aside>
          </div>

          <div class="actions back-row">
            <button id="back3" class="btn secondary">Tilbage</button>
          </div>
        </section>
      </div>
    </div>

    <!-- Bridge -->
    <div id="bridge" class="bridge-overlay" aria-hidden="true">
      <div class="bridge-box">
        <div class="bridge-title">Beregner pris…</div>
        <div class="meter"><span></span></div>
        <div class="bridge-hint">Et øjeblik – vi samler dine valg</div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  // OBS: observer KUN din app-root (mindre støj end hele documentElement)
  new ResizeObserver(safePostHeight).observe(root);
  window.addEventListener("load", safePostHeight);

  /* ============================
     Helpers
  ============================ */
  const $  = (s, el=document) => el.querySelector(s);
  const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));

  const state = { step: 1, cvr: "", virk: null, antal: 1, roles: [], total: 0 };
  const money = (n) => (n || 0).toLocaleString("da-DK") + " kr.";
  const cleanCVR = (v) => String(v || "").replace(/\D+/g, "").slice(0, 8);
  const debounce = (fn, ms = 400) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  function normalizeDkPhone(s) {
    if (!s) return "";
    let d = String(s).replace(/[^\d]/g, "");
    if (d.startsWith("0045")) d = d.slice(4); else if (d.startsWith("45")) d = d.slice(2);
    return d;
  }

  /* ============================
     Data (stillinger) – lazy & cached
  ============================ */
  let POS = [];
  let posLoaded = false, posLoading = false;
  let SELECT_TEMPLATE = null; // build options once and clone per row

  async function ensurePositions() {
    if (posLoaded || posLoading) return;
    posLoading = true;
    try {
      const r = await fetch("positions.json", { cache: "no-cache" });
      const d = await r.json();
      POS = (d || []).sort((a,b)=>a.label.localeCompare(b.label,"da"));
      buildSelectTemplate();
      posLoaded = true;
    } catch(_) {
      POS = [];
      buildSelectTemplate();
      posLoaded = true;
    } finally {
      posLoading = false;
    }
  }

  function buildSelectTemplate() {
    const s = document.createElement("select");
    s.className = "role";
    const frag = document.createDocumentFragment();
    for (let i=0;i<POS.length;i++){
      const o = document.createElement("option");
      o.value = POS[i].label;
      o.textContent = POS[i].label;
      frag.appendChild(o);
    }
    s.appendChild(frag);
    SELECT_TEMPLATE = s;
  }

  function cloneRoleSelect() {
    return SELECT_TEMPLATE ? SELECT_TEMPLATE.cloneNode(true) : document.createElement("select");
  }

  /* ============================
     API
  ============================ */
  async function fetchVirkByCVR(cvr) {
    try {
      const r = await fetch("/api/cvr?cvr=" + encodeURIComponent(cvr));
      if (!r.ok) { if (r.status === 429) return { kvote: true }; return null; }
      return await r.json();
    } catch { return null; }
  }

  /* ============================
     Steps
  ============================ */
  function setStep(n) {
    state.step = n;
    $$(".step").forEach(el => el.classList.toggle("is", +el.dataset.step === n));
    $$(".pane").forEach(el => el.hidden = (+el.dataset.step !== n));

    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch(_) {}
    safePostHeight();

    if (n === 2) {
      ensurePositions().then(() => {
        initStep2Once();
        syncRoleRows();
      });
    } else if (n === 3) {
      requestAnimationFrame(wireDisclaimerToggle);
    }
  }

  /* ============================
     “Læs mere …” toggle (Step 3)
  ============================ */
  let toggleWired = false;
  function wireDisclaimerToggle(){
    const disc = $("#price-disclaimer");
    const btn  = $("#price-disclaimer-toggle");
    if (!disc || !btn) return;

    // reset label hver gang vi lander på step 3
    btn.textContent = disc.classList.contains("expanded") ? "Skjul tekst" : "Læs mere …";
    if (toggleWired) return; // bind kun én gang
    toggleWired = true;

    btn.addEventListener("click", () => {
      disc.classList.toggle("expanded");
      btn.textContent = disc.classList.contains("expanded") ? "Skjul tekst" : "Læs mere …";
      safePostHeight();
    }, { passive: true });
  }

  /* ============================
     Step 2 (hurtig, minimal DOM)
  ============================ */
  let antalInitialized = false;
  function initStep2Once() {
    if (antalInitialized) return;
    const sel = $("#antal");
    if (sel && !sel.children.length) {
      sel.innerHTML = Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("");
      sel.value = "1";
    }
    sel?.addEventListener("change", () => { syncRoleRows(); safePostHeight(); });
    antalInitialized = true;
  }

  function syncRoleRows() {
    const sel = $("#antal");
    const container = $("#roles");
    if (!sel || !container) return;

    const target = parseInt(sel.value || "1", 10);
    state.antal = target;

    // init/trim state
    if (state.roles.length < target) {
      state.roles = state.roles.concat(new Array(target - state.roles.length).fill(POS[0]?.label || ""));
    } else if (state.roles.length > target) {
      state.roles.length = target;
    }

    const currentRows = container.children.length;

    // PAUSE height-post under batch
    _heightPaused = true;

    // Add missing rows
    if (currentRows < target) {
      const frag = document.createDocumentFragment();
      for (let i=currentRows;i<target;i++){
        const row = document.createElement("div");
        row.className = "item";
        row.setAttribute("data-idx", String(i));

        const left = document.createElement("div");
        left.innerHTML = `<strong>Medarbejder ${i + 1}</strong>`;

        const right = document.createElement("div");
        const select = cloneRoleSelect();
        select.value = state.roles[i] || POS[0]?.label || "";
        select.addEventListener("change", (e) => { state.roles[i] = e.target.value; }, { passive: true });

        right.appendChild(select);
        row.appendChild(left);
        row.appendChild(right);
        frag.appendChild(row);
      }
      container.appendChild(frag);
    }

    // Remove extra rows
    if (currentRows > target) {
      for (let i=currentRows-1; i>=target; i--){
        container.removeChild(container.lastElementChild);
      }
    }

    // Update existing rows (labels/values only if needed)
    for (let i=0; i<container.children.length; i++){
      const row = container.children[i];
      const label = row.firstElementChild?.querySelector("strong");
      if (label && label.textContent !== `Medarbejder ${i+1}`) label.textContent = `Medarbejder ${i+1}`;
      const select = row.querySelector("select.role") || row.querySelector("select");
      const desired = state.roles[i] || (POS[0]?.label || "");
      if (select && select.value !== desired) select.value = desired;
    }

    // Un-pause og post højde én gang
    requestAnimationFrame(() => {
      _heightPaused = false;
      safePostHeight();
    });
  }

  /* ============================
     Prisberegning (Step 3)
  ============================ */
  let _priceMap = null;
  function calculateTotal() {
    const list = $("#breakdown");
    list.classList.add("role-list");
    list.innerHTML = "";

    if (!_priceMap) _priceMap = new Map(POS.map(o => [o.label, o.price]));

    let sum = 0;
    const frag = document.createDocumentFragment();

    for (let i=0;i<state.roles.length;i++){
      const r = state.roles[i];
      const p = _priceMap.get(r) || 0;
      sum += p;
      const div = document.createElement("div");
      div.className = "role-card";
      div.innerHTML = `
        <div class="idx">${i + 1}</div>
        <div>${r || "—"}</div>
        <div class="price-pill">${(p||0).toLocaleString("da-DK",{minimumFractionDigits:2})} kr.</div>`;
      frag.appendChild(div);
    }

    list.appendChild(frag);
    state.total = Math.round(sum);
    $("#total").textContent = money(state.total);
    safePostHeight();
  }

  /* ============================
     API: CVR
  ============================ */
  async function fetchVirkByCVRThrottled(val, box) {
    if (val.length !== 8) { box.textContent = "Indtast 8 cifre for CVR."; return; }
    box.textContent = "Henter virksomhedsdata…";
    const v = await fetchVirkByCVR(val);

    if (v?.kvote) {
      box.innerHTML = '<div class="muted">Vi har ramt opslaggrænsen hos CVR lige nu. Prøv igen om lidt – vi indhenter data manuelt, hvis det fortsætter.</div>';
      safePostHeight(); return;
    }

    if (v && (v.navn || v.name || v.cvr)) {
      state.virk = v; state.cvr = val;
      const navn = v.navn || v.name || "-";
      const adresse = v.adresse || v.address || "-";
      const branche = v.branche || v.industrydesc;
      const branchekode = v.branchekode || v.industrycode;
      box.innerHTML =
        `<div class="review-row"><strong>Virksomhed:</strong> ${navn}</div>
         <div class="review-row"><strong>CVR:</strong> ${v.cvr || "-"}</div>
         <div class="review-row"><strong>Adresse:</strong> ${adresse}</div>
         ${branche ? `<div class="review-row"><strong>Branche:</strong> ${branche}</div>` : ""}
         ${branchekode ? `<div class="review-row"><strong>Branchekode:</strong> ${branchekode}</div>` : ""}`;
    } else {
      box.innerHTML = '<div class="muted">Kunne ikke hente virksomhedsdata (rate limit eller fejl). Vi indhenter det manuelt efterfølgende.</div>';
    }
    safePostHeight();
  }

  /* ============================
     Init & events
  ============================ */
  function init() {
    const cvrInput = $("#cvr");
    const next1 = $("#next1");
    const antalEl = $("#antal");
    const back2 = $("#back2");
    const next2 = $("#next2");
    const back3 = $("#back3");
    const submitBtn = $("#submit");

    const handleCVRInput = debounce(async (val) => {
      const box = $("#virk-box");
      fetchVirkByCVRThrottled(val, box);
    }, 450);

    cvrInput?.addEventListener("input", (e) => {
      const val = cleanCVR(e.target.value);
      e.target.value = val;
      handleCVRInput(val);
    });

    next1?.addEventListener("click", () => {
      const val = cleanCVR(cvrInput?.value);
      if (val.length !== 8) { alert("Udfyld et gyldigt CVR-nummer."); return; }
      setStep(2);
    });

    antalEl?.addEventListener("change", () => { syncRoleRows(); safePostHeight(); });
    back2 && (back2.onclick = () => setStep(1));

    next2 && (next2.onclick = () => {
      _priceMap = null;
      const byLabel = new Map(POS.map(o => [o.label, o.price]));
      const bad = state.roles.findIndex(r => !byLabel.has(r));
      if (bad !== -1) { alert("Vælg en gyldig stilling for medarbejder " + (bad + 1)); return; }

      calculateTotal();

      const bridge = $("#bridge");
      bridge.classList.add("show");
      setTimeout(() => { bridge.classList.remove("show"); setStep(3); }, THINK_MS);
    });

    back3 && (back3.onclick = () => setStep(2));

    submitBtn?.addEventListener("click", () => {
      const phoneEl = $("#lead-phone");
      const normalized = normalizeDkPhone(phoneEl?.value || "");
      if (normalized.length !== 8) { alert("Skriv et dansk telefonnummer på 8 cifre."); phoneEl?.focus(); return; }
      if (phoneEl) phoneEl.value = normalized;

      const urlp = new URLSearchParams(location.search);
      const payload = {
        cvr: state.cvr || cleanCVR($("#cvr")?.value),
        virk: state.virk || {},
        roles: state.roles,
        total: state.total,
        phone: normalized,
        page: location.href,
        referrer: document.referrer || "",
        utm_source: urlp.get("utm_source") || "",
        utm_medium: urlp.get("utm_medium") || "",
        utm_campaign: urlp.get("utm_campaign") || "",
        utm_term: urlp.get("utm_term") || "",
        utm_content: urlp.get("utm_content") || "",
        ts: Date.now(),
      };

      fetch("/api/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        .catch(() => {});

      submitBtn.setAttribute("disabled", "true");
      phoneEl?.setAttribute("disabled", "true");
      submitBtn.textContent = "Tak! Vi kontakter dig";

      try { window.dataLayer = window.dataLayer || []; window.dataLayer.push({ event: "lead_submitted", value: state.total }); } catch(_) {}
      try { parent.postMessage({ type: "FF_CALC_EVENT", event: "lead_submitted", value: state.total }, "*"); } catch(_) {}

      safePostHeight();
    });
  }

  init();

  /* ============================
     Prefetch positions on idle (Step 2 bliver instant)
  ============================ */
  if ("requestIdleCallback" in window) {
    requestIdleCallback(() => ensurePositions().catch(() => {}));
  } else {
    setTimeout(() => ensurePositions().catch(() => {}), 500);
  }
})();
