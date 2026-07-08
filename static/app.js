// MadeGood Paid System — frontend

let PW = "";
const $ = id => document.getElementById(id);
const esc = s => String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const fmt = n => n != null ? Number(n).toLocaleString() : "—";
const fmtD = n => n != null && n !== "" ? "$" + Math.round(Number(n)).toLocaleString() : "—";
const fmtDate = s => s ? new Date(s + "T12:00:00").toLocaleDateString("en-US", {month:"short",day:"numeric",year:"numeric"}) : "—";

// ── Auth ──────────────────────────────────────────────────────────────────────
$("gate-btn").addEventListener("click", async () => {
  const pw = $("gate-pw").value.trim();
  const r = await fetch("/api/auth", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({password:pw}) });
  if (r.ok) {
    PW = pw;
    $("gate").classList.add("hidden");
    $("app").classList.remove("hidden");
    loadCurrentTab();
  } else {
    $("gate-err").classList.remove("hidden");
  }
});
$("gate-pw").addEventListener("keydown", e => { if (e.key === "Enter") $("gate-btn").click(); });

// ── Tab switching ─────────────────────────────────────────────────────────────
let currentTab = "master-list";
let currentListType = "INT";

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    currentTab = btn.dataset.tab;
    $(`tab-${currentTab}`).classList.add("active");
    loadCurrentTab();
  });
});

function loadCurrentTab() {
  const loaders = {
    "master-list":    loadMasterList,
    "outreach":       loadOutreach,
    "paid-plan":      loadPaidPlan,
    "content-cal":    loadCalendar,
    "content-review": loadContentReview,
    "live-posts":     loadLivePosts,
    "payments":       loadPayments,
    "budget":         loadBudget,
    "reporting":      loadReporting,
  };
  loaders[currentTab]?.();
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: {"Content-Type":"application/json"} };
  if (body) opts.body = JSON.stringify({...body, password: PW});
  const r = await fetch(path, opts);
  if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.detail || `HTTP ${r.status}`); }
  return r.json();
}
const apiGet    = path => fetch(path, {headers:{"Content-Type":"application/json"}}).then(r=>r.json());
const apiPost   = (path, body) => api("POST", path, body);
const apiPatch  = (path, body) => api("PATCH", path, body);
const apiDelete = path => fetch(path, {method:"DELETE"}).then(r=>r.json());

// ── Influencers cache ─────────────────────────────────────────────────────────
let allInfluencers = [];  // loaded when needed for dropdowns

async function getInfluencers() {
  if (!allInfluencers.length) {
    const [int, ext] = await Promise.all([apiGet("/api/influencers?list_type=INT"), apiGet("/api/influencers?list_type=EXT")]);
    allInfluencers = [...(int||[]), ...(ext||[])];
  }
  return allInfluencers;
}

function influencerOptions(filter) {
  const infs = filter ? allInfluencers.filter(filter) : allInfluencers;
  return infs.map(i => `<option value="${i.id}">${esc(i.name || i.ig_handle || "Unnamed")}</option>`).join("");
}

// ── 1. Master List ────────────────────────────────────────────────────────────
let mlSortCol = "name", mlSortDir = "asc";

async function loadMasterList() {
  allInfluencers = [];  // reset cache
  const [data, extData] = await Promise.all([
    apiGet(`/api/influencers?list_type=${currentListType}`),
    currentListType === "INT" ? apiGet("/api/influencers?list_type=EXT") : Promise.resolve([]),
  ]);
  const extHandles = new Set((extData || []).map(r => (r.ig_handle || "").toLowerCase()).filter(Boolean));
  const search   = $("ml-search")?.value.toLowerCase() || "";
  const tier     = $("ml-filter-tier")?.value || "";
  const gender   = $("ml-filter-gender")?.value || "";
  const campaign = $("ml-filter-campaign")?.value || "";
  let rows = data;
  if (search)   rows = rows.filter(r => `${r.name} ${r.ig_handle} ${r.tt_handle} ${r.vertical} ${r.campaign||""}`.toLowerCase().includes(search));
  if (tier)     rows = rows.filter(r => r.tier === tier);
  if (gender)   rows = rows.filter(r => r.gender === gender);
  if (campaign) rows = rows.filter(r => r.campaign === campaign);

  // Populate campaign filter options dynamically
  const campaigns = [...new Set(data.map(r => r.campaign).filter(Boolean))].sort();
  const campSel = $("ml-filter-campaign");
  if (campSel) {
    const cur = campSel.value;
    campSel.innerHTML = `<option value="">All campaigns</option>` + campaigns.map(c => `<option ${cur===c?"selected":""}>${esc(c)}</option>`).join("");
  }

  // Sort
  rows.sort((a, b) => {
    let av = a[mlSortCol] ?? "", bv = b[mlSortCol] ?? "";
    if (["ig_followers","tt_followers"].includes(mlSortCol)) { av = +av || 0; bv = +bv || 0; }
    else { av = String(av).toLowerCase(); bv = String(bv).toLowerCase(); }
    if (av < bv) return mlSortDir === "asc" ? -1 : 1;
    if (av > bv) return mlSortDir === "asc" ?  1 : -1;
    return 0;
  });

  // Set INT/EXT class on table for column visibility
  const mlTable = $("ml-table");
  if (mlTable) { mlTable.className = `tbl ml-${currentListType.toLowerCase()}`; }

  // Update sort icons
  document.querySelectorAll(".ml-sort .sort-icon").forEach(el => el.textContent = "");
  const activeSort = document.querySelector(`.ml-sort[data-col="${mlSortCol}"] .sort-icon`);
  if (activeSort) activeSort.textContent = mlSortDir === "asc" ? " ↑" : " ↓";

  $("ml-summary").innerHTML = `<span><strong>${rows.length}</strong> creators</span>`;

  $("ml-body").innerHTML = rows.length ? rows.map(r => {
    const inExt = currentListType === "INT" && r.ig_handle && extHandles.has(r.ig_handle.toLowerCase());
    const locDisplay = [r.location, r.location_country].filter(Boolean).join(", ");
    return `<tr>
    <td>${esc(r.name || "")}</td>
    <td>${r.ig_handle ? `<a href="${esc(r.ig_url||`https://instagram.com/${r.ig_handle}`)}" target="_blank">@${esc(r.ig_handle)}</a>` : "—"}</td>
    <td>${r.tt_handle ? `<a href="${esc(r.tt_url||`https://tiktok.com/@${r.tt_handle}`)}" target="_blank">@${esc(r.tt_handle)}</a>` : "—"}</td>
    <td>${fmt(r.ig_followers)}</td>
    <td>${fmt(r.tt_followers)}</td>
    <td>${r.tier ? `<span class="badge badge-int">${esc(r.tier)}</span>` : "—"}</td>
    <td>${esc(r.vertical || "")}</td>
    <td>${esc(locDisplay)}</td>
    <td>${esc(r.gender || "")}</td>
    <td>${esc(r.campaign || "")}</td>
    <td>${esc(r.email || "")}</td>
    <td><input class="ml-notes-inp" data-id="${r.id}" value="${esc(r.review_notes||"")}" placeholder="Notes…" style="background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:3px 7px;font-size:11px;width:140px"></td>
    <td class="int-col" style="text-align:center">${inExt ? `<span style="color:var(--green);font-weight:700;font-size:14px">✓</span>` : ""}</td>
    <td class="ext-col" style="text-align:center">
      ${currentListType==="EXT" ? `<input type="checkbox" class="ml-client-approved" data-id="${r.id}" ${r.client_approved?"checked":""} style="accent-color:var(--green);width:16px;height:16px;cursor:pointer">` : ""}
    </td>
    <td class="ext-col">
      ${currentListType==="EXT" ? `<input class="ml-client-notes" data-id="${r.id}" value="${esc(r.client_notes||"")}" placeholder="Client notes…" style="background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:3px 7px;font-size:11px;width:160px">` : ""}
    </td>
    <td>
      <button class="btn-icon btn-edit-inf" data-id="${r.id}" title="Edit">✏</button>
      ${currentListType==="INT" ? `<button class="btn-icon btn-copy-ext" data-id="${r.id}" title="Add to External list" style="font-size:10px;letter-spacing:.3px">${inExt ? `<span style="color:var(--green)">✓EXT</span>` : "→EXT"}</button>` : ""}
      ${currentListType==="INT" ? `<button class="btn-icon btn-reject-inf" data-id="${r.id}" style="color:var(--red);font-size:11px" title="Reject">${r.int_status==="rejected"?"✕ Rejected":"Reject"}</button>` : ""}
      <button class="btn-icon btn-del-inf" data-id="${r.id}" title="Delete">✕</button>
    </td>
  </tr>`;}).join("") : `<tr><td colspan="16" class="empty-cell">No creators yet. Click + Add Creator.</td></tr>`;

  // Edit/delete
  document.querySelectorAll(".btn-edit-inf").forEach(b =>
    b.addEventListener("click", () => {
      const row = rows.find(r => String(r.id) === b.dataset.id);
      if (row) openInfluencerModal(row);
    })
  );
  document.querySelectorAll(".btn-del-inf").forEach(b =>
    b.addEventListener("click", async () => {
      if (!confirm("Delete this creator? This cannot be undone.")) return;
      await fetch(`/api/influencers/${b.dataset.id}?password=${encodeURIComponent(PW)}`, {method:"DELETE"});
      loadMasterList();
    })
  );
  // Mark already-rejected rows red on load
  rows.forEach(r => {
    if (r.int_status === "rejected") {
      document.querySelectorAll(`.btn-reject-inf[data-id="${r.id}"]`).forEach(b =>
        b.closest("tr")?.classList.add("ml-rejected")
      );
    }
  });

  // Inline notes save
  document.querySelectorAll(".ml-notes-inp").forEach(inp =>
    inp.addEventListener("blur", () =>
      apiPatch(`/api/influencers/${inp.dataset.id}`, {review_notes: inp.value.trim() || null})
    )
  );

  // Reject button
  document.querySelectorAll(".btn-reject-inf").forEach(b =>
    b.addEventListener("click", async () => {
      const row = rows.find(r => String(r.id) === b.dataset.id);
      if (!row) return;
      const isRejected = row.int_status === "rejected";
      const newStatus = isRejected ? null : "rejected";
      await apiPatch(`/api/influencers/${b.dataset.id}`, {int_status: newStatus});
      row.int_status = newStatus;
      b.textContent = newStatus ? "✕ Rejected" : "Reject";
      b.closest("tr")?.classList.toggle("ml-rejected", !!newStatus);
    })
  );

  // EXT: client approved checkbox → also sets in_paid_plan
  document.querySelectorAll(".ml-client-approved").forEach(cb =>
    cb.addEventListener("change", async () => {
      await apiPatch(`/api/influencers/${cb.dataset.id}`, {
        client_approved: cb.checked,
        in_paid_plan:    cb.checked ? true : undefined,
      });
    })
  );

  // EXT: client notes save on blur
  document.querySelectorAll(".ml-client-notes").forEach(inp =>
    inp.addEventListener("blur", () =>
      apiPatch(`/api/influencers/${inp.dataset.id}`, {client_notes: inp.value.trim() || null})
    )
  );

  document.querySelectorAll(".btn-copy-ext").forEach(b =>
    b.addEventListener("click", async () => {
      const row = rows.find(r => String(r.id) === b.dataset.id);
      if (!row) return;
      if (!confirm(`Add ${row.name || row.ig_handle} to the External list?`)) return;
      await apiPost("/api/influencers", {
        list_type:        "EXT",
        name:             row.name,
        ig_handle:        row.ig_handle,
        ig_url:           row.ig_url,
        tt_handle:        row.tt_handle,
        tt_url:           row.tt_url,
        ig_followers:     row.ig_followers,
        tt_followers:     row.tt_followers,
        tier:             row.tier,
        gender:           row.gender,
        vertical:         row.vertical,
        archetype:        row.archetype,
        location:         row.location,
        location_country: row.location_country,
        email:            row.email,
        campaign:         row.campaign,
        audience_age:     row.audience_age,
        shopmy_data:      row.shopmy_data,
      });
      // Instant green feedback — permanent checkmark on reload
      b.innerHTML = `<span style="color:var(--green)">✓EXT</span>`;
      b.disabled = true;
      const inExtCell = b.closest("tr")?.querySelector("td:nth-last-child(2)");
      if (inExtCell) inExtCell.innerHTML = `<span style="color:var(--green);font-weight:700;font-size:14px">✓</span>`;
    })
  );
}

