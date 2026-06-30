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
async function loadMasterList() {
  allInfluencers = [];  // reset cache
  const data = await apiGet(`/api/influencers?list_type=${currentListType}`);
  const search = $("ml-search")?.value.toLowerCase() || "";
  const tier   = $("ml-filter-tier")?.value || "";
  const gender = $("ml-filter-gender")?.value || "";
  let rows = data;
  if (search) rows = rows.filter(r => `${r.name} ${r.ig_handle} ${r.tt_handle} ${r.vertical}`.toLowerCase().includes(search));
  if (tier)   rows = rows.filter(r => r.tier === tier);
  if (gender) rows = rows.filter(r => r.gender === gender);

  const inPaid = rows.filter(r => r.in_paid_plan).length;
  $("ml-summary").innerHTML = `<span><strong>${rows.length}</strong> creators</span><span><strong>${inPaid}</strong> in paid plan</span>`;

  $("ml-body").innerHTML = rows.length ? rows.map(r => `<tr>
    <td><input type="checkbox" class="paid-plan-chk" data-id="${r.id}" ${r.in_paid_plan ? "checked" : ""}></td>
    <td>${esc(r.name || "")}</td>
    <td>${r.ig_handle ? `<a href="${esc(r.ig_url||`https://instagram.com/${r.ig_handle}`)}" target="_blank">@${esc(r.ig_handle)}</a>` : "—"}</td>
    <td>${r.tt_handle ? `<a href="${esc(r.tt_url||`https://tiktok.com/@${r.tt_handle}`)}" target="_blank">@${esc(r.tt_handle)}</a>` : "—"}</td>
    <td>${fmt(r.ig_followers)}</td>
    <td>${fmt(r.tt_followers)}</td>
    <td>${r.tier ? `<span class="badge badge-int">${esc(r.tier)}</span>` : "—"}</td>
    <td>${esc(r.vertical || "")}</td>
    <td>${esc(r.location || "")} ${r.is_international ? '<span class="badge badge-intl">Intl</span>' : ""}</td>
    <td>${esc(r.gender || "")}</td>
    <td>${esc(r.email || "")}</td>
    <td>
      <button class="btn-icon btn-edit-inf" data-id="${r.id}" title="Edit">✏</button>
      <button class="btn-icon btn-del-inf" data-id="${r.id}" title="Delete">✕</button>
    </td>
  </tr>`).join("") : `<tr><td colspan="12" class="empty-cell">No creators yet. Click + Add Creator.</td></tr>`;

  // Paid plan checkboxes
  document.querySelectorAll(".paid-plan-chk").forEach(cb => {
    cb.addEventListener("change", async () => {
      await apiPatch(`/api/influencers/${cb.dataset.id}`, {in_paid_plan: cb.checked});
    });
  });
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

["ml-search","ml-filter-tier","ml-filter-gender"].forEach(id =>
  document.getElementById(id)?.addEventListener("input", () => loadMasterList())
);

$("btn-add-influencer").addEventListener("click", () => openInfluencerModal(null));

function openInfluencerModal(existing) {
  const isEdit = !!existing;
  const e = existing || {};
  openModal(isEdit ? "Edit Creator" : "Add Creator", `
    <div class="form-grid-2">
      <div class="fld"><label>Name</label><input id="mf-name" value="${esc(e.name||"")}"></div>
      <div class="fld"><label>List Type</label>
        <select id="mf-list-type">
          <option value="INT" ${currentListType==="INT"?"selected":""}>Internal</option>
          <option value="EXT" ${currentListType==="EXT"?"selected":""}>External</option>
        </select>
      </div>
    </div>
    <div class="form-section">Social</div>
    <div class="form-grid-2">
      <div class="fld"><label>IG Handle</label><input id="mf-ig-handle" value="${esc(e.ig_handle||"")}" placeholder="@handle"></div>
      <div class="fld"><label>IG URL</label><input id="mf-ig-url" value="${esc(e.ig_url||"")}"></div>
      <div class="fld"><label>TikTok Handle</label><input id="mf-tt-handle" value="${esc(e.tt_handle||"")}" placeholder="@handle"></div>
      <div class="fld"><label>TikTok URL</label><input id="mf-tt-url" value="${esc(e.tt_url||"")}"></div>
      <div class="fld"><label>IG Followers</label><input type="number" id="mf-ig-fol" value="${e.ig_followers||""}"></div>
      <div class="fld"><label>TT Followers</label><input type="number" id="mf-tt-fol" value="${e.tt_followers||""}"></div>
    </div>
    <div class="form-section">Profile</div>
    <div class="form-grid-3">
      <div class="fld"><label>Tier</label>
        <select id="mf-tier"><option value="">—</option><option ${e.tier==="Nano"?"selected":""}>Nano</option><option ${e.tier==="Micro"?"selected":""}>Micro</option><option ${e.tier==="Macro"?"selected":""}>Macro</option><option ${e.tier==="Celeb"?"selected":""}>Celeb</option></select>
      </div>
      <div class="fld"><label>Gender</label>
        <select id="mf-gender"><option value="">—</option><option ${e.gender==="Female"?"selected":""}>Female</option><option ${e.gender==="Male"?"selected":""}>Male</option><option ${e.gender==="Non-binary"?"selected":""}>Non-binary</option></select>
      </div>
      <div class="fld"><label>Vertical</label><input id="mf-vertical" value="${esc(e.vertical||"")}"></div>
      <div class="fld"><label>Archetype</label><input id="mf-archetype" value="${esc(e.archetype||"")}"></div>
      <div class="fld"><label>Location</label><input id="mf-location" value="${esc(e.location||"")}"></div>
      <div class="fld"><label>Email</label><input type="email" id="mf-email" value="${esc(e.email||"")}"></div>
    </div>
    <div class="fld"><label>Audience Age Breakdown</label><input id="mf-age" value="${esc(e.audience_age||"")}"></div>
    <div class="fld"><label>ShopMy Conversion Data</label><input id="mf-shopmy" value="${esc(e.shopmy_data||"")}"></div>
    ${currentListType==="EXT" ? `<div class="fld"><label>External Feedback</label><textarea id="mf-ext-feedback" rows="2">${esc(e.external_feedback||"")}</textarea></div>` : ""}
  `, async () => {
    const payload = {
      list_type:   $("mf-list-type").value,
      name:        $("mf-name").value.trim(),
      ig_handle:   $("mf-ig-handle").value.trim().replace(/^@/,""),
      ig_url:      $("mf-ig-url").value.trim(),
      tt_handle:   $("mf-tt-handle").value.trim().replace(/^@/,""),
      tt_url:      $("mf-tt-url").value.trim(),
      ig_followers: parseFloat($("mf-ig-fol").value) || null,
      tt_followers: parseFloat($("mf-tt-fol").value) || null,
      tier:         $("mf-tier").value,
      gender:       $("mf-gender").value,
      vertical:     $("mf-vertical").value.trim(),
      archetype:    $("mf-archetype").value.trim(),
      location:     $("mf-location").value.trim(),
      email:        $("mf-email").value.trim(),
      audience_age: $("mf-age").value.trim(),
      shopmy_data:  $("mf-shopmy").value.trim(),
      external_feedback: $("mf-ext-feedback")?.value.trim() || null,
    };
    if (isEdit) await apiPatch(`/api/influencers/${existing.id}`, payload);
    else await apiPost("/api/influencers", payload);
    closeModal(); loadMasterList();
  });
}

// ── 2. Outreach ───────────────────────────────────────────────────────────────
const OUTREACH_STATUSES = ["Not Yet","Contacted","No Response","Interested","Declined"];

async function loadOutreach() {
  const data = await apiGet("/api/outreach");
  const search = $("or-search")?.value.toLowerCase() || "";
  const status = $("or-filter-status")?.value || "";
  let rows = data;
  if (search) rows = rows.filter(r => `${r.name} ${r.ig_handle}`.toLowerCase().includes(search));
  if (status) rows = rows.filter(r => r.outreach_status === status);

  $("or-body").innerHTML = rows.length ? rows.map(r => `<tr>
    <td><strong>${esc(r.name||"")}</strong></td>
    <td>${r.ig_handle ? `<a href="https://instagram.com/${esc(r.ig_handle)}" target="_blank">@${esc(r.ig_handle)}</a>` : "—"}</td>
    <td>${fmt(r.ig_followers)}</td>
    <td><span class="badge ${r.list_type==="INT"?"badge-int":"badge-ext"}">${esc(r.list_type)}</span></td>
    <td>
      <select class="or-status-sel" data-id="${r.id}" style="background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:12px">
        ${OUTREACH_STATUSES.map(s=>`<option ${r.outreach_status===s?"selected":""}>${s}</option>`).join("")}
      </select>
    </td>
    <td><input class="or-owner" data-id="${r.id}" value="${esc(r.outreach_owner||"")}" placeholder="Owner" style="width:100px;background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:12px"></td>
    <td><input type="date" class="or-date" data-id="${r.id}" value="${r.outreach_date||""}" style="background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:12px"></td>
    <td><input type="date" class="or-last" data-id="${r.id}" value="${r.last_contact||""}" style="background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:12px"></td>
    <td><input class="or-notes" data-id="${r.id}" value="${esc(r.outreach_notes||"")}" placeholder="Notes" style="width:160px;background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:12px"></td>
    <td>${r.in_paid_plan ? '<span class="badge badge-locked">✓</span>' : ""}</td>
  </tr>`).join("") : `<tr><td colspan="10" class="empty-cell">No creators found.</td></tr>`;

  const saveField = async (id, field, value) => {
    await apiPatch(`/api/influencers/${id}`, {[field]: value || null});
  };
  document.querySelectorAll(".or-status-sel").forEach(s => s.addEventListener("change", () => saveField(s.dataset.id, "outreach_status", s.value)));
  document.querySelectorAll(".or-owner").forEach(i => i.addEventListener("blur", () => saveField(i.dataset.id, "outreach_owner", i.value.trim())));
  document.querySelectorAll(".or-date").forEach(i => i.addEventListener("change", () => saveField(i.dataset.id, "outreach_date", i.value)));
  document.querySelectorAll(".or-last").forEach(i => i.addEventListener("change", () => saveField(i.dataset.id, "last_contact", i.value)));
  document.querySelectorAll(".or-notes").forEach(i => i.addEventListener("blur", () => saveField(i.dataset.id, "outreach_notes", i.value.trim())));
}

["or-search","or-filter-status"].forEach(id => document.getElementById(id)?.addEventListener("input", loadOutreach));

// ── 3. Paid Plan ──────────────────────────────────────────────────────────────
// Quick CPM calculator
["calc-imp","calc-cpm"].forEach(id => {
  document.getElementById(id)?.addEventListener("input", () => {
    const imp = parseFloat($("calc-imp")?.value) || 0;
    const cpm = parseFloat($("calc-cpm")?.value) || 0;
    $("calc-result").textContent = "= $" + Math.round((imp * cpm) / 1000).toLocaleString();
  });
});

function calcEstCost(r) {
  const igReel  = ((r.ig_reels_impressions||0) * (r.ig_reel_cpm||0)) / 1000;
  const igStory = ((r.ig_stories_impressions||0) * (r.ig_story_cpm||0)) / 1000;
  const igFeed  = ((r.ig_reels_impressions||0) * (r.ig_feed_cpm||0)) / 1000;
  const tt      = ((r.tt_impressions||0) * (r.tt_cpm||0)) / 1000;
  const sub     = igReel + igStory + igFeed + tt;
  const org     = sub * (r.organic_pct||0) / 100;
  const paid    = sub * (r.paid_pct||0) / 100;
  return sub + org + paid;
}

const STATUS_BADGE = {
  "In Negotiations": "badge-negotiations",
  "Offer Out":       "badge-offer",
  "Locked":          "badge-locked",
};

async function loadPaidPlan() {
  await getInfluencers();
  const data = await apiGet("/api/paid_plan");
  const search = $("pp-search")?.value.toLowerCase() || "";
  const status = $("pp-filter-status")?.value || "";
  let rows = data;
  if (search) rows = rows.filter(r => (r.influencer?.name||"").toLowerCase().includes(search));
  if (status) rows = rows.filter(r => r.status === status);

  $("pp-body").innerHTML = rows.length ? rows.map(r => {
    const est = calcEstCost(r);
    return `<tr>
      <td>${r.status ? `<span class="badge ${STATUS_BADGE[r.status]||""}">${esc(r.status)}</span>` : "—"}</td>
      <td><strong>${esc(r.influencer?.name||"Unknown")}</strong></td>
      <td>${esc(r.campaign||"")}</td>
      <td>${esc(r.platform_format||"")}</td>
      <td>${esc(r.usage||"")}</td>
      <td>${fmt(r.ig_reels_impressions)}</td>
      <td>${fmt(r.tt_impressions)}</td>
      <td>${fmtD(r.ig_reel_cpm)}</td>
      <td>${fmtD(r.ig_story_cpm)}</td>
      <td>${fmtD(r.tt_cpm)}</td>
      <td style="color:var(--red);font-weight:600">${fmtD(est)}</td>
      <td style="font-weight:600">${fmtD(r.accepted_offer)}</td>
      <td>
        <button class="btn-icon btn-edit-pp" data-id="${r.id}" title="Edit">✏</button>
        <button class="btn-icon btn-del-pp" data-id="${r.id}" title="Delete">✕</button>
      </td>
    </tr>`;
  }).join("") : `<tr><td colspan="13" class="empty-cell">No paid plan entries yet. Add creators to the master list and check their "Paid Plan" box, then + Add Deliverable.</td></tr>`;

  document.querySelectorAll(".btn-edit-pp").forEach(b =>
    b.addEventListener("click", () => {
      const row = rows.find(r => String(r.id) === b.dataset.id);
      if (row) openPaidPlanModal(row);
    })
  );
  document.querySelectorAll(".btn-del-pp").forEach(b =>
    b.addEventListener("click", async () => {
      if (!confirm("Delete this deliverable?")) return;
      await apiDelete(`/api/paid_plan/${b.dataset.id}?password=${encodeURIComponent(PW)}`);
      loadPaidPlan();
    })
  );
}

["pp-search","pp-filter-status"].forEach(id => document.getElementById(id)?.addEventListener("input", loadPaidPlan));
$("btn-add-pp").addEventListener("click", () => openPaidPlanModal(null));

async function openPaidPlanModal(existing) {
  await getInfluencers();
  const inPaidPlan = allInfluencers.filter(i => i.in_paid_plan);
  const isEdit = !!existing;
  const e = existing || {};
  openModal(isEdit ? "Edit Deliverable" : "Add Deliverable", `
    <div class="form-grid-2">
      <div class="fld"><label>Creator</label>
        <select id="ppf-inf">${inPaidPlan.map(i=>`<option value="${i.id}" ${e.influencer_id===i.id?"selected":""}>${esc(i.name||i.ig_handle)}</option>`).join("")}</select>
      </div>
      <div class="fld"><label>Status</label>
        <select id="ppf-status">
          <option value="">—</option>
          <option ${e.status==="In Negotiations"?"selected":""}>In Negotiations</option>
          <option ${e.status==="Offer Out"?"selected":""}>Offer Out</option>
          <option ${e.status==="Locked"?"selected":""}>Locked</option>
        </select>
      </div>
      <div class="fld"><label>Campaign</label><input id="ppf-campaign" value="${esc(e.campaign||"")}"></div>
      <div class="fld"><label>Platform / Format</label>
        <select id="ppf-format">
          <option value="">—</option>
          <option ${e.platform_format==="IG Reel"?"selected":""}>IG Reel</option>
          <option ${e.platform_format==="IG Story"?"selected":""}>IG Story</option>
          <option ${e.platform_format==="IG In-Feed"?"selected":""}>IG In-Feed</option>
          <option ${e.platform_format==="TikTok"?"selected":""}>TikTok</option>
        </select>
      </div>
      <div class="fld"><label>Usage</label>
        <select id="ppf-usage"><option>Organic</option><option ${e.usage==="Paid"?"selected":""}>Paid</option><option ${e.usage==="Both"?"selected":""}>Both</option></select>
      </div>
      <div class="fld"><label>Exclusivity</label><input id="ppf-excl" value="${esc(e.exclusivity||"")}"></div>
    </div>
    <div class="form-section">Impressions</div>
    <div class="form-grid-3">
      <div class="fld"><label>IG Reels Avg Impressions</label><input type="number" id="ppf-ig-r-imp" value="${e.ig_reels_impressions||""}"></div>
      <div class="fld"><label>IG Stories Avg Impressions</label><input type="number" id="ppf-ig-s-imp" value="${e.ig_stories_impressions||""}"></div>
      <div class="fld"><label>TikTok Avg Impressions</label><input type="number" id="ppf-tt-imp" value="${e.tt_impressions||""}"></div>
    </div>
    <div class="form-section">CPM Rates</div>
    <div class="form-grid-3">
      <div class="fld"><label>IG Reel CPM ($)</label><input type="number" step="0.01" id="ppf-reel-cpm" value="${e.ig_reel_cpm||""}"></div>
      <div class="fld"><label>IG Story CPM ($)</label><input type="number" step="0.01" id="ppf-story-cpm" value="${e.ig_story_cpm||""}"></div>
      <div class="fld"><label>TT CPM ($)</label><input type="number" step="0.01" id="ppf-tt-cpm" value="${e.tt_cpm||""}"></div>
    </div>
    <div class="form-section">Usage Rights + Negotiation</div>
    <div class="form-grid-3">
      <div class="fld"><label>Organic Usage %</label><input type="number" step="0.1" id="ppf-org-pct" value="${e.organic_pct||""}"></div>
      <div class="fld"><label>Paid Usage %</label><input type="number" step="0.1" id="ppf-paid-pct" value="${e.paid_pct||""}"></div>
      <div class="fld"><label>First Offer ($)</label><input type="number" id="ppf-first" value="${e.first_offer||""}"></div>
      <div class="fld"><label>Influencer Offer ($)</label><input type="number" id="ppf-inf-offer" value="${e.influencer_offer||""}"></div>
      <div class="fld"><label>A8 Counter ($)</label><input type="number" id="ppf-a8c" value="${e.a8_counter||""}"></div>
      <div class="fld"><label>Accepted Offer ($)</label><input type="number" id="ppf-accepted" value="${e.accepted_offer||""}"></div>
    </div>
    <div class="fld" style="margin-top:8px"><label>Notes</label><textarea id="ppf-notes" rows="2">${esc(e.notes||"")}</textarea></div>
  `, async () => {
    const n = id => parseFloat($(id)?.value) || null;
    const payload = {
      influencer_id:          parseInt($("ppf-inf").value),
      status:                 $("ppf-status").value,
      campaign:               $("ppf-campaign").value.trim(),
      platform_format:        $("ppf-format").value,
      usage:                  $("ppf-usage").value,
      exclusivity:            $("ppf-excl").value.trim(),
      ig_reels_impressions:   n("ppf-ig-r-imp"),
      ig_stories_impressions: n("ppf-ig-s-imp"),
      tt_impressions:         n("ppf-tt-imp"),
      ig_reel_cpm:            n("ppf-reel-cpm"),
      ig_story_cpm:           n("ppf-story-cpm"),
      tt_cpm:                 n("ppf-tt-cpm"),
      organic_pct:            n("ppf-org-pct"),
      paid_pct:               n("ppf-paid-pct"),
      first_offer:            n("ppf-first"),
      influencer_offer:       n("ppf-inf-offer"),
      a8_counter:             n("ppf-a8c"),
      accepted_offer:         n("ppf-accepted"),
      notes:                  $("ppf-notes").value.trim(),
    };
    if (isEdit) await apiPatch(`/api/paid_plan/${existing.id}`, payload);
    else await apiPost("/api/paid_plan", payload);
    closeModal(); loadPaidPlan();
  });
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
      html += `<div class="cal-day ${ds===todayStr?"is-today":""}">
        <div class="cal-day-num">${d}</div>
        ${es.map(e=>`<div class="cal-entry">@${esc(e.influencer?.ig_handle||e.influencer?.name||"")} · ${esc(e.deliverable||"")}</div>`).join("")}
      </div>`;
    }
    $("cal-days").innerHTML = html;
  } else {
    const rows = calRows.filter(r => r.scheduled_date?.startsWith(`${calY}-${pad(calM+1)}`));
    $("cal-body").innerHTML = rows.length ? rows.map(r=>`<tr>
      <td>${fmtDate(r.scheduled_date)}</td>
      <td>${esc(r.influencer?.name||"")}</td>
      <td>${esc(r.deliverable||"")}</td>
      <td>${esc(r.usage||"")}</td>
      <td>${r.collab?"✓":""}</td>
      <td>${esc(r.notes||"")}</td>
      <td><button class="btn-icon" onclick="deleteCalEntry(${r.id})">✕</button></td>
    </tr>`).join("") : `<tr><td colspan="7" class="empty-cell">No entries this month.</td></tr>`;
  }
}

