// FForsikring Arbejdsskade – Cloudflare Pages version
// - CVR hentes via /api/cvr (Cloudflare Pages Function)
// - Robust DK-telefon-normalisering (+45 / 0045 / 45 fjernes)
// - CVR-rensning rettet (kun 8 cifre)
// - Beholder postMessage-højdejustering til iframe-embed

(function () {
  /* -------- iframe-højde til parent -------- */
  function postHeight() {
    const h = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight
    );
    parent.postMessage({ type: "FF_CALC_HEIGHT", height: h }, "*");
  }
  new ResizeObserver(postHeight).observe(document.documentElement);
  window.addEventListener("load", postHeight);

  /* --------- markup --------- */
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
        <section class="pane" data-step="1">
          <div class="grid">
            <div>
              <label for="cvr">CVR-nummer</label>
              <input id="cvr" name="cvr" type="text" inputmode="numeric" placeholder="XXXXXXXX" maxlength="8" aria-describedby="cvr-help" autocomplete="off" />
              <div id="cvr-help" class="hint">Indtast CVR (8 cifre) – vi henter automatisk data fra VIRK.</div>
            </div>
            <div id="virk-box" class="review muted" aria-live="polite">Ingen virksomhedsdata endnu.</div>
            <div class="actions"><button id="next1" class="btn">Næste</button></div>
          </div>
        </section>

        <section class="pane" data-step="2" hidden>
          <div class="grid">
            <div class="row">
              <div>
                <label for="antal">Antal medarbejdere</label>
                <select id="antal" name="antal"></select>
              </div>
            </div>
            <div class="hint">Vælg stilling for hver medarbejder. (Listen viser kun titler)</div>
            <div id="roles" class="list"></div>
            <div class="actions"><button id="back2" class="btn secondary">Tilbage</button><button id="next2" class="btn">Se pris</button></div>
          </div>
        </section>

        <section class="pane" data-step="3" hidden>
          <div class="two-col">
            <div class="grid">
              <div class="kicker">Fra-priser</div>
              <div id="breakdown" class="grid"></div>
              <div class="total">
                <div class="total-label">Årlig pris (inkl. gebyrer og afgifter)</div>
                <div class="total-amount" id="total">0 kr.</div>
              </div>
              <div id="price-disclaimer" class="disclaimer">
                Prisen er årlig og inkluderer alle gebyrer og afgifter. Den viste pris er vejledende og ikke garanteret, da skadeshistorik og øvrige forsikringsforhold kan påvirke den endelige pris. Priserne er baseret på tilbud fra en af vores mange samarbejdspartnere.
              </div>
              <div class="actions"><button id="back3" class="btn secondary">Tilbage</button></div>
            </div>
            <aside class="grid">
              <div class="hint">Kunne du tænke dig at høre mere? Så indtast dit telefonnummer, og vi kontakter dig med et tilbud baseret på dine valg.</div>
              <div><label for="lead-phone">Telefon</label><input id="lead-phone" name="phone" type="tel" inputmode="tel" placeholder="20 12 34 56" required autocomplete="tel"></div>
              <div class="hint">Indtast telefonnummer og få et uforpligtende tilbud.<br><br>Vi behandler dit data ordentligt. <a href="https://www.fforsikring.dk/politikker/privatlivspolitik" target="_blank" rel="noopener noreferrer">Læs vores privatlivspolitik</a>.</div>
              <div class="actions"><button id="submit" class="btn">Bliv kontaktet af en rådgiver</button></div>
              <div id="thanks-card" class="thanks-card" hidden>
                <strong>Tak! Vi har modtaget din forespørgsel.</strong>
                <div class="muted">En rådgiver kontakter dig telefonisk inden for 24 timer på hverdage.</div>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </div>
    <div id="bridge" class="bridge-overlay" aria-hidden="true">
      <div class="bridge-box">
        <div class="bridge-title">Beregner pris…</div>
        <div class="meter"><span></span></div>
        <div class="bridge-hint">Et øjeblik – vi samler dine valg</div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  /* -------- helpers -------- */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const state = { step: 1, cvr: "", virk: null, antal: 1, roles: [], total: 0 };
  const money = (n) =>
    (n || 0).toLocaleString("da-DK", { minimumFractionDigits: 0 }) + " kr.";

  // CVR → kun 8 cifre
  const cleanCVR = (v) => String(v || "").replace(/\D+/g, "").slice(0, 8);

  // Debounce
  const debounce = (fn, ms = 400) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  // DK-telefon normalisering
  function normalizeDkPhone(input) {
    if (!input) return "";
    let digits = String(input).replace(/[^\d]/g, "");
    if (digits.startsWith("0045")) digits = digits.slice(4);
    else if (digits.startsWith("45")) digits = digits.slice(2);
    return digits;
  }

  /* -------- data -------- */
  let POS = [];
  fetch("positions.json")
    .then((r) => r.json())
    .then((d) => {
      POS = (d || []).sort((a, b) => a.label.localeCompare(b.label, "da"));
      init();
    })
    .catch(() => {
      POS = [];
      init();
    });

  // Cloudflare Pages Function: /api/cvr
  async function fetchVirkByCVR(cvr) {
    try {
      const r = await fetch("/api/cvr?cvr=" + encodeURIComponent(cvr));
      if (!r.ok) throw new Error("upstream");
      const d = await r.json();
      if (d && (d.cvr || d.vat))
        return {
          cvr: d.cvr || d.vat,
          navn: d.name || d.virksomhedsnavn,
          adresse: [d.address, d.zipcode, d.city].filter(Boolean).join(", "),
          branche: d.industrydesc || d.main_industrycode_tekst || null,
          branchekode:
            d.industrycode || d.main_industrycode || d.branchekode || null,
          ansatte:
            typeof d.employees === "number"
              ? d.employees
              : d.employeesYear || d.antal_ansatte || null,
        };
    } catch (e) {
      return null;
    }
    return null;
  }

  /* -------- UI logik -------- */
  function setStep(n) {
    state.step = n;
    $$(".step").forEach((el) =>
      el.classList.toggle("is", +el.dataset.step === n)
    );
    $$(".pane").forEach(
      (el) => (el.hidden = +el.dataset.step !== n)
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
    postHeight();
  }

  function makeCombo(host, idx) {
    host.className = "combobox";
    host.innerHTML =
      '<input class="combo-input" role="combobox" aria-expanded="false" aria-autocomplete="list" placeholder="Søg/skriv og vælg stilling">' +
      '<div class="combo-list" role="listbox"></div>';
    const input = host.querySelector("input"),
      list = host.querySelector(".combo-list");
    let opts = POS;
    let open = false,
      cursor = -1;
    const openList = () => {
      list.style.display = "block";
      input.setAttribute("aria-expanded", "true");
      open = true;
    };
    const closeList = () => {
      list.style.display = "none";
      input.setAttribute("aria-expanded", "false");
      open = false;
      cursor = -1;
    };
    const render = (items) => {
      list.innerHTML = "";
      items.slice(0, 300).forEach((o, i) => {
        const el = document.createElement("div");
        el.className = "combo-opt";
        el.setAttribute("role", "option");
        el.textContent = o.label;
        el.onclick = () => {
          input.value = o.label;
          state.roles[idx] = o.label;
          closeList();
        };
        if (i === cursor) el.setAttribute("aria-selected", "true");
        list.appendChild(el);
      });
    };
    const filter = (q) => {
      const s = (q || "").toLowerCase();
      opts = POS.filter((o) => o.label.toLowerCase().includes(s));
      render(opts);
      if (opts.length) openList();
      else closeList();
    };
    input.addEventListener("input", (e) => {
      filter(e.target.value);
    });
    input.addEventListener("focus", () => {
      filter(input.value);
    });
    input.addEventListener("keydown", (e) => {
      if (!open && ["ArrowDown", "Enter"].includes(e.key)) {
        filter(input.value);
        return;
      }
      if (e.key === "Escape") {
        closeList();
        return;
      }
      if (!open) return;
      if (e.key === "ArrowDown") {
        cursor = Math.min(cursor + 1, opts.length - 1);
        render(opts);
      } else if (e.key === "ArrowUp") {
        cursor = Math.max(cursor - 1, 0);
        render(opts);
      } else if (e.key === "Enter") {
        if (opts[cursor]) {
          input.value = opts[cursor].label;
          state.roles[idx] = opts[cursor].label;
          closeList();
        }
      }
    });
    document.addEventListener(
      "click",
      (e) => {
        if (!host.contains(e.target)) closeList();
      },
      { passive: true }
    );
  }

  function renderRoleSelectors() {
    const sel = $("#antal");
    if (sel.children.length === 0) {
      sel.innerHTML =
        Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("") +
        '<option value="10+">10+</option>';
    }
    const container = document.getElementById("roles");
    const prev = [...state.roles];
    container.innerHTML = "";
    const v = sel.value || "1";
    state.antal = v === "10+" ? 10 : parseInt(v, 10);
    state.roles = new Array(state.antal).fill("");
    for (let i = 0; i < state.antal; i++) {
      const wrap = document.createElement("div");
      wrap.className = "item";
      const left = document.createElement("div");
      left.innerHTML = "<strong>Medarbejder " + (i + 1) + "</strong>";
      const right = document.createElement("div");
      makeCombo(right, i);
      wrap.appendChild(left);
      wrap.appendChild(right);
      container.appendChild(wrap);
      if (prev[i]) {
        const input = right.querySelector("input");
        input.value = prev[i];
        state.roles[i] = prev[i];
      }
    }
    postHeight();
  }

  function calculateTotal() {
    let sum = 0;
    const list = document.getElementById("breakdown");
    list.classList.add("role-list");
    list.innerHTML = "";
    const byLabel = new Map(POS.map((o) => [o.label, o.price]));
    for (let i = 0; i < state.roles.length; i++) {
      const r = state.roles[i];
      const p = byLabel.get(r) || 0;
      sum += p;
      const row = document.createElement("div");
      row.className = "role-card";
      row.innerHTML =
        '<div class="idx">' +
        (i + 1) +
        '</div><div class="role-chip">' +
        (r || "—") +
        '</div><div class="price-pill">' +
        money(p) +
        "</div>";
      list.appendChild(row);
    }
    state.total = Math.round(sum);
    document.getElementById("total").textContent = money(state.total);
    postHeight();
  }

  /* -------- init & events -------- */
  function init() {
    const cvrInput = document.getElementById("cvr");
    const next1 = document.getElementById("next1");
    const antalEl = document.getElementById("antal");
    const back2 = document.getElementById("back2");
    const next2 = document.getElementById("next2");
    const back3 = document.getElementById("back3");
    const submitBtn = document.getElementById("submit");

    const handleCVRInput = debounce(async (val) => {
      if (val.length === 8) {
        const box = document.getElementById("virk-box");
        box.textContent = "Henter virksomhedsdata…";
        const v = await fetchVirkByCVR(val);
        if (v) {
          state.virk = v;
          state.cvr = val;
          box.innerHTML =
            '<div class="review-row"><strong>Virksomhed:</strong> ' +
            (v.navn || "-") +
            "</div>" +
            '<div class="review-row"><strong>CVR:</strong> ' +
            (v.cvr || "-") +
            "</div>" +
            '<div class="review-row"><strong>Adresse:</strong> ' +
            (v.adresse || "-") +
            "</div>" +
            (v.branche
              ? '<div class="review-row"><strong>Branche:</strong> ' +
                v.branche +
                "</div>"
              : "") +
            (v.branchekode
              ? '<div class="review-row"><strong>Branchekode:</strong> ' +
                v.branchekode +
                "</div>"
              : "") +
            (v.ansatte != null
              ? '<div class="review-row"><strong>Antal ansatte:</strong> ' +
                v.ansatte +
                "</div>"
              : "");
        } else {
          box.innerHTML =
            '<div class="muted">Kunne ikke hente virksomhedsdata. Vi indhenter det manuelt efterfølgende.</div>';
        }
        postHeight();
      }
    }, 450);

    cvrInput.addEventListener("input", (e) => {
      const val = cleanCVR(e.target.value);
      e.target.value = val;
      handleCVRInput(val);
    });

    next1.addEventListener("click", () => {
      const val = cleanCVR(cvrInput.value);
      if (val.length !== 8) {
        alert("Udfyld et gyldigt CVR-nummer.");
        return;
      }
      setStep(2);
      antalEl.focus();
      postHeight();
    });

    antalEl.addEventListener("change", renderRoleSelectors);
    renderRoleSelectors();

    back2 && (back2.onclick = () => setStep(1));

    next2 &&
      (next2.onclick = () => {
        const byLabel = new Map(POS.map((o) => [o.label, o.price]));
        const bad = state.roles.findIndex((r) => !byLabel.has(r));
        if (bad !== -1) {
          alert("Vælg en gyldig stilling for medarbejder " + (bad + 1));
          return;
        }
        calculateTotal();
        const bridge = document.getElementById("bridge");
        bridge.classList.add("show");
        setTimeout(() => {
          bridge.classList.remove("show");
          setStep(3);
        }, 900);
      });

    back3 && (back3.onclick = () => setStep(2));

    function handleSubmit() {
      const phoneEl = document.getElementById("lead-phone");
      const normalizedPhone = normalizeDkPhone(phoneEl?.value || "");
      if (normalizedPhone.length !== 8) {
        alert("Skriv et dansk telefonnummer på 8 cifre.");
        phoneEl && phoneEl.focus();
        return;
      }
      // skriv renset værdi tilbage i input
      if (phoneEl) phoneEl.value = normalizedPhone;

      const validCVR = cleanCVR(cvrInput.value);
      if (validCVR.length !== 8) {
        alert("Udfyld gyldigt CVR-nummer.");
        return;
      }

      const urlp = new URLSearchParams(location.search);
      const payload = {
        cvr: state.cvr || validCVR,
        virk: state.virk || {},
        roles: state.roles,
        total: state.total,
        phone: normalizedPhone,
        page: location.href,
        referrer: document.referrer || "",
        utm_source: urlp.get("utm_source") || "",
        utm_medium: urlp.get("utm_medium") || "",
        utm_campaign: urlp.get("utm_campaign") || "",
        utm_term: urlp.get("utm_term") || "",
        utm_content: urlp.get("utm_content") || "",
        ts: Date.now(),
      };

      // TODO: Hvis du laver en Cloudflare function til lead (fx /api/lead), så skift endpoint herunder:
      fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});

      const btn = document.getElementById("submit");
      btn.classList.add("success", "pulse");
      btn.setAttribute("disabled", "true");
      phoneEl.setAttribute("disabled", "true");
      document.getElementById("thanks-card").hidden = false;

      try {
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ event: "lead_submitted", value: state.total });
      } catch (e) {}
      parent.postMessage(
        { type: "FF_CALC_EVENT", event: "lead_submitted", value: state.total },
        "*"
      );
      postHeight();
    }
    $("#submit").addEventListener("click", handleSubmit);
  }
})();