// List toggle
document.querySelectorAll(".list-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".list-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentListType = btn.dataset.list;
    loadMasterList();
  });
});

["ml-search","ml-filter-tier","ml-filter-gender","ml-filter-campaign"].forEach(id =>
  document.getElementById(id)?.addEventListener("input", () => loadMasterList())
);

// Sort column headers
document.querySelectorAll(".ml-sort").forEach(th =>
  th.addEventListener("click", () => {
    const col = th.dataset.col;
    if (mlSortCol === col) mlSortDir = mlSortDir === "asc" ? "desc" : "asc";
    else { mlSortCol = col; mlSortDir = "asc"; }
    loadMasterList();
  })
);

$("btn-add-influencer").addEventListener("click", () => openInfluencerModal(null));

function calcTier(igFol, ttFol) {
  const total = (parseFloat(igFol) || 0) + (parseFloat(ttFol) || 0);
  if (!total) return "";
  if (total < 25000)   return "Nano";
  if (total < 100000)  return "Micro";
  if (total < 250000)  return "Mid";
  if (total < 1000000) return "Macro";
  return "Mega";
}

function openInfluencerModal(existing) {
  const isEdit = !!existing;
  const e = existing || {};
  openModal(isEdit ? "Edit Creator" : "Add Creator", `
    <div class="form-grid-2">
      <div class="fld"><label>Name</label><input id="mf-name" value="${esc(e.name||"")}"></div>
      <div class="fld"><label>Add to List</label>
        <div style="display:flex;gap:20px;margin-top:6px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
            <input type="checkbox" id="mf-list-int" ${!isEdit && currentListType==="INT" ? "checked" : isEdit && e.list_type==="INT" ? "checked" : ""}> Internal
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
            <input type="checkbox" id="mf-list-ext" ${!isEdit && currentListType==="EXT" ? "checked" : isEdit && e.list_type==="EXT" ? "checked" : ""}> External
          </label>
        </div>
      </div>
    </div>
    <div class="form-section">Social</div>
    <div class="form-grid-2">
      <div class="fld"><label>IG Handle</label><input id="mf-ig-handle" value="${esc(e.ig_handle||"")}" placeholder="@handle"></div>
      <div class="fld"><label>TikTok Handle</label><input id="mf-tt-handle" value="${esc(e.tt_handle||"")}" placeholder="@handle"></div>
      <div class="fld"><label>IG Followers</label><input type="number" id="mf-ig-fol" value="${e.ig_followers||""}"></div>
      <div class="fld"><label>TT Followers</label><input type="number" id="mf-tt-fol" value="${e.tt_followers||""}"></div>
    </div>
    <div class="form-section">Profile</div>
    <div class="form-grid-3">
      <div class="fld"><label>Tier (auto-fills)</label>
        <select id="mf-tier"><option value="">—</option><option ${e.tier==="Nano"?"selected":""}>Nano</option><option ${e.tier==="Micro"?"selected":""}>Micro</option><option ${e.tier==="Mid"?"selected":""}>Mid</option><option ${e.tier==="Macro"?"selected":""}>Macro</option><option ${e.tier==="Mega"?"selected":""}>Mega</option></select>
      </div>
      <div class="fld"><label>Gender</label>
        <select id="mf-gender"><option value="">—</option><option ${e.gender==="Female"?"selected":""}>Female</option><option ${e.gender==="Male"?"selected":""}>Male</option><option ${e.gender==="Non-binary"?"selected":""}>Non-binary</option></select>
      </div>
      <div class="fld"><label>Vertical / Archetype</label>
        <select id="mf-vertical">
          <option value="">—</option>
          <option ${ (e.vertical||e.archetype)==="Health / Wellness"?"selected":""}>Health / Wellness</option>
          <option ${ (e.vertical||e.archetype)==="Beauty / Skincare"?"selected":""}>Beauty / Skincare</option>
          <option ${ (e.vertical||e.archetype)==="Fashion / Lifestyle"?"selected":""}>Fashion / Lifestyle</option>
          <option ${ (e.vertical||e.archetype)==="Cool Guys"?"selected":""}>Cool Guys</option>
          <option ${ (e.vertical||e.archetype)==="Models"?"selected":""}>Models</option>
          <option ${ (e.vertical||e.archetype)==="Parents"?"selected":""}>Parents</option>
          <option ${ (e.vertical||e.archetype)==="Student"?"selected":""}>Student</option>
          <option ${ (e.vertical||e.archetype)==="Travel"?"selected":""}>Travel</option>
          <option ${ (e.vertical||e.archetype)==="Creatives"?"selected":""}>Creatives</option>
          <option ${ (e.vertical||e.archetype)==="Food / Bev"?"selected":""}>Food / Bev</option>
          <option ${ (e.vertical||e.archetype)==="Professionals"?"selected":""}>Professionals</option>
          <option ${ (e.vertical||e.archetype)==="Fitness"?"selected":""}>Fitness</option>
        </select>
      </div>
      <div class="fld"><label>Country</label>
        <select id="mf-country">
          <option value="">—</option>
          ${["United States","United Kingdom","Canada","Australia","Mexico","Brazil","France","Germany","Spain","Italy","Netherlands","Sweden","Denmark","Norway","South Korea","Japan","India","Other"].map(c=>`<option ${(e.location_country||""===c)?'selected':''}>${c}</option>`).join("")}
        </select>
      </div>
      <div class="fld" id="mf-state-wrap">
        <label>State</label>
        <select id="mf-state">
          <option value="">—</option>
          ${["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"].map(s=>`<option ${(e.location||""===s)?'selected':''}>${s}</option>`).join("")}
        </select>
      </div>
      <div class="fld"><label>Email</label><input type="email" id="mf-email" value="${esc(e.email||"")}"></div>
    </div>
    <div class="fld"><label>Campaign</label><input id="mf-campaign" value="${esc(e.campaign||"")}"></div>
    <div class="fld"><label>Audience Age Breakdown</label><input id="mf-age" value="${esc(e.audience_age||"")}"></div>
    <div class="fld"><label>ShopMy Conversion Data</label><input id="mf-shopmy" value="${esc(e.shopmy_data||"")}" placeholder="Average $ per Month" style="background:var(--panel);"></div>
    <div class="fld"><label>Notes</label><textarea id="mf-ext-feedback" rows="2">${esc(e.external_feedback||"")}</textarea></div>
  `, async () => {
    const igHandle  = $("mf-ig-handle").value.trim().replace(/^@/,"");
    const ttHandle  = $("mf-tt-handle").value.trim().replace(/^@/,"");
    const country   = $("mf-country").value;
    const stateVal  = country === "United States" ? $("mf-state").value : "";
    const listInt   = $("mf-list-int").checked;
    const listExt   = $("mf-list-ext").checked;
    const payload = {
      name:             $("mf-name").value.trim(),
      ig_handle:        igHandle,
      ig_url:           igHandle ? `https://instagram.com/${igHandle}` : "",
      tt_handle:        ttHandle,
      tt_url:           ttHandle ? `https://tiktok.com/@${ttHandle}` : "",
      ig_followers:     parseFloat($("mf-ig-fol").value) || null,
      tt_followers:     parseFloat($("mf-tt-fol").value) || null,
      tier:             $("mf-tier").value,
      gender:           $("mf-gender").value,
      vertical:         $("mf-vertical").value,
      archetype:        $("mf-vertical").value,
      location:         stateVal,
      location_country: country,
      email:            $("mf-email").value.trim(),
      campaign:         $("mf-campaign").value.trim(),
      audience_age:     $("mf-age").value.trim(),
      shopmy_data:      $("mf-shopmy").value.trim(),
      external_feedback: $("mf-ext-feedback")?.value.trim() || null,
    };
    if (isEdit) {
      await apiPatch(`/api/influencers/${existing.id}`, {...payload, list_type: existing.list_type});
    } else {
      if (listInt) await apiPost("/api/influencers", {...payload, list_type: "INT"});
      if (listExt) await apiPost("/api/influencers", {...payload, list_type: "EXT"});
      if (!listInt && !listExt) await apiPost("/api/influencers", {...payload, list_type: "INT"});
    }
    closeModal(); loadMasterList();
  });

  // Wire up tier autofill + country/state visibility after modal renders
  setTimeout(() => {
    const updateTier = () => {
      const t = calcTier($("mf-ig-fol")?.value, $("mf-tt-fol")?.value);
      if (t) $("mf-tier").value = t;
    };
    $("mf-ig-fol")?.addEventListener("input", updateTier);
    $("mf-tt-fol")?.addEventListener("input", updateTier);
    updateTier();

    const updateStateVis = () => {
      const isUS = $("mf-country")?.value === "United States";
      const wrap = $("mf-state-wrap");
      if (wrap) wrap.style.display = isUS ? "" : "none";
    };
    $("mf-country")?.addEventListener("change", updateStateVis);
    updateStateVis(); // run on open
  }, 0);
}

// ── 2. Outreach ───────────────────────────────────────────────────────────────
const OUTREACH_STATUSES = ["Not Outreached","Outreached","Followed Up 1x","Followed Up 2x","Interested","Passed","Not Responsive","Conflicted Out"];