window.deleteCalEntry = async (id) => {
  if (!confirm("Delete this entry?")) return;
  await apiDelete(`/api/content_calendar/${id}?password=${encodeURIComponent(PW)}`);
  loadCalendar();
};

$("btn-add-cal").addEventListener("click", async () => {
  await getInfluencers();
  const inPaidPlan = allInfluencers.filter(i => i.in_paid_plan);
  openModal("Add Calendar Entry", `
    <div class="fld"><label>Creator (from Paid Plan)</label>
      <select id="calf-inf"><option value="">— select —</option>${inPaidPlan.map(i=>`<option value="${i.id}">${esc(i.name||i.ig_handle)}</option>`).join("")}</select>
    </div>
    <div class="form-grid-2">
      <div class="fld"><label>Date</label><input type="date" id="calf-date"></div>
      <div class="fld"><label>Deliverable</label>
        <select id="calf-del"><option>IG Reel</option><option>IG Story</option><option>IG In-Feed</option><option>TikTok</option></select>
      </div>
      <div class="fld"><label>Usage</label>
        <select id="calf-usage"><option>Organic</option><option>Paid</option><option>Both</option></select>
      </div>
      <div class="fld"><label>Collab?</label>
        <select id="calf-collab"><option value="false">No</option><option value="true">Yes</option></select>
      </div>
    </div>
    <div class="fld"><label>Notes</label><textarea id="calf-notes" rows="2"></textarea></div>
  `, async () => {
    await apiPost("/api/content_calendar", {
      influencer_id:  parseInt($("calf-inf").value),
      scheduled_date: $("calf-date").value,
      deliverable:    $("calf-del").value,
      usage:          $("calf-usage").value,
      collab:         $("calf-collab").value === "true",
      notes:          $("calf-notes").value.trim(),
    });
    closeModal(); loadCalendar();
  });
});

