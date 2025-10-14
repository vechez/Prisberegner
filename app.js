(function () {
  /* ---------- iframe-højde til Webflow ---------- */
  function postHeight(){
    const h = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    try{ parent.postMessage({type:"FF_CALC_HEIGHT", height:h},"*"); }catch(_){}
  }
  new ResizeObserver(postHeight).observe(document.documentElement);
  window.addEventListener("load", postHeight);

  /* ---------- markup ---------- */
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
              <label for="cvr">Indtast CVR-nummer</label>
              <input id="cvr" name="cvr" type="text" inputmode="numeric" placeholder="XXXXXXXX" maxlength="8" aria-describedby="cvr-help" autocomplete="off" />
              <div id="cvr-help" class="hint">Vi henter automatisk data fra VIRK.</div>
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
            <!-- PRIS (venstre desktop / øverst mobil) -->
            <div class="grid col-price">
              <div class="kicker">Beregnet pris</div>
              <div id="breakdown" class="grid role-list"></div>

              <div class="total">
                <div class="total-label">Årlig pris (inkl. gebyrer og afgifter)</div>
                <div class="total-amount" id="total">0 kr.</div>
              </div>

              <div id="price-disclaimer" class="disclaimer">
                Prisen er årlig og inkluderer alle gebyrer og afgifter. Den viste pris er vejledende og ikke garanteret, da skadeshistorik, indeksering og øvrige forsikringsforhold kan påvirke den endelige pris. Priserne er baseret på tilbud fra en af vores mange samarbejdspartnere.
              </div>
            </div>

            <!-- KONTAKT (højre desktop / under pris mobil) -->
            <aside class="col-aside">
              <!-- OVERSKRIFT -> FELT -> PRIVACY -> CTA (orden låses i CSS) -->
              <h2 class="lead-title">Lyder det interessant?</h2>
              <h3 class="lead-subtitle">Så indtast dit telefonnummer</h3>



              <div class="phone-field">
                <label for="lead-phone">Telefonnummer</label>
                <input id="lead-phone" name="phone" type="tel" inputmode="tel" placeholder="XXXXXXXX" required autocomplete="tel">
              </div>

              <div class="privacy disclaimer">
                Vi behandler din data ordentligt.
                <a href="https://www.fforsikring.dk/politikker/privatlivspolitik" target="_blank" rel="noopener noreferrer">Læs vores privatlivspolitik</a>.
              </div>

              <div class="actions cta-area">
                <button id="submit" class="btn">Bliv kontaktet af en rådgiver</button>
              </div>

              <div id="thanks-card" class="thanks-card" hidden>
                <strong>Tak! Vi har modtaget din forespørgsel.</strong>
                <div class="muted">En rådgiver kontakter dig telefonisk inden for 24 timer på hverdage.</div>
              </div>
            </aside>
          </div>

          <!-- Tilbage-knap (både desktop og mobil; nederst på mobil) -->
          <div class="actions back-row">
            <button id="back3" class="btn secondary">Tilbage</button>
          </div>
        </section>
      </div>
    </div>

    <!-- Loader/Bridge -->
    <div id="bridge" class="bridge-overlay" aria-hidden="true">
      <div class="bridge-box">
        <div class="bridge-title">Beregner pris…</div>
        <div class="meter"><span></span></div>
        <div class="bridge-hint">Et øjeblik – vi samler dine valg</div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  /* ---------- helpers ---------- */
  const $  = (s, el=document) => el.querySelector(s);
  const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));
  const isMobile = () => matchMedia("(max-width:860px)").matches;

  const state = { step:1, cvr:"", virk:null, antal:1, roles:[], total:0 };
  const money = (n)=> (n||0).toLocaleString("da-DK")+" kr.";
  const cleanCVR = (v)=> String(v||"").replace(/\D+/g,"").slice(0,8);
  const debounce = (fn,ms=400)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}};

  function normalizeDkPhone(s){ if(!s) return ""; let d=String(s).replace(/[^\d]/g,""); if(d.startsWith("0045")) d=d.slice(4); else if(d.startsWith("45")) d=d.slice(2); return d; }

  /* ---------- data (stillinger) ---------- */
  let POS=[];
  fetch("positions.json")
    .then(r=>r.json())
    .then(d=>{ POS=(d||[]).sort((a,b)=>a.label.localeCompare(b.label,"da")); init(); })
    .catch(()=>{ POS=[]; init(); });

  /* ---------- API ---------- */
  async function fetchVirkByCVR(cvr){
    try{
      const r = await fetch("/api/cvr?cvr="+encodeURIComponent(cvr));
      if(!r.ok){ if(r.status===429) return {kvote:true}; return null; }
      return await r.json();
    }catch{ return null; }
  }

  /* ---------- Step handling ---------- */
  function setStep(n){
    state.step=n;
    $$(".step").forEach(el=>el.classList.toggle("is", +el.dataset.step===n));
    $$(".pane").forEach(el=>el.hidden=(+el.dataset.step!==n));
    window.scrollTo({top:0, behavior:"smooth"});

    // Mobil: skjul disclaimer bag "Læs mere …"
    if(n===3 && isMobile()){
      setupMobileDisclaimerToggle();  // sikrer knap + skjul
    }
    postHeight();
  }

  function setupMobileDisclaimerToggle(){
    const disclaimer = $("#price-disclaimer");
    if(!disclaimer) return;

    // Start skjult (uden .expanded)
    disclaimer.classList.remove("expanded");

    // Opret knap hvis den ikke findes
    let toggle = $("#price-disclaimer-toggle");
    if(!toggle){
      toggle = document.createElement("button");
      toggle.id = "price-disclaimer-toggle";
      toggle.className = "disclaimer-toggle";
      toggle.type = "button";
      toggle.textContent = "Læs mere …";
      disclaimer.after(toggle);
    }else{
      toggle.textContent = "Læs mere …";
    }

    toggle.onclick = () => {
      disclaimer.classList.toggle("expanded");
      toggle.textContent = disclaimer.classList.contains("expanded") ? "Skjul tekst" : "Læs mere …";
      postHeight();
    };
  }

  /* ---------- combobox (mobil scroll-sikker) ---------- */
  function makeCombo(host, idx){
    host.className="combobox";
    host.innerHTML =
      '<input class="combo-input" role="combobox" aria-expanded="false" aria-autocomplete="list" placeholder="Søg eller vælg stilling">'+
      '<div class="combo-list" role="listbox"></div>';

    const input = host.querySelector("input");
    const list  = host.querySelector(".combo-list");

    let opts=POS, open=false, cursor=-1;
    let touchStartY=0, touchStartX=0, moved=false, touching=false;

    function placeListFixed(){
      if(!isMobile()) return;
      const r=input.getBoundingClientRect();
      const vv=window.visualViewport; const offY = vv? vv.offsetTop:0;
      Object.assign(list.style,{position:"fixed",left:r.left+"px",top:(r.bottom+6-offY)+"px",width:r.width+"px",maxWidth:r.width+"px"});
    }
    function resetListPos(){
      if(!isMobile()) return;
      list.style.removeProperty("left");list.style.removeProperty("top");list.style.removeProperty("width");list.style.removeProperty("max-width");
      list.style.position="fixed";
    }
    function openList(){
      if(!opts||!opts.length) return;
      list.style.display="block"; input.setAttribute("aria-expanded","true"); open=true;
      if(isMobile()){
        placeListFixed();
        window.addEventListener("scroll",placeListFixed,{passive:true});
        window.addEventListener("resize",placeListFixed,{passive:true});
        window.visualViewport?.addEventListener("resize",placeListFixed);
        window.visualViewport?.addEventListener("scroll",placeListFixed,{passive:true});
      }else list.style.position="absolute";
      setTimeout(()=>host.scrollIntoView({behavior:"smooth",block:"center"}),60);
    }
    function closeList(){
      list.style.display="none"; input.setAttribute("aria-expanded","false"); open=false; cursor=-1;
      if(isMobile()){
        window.removeEventListener("scroll",placeListFixed);
        window.removeEventListener("resize",placeListFixed);
        window.visualViewport?.removeEventListener("resize",placeListFixed);
        window.visualViewport?.removeEventListener("scroll",placeListFixed);
      }
      resetListPos();
    }

    function render(items){
      list.innerHTML="";
      (items||[]).slice(0,300).forEach((o,i)=>{
        const el=document.createElement("div");
        el.className="combo-opt"; el.setAttribute("role","option"); el.textContent=o.label;

        el.addEventListener("touchstart",(e)=>{const t=e.changedTouches[0];touching=true;moved=false;touchStartY=t.clientY;touchStartX=t.clientX},{passive:true});
        el.addEventListener("touchmove",(e)=>{if(!touching)return;const t=e.changedTouches[0];if(Math.abs(t.clientY-touchStartY)>8||Math.abs(t.clientX-touchStartX)>8)moved=true},{passive:true});
        el.addEventListener("touchend",(e)=>{if(!touching)return;touching=false;if(moved){moved=false;return;}e.preventDefault();input.value=o.label;state.roles[idx]=o.label;input.blur();closeList()},{passive:false});
        el.addEventListener("touchcancel",()=>{touching=false;moved=false},{passive:true});

        el.addEventListener("mousedown",(e)=>{if(touching)return;e.preventDefault();input.value=o.label;state.roles[idx]=o.label;closeList()});
        el.addEventListener("click",(e)=>{if(touching)e.preventDefault()});

        if(i===cursor) el.setAttribute("aria-selected","true");
        list.appendChild(el);
      });
      if(open && isMobile()) placeListFixed();
    }

    function filter(q){
      const s=(q||"").toLowerCase().trim();
      opts=!s? POS : POS.filter(o=>o.label.toLowerCase().includes(s));
      render(opts); opts.length? openList() : closeList();
    }

    input.addEventListener("input",(e)=>filter(e.target.value));
    input.addEventListener("focus",()=>filter(input.value));
    input.addEventListener("click",()=>filter(input.value));
    input.addEventListener("keydown",(e)=>{
      if(!open && (e.key==="ArrowDown"||e.key==="Enter")){filter(input.value);return;}
      if(e.key==="Escape"){closeList();return;}
      if(!open) return;
      if(e.key==="ArrowDown"){cursor=Math.min(cursor+1,opts.length-1);render(opts);}
      else if(e.key==="ArrowUp"){cursor=Math.max(cursor-1,0);render(opts);}
      else if(e.key==="Enter"){ if(opts[cursor]){input.value=opts[cursor].label;state.roles[idx]=opts[cursor].label;input.blur();closeList();} }
    });

    document.addEventListener("pointerdown",(e)=>{if(open && !host.contains(e.target)) closeList()},{passive:true});
    input.addEventListener("blur",()=>setTimeout(()=>{if(open) closeList()},50));
  }

  /* ---------- step 2 UI ---------- */
  function renderRoleSelectors(){
    const sel=$("#antal"); const container=$("#roles");
    if(sel && sel.children.length===0){
      sel.innerHTML = Array.from({length:10},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join("") + '<option value="10+">10+</option>';
    }
    container.innerHTML="";
    const v=(sel && sel.value) || "1";
    state.antal = v==="10+"? 10 : parseInt(v,10);
    state.roles = new Array(state.antal).fill("");

    for(let i=0;i<state.antal;i++){
      const row=document.createElement("div");
      row.className="item";
      row.innerHTML=`<div><strong>Medarbejder ${i+1}</strong></div><div></div>`;
      makeCombo(row.lastElementChild,i);
      container.appendChild(row);
    }
    postHeight();
  }

  /* ---------- beregning ---------- */
  function calculateTotal(){
    const list=$("#breakdown");
    list.innerHTML="";
    let sum=0;
    const byLabel=new Map(POS.map(o=>[o.label,o.price]));
    state.roles.forEach((r,i)=>{
      const p=byLabel.get(r)||0;
      sum+=p;
      list.insertAdjacentHTML("beforeend",
        `<div class="role-card">
           <div class="idx">${i+1}</div>
           <div>${r || "—"}</div>
           <div class="price-pill">${(p||0).toLocaleString("da-DK",{minimumFractionDigits:2})} kr.</div>
         </div>`);
    });
    state.total=Math.round(sum);
    $("#total").textContent = money(state.total);
    postHeight();
  }

  /* ---------- Moderne popup (modal) markup + logik ---------- */
  // Inject global modal container
  const modalBackdrop = document.createElement("div");
  modalBackdrop.className = "ff-modal-backdrop";
  modalBackdrop.id = "ff-modal";
  modalBackdrop.innerHTML = `
    <div class="ff-modal" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="ff-modal-title">
      <div class="ff-modal__header">
        <h3 id="ff-modal-title" class="ff-modal__title">Info</h3>
        <button class="ff-modal__close" aria-label="Luk" data-close>&times;</button>
      </div>
      <div class="ff-modal__body" id="ff-modal-body"></div>
      <div class="ff-modal__actions">
        <button class="btn" id="ff-modal-ok">OK</button>
      </div>
    </div>`;
  document.body.appendChild(modalBackdrop);

  const FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
    'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  function openModal(){
    modalBackdrop.dataset.open = "true";
    modalBackdrop.style.display = "flex";
    document.documentElement.style.overflow = 'hidden';
    modalBackdrop.__prevFocus = document.activeElement;
    const dlg = modalBackdrop.querySelector('.ff-modal');
    const first = dlg.querySelector(FOCUSABLE) || dlg;
    first.focus({preventScroll:true});
    try{ parent.postMessage({type:"FF_MODAL_OPENED"},"*"); }catch(_){}
  }
  function closeModal(){
    modalBackdrop.dataset.open = "false";
    modalBackdrop.style.display = "none";
    document.documentElement.style.overflow = '';
    if(modalBackdrop.__prevFocus && modalBackdrop.__prevFocus.focus){
      modalBackdrop.__prevFocus.focus({preventScroll:true});
    }
    modalBackdrop.__prevFocus = null;
    try{ parent.postMessage({type:"FF_MODAL_CLOSED"},"*"); }catch(_){}
  }
  function trapFocus(e){
    if(modalBackdrop.dataset.open !== "true") return;
    const dlg = modalBackdrop.querySelector('.ff-modal');
    const focusables = dlg.querySelectorAll(FOCUSABLE);
    if(!focusables.length) return;
    const first = focusables[0];
    const last  = focusables[focusables.length-1];
    if(e.key === 'Tab'){
      if(e.shiftKey && document.activeElement === first){ last.focus(); e.preventDefault(); }
      else if(!e.shiftKey && document.activeElement === last){ first.focus(); e.preventDefault(); }
    }else if(e.key === 'Escape'){
      closeModal();
    }
  }
  modalBackdrop.addEventListener('mousedown', (e)=>{ if(e.target === modalBackdrop) closeModal(); });
  modalBackdrop.addEventListener('keydown', trapFocus);
  modalBackdrop.querySelectorAll('[data-close]').forEach(btn=>btn.addEventListener('click', closeModal));
  modalBackdrop.querySelector('#ff-modal-ok').addEventListener('click', closeModal);

  // Public: showPopup(title, html, {okText})
  function showPopup(title, html, opts={}){
    const t = modalBackdrop.querySelector('#ff-modal-title');
    const b = modalBackdrop.querySelector('#ff-modal-body');
    const ok = modalBackdrop.querySelector('#ff-modal-ok');
    t.textContent = title || "Info";
    b.innerHTML = typeof html === "string" ? html : "";
    ok.textContent = opts.okText || "OK";
    openModal();
  }

  /* ---------- init / events ---------- */
  function init(){
    const cvrInput=$("#cvr");
    const next1=$("#next1"); const antalEl=$("#antal");
    const back2=$("#back2"); const next2=$("#next2");
    const back3=$("#back3"); const submitBtn=$("#submit");

    const handleCVRInput = debounce(async (val)=>{
      const box=$("#virk-box");
      if(val.length!==8){ box.textContent="Indtast 8 cifre for CVR."; return; }
      box.textContent="Henter virksomhedsdata…";
      const v = await fetchVirkByCVR(val);

      if(v?.kvote){
        box.innerHTML='<div class="muted">Vi har ramt opslaggrænsen hos CVR lige nu. Prøv igen om lidt – vi indhenter data manuelt, hvis det fortsætter.</div>';
        postHeight(); return;
      }

      if(v && (v.navn||v.name||v.cvr)){
        state.virk=v; state.cvr=val;
        const navn=v.navn||v.name||"-";
        const adresse=v.adresse||v.address||"-";
        const branche=v.branche||v.industrydesc;
        const kode=v.branchekode||v.industrycode;
        box.innerHTML =
          `<div class="review-row"><strong>Virksomhed:</strong> ${navn}</div>
           <div class="review-row"><strong>CVR:</strong> ${v.cvr||"-"}</div>
           <div class="review-row"><strong>Adresse:</strong> ${adresse}</div>
           ${branche?`<div class="review-row"><strong>Branche:</strong> ${branche}</div>`:""}
           ${kode?`<div class="review-row"><strong>Branchekode:</strong> ${kode}</div>`:""}`;
      }else{
        box.innerHTML = '<div class="muted">Kunne ikke hente virksomhedsdata (rate limit eller fejl). Vi indhenter det manuelt efterfølgende.</div>';
      }
      postHeight();
    },450);

    cvrInput?.addEventListener("input",(e)=>{const v=cleanCVR(e.target.value);e.target.value=v;handleCVRInput(v);});

    next1?.addEventListener("click",()=>{
      const v=cleanCVR(cvrInput?.value);
      if(v.length!==8){
        showPopup("Manglende CVR", "<p>Udfyld et gyldigt CVR-nummer (8 cifre), før du går videre.</p>");
        return;
      }
      setStep(2);
    });

    antalEl?.addEventListener("change",renderRoleSelectors);
    renderRoleSelectors();

    back2 && (back2.onclick=()=>setStep(1));

    next2 && (next2.onclick=()=>{
      const byLabel=new Map(POS.map(o=>[o.label,o.price]));
      const bad = state.roles.findIndex(r=>!byLabel.has(r));
      if(bad!==-1){
        showPopup("Vælg stilling", `<p>Vælg en gyldig stilling for <strong>medarbejder ${bad+1}</strong>, før du går videre.</p>`);
        return;
      }
      calculateTotal();
      const bridge=$("#bridge");
      bridge.classList.add("show");
      setTimeout(()=>{ bridge.classList.remove("show"); setStep(3); }, 900);
    });

    back3 && (back3.onclick=()=>setStep(2));

    function handleSubmit(){
      const phoneEl=$("#lead-phone");
      const normalized=normalizeDkPhone(phoneEl?.value||"");
      if(normalized.length!==8){
        showPopup("Telefonnummer mangler", "<p>Skriv et dansk telefonnummer på <strong>8 cifre</strong>.</p>");
        phoneEl?.focus();
        return;
      }
      if(phoneEl) phoneEl.value=normalized;

      const urlp=new URLSearchParams(location.search);
      const payload={
        cvr: state.cvr,
        virk: state.virk||{},
        roles: state.roles,
        total: state.total,
        phone: normalized,
        page: location.href,
        referrer: document.referrer||"",
        utm_source:urlp.get("utm_source")||"",
        utm_medium:urlp.get("utm_medium")||"",
        utm_campaign:urlp.get("utm_campaign")||"",
        utm_term:urlp.get("utm_term")||"",
        utm_content:urlp.get("utm_content")||"",
        ts: Date.now()
      };

      fetch("/api/lead",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}).catch(()=>{});

      submitBtn?.setAttribute("disabled","true");
      phoneEl?.setAttribute("disabled","true");
      $("#thanks-card").hidden=false;

      try{ window.dataLayer=window.dataLayer||[]; window.dataLayer.push({event:"lead_submitted",value:state.total}); }catch(_){}
      try{ parent.postMessage({type:"FF_CALC_EVENT",event:"lead_submitted",value:state.total},"*"); }catch(_){}
      postHeight();
    }
    submitBtn?.addEventListener("click",handleSubmit);
  }

  /* kick off */
  init();
})();