async function loadOutreach() {
  const [data, planData] = await Promise.all([
    apiGet("/api/outreach"),
    ppRows.length ? Promise.resolve(ppRows) : apiGet("/api/paid_plan"),
  ]);
  if (!ppRows.length) ppRows = planData;

  // Build map: influencer_id → plan record
  const planMap = {};
  ppRows.forEach(p => { planMap[p.influencer_id] = p; });

  const search = $("or-search")?.value.toLowerCase() || "";
  const status = $("or-filter-status")?.value || "";
  let rows = data;
  if (search) rows = rows.filter(r => `${r.name} ${r.ig_handle}`.toLowerCase().includes(search));
  if (status) rows = rows.filter(r => r.outreach_status === status);

  const iS = "background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:3px 6px;font-size:11px";

  $("or-body").innerHTML = rows.length ? rows.map(r => {
    const plan = planMap[r.id] || {};
    return `<tr>
    <td><input class="or-owner" data-id="${r.id}" value="${esc(r.outreach_owner||"")}" placeholder="Owner" style="width:80px;${iS}"></td>
    <td style="white-space:nowrap"><strong>${esc(r.name||"")}</strong></td>
    <td>${r.ig_handle ? `<a href="${esc(r.ig_url||`https://instagram.com/${r.ig_handle}`)}" target="_blank" style="color:var(--red)">@${esc(r.ig_handle)}</a>` : "—"}</td>
    <td>${r.tt_handle ? `<a href="${esc(r.tt_url||`https://tiktok.com/@${r.tt_handle}`)}" target="_blank" style="color:var(--red)">@${esc(r.tt_handle)}</a>` : "—"}</td>
    <td><input class="or-email" data-id="${r.id}" value="${esc(r.email||"")}" placeholder="Email" style="width:150px;${iS}"></td>
    <td>${r.tier ? `<span class="badge badge-int">${esc(r.tier)}</span>` : "—"}</td>
    <td style="font-size:11px">${esc(r.vertical||r.archetype||"")}</td>
    <td style="font-size:11px">${esc(r.location||"")}</td>
    <td style="font-size:11px">${esc(r.gender||"")}</td>
    <td>${r.list_type==="INT/EXT"
        ? `<span class="badge badge-int">INT</span> <span class="badge badge-ext">EXT</span>`
        : `<span class="badge ${r.list_type==="INT"?"badge-int":"badge-ext"}">${esc(r.list_type)}</span>`}</td>
    <td><input class="or-init-rate" data-id="${r.id}" value="${esc(r.initial_rate||"")}" placeholder="$" style="width:70px;${iS}"></td>
    <td><input class="or-quot-rate" data-id="${r.id}" value="${esc(r.quoted_rate||"")}" placeholder="$" style="width:70px;${iS}"></td>
    <td>
      <div style="display:grid;grid-template-columns:auto 36px;gap:2px 4px;align-items:center;font-size:10px">
        <span style="color:var(--dim)">Feed</span><input type="number" class="or-del" data-id="${r.id}" data-field="ig_feed_qty" value="${plan.ig_feed_qty||0}" min="0" style="width:36px;${iS};padding:2px 4px">
        <span style="color:var(--dim)">Reel</span><input type="number" class="or-del" data-id="${r.id}" data-field="ig_reel_qty" value="${plan.ig_reel_qty||0}" min="0" style="width:36px;${iS};padding:2px 4px">
        <span style="color:var(--dim)">Story</span><input type="number" class="or-del" data-id="${r.id}" data-field="ig_story_qty" value="${plan.ig_story_qty||0}" min="0" style="width:36px;${iS};padding:2px 4px">
        <span style="color:var(--dim)">TT</span><input type="number" class="or-del" data-id="${r.id}" data-field="tt_qty" value="${plan.tt_qty||0}" min="0" style="width:36px;${iS};padding:2px 4px">
      </div>
    </td>
    <td>
      <select class="or-usage" data-id="${r.id}" style="${iS};min-width:140px">
        <option value="">—</option>
        ${["Organic (30 days)","Baked in Paid (30 days)","Pre-Negotiated Paid (30 days)","Other"].map(u=>`<option ${r.outreach_usage===u?"selected":""}>${u}</option>`).join("")}
      </select>
    </td>
    <td>
      <select class="or-status-sel" data-id="${r.id}" style="${iS};min-width:130px">
        ${OUTREACH_STATUSES.map(s=>`<option ${r.outreach_status===s?"selected":""}>${s}</option>`).join("")}
      </select>
    </td>
    <td><input type="date" class="or-date" data-id="${r.id}" value="${r.outreach_date||""}" style="${iS}"></td>
    <td><input type="date" class="or-last" data-id="${r.id}" value="${r.last_contact||""}" style="${iS}"></td>
    <td><input class="or-notes" data-id="${r.id}" value="${esc(r.outreach_notes||"")}" placeholder="Notes" style="width:120px;${iS}"></td>
    <td>${r.in_paid_plan ? '<span class="badge badge-locked">✓</span>' : ""}</td>
  </tr>`;}).join("") : `<tr><td colspan="19" class="empty-cell">No creators found.</td></tr>`;

  const saveField = async (id, field, value) => {
    await apiPatch(`/api/influencers/${id}`, {[field]: value || null});
  };

  // Helper: create or update paid_plan record with deliverable qtys
  const savePlanQty = async (infId, field, value) => {
    const plan = ppRows.find(p => p.influencer_id === parseInt(infId));
    const qty  = parseInt(value) || 0;
    if (plan?.id) {
      await apiPatch(`/api/paid_plan/${plan.id}`, {[field]: qty});
      plan[field] = qty;
    } else {
      const newPlan = await apiPost("/api/paid_plan", {influencer_id: parseInt(infId), [field]: qty});
      if (newPlan?.id) ppRows.push({...newPlan, influencer_id: parseInt(infId)});
    }
  };

  document.querySelectorAll(".or-status-sel").forEach(s => s.addEventListener("change", () => saveField(s.dataset.id, "outreach_status", s.value)));
  document.querySelectorAll(".or-owner").forEach(i => i.addEventListener("blur", () => saveField(i.dataset.id, "outreach_owner", i.value.trim())));
  document.querySelectorAll(".or-email").forEach(i => i.addEventListener("blur", () => saveField(i.dataset.id, "email", i.value.trim())));
  document.querySelectorAll(".or-init-rate").forEach(i => i.addEventListener("blur", () => saveField(i.dataset.id, "initial_rate", i.value.trim())));
  document.querySelectorAll(".or-quot-rate").forEach(i => i.addEventListener("blur", () => saveField(i.dataset.id, "quoted_rate", i.value.trim())));
  document.querySelectorAll(".or-usage").forEach(s => s.addEventListener("change", () => saveField(s.dataset.id, "outreach_usage", s.value)));
  document.querySelectorAll(".or-del").forEach(i => i.addEventListener("change", () => savePlanQty(i.dataset.id, i.dataset.field, i.value)));
  document.querySelectorAll(".or-date").forEach(i => i.addEventListener("change", () => saveField(i.dataset.id, "outreach_date", i.value)));
  document.querySelectorAll(".or-last").forEach(i => i.addEventListener("change", () => saveField(i.dataset.id, "last_contact", i.value)));
  document.querySelectorAll(".or-notes").forEach(i => i.addEventListener("blur", () => saveField(i.dataset.id, "outreach_notes", i.value.trim())));
}

["or-search","or-filter-status"].forEach(id => document.getElementById(id)?.addEventListener("input", loadOutreach));

// ── 3. Paid Plan ──────────────────────────────────────────────────────────────

function calcEstCost(r) {
  const ig   = r.ig_impressions || r.ig_reels_impressions || 0;
  const igFeed  = (r.ig_feed_qty||0)  * ig * (r.ig_feed_cpm||0)  / 1000;
  const igReel  = (r.ig_reel_qty||0)  * ig * (r.ig_reel_cpm||0)  / 1000;
  const igStory = (r.ig_story_qty||0) * ig * (r.ig_story_cpm||0) / 1000;
  const tt      = (r.tt_qty||0) * (r.tt_impressions||0) * (r.tt_cpm||0) / 1000;
  const base    = igFeed + igReel + igStory + tt;
  const org     = base * (r.organic_pct||0) / 100;
  const paid    = base * (r.paid_pct||0) / 100;
  return base + org + paid;
}

const STATUS_BADGE = {
  "In Negotiations": "badge-negotiations",
  "Offer Out":       "badge-offer",
  "Locked":          "badge-locked",
};

let ppRows = []; // module-level so auto-fill can access