// ── 5. Content Review ─────────────────────────────────────────────────────────
async function loadContentReview() {
  const data = await apiGet("/api/content_review");
  const filter = $("cr-filter-status")?.value;
  let rows = data;
  if (filter === "true")  rows = rows.filter(r => r.approved_by_client);
  if (filter === "false") rows = rows.filter(r => !r.approved_by_client);

  $("cr-body").innerHTML = rows.length ? rows.map(r=>`<tr>
    <td>${esc(r.influencer?.name||"")}</td>
    <td>${esc(r.campaign||"")}</td>
    <td>${esc(r.deliverable_type||"")}</td>
    <td>${fmtDate(r.content_due_date)}</td>
    <td>${fmtDate(r.live_date)}</td>
    <td>${r.content_v1 ? `<a href="${esc(r.content_v1)}" target="_blank">V1 ↗</a>` : "—"}</td>
    <td>${esc(r.a8_feedback_v1||"")}</td>
    <td>${esc(r.client_feedback_v1||"")}</td>
    <td>${r.content_v2 ? `<a href="${esc(r.content_v2)}" target="_blank">V2 ↗</a>` : "—"}</td>
    <td><input type="checkbox" ${r.approved_by_client?"checked":""} onchange="toggleApproval(${r.id}, this.checked)"></td>
    <td><button class="btn-icon btn-edit-cr" data-id="${r.id}">✏</button></td>
  </tr>`).join("") : `<tr><td colspan="11" class="empty-cell">No content review entries yet.</td></tr>`;

  document.querySelectorAll(".btn-edit-cr").forEach(b=>
    b.addEventListener("click", ()=>{
      const row = rows.find(r=>String(r.id)===b.dataset.id);
      if (row) openContentReviewModal(row);
    })
  );
}