async function loadPaidPlan() {
  let data;
  try {
    data = await apiGet("/api/paid_plan");
    if (!Array.isArray(data)) throw new Error(data?.detail || JSON.stringify(data));
  const search = $("pp-search")?.value.toLowerCase() || "";
  const status = $("pp-filter-status")?.value || "";
  ppRows = data;
  let rows = ppRows;
  if (search) rows = rows.filter(r => (r.influencer?.name||"").toLowerCase().includes(search));
  if (status) rows = rows.filter(r => r.status === status);

  const fC = v => v > 0 ? `<span>$${Math.round(v).toLocaleString()}</span>` : `<span style="color:var(--dim)">—</span>`;
  const fP = v => (v != null && v !== "") ? `${v}%` : "—";
  const del1 = v => v ? `<span style="color:var(--text);font-weight:600">1</span>` : `<span style="color:var(--dim)">—</span>`;

  $("pp-body").innerHTML = rows.length ? rows.map((r, i) => {
    const inf  = r.influencer || {};
    const fmt_ = r.platform_format || "";
    const igImp = r.ig_impressions || r.ig_reels_impressions || 0;
    const feedQty  = r.ig_feed_qty  || 0;
    const reelQty  = r.ig_reel_qty  || 0;
    const storyQty = r.ig_story_qty || 0;
    const ttQty    = r.tt_qty       || 0;

    const igFeedCost  = feedQty  * igImp * (r.ig_feed_cpm||0)  / 1000;
    const igReelCost  = reelQty  * igImp * (r.ig_reel_cpm||0)  / 1000;
    const igStoryCost = storyQty * igImp * (r.ig_story_cpm||0) / 1000;
    const ttCost      = ttQty * (r.tt_impressions||0) * (r.tt_cpm||0) / 1000;
    const cpmEst      = igFeedCost + igReelCost + igStoryCost + ttCost;
    const totalImpr   = (feedQty + reelQty + storyQty) * igImp + ttQty * (r.tt_impressions||0);
    const orgPct      = r.organic_pct != null ? r.organic_pct : 10;
    const paidPct     = r.paid_pct    != null ? r.paid_pct    : 30;
    const orgD        = cpmEst * orgPct  / 100;
    const paidD       = cpmEst * paidPct / 100;
    const totalEst    = cpmEst + orgD + paidD;
    return `<tr>
      <td>
        <select class="pp-status-sel" data-id="${r.id || ""}" data-idx="${i}" style="background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 6px;font-size:11px;font-weight:600;min-width:150px;${r.status==="Locked"?"color:var(--green)":r.status==="Offer Out"?"color:var(--blue)":r.status==="In Negotiations"?"color:var(--yellow)":"color:var(--dim)"}">
          <option value="">—</option>
          <option ${r.status==="In Negotiations"?"selected":""}>In Negotiations</option>
          <option ${r.status==="Offer Out"?"selected":""}>Offer Out</option>
          <option ${r.status==="Locked"?"selected":""}>Locked</option>
        </select>
      </td>
      <td style="white-space:nowrap"><strong>${esc(inf.name||"Unknown")}</strong></td>
      <td style="white-space:nowrap;font-size:11px">${esc(fmt_||"")}</td>
      <td>${inf.ig_handle ? `<a href="${esc(inf.ig_url||`https://instagram.com/${inf.ig_handle}`)}" target="_blank" style="color:var(--red)">@${esc(inf.ig_handle)}</a>` : "—"}</td>
      <td style="color:var(--dim)">${(r.ig_reels_impressions||0).toLocaleString() || "—"}</td>
      <td>${inf.tt_handle ? `<a href="${esc(inf.tt_url||`https://tiktok.com/@${inf.tt_handle}`)}" target="_blank" style="color:var(--red)">@${esc(inf.tt_handle)}</a>` : "—"}</td>
      <td style="color:var(--dim)">${(r.tt_impressions||0).toLocaleString() || "—"}</td>
      <td style="text-align:center">${feedQty  || `<span style="color:var(--dim)">—</span>`}</td>
      <td style="text-align:center">${reelQty  || `<span style="color:var(--dim)">—</span>`}</td>
      <td style="text-align:center">${storyQty || `<span style="color:var(--dim)">—</span>`}</td>
      <td style="text-align:center">${ttQty    || `<span style="color:var(--dim)">—</span>`}</td>
      <td style="color:var(--yellow)">${r.ig_feed_cpm ? `$${r.ig_feed_cpm}` : "—"}</td>
      <td style="color:var(--yellow)">${r.ig_reel_cpm ? `$${r.ig_reel_cpm}` : "—"}</td>
      <td style="color:var(--yellow)">${r.ig_story_cpm ? `$${r.ig_story_cpm}` : "—"}</td>
      <td style="color:var(--yellow)">${r.tt_cpm ? `$${r.tt_cpm}` : "—"}</td>
      <td>${fC(igFeedCost)}</td>
      <td>${fC(igReelCost)}</td>
      <td>${fC(igStoryCost)}</td>
      <td>${fC(ttCost)}</td>
      <td style="font-weight:600">${fC(cpmEst)}</td>
      <td style="color:var(--dim)">${totalImpr ? totalImpr.toLocaleString() : "—"}</td>
      <td>${fP(orgPct)}</td>
      <td>${fC(orgD)}</td>
      <td>${fP(paidPct)}</td>
      <td>${fC(paidD)}</td>
      <td style="color:var(--red);font-weight:700">${fC(totalEst)}</td>
      <td>${fmtD(r.first_offer)}</td>
      <td style="color:var(--dim)">${totalEst ? fC(totalEst * 0.6) : "—"}</td>
      <td>${fmtD(r.influencer_offer)}</td>
      <td>${fmtD(r.a8_counter)}</td>
      <td style="font-weight:600">${fmtD(r.accepted_offer)}</td>
      <td style="white-space:nowrap">
        <button class="btn-icon btn-edit-pp" data-idx="${i}" title="Edit">✏</button>
        ${r.id ? `<button class="btn-icon btn-del-pp" data-id="${r.id}" title="Clear plan data" style="color:#666">✕</button>` : ""}
      </td>
    </tr>`;
  }).join("") : `<tr><td colspan="31" class="empty-cell">No creators in Paid Plan yet. Check the "Paid Plan" box on a creator in the Master Lists tab.</td></tr>`;

  document.querySelectorAll(".btn-edit-pp").forEach(b =>
    b.addEventListener("click", () => {
      const row = rows[parseInt(b.dataset.idx)];
      if (row) openPaidPlanModal(row);
    })
  );

  // Inline status dropdown save
  document.querySelectorAll(".pp-status-sel").forEach(sel =>
    sel.addEventListener("change", async () => {
      const row = rows[parseInt(sel.dataset.idx)];
      if (!row) return;
      const newStatus = sel.value;
      // Color the select based on new status
      sel.style.color = newStatus==="Locked" ? "var(--green)" : newStatus==="Offer Out" ? "var(--blue)" : newStatus==="In Negotiations" ? "var(--yellow)" : "var(--dim)";
      if (row.id) {
        await apiPatch(`/api/paid_plan/${row.id}`, {status: newStatus});
      } else {
        const newPlan = await apiPost("/api/paid_plan", {influencer_id: row.influencer_id, status: newStatus});
        if (newPlan?.id) row.id = newPlan.id;
      }
      // If set to Locked, trigger Content Review auto-create per deliverable
      if (newStatus === "Locked") {
        try { await autoCreateContentReviewEntries(row.influencer_id, row); }
        catch(err) { console.error("Could not auto-create Content Review:", err); }
      }
    })
  );
  document.querySelectorAll(".btn-del-pp").forEach(b =>
    b.addEventListener("click", async () => {
      if (!confirm("Clear all plan data for this creator? They will stay in the Paid Plan list but their rates and offers will be erased.")) return;
      await fetch(`/api/paid_plan/${b.dataset.id}?password=${encodeURIComponent(PW)}`, {method:"DELETE"});
      loadPaidPlan();
    })
  );
  } catch(err) {
    $("pp-body").innerHTML = `<tr><td colspan="31" class="empty-cell" style="color:var(--red)">Error rendering table: ${esc(String(err.message))}</td></tr>`;
  }
}

// Auto-fill defaults across all existing plan records
document.querySelectorAll(".pp-autofill-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    const field = btn.dataset.field;
    const val   = parseFloat(btn.dataset.val);
    const toUpdate = ppRows.filter(r => r.id);
    if (!toUpdate.length) { alert("No saved plan records to update yet."); return; }
    btn.disabled = true; btn.textContent = "Saving…";
    await Promise.all(toUpdate.map(r => apiPatch(`/api/paid_plan/${r.id}`, {[field]: val})));
    btn.disabled = false; btn.textContent = btn.dataset.label;
    loadPaidPlan();
  });
});

["pp-search","pp-filter-status"].forEach(id => document.getElementById(id)?.addEventListener("input", loadPaidPlan));

async function openPaidPlanModal(row) {
  const e = row;
  const planId = e.id;
  const d = (v, def) => (v != null && v !== "") ? v : def; // default helper
  const inf = e.influencer || {};
  openModal(`Plan Details — ${esc(inf.name||"")}`, `
    <div class="form-section">Creator Info</div>
    <div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:10px 14px;font-size:12px;display:flex;gap:24px;flex-wrap:wrap;margin-bottom:8px">
      <span><span style="color:var(--dim)">Name </span><strong>${esc(inf.name||"")}</strong></span>
      ${inf.ig_handle ? `<span><span style="color:var(--dim)">IG </span><a href="${esc(inf.ig_url||`https://instagram.com/${inf.ig_handle}`)}" target="_blank" style="color:var(--red)">@${esc(inf.ig_handle)}</a></span>` : ""}
      ${inf.tt_handle ? `<span><span style="color:var(--dim)">TT </span><a href="${esc(inf.tt_url||`https://tiktok.com/@${inf.tt_handle}`)}" target="_blank" style="color:var(--red)">@${esc(inf.tt_handle)}</a></span>` : ""}
    </div>
    <div class="form-grid-2" style="margin-bottom:8px">
      <div class="fld"><label>Status</label>
        <select id="ppf-status">
          <option value="">—</option>
          <option ${e.status==="In Negotiations"?"selected":""}>In Negotiations</option>
          <option ${e.status==="Offer Out"?"selected":""}>Offer Out</option>
          <option ${e.status==="Locked"?"selected":""}>Locked</option>
        </select>
      </div>
    </div>
    <div class="form-section">Impressions</div>
    <div class="form-grid-2">
      <div class="fld"><label>IG Avg Impressions</label><input type="number" id="ppf-ig-imp" value="${e.ig_impressions||e.ig_reels_impressions||""}"></div>
      <div class="fld"><label>TikTok Avg Impressions</label><input type="number" id="ppf-tt-imp" value="${e.tt_impressions||""}"></div>
    </div>
    <div class="form-section">Deliverables</div>
    <div class="form-grid-3">
      <div class="fld"><label>IG Feed Posts</label><input type="number" id="ppf-feed-qty" value="${d(e.ig_feed_qty,0)}" min="0"></div>
      <div class="fld"><label>IG Reels</label><input type="number" id="ppf-reel-qty" value="${d(e.ig_reel_qty,0)}" min="0"></div>
      <div class="fld"><label>IG Stories</label><input type="number" id="ppf-story-qty" value="${d(e.ig_story_qty,0)}" min="0"></div>
      <div class="fld"><label>TikTok Videos</label><input type="number" id="ppf-tt-qty" value="${d(e.tt_qty,0)}" min="0"></div>
    </div>
    <div class="form-section">Usage</div>
    <div class="form-grid-2">
      <div class="fld"><label>Usage Rights</label>
        <select id="ppf-usage">
          <option value="">—</option>
          <option ${e.usage==="Organic (30 days)"?"selected":""}>Organic (30 days)</option>
          <option ${e.usage==="Baked in Paid (30 days)"?"selected":""}>Baked in Paid (30 days)</option>
          <option ${e.usage==="Pre-Negotiated Paid (30 days)"?"selected":""}>Pre-Negotiated Paid (30 days)</option>
          <option ${e.usage==="Other"?"selected":""}>Other</option>
        </select>
      </div>
    </div>
    <div class="form-section">CPM Rates (benchmark defaults pre-filled)</div>
    <div class="form-grid-3">
      <div class="fld"><label>IG Reel CPM ($)</label><input type="number" step="0.01" id="ppf-reel-cpm" value="${d(e.ig_reel_cpm, 29.50)}"></div>
      <div class="fld"><label>IG Story CPM ($)</label><input type="number" step="0.01" id="ppf-story-cpm" value="${d(e.ig_story_cpm, 10.50)}"></div>
      <div class="fld"><label>IG In-Feed CPM ($)</label><input type="number" step="0.01" id="ppf-feed-cpm" value="${d(e.ig_feed_cpm, 29.00)}"></div>
      <div class="fld"><label>TT CPM ($)</label><input type="number" step="0.01" id="ppf-tt-cpm" value="${d(e.tt_cpm, 20.00)}"></div>
    </div>
    <div class="form-section">Usage Rights + Negotiation</div>
    <div class="form-grid-3">
      <div class="fld"><label>Organic Usage %</label><input type="number" step="0.1" id="ppf-org-pct" value="${d(e.organic_pct, 10)}"></div>
      <div class="fld"><label>Paid Usage %</label><input type="number" step="0.1" id="ppf-paid-pct" value="${d(e.paid_pct, 30)}"></div>
      <div class="fld"><label>First Offer ($)</label><input type="number" id="ppf-first" value="${e.first_offer||""}"></div>
      <div class="fld"><label>Influencer Ask ($)</label><input type="number" id="ppf-inf-offer" value="${e.influencer_offer||""}"></div>
      <div class="fld"><label>A8 Counter ($)</label><input type="number" id="ppf-a8c" value="${e.a8_counter||""}"></div>
      <div class="fld"><label>Accepted Offer ($)</label><input type="number" id="ppf-accepted" value="${e.accepted_offer||""}"></div>
    </div>
    <div class="fld" style="margin-top:8px"><label>Notes</label><textarea id="ppf-notes" rows="2">${esc(e.notes||"")}</textarea></div>
    <div class="form-section">Estimated Cost — Live Calculator</div>
    <div id="ppf-calc-breakdown" style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:14px 16px;font-size:12px;line-height:2">
      <div style="display:flex;justify-content:space-between"><span style="color:var(--dim)">IG Reel</span><strong id="ppf-c-igr">—</strong></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--dim)">IG Story</span><strong id="ppf-c-igs">—</strong></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--dim)">IG In-Feed</span><strong id="ppf-c-igf">—</strong></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--dim)">TikTok</span><strong id="ppf-c-tt">—</strong></div>
      <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);margin-top:6px;padding-top:6px"><span style="color:var(--dim)">Base CPM Cost</span><strong id="ppf-c-base">—</strong></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--dim)">+ Organic Usage</span><strong id="ppf-c-org">—</strong></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--dim)">+ Paid Usage</span><strong id="ppf-c-paid">—</strong></div>
      <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);margin-top:6px;padding-top:6px;font-size:14px"><span style="font-weight:700">Total Est. Cost</span><strong style="color:var(--red);font-size:18px" id="ppf-c-total">—</strong></div>
    </div>
  `, async () => {
    const n = id => { const v = $(id)?.value; return v !== "" && v != null ? parseFloat(v) || null : null; };
    const igImp = n("ppf-ig-imp");
    const payload = {
      influencer_id:        e.influencer_id,
      status:               $("ppf-status").value,
      usage:                $("ppf-usage").value,
      ig_reels_impressions: igImp,
      tt_impressions:       n("ppf-tt-imp"),
      ig_feed_qty:          n("ppf-feed-qty") || 0,
      ig_reel_qty:          n("ppf-reel-qty") || 0,
      ig_story_qty:         n("ppf-story-qty") || 0,
      tt_qty:               n("ppf-tt-qty") || 0,
      ig_reel_cpm:          n("ppf-reel-cpm"),
      ig_story_cpm:         n("ppf-story-cpm"),
      ig_feed_cpm:          n("ppf-feed-cpm"),
      tt_cpm:               n("ppf-tt-cpm"),
      organic_pct:          n("ppf-org-pct"),
      paid_pct:             n("ppf-paid-pct"),
      first_offer:          n("ppf-first"),
      influencer_offer:     n("ppf-inf-offer"),
      a8_counter:           n("ppf-a8c"),
      accepted_offer:       n("ppf-accepted"),
      notes:                $("ppf-notes").value.trim(),
    };
    if (planId) await apiPatch(`/api/paid_plan/${planId}`, payload);
    else await apiPost("/api/paid_plan", payload);

    // When status set to Locked → auto-create separate Content Review entries per deliverable
    if (payload.status === "Locked") {
      try { await autoCreateContentReviewEntries(e.influencer_id, payload); }
      catch(err) { console.error("Could not auto-create Content Review:", err); }
    }

    closeModal(); loadPaidPlan();
  });

  // Live cost calculator — wires up after modal renders
  setTimeout(() => {
    const fD = v => v > 0 ? "$" + Math.round(v).toLocaleString() : "—";
    const updateCalc = () => {
      const nv = id => parseFloat($(id)?.value) || 0;
      const igImp   = nv("ppf-ig-imp");
      const igFeed  = nv("ppf-feed-qty")  * igImp * nv("ppf-feed-cpm")  / 1000;
      const igReel  = nv("ppf-reel-qty")  * igImp * nv("ppf-reel-cpm")  / 1000;
      const igStory = nv("ppf-story-qty") * igImp * nv("ppf-story-cpm") / 1000;
      const tt      = nv("ppf-tt-qty")    * nv("ppf-tt-imp") * nv("ppf-tt-cpm") / 1000;
      const base    = igFeed + igReel + igStory + tt;
      const org     = base * nv("ppf-org-pct") / 100;
      const paid    = base * nv("ppf-paid-pct") / 100;
      const total   = base + org + paid;
      $("ppf-c-igr").textContent  = fD(igReel);
      $("ppf-c-igs").textContent  = fD(igStory);
      $("ppf-c-igf").textContent  = fD(igFeed);
      $("ppf-c-tt").textContent   = fD(tt);
      $("ppf-c-base").textContent = fD(base);
      $("ppf-c-org").textContent  = fD(org);
      $("ppf-c-paid").textContent = fD(paid);
      $("ppf-c-total").textContent = fD(total);
    };
    ["ppf-ig-imp","ppf-tt-imp",
     "ppf-feed-qty","ppf-reel-qty","ppf-story-qty","ppf-tt-qty",
     "ppf-reel-cpm","ppf-story-cpm","ppf-feed-cpm","ppf-tt-cpm",
     "ppf-org-pct","ppf-paid-pct"].forEach(id => $(id)?.addEventListener("input", updateCalc));
    updateCalc(); // run immediately with existing values
  }, 0);
}

// ── 4. Content Calendar ───────────────────────────────────────────────────────
let calY = new Date().getFullYear();
let calM = new Date().getMonth();
let calRows = [];
let calView = "cal";

document.querySelectorAll(".view-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".view-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    calView = btn.dataset.view;
    $("cal-view").classList.toggle("hidden", calView !== "cal");
    $("list-view").classList.toggle("hidden", calView !== "list");
    renderCalendar();
  });
});

$("cal-prev").addEventListener("click", () => { if (--calM < 0) { calM=11; calY--; } renderCalendar(); });
$("cal-next").addEventListener("click", () => { if (++calM > 11) { calM=0; calY++; } renderCalendar(); });

async function loadCalendar() {
  calRows = await apiGet("/api/content_calendar");
  renderCalendar();
}

function renderCalendar() {
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  $("cal-title").textContent = `${MONTHS[calM]} ${calY}`;
  const firstDow = new Date(calY, calM, 1).getDay();
  const daysInMo = new Date(calY, calM+1, 0).getDate();
  const todayStr = new Date().toISOString().split("T")[0];
  const pad = n => String(n).padStart(2,"0");

  const byDay = {};
  calRows.forEach(r => {
    if (!r.scheduled_date) return;
    const [y,m,d] = r.scheduled_date.split("-");
    if (parseInt(y)===calY && parseInt(m)-1===calM) {
      (byDay[r.scheduled_date] = byDay[r.scheduled_date]||[]).push(r);
    }
  });

  if (calView === "cal") {
    let html = "";
    for (let i=0;i<firstDow;i++) html += `<div class="cal-day faded"></div>`;
    for (let d=1;d<=daysInMo;d++) {
      const ds = `${calY}-${pad(calM+1)}-${pad(d)}`;
      const es = byDay[ds]||[];
      html += `<div class="cal-day ${ds===todayStr?"is-today":""}" data-date="${ds}" style="cursor:pointer">
        <div class="cal-day-num">${d}</div>
        ${es.map(e=>`<div class="cal-entry">@${esc(e.influencer?.ig_handle||e.influencer?.name||"")} · ${fmtDeliverable(e.deliverable)}</div>`).join("")}
      </div>`;
    }
    $("cal-days").innerHTML = html;

    // Clickable days — show detail panel
    const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    document.querySelectorAll(".cal-day[data-date]").forEach(cell => {
      cell.addEventListener("click", () => {
        document.querySelectorAll(".cal-day.selected").forEach(c => c.classList.remove("selected"));
        cell.classList.add("selected");
        const ds = cell.dataset.date;
        const entries = byDay[ds] || [];
        const [y, m, d] = ds.split("-");
        $("cal-detail-date").textContent = `${MONTHS[parseInt(m)-1]} ${parseInt(d)}, ${y}`;
        if (!entries.length) {
          $("cal-detail-body").innerHTML = `<span style="color:var(--dim);font-size:12px">No entries for this day.</span>`;
        } else {
          $("cal-detail-body").innerHTML = entries.map(e => `
            <div class="cal-detail-entry">
              <div class="cal-detail-creator">@${esc(e.influencer?.ig_handle||e.influencer?.name||"Unknown")}</div>
              <div class="cal-detail-meta">
                <span><strong>${fmtDeliverable(e.deliverable)}</strong></span>
                ${e.usage ? `<span>Usage: <strong>${esc(e.usage)}</strong></span>` : ""}
                <span>Collab: <strong>${e.collab ? "Yes" : "No"}</strong></span>
                ${e.notes ? `<span>Notes: <strong>${esc(e.notes)}</strong></span>` : ""}
              </div>
            </div>`).join("");
        }
        $("cal-detail").classList.remove("hidden");
      });
    });
  } else {
    const rows = calRows.filter(r => r.scheduled_date?.startsWith(`${calY}-${pad(calM+1)}`));
    $("cal-body").innerHTML = rows.length ? rows.map(r=>`<tr>
      <td>${fmtDate(r.scheduled_date)}</td>
      <td>${esc(r.influencer?.name||"")}</td>
      <td>${fmtDeliverable(r.deliverable)}</td>
      <td>${esc(r.usage||"")}</td>
      <td>${r.collab?"✓":""}</td>
      <td>${esc(r.notes||"")}</td>
      <td><button class="btn-icon" onclick="deleteCalEntry(${r.id})">✕</button></td>
    </tr>`).join("") : `<tr><td colspan="7" class="empty-cell">No entries this month.</td></tr>`;
  }
}

function fmtDeliverable(d) {
  try {
    const obj = JSON.parse(d);
    const parts = [];
    if (obj.ig_reel  > 0) parts.push(`${obj.ig_reel}x Reel`);
    if (obj.ig_story > 0) parts.push(`${obj.ig_story}x Story`);
    if (obj.ig_feed  > 0) parts.push(`${obj.ig_feed}x Feed`);
    if (obj.tiktok   > 0) parts.push(`${obj.tiktok}x TT`);
    return parts.join(' · ') || '—';
  } catch { return d || '—'; }
}