window.toggleApproval = async (id, val) => {
  await apiPatch(`/api/content_review/${id}`, {approved_by_client: val});
};

$("cr-filter-status")?.addEventListener("change", loadContentReview);
$("btn-add-cr").addEventListener("click", () => openContentReviewModal(null));

async function openContentReviewModal(existing) {
  await getInfluencers();
  const isEdit = !!existing;
  const e = existing || {};
  openModal(isEdit?"Edit Content Review":"Add Content Review", `
    <div class="form-grid-2">
      <div class="fld"><label>Creator</label>
        <select id="crf-inf">${allInfluencers.filter(i=>i.in_paid_plan).map(i=>`<option value="${i.id}" ${e.influencer_id===i.id?"selected":""}>${esc(i.name||i.ig_handle)}</option>`).join("")}</select>
      </div>
      <div class="fld"><label>Campaign</label><input id="crf-campaign" value="${esc(e.campaign||"")}"></div>
      <div class="fld"><label>Deliverable</label><input id="crf-del" value="${esc(e.deliverable_type||"")}"></div>
      <div class="fld"><label>Content Due</label><input type="date" id="crf-due" value="${e.content_due_date||""}"></div>
      <div class="fld"><label>Live Date</label><input type="date" id="crf-live" value="${e.live_date||""}"></div>
      <div class="fld"><label>Month</label><input id="crf-month" value="${esc(e.month||"")}"></div>
    </div>
    <div class="fld"><label>Concept</label><textarea id="crf-concept" rows="3">${esc(e.concept||"")}</textarea></div>
    <div class="form-section">Content Versions</div>
    <div class="fld"><label>Content V1 (link)</label><input id="crf-cv1" value="${esc(e.content_v1||"")}"></div>
    <div class="fld"><label>A8 Feedback V1</label><textarea id="crf-af1" rows="2">${esc(e.a8_feedback_v1||"")}</textarea></div>
    <div class="fld"><label>Client Feedback V1</label><textarea id="crf-cf1" rows="2">${esc(e.client_feedback_v1||"")}</textarea></div>
    <div class="fld"><label>Content V2 (link)</label><input id="crf-cv2" value="${esc(e.content_v2||"")}"></div>
    <div class="fld"><label>A8 Feedback V2</label><textarea id="crf-af2" rows="2">${esc(e.a8_feedback_v2||"")}</textarea></div>
    <div class="fld"><label>Client Feedback V2</label><textarea id="crf-cf2" rows="2">${esc(e.client_feedback_v2||"")}</textarea></div>
  `, async ()=>{
    const payload = {
      influencer_id: parseInt($("crf-inf").value),
      campaign:      $("crf-campaign").value.trim(),
      deliverable_type: $("crf-del").value.trim(),
      content_due_date: $("crf-due").value || null,
      live_date:     $("crf-live").value || null,
      month:         $("crf-month").value.trim(),
      concept:       $("crf-concept").value.trim(),
      content_v1:    $("crf-cv1").value.trim(),
      a8_feedback_v1: $("crf-af1").value.trim(),
      client_feedback_v1: $("crf-cf1").value.trim(),
      content_v2:    $("crf-cv2").value.trim(),
      a8_feedback_v2: $("crf-af2").value.trim(),
      client_feedback_v2: $("crf-cf2").value.trim(),
    };
    if (isEdit) await apiPatch(`/api/content_review/${existing.id}`, payload);
    else await apiPost("/api/content_review", payload);
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
  $("modal-cancel").addEventListener("click", closeModal);
  $("modal-submit").addEventListener("click", async () => {
    const btn = $("modal-submit");
    btn.disabled = true; btn.textContent = "Saving…";
    try { await modalSubmitFn(); }
    catch(e) { alert("Error: " + e.message); btn.disabled=false; btn.textContent="Save"; }
  });
}

function closeModal() {
  $("modal-overlay").classList.add("hidden");
  modalSubmitFn = null;
}

$("modal-close").addEventListener("click", closeModal);
$("modal-overlay").addEventListener("click", e => { if(e.target.id==="modal-overlay") closeModal(); });