window.deleteCalEntry = async (id) => {
  if (!confirm("Delete this entry?")) return;
  await apiDelete(`/api/content_calendar/${id}?password=${encodeURIComponent(PW)}`);
  loadCalendar();
};

$("btn-add-cal").addEventListener("click", async () => {
  await getInfluencers();
  // Build outreach_usage map for auto-fill
  const orData = await apiGet("/api/outreach").catch(() => []);
  const usageMap = {};
  orData.forEach(r => { if (r.outreach_usage) usageMap[r.id] = r.outreach_usage; });
  const inPaidPlan = allInfluencers.filter(i => i.in_paid_plan);
  openModal("Add Calendar Entry", `
    <div class="fld"><label>Creator (from Paid Plan)</label>
      <select id="calf-inf"><option value="">— select —</option>${inPaidPlan.map(i=>`<option value="${i.id}">${esc(i.name||i.ig_handle)}</option>`).join("")}</select>
    </div>
    <div class="form-grid-2">
      <div class="fld"><label>Date</label><input type="date" id="calf-date"></div>
      <div class="fld"><label>Usage</label>
        <select id="calf-usage">
          <option>Organic (30 days)</option>
          <option>Baked in Paid (30 days)</option>
          <option>Pre-Negotiated Paid (30 days)</option>
          <option>Other</option>
        </select>
      </div>
      <div class="fld"><label>Collab?</label>
        <select id="calf-collab"><option value="false">No</option><option value="true">Yes</option></select>
      </div>
    </div>
    <div class="form-section">Deliverables</div>
    <div class="form-grid-3">
      <div class="fld"><label>IG Reels</label><input type="number" id="calf-reel" value="0" min="0"></div>
      <div class="fld"><label>IG Stories</label><input type="number" id="calf-story" value="0" min="0"></div>
      <div class="fld"><label>IG In-Feed</label><input type="number" id="calf-feed" value="0" min="0"></div>
      <div class="fld"><label>TikTok Videos</label><input type="number" id="calf-tt" value="0" min="0"></div>
    </div>
    <div class="fld"><label>Notes</label><textarea id="calf-notes" rows="2"></textarea></div>
  `, async () => {
    const qty = {
      ig_reel:  parseInt($("calf-reel").value)  || 0,
      ig_story: parseInt($("calf-story").value) || 0,
      ig_feed:  parseInt($("calf-feed").value)  || 0,
      tiktok:   parseInt($("calf-tt").value)    || 0,
    };
    await apiPost("/api/content_calendar", {
      influencer_id:  parseInt($("calf-inf").value),
      scheduled_date: $("calf-date").value,
      deliverable:    JSON.stringify(qty),
      usage:          $("calf-usage").value,
      collab:         $("calf-collab").value === "true",
      notes:          $("calf-notes").value.trim(),
    });
    closeModal(); loadCalendar();
  });

  // Auto-fill usage from outreach when creator selected
  setTimeout(() => {
    $("calf-inf")?.addEventListener("change", () => {
      const u = usageMap[parseInt($("calf-inf").value)];
      if (u) $("calf-usage").value = u;
    });
  }, 0);
});

// ── 5. Content Review ─────────────────────────────────────────────────────────
const CR_DELIVERABLES = [
  "Instagram Reel", "Instagram Reel share to Story", "Instagram In-Feed (Still)",
  "Instagram Carousel", "Instagram Story (3-5 frames)",
  "TikTok", "IG/TT Syndication", "Substack", "YouTube",
];

function ppDeliverableSummary(plan) {
  if (!plan) return "";
  const parts = [];
  if (plan.ig_reel_qty  > 0) parts.push(`${plan.ig_reel_qty} Reel${plan.ig_reel_qty  > 1 ? "s" : ""}`);
  if (plan.ig_story_qty > 0) parts.push(`${plan.ig_story_qty} Stor${plan.ig_story_qty > 1 ? "ies" : "y"}`);
  if (plan.ig_feed_qty  > 0) parts.push(`${plan.ig_feed_qty} In-Feed`);
  if (plan.tt_qty       > 0) parts.push(`${plan.tt_qty} TikTok${plan.tt_qty > 1 ? "s" : ""}`);
  return parts.join(" · ");
}
const CR_CAMPAIGNS = ["A8 Paid Influencers", "MadeGood Paid Influencers", "Shipping & PR Mailers"];
const CR_STATUSES  = ["New! Needs Client Review", "Client Reviewed: Approved", "Client Reviewed: Needs Edits"];

// Helper: auto-create one Content Review entry per deliverable type when Locked
async function autoCreateContentReviewEntries(influencerId, plan) {
  const existing = await apiGet("/api/content_review");
  const existingTypes = existing.filter(r => r.influencer_id === influencerId).map(r => r.deliverable_type);
  const toCreate = [];
  if ((plan.ig_reel_qty  || 0) > 0) toCreate.push("Instagram Reel");
  if ((plan.ig_story_qty || 0) > 0) toCreate.push("Instagram Story (3-5 frames)");
  if ((plan.ig_feed_qty  || 0) > 0) toCreate.push("Instagram In-Feed (Still)");
  if ((plan.tt_qty       || 0) > 0) toCreate.push("TikTok");
  for (const type of toCreate) {
    if (!existingTypes.includes(type)) {
      await apiPost("/api/content_review", {influencer_id: influencerId, deliverable_type: type});
    }
  }
}

async function loadContentReview() {
  const data = await apiGet("/api/content_review");
  const filter = $("cr-filter-status")?.value;
  let rows = data;
  if (filter === "needs_review") rows = rows.filter(r => r.status === "New! Needs Client Review");
  if (filter === "approved")     rows = rows.filter(r => r.status === "Client Reviewed: Approved");
  if (filter === "needs_edits")  rows = rows.filter(r => r.status === "Client Reviewed: Needs Edits");

  // Group by influencer_id
  const groups = {};
  rows.forEach(r => {
    const key = r.influencer_id || r.id;
    if (!groups[key]) groups[key] = {inf: r.influencer || {}, records: [], infId: r.influencer_id};
    groups[key].records.push(r);
  });

  const iS = "background:var(--panel);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:3px 6px;font-size:11px;width:100%";
  const NCOLS = 16;

  $("cr-body").innerHTML = Object.values(groups).length ? Object.values(groups).map(group => {
    const inf = group.inf;

    // Parent row — full-width creator bar
    const parentRow = `<tr style="background:var(--panel2);border-top:2px solid var(--border)">
      <td colspan="${NCOLS}" style="padding:10px 16px">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <strong>${esc(inf.name||"")}</strong>
          ${inf.ig_handle ? `<a href="${esc(inf.ig_url||`https://instagram.com/${inf.ig_handle}`)}" target="_blank" style="color:var(--red);font-size:12px">@${esc(inf.ig_handle)}</a>` : ""}
          ${inf.tt_handle ? `<a href="${esc(inf.tt_url||`https://tiktok.com/@${inf.tt_handle}`)}" target="_blank" style="color:var(--red);font-size:12px">@${esc(inf.tt_handle)}</a>` : ""}
          ${inf.tier ? `<span class="badge badge-int">${esc(inf.tier)}</span>` : ""}
          ${inf.vertical||inf.archetype ? `<span style="color:var(--dim);font-size:11px">${esc(inf.vertical||inf.archetype)}</span>` : ""}
          <button class="btn-sec btn-add-cr-del" data-inf-id="${group.infId}" style="padding:3px 12px;font-size:11px;margin-left:auto">+ Add Deliverable</button>
        </div>
      </td>
    </tr>`;

    // Sub-rows — one per deliverable record
    const subRows = group.records.map(r => `<tr>
      <td style="color:var(--dim);font-size:13px;padding-left:20px;white-space:nowrap">↳</td>
      <td>
        <select class="cr-del" data-id="${r.id}" style="${iS};min-width:150px">
          <option value="">—</option>
          ${CR_DELIVERABLES.map(d=>`<option ${r.deliverable_type===d?"selected":""}>${esc(d)}</option>`).join("")}
        </select>
      </td>
      <td><input type="date" class="cr-due" data-id="${r.id}" value="${r.content_due_date||""}" style="${iS};min-width:110px"></td>
      <td><input type="date" class="cr-live" data-id="${r.id}" value="${r.live_date||""}" style="${iS};min-width:110px"></td>
      <td><input class="cr-concept" data-id="${r.id}" value="${esc(r.concept||"")}" placeholder="Concept" style="${iS};min-width:110px"></td>
      <td><input class="cr-concept-fbk" data-id="${r.id}" value="${esc(r.concept_feedback||"")}" placeholder="Concept feedback" style="${iS};min-width:110px"></td>
      <td>
        <div style="display:flex;align-items:center;gap:4px">
          <input class="cr-cv1" data-id="${r.id}" value="${esc(r.content_v1||"")}" placeholder="Link…" style="${iS};min-width:80px">
          ${r.content_v1 ? `<a href="${esc(r.content_v1)}" target="_blank" style="color:var(--red);font-size:12px;flex-shrink:0">↗</a>` : ""}
        </div>
      </td>
      <td><input class="cr-cap1" data-id="${r.id}" value="${esc(r.caption_v1||"")}" placeholder="Caption" style="${iS};min-width:90px"></td>
      <td><input class="cr-af1" data-id="${r.id}" value="${esc(r.a8_feedback_v1||"")}" placeholder="A8 notes" style="${iS};min-width:90px"></td>
      <td style="background:rgba(202,1,0,.04)"><input class="cr-cf1" data-id="${r.id}" value="${esc(r.client_feedback_v1||"")}" placeholder="Client feedback" style="${iS};min-width:110px"></td>
      <td>
        <div style="display:flex;align-items:center;gap:4px">
          <input class="cr-cv2" data-id="${r.id}" value="${esc(r.content_v2||"")}" placeholder="Link…" style="${iS};min-width:80px">
          ${r.content_v2 ? `<a href="${esc(r.content_v2)}" target="_blank" style="color:var(--red);font-size:12px;flex-shrink:0">↗</a>` : ""}
        </div>
      </td>
      <td><input class="cr-cap2" data-id="${r.id}" value="${esc(r.caption_v2||"")}" placeholder="Caption" style="${iS};min-width:90px"></td>
      <td><input class="cr-af2" data-id="${r.id}" value="${esc(r.a8_feedback_v2||"")}" placeholder="A8 notes" style="${iS};min-width:90px"></td>
      <td style="background:rgba(202,1,0,.04)"><input class="cr-cf2" data-id="${r.id}" value="${esc(r.client_feedback_v2||"")}" placeholder="Client feedback" style="${iS};min-width:110px"></td>
      <td style="text-align:center">
        <input type="checkbox" class="cr-approved-chk" data-id="${r.id}" data-inf-id="${r.influencer_id}" data-live="${r.live_date||""}" data-del="${esc(r.deliverable_type||"")}" ${r.approved_by_client?"checked":""} style="accent-color:var(--green);width:16px;height:16px;cursor:pointer">
      </td>
      <td>
        <button class="btn-icon btn-del-cr" data-id="${r.id}" title="Delete" style="color:var(--dim)">✕</button>
      </td>
    </tr>`).join("");

    return parentRow + subRows;
  }).join("") : `<tr><td colspan="${NCOLS}" class="empty-cell">No content review entries yet.</td></tr>`;

  // Inline save handlers
  const wire = (cls, field, evt="blur") =>
    document.querySelectorAll(`.${cls}`).forEach(el =>
      el.addEventListener(evt, () => apiPatch(`/api/content_review/${el.dataset.id}`, {[field]: el.value || null}))
    );
  wire("cr-del",         "deliverable_type",  "change");
  wire("cr-due",         "content_due_date",  "change");
  wire("cr-live",        "live_date",         "change");
  wire("cr-concept",     "concept");
  wire("cr-concept-fbk", "concept_feedback");
  wire("cr-cv1",         "content_v1");
  wire("cr-cap1",        "caption_v1");
  wire("cr-af1",         "a8_feedback_v1");
  wire("cr-cf1",         "client_feedback_v1");
  wire("cr-cv2",         "content_v2");
  wire("cr-cap2",        "caption_v2");
  wire("cr-af2",         "a8_feedback_v2");
  wire("cr-cf2",         "client_feedback_v2");

  // Approved checkbox → patch + create calendar entry
  document.querySelectorAll(".cr-approved-chk").forEach(cb =>
    cb.addEventListener("change", async () => {
      await apiPatch(`/api/content_review/${cb.dataset.id}`, {approved_by_client: cb.checked});
      if (cb.checked && cb.dataset.live) {
        const del = cb.dataset.del;
        await apiPost("/api/content_calendar", {
          influencer_id:  parseInt(cb.dataset.infId),
          scheduled_date: cb.dataset.live,
          deliverable:    JSON.stringify({
            ig_feed:  del.includes("In-Feed") ? 1 : 0,
            ig_reel:  del.includes("Reel")    ? 1 : 0,
            ig_story: del.includes("Story")   ? 1 : 0,
            tiktok:   del.includes("TikTok")  ? 1 : 0,
          }),
          approved: true,
          collab:   false,
        });
      }
    })
  );

  // + Add Deliverable button
  document.querySelectorAll(".btn-add-cr-del").forEach(b =>
    b.addEventListener("click", () => openContentReviewModal({influencer_id: parseInt(b.dataset.infId)}))
  );

  // Delete
  document.querySelectorAll(".btn-del-cr").forEach(b =>
    b.addEventListener("click", async () => {
      if (!confirm("Delete this deliverable entry?")) return;
      await fetch(`/api/content_review/${b.dataset.id}?password=${encodeURIComponent(PW)}`, {method:"DELETE"});
      loadContentReview();
    })
  );
}

$("cr-filter-status")?.addEventListener("change", loadContentReview);
$("btn-add-cr").addEventListener("click", () => openContentReviewModal(null));

async function openContentReviewModal(existing) {
  await getInfluencers();
  const e = existing || {};
  const inPaidPlan = allInfluencers.filter(i => i.in_paid_plan);
  openModal("Add Deliverable", `
    <div class="form-grid-2">
      <div class="fld"><label>Creator</label>
        <select id="crf-inf">
          <option value="">— select —</option>
          ${inPaidPlan.map(i=>`<option value="${i.id}" ${e.influencer_id===i.id?"selected":""}>${esc(i.name||i.ig_handle)}</option>`).join("")}
        </select>
      </div>
      <div class="fld"><label>Campaign</label>
        <select id="crf-campaign">
          <option value="">—</option>
          ${CR_CAMPAIGNS.map(c=>`<option ${e.campaign===c?"selected":""}>${esc(c)}</option>`).join("")}
        </select>
      </div>
      <div class="fld"><label>Deliverable</label>
        <select id="crf-del">
          <option value="">—</option>
          ${CR_DELIVERABLES.map(d=>`<option ${e.deliverable_type===d?"selected":""}>${esc(d)}</option>`).join("")}
        </select>
      </div>
      <div class="fld"><label>Content Due</label><input type="date" id="crf-due" value="${e.content_due_date||""}"></div>
      <div class="fld"><label>Live Date</label><input type="date" id="crf-live" value="${e.live_date||""}"></div>
    </div>
  `, async () => {
    await apiPost("/api/content_review", {
      influencer_id:    parseInt($("crf-inf").value),
      campaign:         $("crf-campaign").value,
      deliverable_type: $("crf-del").value,
      content_due_date: $("crf-due").value || null,
      live_date:        $("crf-live").value || null,
    });
    closeModal(); loadContentReview();
  });
}

// ── 6. Live Posts ─────────────────────────────────────────────────────────────
async function loadLivePosts() {
  const data = await apiGet("/api/live_posts");
  $("lp-body").innerHTML = data.length ? data.map(r=>`<tr>
    <td>${fmtDate(r.live_date)}</td>
    <td><strong>${esc(r.influencer?.name||"")}</strong></td>
    <td>${esc(r.campaign||"")}</td>
    <td>${fmtD(r.final_rate)}</td>
    <td>${fmtD(r.total_cost)}</td>
    <td>${r.live_link?`<a href="${esc(r.live_link)}" target="_blank">View ↗</a>`:"—"}</td>
    <td>${fmt(r.total_views)}</td>
    <td>${fmt(r.total_engagement)}</td>
    <td>${r.cpv != null ? "$"+r.cpv : "—"}</td>
    <td>${r.cpe != null ? "$"+r.cpe : "—"}</td>
    <td>${esc(r.ig_spark_code||"")}</td>
    <td>${r.content_boosted?"✓":""}</td>
    <td>
      <button class="btn-icon btn-edit-lp" data-id="${r.id}">✏</button>
      <button class="btn-icon btn-del-lp" data-id="${r.id}">✕</button>
    </td>
  </tr>`).join("") : `<tr><td colspan="13" class="empty-cell">No live posts yet.</td></tr>`;

  document.querySelectorAll(".btn-edit-lp").forEach(b=>
    b.addEventListener("click",()=>{ const row=data.find(r=>String(r.id)===b.dataset.id); if(row) openLivePostModal(row); })
  );
  document.querySelectorAll(".btn-del-lp").forEach(b=>
    b.addEventListener("click",async()=>{ if(!confirm("Delete?")) return; await apiDelete(`/api/live_posts/${b.dataset.id}?password=${encodeURIComponent(PW)}`); loadLivePosts(); })
  );
}

$("btn-add-lp").addEventListener("click", ()=>openLivePostModal(null));

async function openLivePostModal(existing) {
  await getInfluencers();
  const isEdit = !!existing;
  const e = existing || {};
  openModal(isEdit?"Edit Live Post":"Add Live Post", `
    <div class="form-grid-2">
      <div class="fld"><label>Creator</label>
        <select id="lpf-inf">${allInfluencers.filter(i=>i.in_paid_plan).map(i=>`<option value="${i.id}" ${e.influencer_id===i.id?"selected":""}>${esc(i.name||i.ig_handle)}</option>`).join("")}</select>
      </div>
      <div class="fld"><label>Live Date</label><input type="date" id="lpf-date" value="${e.live_date||""}"></div>
      <div class="fld"><label>Campaign</label><input id="lpf-campaign" value="${esc(e.campaign||"")}"></div>
      <div class="fld"><label>Final Rate ($)</label><input type="number" id="lpf-rate" value="${e.final_rate||""}"></div>
      <div class="fld"><label>COGs ($)</label><input type="number" id="lpf-cogs" value="${e.cogs||""}"></div>
      <div class="fld"><label>Total Cost ($)</label><input type="number" id="lpf-cost" value="${e.total_cost||""}"></div>
    </div>
    <div class="fld"><label>Live Link</label><input id="lpf-link" value="${esc(e.live_link||"")}"></div>
    <div class="fld"><label>UTM Link</label><input id="lpf-utm" value="${esc(e.utm_link||"")}"></div>
    <div class="form-grid-2">
      <div class="fld"><label>Discount Code</label><input id="lpf-code" value="${esc(e.discount_code||"")}"></div>
      <div class="fld"><label>IG Spark Code</label><input id="lpf-ig-spark" value="${esc(e.ig_spark_code||"")}"></div>
      <div class="fld"><label>TT Spark Code</label><input id="lpf-tt-spark" value="${esc(e.tt_spark_code||"")}"></div>
      <div class="fld"><label>Paid Spend ($)</label><input type="number" id="lpf-paid-spend" value="${e.paid_spend||""}"></div>
    </div>
    <div class="form-section">Performance Metrics</div>
    <div class="form-grid-3">
      <div class="fld"><label>Total Views</label><input type="number" id="lpf-views" value="${e.total_views||""}"></div>
      <div class="fld"><label>Likes</label><input type="number" id="lpf-likes" value="${e.likes||""}"></div>
      <div class="fld"><label>Comments</label><input type="number" id="lpf-comments" value="${e.comments||""}"></div>
      <div class="fld"><label>Shares</label><input type="number" id="lpf-shares" value="${e.shares||""}"></div>
      <div class="fld"><label>Saves</label><input type="number" id="lpf-saves" value="${e.saves||""}"></div>
    </div>
  `, async ()=>{
    const n = id => parseFloat($(id)?.value)||null;
    await (isEdit ? apiPatch(`/api/live_posts/${existing.id}`, {
      influencer_id: parseInt($("lpf-inf").value),
      live_date: $("lpf-date").value||null,
      campaign: $("lpf-campaign").value.trim(),
      final_rate: n("lpf-rate"), cogs: n("lpf-cogs"), total_cost: n("lpf-cost"),
      live_link: $("lpf-link").value.trim(), utm_link: $("lpf-utm").value.trim(),
      discount_code: $("lpf-code").value.trim(), ig_spark_code: $("lpf-ig-spark").value.trim(),
      tt_spark_code: $("lpf-tt-spark").value.trim(), paid_spend: n("lpf-paid-spend"),
      total_views: n("lpf-views"), likes: n("lpf-likes"), comments: n("lpf-comments"),
      shares: n("lpf-shares"), saves: n("lpf-saves"),
    }) : apiPost("/api/live_posts", {
      influencer_id: parseInt($("lpf-inf").value),
      live_date: $("lpf-date").value||null,
      campaign: $("lpf-campaign").value.trim(),
      final_rate: n("lpf-rate"), cogs: n("lpf-cogs"), total_cost: n("lpf-cost"),
      live_link: $("lpf-link").value.trim(), utm_link: $("lpf-utm").value.trim(),
      discount_code: $("lpf-code").value.trim(), ig_spark_code: $("lpf-ig-spark").value.trim(),
      tt_spark_code: $("lpf-tt-spark").value.trim(), paid_spend: n("lpf-paid-spend"),
      total_views: n("lpf-views"), likes: n("lpf-likes"), comments: n("lpf-comments"),
      shares: n("lpf-shares"), saves: n("lpf-saves"),
    }));
    closeModal(); loadLivePosts();
  });
}

// ── 7. Payment Status ─────────────────────────────────────────────────────────
async function loadPayments() {
  const data = await apiGet("/api/payment_status");
  const filter = $("pay-filter")?.value;
  let rows = data;
  if (filter === "paid") rows = rows.filter(r=>r.paid);
  if (filter === "pending") rows = rows.filter(r=>!r.paid);

  const chk = (id, field, val) => `<input type="checkbox" ${val?"checked":""} onchange="updatePayField(${id},'${field}',this.checked)">`;
  $("pay-body").innerHTML = rows.length ? rows.map(r=>`<tr>
    <td><strong>${esc(r.influencer?.name||"")}</strong></td>
    <td>${esc(r.influencer?.email||"")}</td>
    <td>${fmtD(r.agreed_rate)}</td>
    <td>${esc(r.deliverables||"")}</td>
    <td>${chk(r.id,"content_live",r.content_live)}</td>
    <td>${fmtDate(r.payment_due_date)}</td>
    <td>${chk(r.id,"w9",r.w9)}</td>
    <td>${chk(r.id,"proper_invoice",r.proper_invoice)}</td>
    <td>${chk(r.id,"added_to_quickbooks",r.added_to_quickbooks)}</td>
    <td>${chk(r.id,"paid",r.paid)}</td>
    <td>${esc(r.status||"")}</td>
    <td><button class="btn-icon btn-edit-pay" data-id="${r.id}">✏</button></td>
  </tr>`).join("") : `<tr><td colspan="12" class="empty-cell">No payment entries yet.</td></tr>`;

  document.querySelectorAll(".btn-edit-pay").forEach(b=>
    b.addEventListener("click",()=>{ const row=rows.find(r=>String(r.id)===b.dataset.id); if(row) openPayModal(row); })
  );
}

window.updatePayField = async (id, field, val) => {
  await apiPatch(`/api/payment_status/${id}`, {[field]: val});
};

$("pay-filter")?.addEventListener("change", loadPayments);
$("btn-add-pay").addEventListener("click", ()=>openPayModal(null));

async function openPayModal(existing) {
  await getInfluencers();
  const isEdit = !!existing;
  const e = existing || {};
  openModal(isEdit?"Edit Payment":"Add Payment", `
    <div class="form-grid-2">
      <div class="fld"><label>Creator</label>
        <select id="payf-inf">${allInfluencers.filter(i=>i.in_paid_plan).map(i=>`<option value="${i.id}" ${e.influencer_id===i.id?"selected":""}>${esc(i.name||i.ig_handle)}</option>`).join("")}</select>
      </div>
      <div class="fld"><label>Agreed Rate ($)</label><input type="number" id="payf-rate" value="${e.agreed_rate||""}"></div>
      <div class="fld"><label>Deliverables</label><input id="payf-del" value="${esc(e.deliverables||"")}"></div>
      <div class="fld"><label>Payment Due</label><input type="date" id="payf-due" value="${e.payment_due_date||""}"></div>
      <div class="fld"><label>Payment Date</label><input type="date" id="payf-date" value="${e.payment_date||""}"></div>
      <div class="fld"><label>Status</label><input id="payf-status" value="${esc(e.status||"")}"></div>
    </div>
    <div class="fld"><label>Notes</label><textarea id="payf-notes" rows="2">${esc(e.notes||"")}</textarea></div>
  `, async ()=>{
    const payload = {
      influencer_id: parseInt($("payf-inf").value),
      agreed_rate:   parseFloat($("payf-rate").value)||null,
      deliverables:  $("payf-del").value.trim(),
      payment_due_date: $("payf-due").value||null,
      payment_date:  $("payf-date").value||null,
      status:        $("payf-status").value.trim(),
      notes:         $("payf-notes").value.trim(),
    };
    if (isEdit) await apiPatch(`/api/payment_status/${existing.id}`, payload);
    else await apiPost("/api/payment_status", payload);
    closeModal(); loadPayments();
  });
}

// ── Budget Tracker ─────────────────────────────────────────────────────────────
async function loadBudget() {
  const { entries, campaigns, total_budget } = await apiGet("/api/budget");
  const actuals = entries.filter(e=>e.entry_type==="actual");
  const total = actuals.reduce((s,e)=>s+Number(e.amount),0);

  $("budget-summary").textContent = `$${Math.round(total).toLocaleString()} spent of $${Math.round(total_budget).toLocaleString()} · $${Math.round(total_budget-total).toLocaleString()} remaining`;

  const cats = Object.entries(campaigns);
  $("budget-cards").innerHTML = cats.map(([key,camp])=>{
    const catTotal = actuals.filter(e=>e.category===key).reduce((s,e)=>s+Number(e.amount),0);
    return `<div class="budget-card"><div class="bc-label">${esc(camp.label)}</div><div class="bc-amt">$${Math.round(catTotal).toLocaleString()}</div></div>`;
  }).join("") + `<div class="budget-card"><div class="bc-label">Total Spent</div><div class="bc-amt">$${Math.round(total).toLocaleString()}</div></div>`;

  $("budget-body").innerHTML = entries.length ? entries.map(e=>`<tr>
    <td>${fmtDate(e.date)}</td>
    <td><span class="badge ${e.entry_type==="actual"?"badge-locked":"badge-negotiations"}">${esc(e.entry_type)}</span></td>
    <td>${esc(campaigns[e.category]?.label||e.category||"")}</td>
    <td>${esc(e.creator_handle?`@${e.creator_handle}`:"")} ${esc(e.description||"")}</td>
    <td style="font-weight:600">$${Math.round(Number(e.amount)).toLocaleString()}</td>
    <td>${esc(e.notes||"")}</td>
    <td>
      <button class="btn-icon btn-del-budget" data-id="${e.id}">✕</button>
    </td>
  </tr>`).join("") : `<tr><td colspan="7" class="empty-cell">No budget entries yet.</td></tr>`;

  document.querySelectorAll(".btn-del-budget").forEach(b=>
    b.addEventListener("click", async()=>{
      if(!confirm("Delete this entry?")) return;
      await fetch(`/api/budget/${b.dataset.id}?password=${encodeURIComponent(PW)}`, {method:"DELETE"});
      loadBudget();
    })
  );
}

$("btn-add-budget").addEventListener("click", ()=>{
  apiGet("/api/budget").then(({campaigns})=>{
    openModal("Add Budget Entry", `
      <div class="form-grid-2">
        <div class="fld"><label>Date</label><input type="date" id="bf-date" value="${new Date().toISOString().split("T")[0]}"></div>
        <div class="fld"><label>Type</label>
          <select id="bf-type"><option value="actual">Actual</option><option value="planned">Planned</option></select>
        </div>
        <div class="fld"><label>Campaign</label>
          <select id="bf-cat">${Object.entries(campaigns).map(([k,v])=>`<option value="${k}">${esc(v.label)}</option>`).join("")}</select>
        </div>
        <div class="fld"><label>Amount ($)</label><input type="number" id="bf-amt" step="0.01" required></div>
        <div class="fld"><label>Creator Handle</label><input id="bf-handle" placeholder="@username"></div>
        <div class="fld"><label>Description</label><input id="bf-desc"></div>
      </div>
      <div class="fld"><label>Notes</label><textarea id="bf-notes" rows="2"></textarea></div>
    `, async ()=>{
      await apiPost("/api/budget", {
        date:            $("bf-date").value,
        entry_type:      $("bf-type").value,
        category:        $("bf-cat").value,
        amount:          parseFloat($("bf-amt").value)||0,
        creator_handle:  $("bf-handle").value.trim().replace(/^@/,"")||null,
        description:     $("bf-desc").value.trim()||null,
        notes:           $("bf-notes").value.trim()||null,
      });
      closeModal(); loadBudget();
    });
  });
});

// ── Reporting ─────────────────────────────────────────────────────────────────
async function loadReporting() {
  const start = $("rep-start")?.value || "";
  const end   = $("rep-end")?.value || "";
  const params = new URLSearchParams();
  if (start) params.append("start", start);
  if (end)   params.append("end", end);
  const data = await apiGet(`/api/reporting?${params}`);

  const kpis = [
    {label:"Total Creators", val: data.total_influencers},
    {label:"Internal",       val: data.int_count},
    {label:"External",       val: data.ext_count},
    {label:"In Paid Plan",   val: data.in_paid_plan},
    {label:"Confirmed",      val: data.confirmed},
    {label:"Live Posts",     val: data.live_posts},
    {label:"Total Spend",    val: "$"+Math.round(data.total_spend||0).toLocaleString()},
    {label:"Total Views",    val: fmt(data.total_views)},
    {label:"CPV",            val: data.cpv ? "$"+data.cpv : "—"},
    {label:"Paid Out",       val: data.paid_count},
    {label:"Pending Payment",val: data.pending_payment},
  ];

  $("kpi-grid").innerHTML = kpis.map(k=>`<div class="kpi-card">
    <div class="kv">${k.val}</div>
    <div class="kl">${k.label}</div>
  </div>`).join("");
}

$("btn-rep-load")?.addEventListener("click", loadReporting);

// ── Modal helpers ─────────────────────────────────────────────────────────────
let modalSubmitFn = null;

function openModal(title, bodyHtml, onSubmit) {
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = bodyHtml + `
    <div class="modal-footer">
      <button class="btn-sec" id="modal-cancel">Cancel</button>
      <button class="btn-pri" id="modal-submit">Save</button>
    </div>`;
  $("modal-overlay").classList.remove("hidden");
  modalSubmitFn = onSubmit;
  // Use onclick (not addEventListener) to prevent stacking handlers across modal opens
  $("modal-close").onclick  = closeModal;
  $("modal-cancel").onclick = closeModal;
  $("modal-submit").onclick = async () => {
    const btn = $("modal-submit");
    btn.disabled = true; btn.textContent = "Saving…";
    try { await modalSubmitFn(); }
    catch(err) { alert("Error: " + err.message); btn.disabled=false; btn.textContent="Save"; }
  };
}

function closeModal() {
  $("modal-overlay").classList.add("hidden");
  modalSubmitFn = null;
}

// Clicking outside the modal box also closes it
$("modal-overlay").addEventListener("click", e => { if(e.target.id==="modal-overlay") closeModal(); });
