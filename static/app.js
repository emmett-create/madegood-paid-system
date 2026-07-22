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

async function refreshCampaignDatalist() {
  try {
    const campaigns = await apiGet("/api/campaigns");
    _campAllOptions = campaigns || [];
    const dl = document.getElementById("campaign-datalist");
    if (dl) dl.innerHTML = _campAllOptions.map(c => `<option value="${esc(c)}"></option>`).join("");
    // Also refresh the filter dropdown
    const sel = document.getElementById("ml-filter-campaign");
    if (sel) {
      const cur = sel.value;
      sel.innerHTML = `<option value="">All campaigns</option>` +
        _campAllOptions.map(c => `<option value="${esc(c)}" ${cur===c?"selected":""}>${esc(c)}</option>`).join("");
    }
  } catch { /* ignore */ }
}

// ── Campaign picker helpers (used in Edit Creator modal) ─────────────────────
let _campAllOptions = [];

function toggleCampaignPanel() {
  const panel = document.getElementById("camp-panel");
  if (!panel) return;
  const isOpen = panel.style.display !== "none";
  if (isOpen) { panel.style.display = "none"; return; }
  panel.style.display = "block";
  populateCampaignChips("");
  setTimeout(() => document.getElementById("camp-search")?.focus(), 50);
  // Close on outside click
  setTimeout(() => {
    document.addEventListener("click", function outsideClick(e) {
      if (!document.getElementById("camp-panel")?.contains(e.target) &&
          e.target.id !== "camp-trigger" && !document.getElementById("camp-trigger")?.contains(e.target)) {
        const p = document.getElementById("camp-panel");
        if (p) p.style.display = "none";
        document.removeEventListener("click", outsideClick);
      }
    });
  }, 10);
}

function populateCampaignChips(filter) {
  const chips = document.getElementById("camp-chips");
  if (!chips) return;
  const f = filter.toLowerCase();
  const matches = _campAllOptions.filter(c => !f || c.toLowerCase().includes(f));
  const current = document.getElementById("mf-campaign")?.value || "";
  chips.innerHTML = matches.map(c => `
    <div onclick="selectCampaign('${esc(c)}')" style="cursor:pointer;padding:5px 12px;border-radius:20px;font-size:12px;border:1px solid var(--border);background:${c===current?'var(--red)':'var(--panel2)'};color:${c===current?'#fff':'var(--text)'}">
      ${esc(c)}
    </div>`).join("") || `<div style="font-size:12px;color:var(--dim)">No matches — press Enter to create</div>`;
}

function filterCampaignChips(val) {
  populateCampaignChips(val);
}

function selectCampaign(val) {
  const hidden = document.getElementById("mf-campaign");
  const display = document.getElementById("camp-val-display");
  if (hidden) hidden.value = val;
  if (display) {
    display.textContent = val || "Select or type new…";
    display.style.color = val ? "var(--text)" : "var(--dim)";
  }
  const panel = document.getElementById("camp-panel");
  if (panel) panel.style.display = "none";
}

document.getElementById("btn-manage-campaigns")?.addEventListener("click", async () => {
  const campaigns = await apiGet("/api/campaigns");
  const renderList = (list) => list.map((c, i) => `
    <div class="camp-row" style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <input class="camp-edit" data-orig="${esc(c)}" value="${esc(c)}" style="flex:1;background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px">
      <button class="camp-del" data-name="${esc(c)}" style="background:none;border:none;cursor:pointer;color:var(--dim);font-size:16px;padding:4px 8px" title="Delete">🗑</button>
    </div>`).join("");

  const bodyHtml = `
    <p style="color:var(--dim);font-size:12px;margin-bottom:14px">Delete removes a campaign from all creators. Rename and save to rename it everywhere.</p>
    <div id="camp-manage-list">${renderList(campaigns || [])}</div>
    <button id="camp-add-item" class="btn-sec" style="width:100%;margin-top:4px">+ Add another item</button>`;

  openModal("Manage Campaigns", bodyHtml, async () => {
    // Save renames
    const rows = document.querySelectorAll(".camp-row");
    for (const row of rows) {
      const input = row.querySelector(".camp-edit");
      const orig = input.dataset.orig;
      const newVal = input.value.trim();
      if (newVal && newVal !== orig) {
        // Rename: clear old, set new on all creators with that campaign
        const withOld = await apiGet("/api/campaigns");
        const affected = await fetch(`/api/influencers?list_type=INT`); // get all & update by handle
        await fetch(`/api/campaigns/${encodeURIComponent(orig)}?password=${encodeURIComponent(PW)}`, {method:"DELETE"});
        // Note: user would need to re-assign manually for renames — keep simple for now
      }
    }
    refreshCampaignDatalist();
    loadMasterList();
    closeModal();
  });

  // Hide Save for now — use only delete/add actions
  document.getElementById("modal-submit").style.display = "none";

  document.getElementById("camp-add-item").addEventListener("click", () => {
    const list = document.getElementById("camp-manage-list");
    const div = document.createElement("div");
    div.className = "camp-row";
    div.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px";
    div.innerHTML = `<input class="camp-edit" data-orig="" value="" placeholder="New campaign name…" style="flex:1;background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px">
      <button class="camp-del" data-name="" style="background:none;border:none;cursor:pointer;color:var(--dim);font-size:16px;padding:4px 8px">🗑</button>`;
    list.appendChild(div);
    div.querySelector(".camp-del").addEventListener("click", () => div.remove());
  });

  document.querySelectorAll(".camp-del").forEach(btn => {
    btn.addEventListener("click", async () => {
      const name = btn.dataset.name;
      if (!name) { btn.closest(".camp-row").remove(); return; }
      if (!confirm(`Remove "${name}" from all creators?`)) return;
      btn.disabled = true;
      await fetch(`/api/campaigns/${encodeURIComponent(name)}?password=${encodeURIComponent(PW)}`, {method:"DELETE"});
      btn.closest(".camp-row").remove();
      refreshCampaignDatalist();
      loadMasterList();
    });
  });
});

async function loadMasterList() {
  allInfluencers = [];  // reset cache
  refreshCampaignDatalist();
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
  loadTally();

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
      const row = rows.find(r => String(r.id) === b.dataset.id);
      if (!row) return;
      const label = row.name || row.ig_handle || "this creator";
      if (!confirm(`Delete ${label} from the ${currentListType} list?`)) return;

      await fetch(`/api/influencers/${b.dataset.id}?password=${encodeURIComponent(PW)}`, {method:"DELETE"});

      // Check if they also exist in the other list and offer to delete there too
      if (row.ig_handle) {
        const otherType = currentListType === "INT" ? "EXT" : "INT";
        const otherList = await apiGet(`/api/influencers?list_type=${otherType}`);
        const match = otherList.find(i => i.ig_handle && i.ig_handle.toLowerCase() === row.ig_handle.toLowerCase());
        if (match && confirm(`${label} also exists in the ${otherType} list. Delete from there too?`)) {
          await fetch(`/api/influencers/${match.id}?password=${encodeURIComponent(PW)}`, {method:"DELETE"});
        }
      }

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

  // EXT: client approved checkbox → also sets in_paid_plan, cascades on uncheck
  document.querySelectorAll(".ml-client-approved").forEach(cb =>
    cb.addEventListener("change", async () => {
      const infId = parseInt(cb.dataset.id);
      await apiPatch(`/api/influencers/${infId}`, {
        client_approved: cb.checked,
        in_paid_plan:    cb.checked ? true : false,
      });
      // Unchecking → cascade delete Content Review + Calendar entries
      if (!cb.checked) {
        try {
          const existing = await apiGet("/api/content_review");
          const toDelete = existing.filter(r => r.influencer_id === infId);
          if (!calRows.length) { try { calRows = await apiGet("/api/content_calendar"); } catch {} }
          for (const entry of toDelete) {
            const calEntries = calRows.filter(c => c.content_review_id === entry.id);
            for (const cal of calEntries) {
              await fetch(`/api/content_calendar/${cal.id}?password=${encodeURIComponent(PW)}`, {method:"DELETE"});
            }
            await fetch(`/api/content_review/${entry.id}?password=${encodeURIComponent(PW)}`, {method:"DELETE"});
          }
          calRows = [];
        } catch(err) { console.error("Cascade on client uncheck:", err); }
      }
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

// ── Tally / Pivot table ────────────────────────────────────────────────────────
let tallyIntData = [], tallyExtData = [];
let tallyDimensions = ["vertical"]; // active row dimensions

const TALLY_DIMS = {
  vertical: "Vertical / Archetype",
  tier:     "Tier",
  gender:   "Gender",
  campaign: "Campaign",
  location: "Location",
};

function renderTallyChips() {
  const chips = $("ml-tally-chips");
  if (!chips) return;
  chips.innerHTML = tallyDimensions.map(d => `
    <span style="background:var(--panel2);border:1px solid var(--border);border-radius:6px;padding:3px 10px;font-size:12px;display:inline-flex;align-items:center;gap:6px">
      ${TALLY_DIMS[d] || d}
      <button onclick="removeTallyDim('${d}')" style="background:none;border:none;color:var(--dim);cursor:pointer;font-size:12px;padding:0;line-height:1">×</button>
    </span>`).join("");
}

window.removeTallyDim = (dim) => {
  if (tallyDimensions.length === 1) return; // keep at least one
  tallyDimensions = tallyDimensions.filter(d => d !== dim);
  renderTallyChips();
  renderTally();
};

function renderTally() {
  const body = $("ml-tally-body");
  if (!body || !tallyDimensions.length) return;

  const dims = tallyDimensions;
  const SEP  = "|||";

  // Build composite key from all selected dimensions
  const keyOf = r => dims.map(d => r[d] || "—").join(SEP);

  const intCounts = {}, extCounts = {};
  tallyIntData.forEach(r => { const k = keyOf(r); intCounts[k] = (intCounts[k]||0)+1; });
  tallyExtData.forEach(r => { const k = keyOf(r); extCounts[k] = (extCounts[k]||0)+1; });

  const allKeys = [...new Set([...Object.keys(intCounts), ...Object.keys(extCounts)])].sort();
  const total   = allKeys.reduce((s,k)=>(s+(intCounts[k]||0)+(extCounts[k]||0)),0);

  if (!allKeys.length) { body.innerHTML = `<p style="color:var(--dim);font-size:12px">No data.</p>`; return; }

  const thStyle = "background:var(--panel2);color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.4px;padding:8px 12px;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap";
  const tdStyle = "padding:8px 12px;border-bottom:1px solid var(--border);font-size:12px";

  const headers = dims.map(d=>`<th style="${thStyle}">${TALLY_DIMS[d]||d}</th>`).join("")
    + `<th style="${thStyle};text-align:center;color:var(--purple)">INT</th>`
    + `<th style="${thStyle};text-align:center;color:var(--blue)">EXT</th>`
    + `<th style="${thStyle};text-align:center">Total</th>`;

  const rows = allKeys.map(k => {
    const vals   = k.split(SEP);
    const intN   = intCounts[k] || 0;
    const extN   = extCounts[k] || 0;
    const rowTot = intN + extN;
    const pct    = total ? Math.round(rowTot/total*100) : 0;
    return `<tr>
      ${vals.map(v=>`<td style="${tdStyle}">${esc(v)}</td>`).join("")}
      <td style="${tdStyle};text-align:center;font-weight:600;color:var(--purple)">${intN}</td>
      <td style="${tdStyle};text-align:center;font-weight:600;color:var(--blue)">${extN}</td>
      <td style="${tdStyle};text-align:center;color:var(--dim)">${rowTot} <span style="font-size:10px">(${pct}%)</span></td>
    </tr>`;
  }).join("");

  body.innerHTML = `<div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr>${headers}</tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        ${dims.map(()=>`<td style="${tdStyle};font-weight:700">Total</td>`).join("")}
        <td style="${tdStyle};text-align:center;font-weight:700;color:var(--purple)">${tallyIntData.length}</td>
        <td style="${tdStyle};text-align:center;font-weight:700;color:var(--blue)">${tallyExtData.length}</td>
        <td style="${tdStyle};text-align:center;font-weight:700">${total}</td>
      </tr></tfoot>
    </table>
  </div>`;
}

async function loadTally() {
  const [intData, extData] = await Promise.all([
    apiGet("/api/influencers?list_type=INT"),
    apiGet("/api/influencers?list_type=EXT"),
  ]);
  tallyIntData = intData || [];
  tallyExtData = extData || [];
  renderTallyChips();
  renderTally();
}

$("ml-tally-add")?.addEventListener("click", () => {
  const available = Object.entries(TALLY_DIMS).filter(([k]) => !tallyDimensions.includes(k));
  if (!available.length) return;
  // Simple prompt-style picker using a temporary select
  const sel = document.createElement("select");
  sel.style.cssText = "background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 10px;font-size:12px;margin-left:6px";
  sel.innerHTML = `<option value="">Pick dimension…</option>` + available.map(([k,v])=>`<option value="${k}">${v}</option>`).join("");
  sel.onchange = () => {
    if (sel.value) {
      tallyDimensions.push(sel.value);
      sel.remove();
      renderTallyChips();
      renderTally();
    }
  };
  $("ml-tally-add").after(sel);
  sel.focus();
});

// ── Paid Plan Pivot Table ─────────────────────────────────────────────────────
let ppTallyDimensions = [];
let ppTallyData = [];
let ppCrMonthMap = {}; // influencer handle → earliest live month from CR

const PP_TALLY_DIMS = {
  campaign:   "Campaign",
  month_live: "Month Live",
  status:     "Status",
  tier:       "Tier",
  vertical:   "Vertical",
  collab:     "Collab Post",
  usage:      "Usage",
};

function ppTallyKeyOf(r) {
  return ppTallyDimensions.map(d => {
    if (d === "month_live") return ppCrMonthMap[(r.influencer?.ig_handle||"").toLowerCase()] || "—";
    if (d === "campaign")   return r.influencer?.campaign || "—";
    if (d === "status")     return r.status || "—";
    if (d === "tier")       return r.influencer?.tier || "—";
    if (d === "vertical")   return r.influencer?.vertical || "—";
    if (d === "collab")     return ppRowHasCollab(r) ? "Yes" : "No";
    if (d === "usage")      return ppRowUsage(r) || "—";
    return "—";
  }).join("|||");
}

function ppRowHasCollab(r) {
  const pd = r.post_details || {};
  return Object.values(pd).flat().some(p => p?.is_collab);
}

function ppRowUsage(r) {
  const pd = r.post_details || {};
  const all = new Set(Object.values(pd).flat().flatMap(p => p?.usage || []));
  return [...all].join(", ") || null;
}

function renderPpTallyChips() {
  const chips = $("pp-tally-chips");
  if (!chips) return;
  chips.innerHTML = ppTallyDimensions.map(d => `
    <span style="background:var(--panel2);border:1px solid var(--border);border-radius:6px;padding:3px 10px;font-size:12px;display:inline-flex;align-items:center;gap:6px">
      ${PP_TALLY_DIMS[d] || d}
      <button onclick="removePpTallyDim('${d}')" style="background:none;border:none;color:var(--dim);cursor:pointer;font-size:12px;padding:0;line-height:1">×</button>
    </span>`).join("");
}

window.removePpTallyDim = (dim) => {
  ppTallyDimensions = ppTallyDimensions.filter(d => d !== dim);
  renderPpTallyChips();
  renderPpTally();
};

function renderPpTally() {
  const body = $("pp-tally-body");
  if (!body) return;
  if (!ppTallyDimensions.length) {
    body.innerHTML = `<p style="color:var(--dim);font-size:12px;padding:4px 0">Click <strong>+ Add Row</strong> to choose a dimension.</p>`;
    return;
  }
  if (!ppTallyData.length) return;
  const SEP = "|||";
  const counts = {};
  ppTallyData.forEach(r => { const k = ppTallyKeyOf(r); counts[k] = (counts[k]||0)+1; });
  const allKeys = Object.keys(counts).sort();
  const total = Object.values(counts).reduce((a,b)=>a+b,0);
  const thS = "background:var(--panel2);color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.4px;padding:8px 12px;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap";
  const tdS = "padding:8px 12px;border-bottom:1px solid var(--border);font-size:12px";
  const headers = ppTallyDimensions.map(d=>`<th style="${thS}">${PP_TALLY_DIMS[d]||d}</th>`).join("")
    + `<th style="${thS};text-align:center">Count</th>`;
  const rows = allKeys.map(k => {
    const vals = k.split(SEP);
    const n = counts[k];
    const pct = total ? Math.round(n/total*100) : 0;
    return `<tr>${vals.map(v=>`<td style="${tdS}">${esc(v)}</td>`).join("")}
      <td style="${tdS};text-align:center;font-weight:600;color:var(--red)">${n} <span style="font-size:10px;color:var(--dim)">(${pct}%)</span></td>
    </tr>`;
  }).join("");
  body.innerHTML = `<div style="overflow-x:auto;border:1px solid var(--border);border-radius:8px">
    <table style="width:100%;border-collapse:collapse">
      <thead><tr>${headers}</tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>${ppTallyDimensions.map(()=>`<td style="${tdS};font-weight:700">Total</td>`).join("")}
        <td style="${tdS};text-align:center;font-weight:700">${total}</td></tr></tfoot>
    </table></div>`;
}

$("pp-tally-add")?.addEventListener("click", () => {
  const available = Object.entries(PP_TALLY_DIMS).filter(([k]) => !ppTallyDimensions.includes(k));
  if (!available.length) return;
  const sel = document.createElement("select");
  sel.style.cssText = "background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 10px;font-size:12px;margin-left:6px";
  sel.innerHTML = `<option value="">Pick dimension…</option>` + available.map(([k,v])=>`<option value="${k}">${v}</option>`).join("");
  sel.onchange = () => {
    if (sel.value) { ppTallyDimensions.push(sel.value); sel.remove(); renderPpTallyChips(); renderPpTally(); }
  };
  $("pp-tally-add").after(sel);
  sel.focus();
});

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
  refreshCampaignDatalist(); // ensure campaign options are fresh
  const isEdit = !!existing;
  const e = existing || {};
  const preTier   = e.tier || calcTier(e.ig_followers, e.tt_followers);
  const showState = !e.location_country || e.location_country === "United States";
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
        <select id="mf-tier"><option value="">—</option><option ${preTier==="Nano"?"selected":""}>Nano</option><option ${preTier==="Micro"?"selected":""}>Micro</option><option ${preTier==="Mid"?"selected":""}>Mid</option><option ${preTier==="Macro"?"selected":""}>Macro</option><option ${preTier==="Mega"?"selected":""}>Mega</option></select>
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
          ${["United States","United Kingdom","Canada","Australia","Mexico","Brazil","France","Germany","Spain","Italy","Netherlands","Sweden","Denmark","Norway","South Korea","Japan","India","Other"].map(c=>`<option ${((e.location_country||"")===c)?'selected':''}>${c}</option>`).join("")}
        </select>
      </div>
      <div class="fld" id="mf-state-wrap" style="${showState ? "" : "display:none"}">
        <label>State</label>
        <select id="mf-state">
          <option value="">—</option>
          ${["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"].map(s=>`<option ${((e.location||"")===s)?'selected':''}>${s}</option>`).join("")}
        </select>
      </div>
      <div class="fld"><label>Email</label><input type="email" id="mf-email" value="${esc(e.email||"")}"></div>
    </div>
    <div class="fld" style="position:relative">
      <label>Campaign</label>
      <div id="camp-trigger" onclick="toggleCampaignPanel()" style="cursor:pointer;background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px;display:flex;justify-content:space-between;align-items:center;min-height:37px">
        <span id="camp-val-display" style="color:${e.campaign?'var(--text)':'var(--dim)'}">${esc(e.campaign||"Select or type new…")}</span>
        <span style="color:var(--dim);font-size:10px">▾</span>
      </div>
      <div id="camp-panel" style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;background:var(--panel);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.15);z-index:10001;padding:10px">
        <input id="camp-search" placeholder="Search or type new…" autocomplete="off"
          oninput="filterCampaignChips(this.value)"
          onkeydown="if(event.key==='Enter'&&this.value.trim()){selectCampaign(this.value.trim());}"
          style="width:100%;border:1px solid var(--border);border-radius:6px;padding:7px 10px;font-size:12px;background:var(--panel2);margin-bottom:8px">
        <div style="font-size:10px;color:var(--dim);margin-bottom:6px">Press Enter to add a new campaign</div>
        <div id="camp-chips" style="display:flex;flex-wrap:wrap;gap:6px;max-height:180px;overflow-y:auto"></div>
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
          <button onclick="selectCampaign('')" style="font-size:11px;color:var(--dim);background:none;border:none;cursor:pointer;padding:0">✕ Clear</button>
        </div>
      </div>
      <input type="hidden" id="mf-campaign" value="${esc(e.campaign||"")}">
    </div>
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
      if (t && $("mf-tier")) $("mf-tier").value = t;
    };
    $("mf-ig-fol")?.addEventListener("input",  updateTier);
    $("mf-ig-fol")?.addEventListener("change", updateTier);
    $("mf-tt-fol")?.addEventListener("input",  updateTier);
    $("mf-tt-fol")?.addEventListener("change", updateTier);
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
  // Always fetch all paid_plan records (not just in_paid_plan=true) so deliverables persist
  const [data, planData] = await Promise.all([
    apiGet("/api/outreach"),
    apiGet("/api/paid_plan/all"),
  ]);

  // Build BOTH id-based and handle-based plan maps for cross-list INT↔EXT matching
  const planMap = {};
  const handlePlanMap = {};
  planData.forEach(p => {
    planMap[p.influencer_id] = p;
    if (p.ig_handle && !handlePlanMap[p.ig_handle]) {
      handlePlanMap[p.ig_handle] = p;
    }
  });

  const getPlan = (r) =>
    planMap[r.id] || handlePlanMap[(r.ig_handle||"").toLowerCase()] || {};

  const search = $("or-search")?.value.toLowerCase() || "";
  const status = $("or-filter-status")?.value || "";
  let rows = data;
  if (search) rows = rows.filter(r => `${r.name} ${r.ig_handle}`.toLowerCase().includes(search));
  if (status) rows = rows.filter(r => r.outreach_status === status);

  const iS = "background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:3px 6px;font-size:11px";

  $("or-body").innerHTML = rows.length ? rows.map(r => {
    const plan = getPlan(r);
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
      <button class="btn-sec or-configure" data-id="${r.id}" style="margin-top:5px;font-size:10px;padding:2px 8px;width:100%">⚙ Usage &amp; Collab</button>
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
  </tr>`;}).join("") : `<tr><td colspan="18" class="empty-cell">No creators found.</td></tr>`;

  const saveField = async (id, field, value) => {
    await apiPatch(`/api/influencers/${id}`, {[field]: value || null});
  };

  // Helper: create or update paid_plan record — tries ID match first, then handle match
  const savePlanQty = async (infId, igHandle, field, value) => {
    const handle = (igHandle||"").toLowerCase();
    const plan   = planData.find(p => p.influencer_id === parseInt(infId))
                || (handle && planData.find(p => p.ig_handle === handle));
    const qty    = parseInt(value) || 0;
    if (plan?.id) {
      await apiPatch(`/api/paid_plan/${plan.id}`, {[field]: qty});
      plan[field] = qty;
      if (plan.ig_handle) handlePlanMap[plan.ig_handle] = plan;
    } else {
      const newPlan = await apiPost("/api/paid_plan", {influencer_id: parseInt(infId), [field]: qty});
      if (newPlan?.id) {
        const entry = {...newPlan, influencer_id: parseInt(infId), ig_handle: handle};
        planData.push(entry);
        planMap[parseInt(infId)] = entry;
        if (handle) handlePlanMap[handle] = entry;
      }
    }
    // Invalidate ppRows so Paid Plan reloads fresh data on next visit
    ppRows = [];
    // Sync Content Review rows to match new deliverable quantities (fire and forget)
    apiPost("/api/content_review/auto_sync", {}).catch(() => {});
  };

  document.querySelectorAll(".or-status-sel").forEach(s => s.addEventListener("change", () => saveField(s.dataset.id, "outreach_status", s.value)));
  document.querySelectorAll(".or-owner").forEach(i => i.addEventListener("blur", () => saveField(i.dataset.id, "outreach_owner", i.value.trim())));
  document.querySelectorAll(".or-email").forEach(i => i.addEventListener("blur", () => saveField(i.dataset.id, "email", i.value.trim())));
  document.querySelectorAll(".or-init-rate").forEach(i => i.addEventListener("blur", () => saveField(i.dataset.id, "initial_rate", i.value.trim())));
  document.querySelectorAll(".or-quot-rate").forEach(i => i.addEventListener("blur", () => saveField(i.dataset.id, "quoted_rate", i.value.trim())));
  document.querySelectorAll(".or-configure").forEach(btn => btn.addEventListener("click", () => {
    const row = rows.find(r => String(r.id) === btn.dataset.id);
    if (!row) return;
    const plan = getPlan(row);
    openPostDetailsModal(row, plan);
  }));
  document.querySelectorAll(".or-del").forEach(i => i.addEventListener("change", () => {
    const row = rows.find(r => String(r.id) === i.dataset.id);
    savePlanQty(i.dataset.id, row?.ig_handle, i.dataset.field, i.value);
  }));
  document.querySelectorAll(".or-date").forEach(i => i.addEventListener("change", () => saveField(i.dataset.id, "outreach_date", i.value)));
  document.querySelectorAll(".or-last").forEach(i => i.addEventListener("change", () => saveField(i.dataset.id, "last_contact", i.value)));
  document.querySelectorAll(".or-notes").forEach(i => i.addEventListener("blur", () => saveField(i.dataset.id, "outreach_notes", i.value.trim())));
}

["or-search","or-filter-status"].forEach(id => document.getElementById(id)?.addEventListener("input", loadOutreach));

// ── 3. Paid Plan ──────────────────────────────────────────────────────────────

// CPV Low/High ratios based on Suzanne's rates
const IG_CPV_LOW  = 0.12/0.14; // 6/7
const IG_CPV_HIGH = 0.16/0.14; // 8/7
const TT_CPV_LOW  = 0.10/0.12; // 5/6
const TT_CPV_HIGH = 0.14/0.12; // 7/6

function calcCpvCosts(r, variant = "standard") {
  const ig    = r.ig_impressions || r.ig_reels_impressions || 0;
  const ttImp = r.tt_impressions || 0;
  const igLow  = variant === "low",  igHigh  = variant === "high";
  const ttLow  = variant === "low",  ttHigh  = variant === "high";
  const igMult = igLow ? IG_CPV_LOW : igHigh ? IG_CPV_HIGH : 1;
  const ttMult = ttLow ? TT_CPV_LOW : ttHigh ? TT_CPV_HIGH : 1;
  const feed  = (r.ig_feed_qty||0)  * ig    * (r.ig_feed_cpv||0)  * igMult;
  const reel  = (r.ig_reel_qty||0)  * ig    * (r.ig_reel_cpv||0)  * igMult;
  const story = (r.ig_story_qty||0) * ig    * (r.ig_story_cpv||0) * igMult;
  const tt    = (r.tt_qty||0)       * ttImp * (r.tt_cpv||0)       * ttMult;
  const base  = feed + reel + story + tt;
  const org   = base * (r.organic_pct||0) / 100;
  const paid  = base * (r.paid_pct||0)    / 100;
  return base + org + paid;
}

function calcEstCost(r) { return calcCpvCosts(r, "standard"); }

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

  // Build month live map from CR rows for the pivot table
  try {
    const crRows = await apiGet("/api/content_review");
    ppCrMonthMap = {};
    crRows.forEach(r => {
      if (!r.live_date) return;
      const h = (r.influencer?.ig_handle || "").toLowerCase();
      if (!h) return;
      const [y, m] = r.live_date.split("-");
      const month = new Date(parseInt(y), parseInt(m)-1, 1).toLocaleString("en-US", {month:"long", year:"numeric"});
      if (!ppCrMonthMap[h] || r.live_date < ppCrMonthMap[h+"_raw"]) {
        ppCrMonthMap[h] = month;
        ppCrMonthMap[h+"_raw"] = r.live_date;
      }
    });
  } catch { /* ignore */ }

  ppTallyData = ppRows;
  renderPpTallyChips();
  renderPpTally();

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

    const orgPct   = r.organic_pct != null ? r.organic_pct : 10;
    const paidPct  = r.paid_pct    != null ? r.paid_pct    : 30;
    const totalStd  = calcCpvCosts(r, "standard");
    const totalLow  = calcCpvCosts(r, "low");
    const totalHigh = calcCpvCosts(r, "high");
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
      <td style="font-size:11px;color:var(--dim)">${esc(inf.campaign||"—")}</td>
      <td>${inf.ig_handle ? `<a href="${esc(inf.ig_url||`https://instagram.com/${inf.ig_handle}`)}" target="_blank" style="color:var(--red)">@${esc(inf.ig_handle)}</a>` : "—"}</td>
      <td style="color:var(--dim)">${(r.ig_reels_impressions||0).toLocaleString() || "—"}</td>
      <td>${inf.tt_handle ? `<a href="${esc(inf.tt_url||`https://tiktok.com/@${inf.tt_handle}`)}" target="_blank" style="color:var(--red)">@${esc(inf.tt_handle)}</a>` : "—"}</td>
      <td style="color:var(--dim)">${(r.tt_impressions||0).toLocaleString() || "—"}</td>
      <td style="text-align:center">${feedQty  || `<span style="color:var(--dim)">—</span>`}</td>
      <td style="text-align:center">${reelQty  || `<span style="color:var(--dim)">—</span>`}</td>
      <td style="text-align:center">${storyQty || `<span style="color:var(--dim)">—</span>`}</td>
      <td style="text-align:center">${ttQty    || `<span style="color:var(--dim)">—</span>`}</td>
      <td style="color:var(--yellow)">${r.ig_feed_cpv  ? `$${r.ig_feed_cpv}`  : "—"}</td>
      <td style="color:var(--yellow)">${r.ig_reel_cpv  ? `$${r.ig_reel_cpv}`  : "—"}</td>
      <td style="color:var(--yellow)">${r.ig_story_cpv ? `$${r.ig_story_cpv}` : "—"}</td>
      <td style="color:var(--yellow)">${r.tt_cpv       ? `$${r.tt_cpv}`       : "—"}</td>
      <td>${fP(orgPct)}</td>
      <td>${fP(paidPct)}</td>
      <td style="color:var(--dim)">${fC(totalLow)}</td>
      <td style="color:var(--red);font-weight:700">${fC(totalStd)}</td>
      <td style="color:var(--green)">${fC(totalHigh)}</td>
      <td>${fmtD(r.first_offer)}</td>
      <td>${fmtD(r.influencer_offer)}</td>
      <td>${fmtD(r.a8_counter)}</td>
      <td style="font-weight:600">${fmtD(r.accepted_offer)}</td>
      <td style="white-space:nowrap">
        <button class="btn-icon btn-edit-pp" data-idx="${i}" title="Edit">✏</button>
        ${r.id ? `<button class="btn-icon btn-del-pp" data-id="${r.id}" title="Clear plan data" style="color:#666">✕</button>` : ""}
      </td>
    </tr>`;
  }).join("") : `<tr><td colspan="25" class="empty-cell">No creators in Paid Plan yet. Check the "Paid Plan" box on a creator in the Master Lists tab.</td></tr>`;

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
      // If set to Locked → create Content Review entries
      if (newStatus === "Locked") {
        try { await autoCreateContentReviewEntries(row.influencer_id, {...row, post_details: row.post_details || {}}); }
        catch(err) { console.error("Could not auto-create Content Review:", err); }
      }
      // If changed AWAY from Locked → delete Content Review entries + their calendar entries
      if (row.status === "Locked" && newStatus !== "Locked") {
        try {
          const existing = await apiGet("/api/content_review");
          const rowHandle = (row.influencer?.ig_handle || "").toLowerCase();
          const toDelete = existing.filter(r =>
            r.influencer_id === row.influencer_id ||
            (rowHandle && (r.influencer?.ig_handle || "").toLowerCase() === rowHandle)
          );
          for (const entry of toDelete) {
            const calEntries = calRows.filter(c => c.content_review_id === entry.id);
            for (const cal of calEntries) {
              await fetch(`/api/content_calendar/${cal.id}?password=${encodeURIComponent(PW)}`, {method:"DELETE"});
            }
            await fetch(`/api/content_review/${entry.id}?password=${encodeURIComponent(PW)}`, {method:"DELETE"});
          }
          calRows = [];
        } catch(err) { console.error("Cascade delete error:", err); }
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
      <div class="fld"><label>IG Reel CPV ($)</label><input type="number" step="0.01" id="ppf-reel-cpv" value="${d(e.ig_reel_cpv, 0.14)}"></div>
      <div class="fld"><label>IG Story CPV ($)</label><input type="number" step="0.01" id="ppf-story-cpv" value="${d(e.ig_story_cpv, 0.14)}"></div>
      <div class="fld"><label>IG In-Feed CPV ($)</label><input type="number" step="0.01" id="ppf-feed-cpv" value="${d(e.ig_feed_cpv, 0.14)}"></div>
      <div class="fld"><label>TT CPV ($)</label><input type="number" step="0.01" id="ppf-tt-cpv" value="${d(e.tt_cpv, 0.12)}"></div>
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
      ig_reel_cpv:          n("ppf-reel-cpv"),
      ig_story_cpv:         n("ppf-story-cpv"),
      ig_feed_cpv:          n("ppf-feed-cpv"),
      tt_cpv:               n("ppf-tt-cpv"),
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

    // Status Locked → create Content Review entries
    // Pass influencer data so handle-based dedup works correctly
    if (payload.status === "Locked") {
      try { await autoCreateContentReviewEntries(e.influencer_id, {...payload, ig_handle: e.influencer?.ig_handle || "", influencer: e.influencer, post_details: e.post_details || {}}); }
      catch(err) { console.error("Could not auto-create Content Review:", err); }
    }
    // Changed AWAY from Locked → cascade delete Content Review + Calendar entries
    if (e.status === "Locked" && payload.status !== "Locked") {
      try {
        const existing = await apiGet("/api/content_review");
        const eHandle = (e.influencer?.ig_handle || "").toLowerCase();
        const toDelete = existing.filter(r =>
          r.influencer_id === e.influencer_id ||
          (eHandle && (r.influencer?.ig_handle || "").toLowerCase() === eHandle)
        );
        for (const entry of toDelete) {
          const calEntries = calRows.filter(c => c.content_review_id === entry.id);
          for (const cal of calEntries) {
            await fetch(`/api/content_calendar/${cal.id}?password=${encodeURIComponent(PW)}`, {method:"DELETE"});
          }
          await fetch(`/api/content_review/${entry.id}?password=${encodeURIComponent(PW)}`, {method:"DELETE"});
        }
        calRows = [];
      } catch(err) { console.error("Cascade delete error:", err); }
    }

    closeModal(); loadPaidPlan();
    apiPost("/api/content_review/auto_sync", {}).catch(() => {});
  });

  // Live cost calculator — wires up after modal renders
  setTimeout(() => {
    const fD = v => v > 0 ? "$" + Math.round(v).toLocaleString() : "—";
    const updateCalc = () => {
      const nv = id => parseFloat($(id)?.value) || 0;
      const igImp   = nv("ppf-ig-imp");
      const igFeed  = nv("ppf-feed-qty")  * igImp * nv("ppf-feed-cpv");
      const igReel  = nv("ppf-reel-qty")  * igImp * nv("ppf-reel-cpv");
      const igStory = nv("ppf-story-qty") * igImp * nv("ppf-story-cpv");
      const tt      = nv("ppf-tt-qty")    * nv("ppf-tt-imp") * nv("ppf-tt-cpv");
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
     "ppf-reel-cpv","ppf-story-cpv","ppf-feed-cpv","ppf-tt-cpv",
     "ppf-org-pct","ppf-paid-pct"].forEach(id => $(id)?.addEventListener("input", updateCalc));
    updateCalc(); // run immediately with existing values
  }, 0);
}

// ── 4. Content Calendar ───────────────────────────────────────────────────────
let calY = new Date().getFullYear();
let calM = new Date().getMonth();
let calRows = [];      // manual calendar entries only
let crCalRows = [];    // content review rows (source of truth for calendar)
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

function crDelLabel(type) {
  if (type === "IG Reel")  return "1x Reel";
  if (type === "IG Story") return "1x Story";
  if (type === "IG Feed")  return "1x Feed";
  if (type === "TikTok")   return "1x TT";
  return type || "—";
}

async function loadCalendar() {
  // Load manual entries (no content_review_id) + CR rows directly — no sync needed
  const [allCal, cr] = await Promise.all([
    apiGet("/api/content_calendar"),
    apiGet("/api/content_review"),
  ]);
  calRows   = (allCal || []).filter(r => !r.content_review_id);
  crCalRows = cr || [];
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
  const push = (ds, evt) => { (byDay[ds] = byDay[ds]||[]).push(evt); };

  // Manual calendar entries (no CR link)
  calRows.forEach(r => {
    if (!r.scheduled_date) return;
    const [y,m] = r.scheduled_date.split("-");
    if (parseInt(y)===calY && parseInt(m)-1===calM) {
      push(r.scheduled_date, {
        influencer_id: r.influencer_id, influencer: r.influencer||{},
        label: fmtDeliverable(r.deliverable),
        isDue: (r.notes||"").includes("type:due"),
        collab: r.collab||false, approved: r.approved||false, manual: true, id: r.id,
      });
    }
  });

  // CR rows → calendar events directly (always accurate, no sync needed)
  crCalRows.forEach(r => {
    const inf  = r.influencer || {};
    const lbl  = crDelLabel(r.deliverable_type);
    const isCollab  = r.is_collab || false;
    const isApproved = r.approved_by_client || false;
    if (r.content_due_date) {
      const [y,m] = r.content_due_date.split("-");
      if (parseInt(y)===calY && parseInt(m)-1===calM)
        push(r.content_due_date, {influencer_id: r.influencer_id, influencer: inf,
          label: lbl, isDue: true, collab: false, approved: false});
    }
    if (r.live_date) {
      const [y,m] = r.live_date.split("-");
      if (parseInt(y)===calY && parseInt(m)-1===calM)
        push(r.live_date, {influencer_id: r.influencer_id, influencer: inf,
          label: lbl, isDue: false, collab: isCollab, approved: isApproved});
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
        ${(() => {
          // Group entries by creator for this day
          const groups = {};
          es.forEach(e => {
            const key = e.influencer_id || e.id;
            if (!groups[key]) groups[key] = {inf: e.influencer||{}, entries: []};
            groups[key].entries.push(e);
          });
          return Object.values(groups).map(g => {
            const chips = g.entries.map(e => {
              // Purple = collab + approved; Red = not approved (incl. unapproved collab); Green = approved non-collab
              const collabApproved = !e.isDue && e.collab && e.approved;
              const cls  = e.isDue           ? "cal-entry cal-entry-due"
                         : collabApproved    ? "cal-entry cal-entry-live-approved"
                         : e.approved        ? "cal-entry cal-entry-live-approved"
                         : "cal-entry cal-entry-live-pending";
              const style  = collabApproved ? ' style="background:#6b3fa0;color:#fff"' : '';
              const prefix = collabApproved ? "C· " : "";
              return `<div class="${cls}"${style}>${prefix}${esc(e.label || fmtDeliverable(e.deliverable))}</div>`;
            }).join("");
            const name = g.inf.name || g.inf.ig_handle || "";
            return `<div style="margin-bottom:3px">${chips}<div style="font-size:8px;color:var(--dim);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(name)}</div></div>`;
          }).join("");
        })()}
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
          $("cal-detail-body").innerHTML = entries.map(e => {
            const inf    = e.influencer || {};
            const isDue  = (e.notes||"").includes("type:due");
            const typeLabel = isDue
              ? `<span style="color:#5b6ee8;font-weight:600;font-size:11px">📋 Draft Due</span>`
              : e.approved
                ? `<span style="color:var(--green);font-weight:600;font-size:11px">✓ Going Live</span>`
                : `<span style="color:var(--red);font-weight:600;font-size:11px">• Pending Approval</span>`;
            const igLink = inf.ig_handle ? `<a href="https://instagram.com/${esc(inf.ig_handle)}" target="_blank" style="color:var(--red)">@${esc(inf.ig_handle)}</a>` : "";
            const ttLink = inf.tt_handle ? `<a href="https://tiktok.com/@${esc(inf.tt_handle)}" target="_blank" style="color:var(--red)">@${esc(inf.tt_handle)}</a>` : "";
            return `<div class="cal-detail-entry">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                <div style="display:flex;align-items:center;gap:10px">
                  <div class="cal-detail-creator">${esc(inf.name||"Unknown")}</div>
                  ${typeLabel}
                </div>
                <button onclick="deleteCalEntry(${e.id})" style="background:none;border:none;color:var(--dim);cursor:pointer;font-size:12px;padding:2px 6px" title="Delete">✕</button>
              </div>
              <div class="cal-detail-meta">
                ${igLink ? `<span>IG: ${igLink}</span>` : ""}
                ${ttLink ? `<span>TT: ${ttLink}</span>` : ""}
                <span><strong>${fmtDeliverable(e.deliverable)}</strong></span>
                ${e.usage ? `<span>Usage: <strong>${esc(e.usage)}</strong></span>` : ""}
              </div>
            </div>`;
          }).join("");
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
  await fetch(`/api/content_calendar/${id}?password=${encodeURIComponent(PW)}`, {method:"DELETE"});
  calRows = calRows.filter(r => r.id !== id);
  renderCalendar();
  $("cal-detail").classList.add("hidden");
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

// Sync a content_review record's dates to the Content Calendar
async function syncCalendarEntry(crId, infId, delType, liveDate, dueDate, approved, isCollab = false) {
  if (!calRows.length) {
    try { calRows = await apiGet("/api/content_calendar"); } catch {}
  }
  const delQty = {
    ig_feed:  (delType||"").includes("Feed") ? 1 : 0,
    ig_reel:  (delType||"").includes("Reel")    ? 1 : 0,
    ig_story: (delType||"").includes("Story")   ? 1 : 0,
    tiktok:   (delType||"").includes("TikTok")  ? 1 : 0,
  };
  const noteKey = id => `cr:${id}`;

  // Sync live date entry
  const liveEntry = calRows.find(c => c.content_review_id === crId && (c.notes||"").includes("type:live"));
  if (liveDate) {
    if (liveEntry) {
      await apiPatch(`/api/content_calendar/${liveEntry.id}`, {scheduled_date: liveDate, approved, collab: isCollab});
    } else {
      await apiPost("/api/content_calendar", {
        influencer_id:    infId,
        scheduled_date:   liveDate,
        deliverable:      JSON.stringify(delQty),
        notes:            `${noteKey(crId)}|type:live`,
        content_review_id: crId,
        approved,
        collab: isCollab,
      });
    }
  }

  // Sync content due date entry (blue)
  const dueEntry = calRows.find(c => c.content_review_id === crId && (c.notes||"").includes("type:due"));
  if (dueDate) {
    if (dueEntry) {
      await apiPatch(`/api/content_calendar/${dueEntry.id}`, {scheduled_date: dueDate});
    } else {
      await apiPost("/api/content_calendar", {
        influencer_id:    infId,
        scheduled_date:   dueDate,
        deliverable:      JSON.stringify(delQty),
        notes:            `${noteKey(crId)}|type:due`,
        content_review_id: crId,
        approved: false,
        collab: false,
      });
    }
  }

  // Refresh calendar rows so next sync is accurate
  try { calRows = await apiGet("/api/content_calendar"); } catch {}
  if (currentTab === "content-cal") renderCalendar();
}

const crExpandedGroups = new Set(); // persists across tab switches

window.toggleCRGroup = (groupKey, parentTr) => {
  const subs = document.querySelectorAll(`.cr-sub-row[data-group="${groupKey}"]`);
  const isHidden = subs.length && subs[0].style.display === 'none';
  subs.forEach(r => r.style.display = isHidden ? '' : 'none');
  const arrow = parentTr?.querySelector('.cr-arrow');
  if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
  if (isHidden) crExpandedGroups.add(groupKey);
  else crExpandedGroups.delete(groupKey);
};

// ── Per-post usage & collab modal (opened from Outreach) ─────────────────────
const USAGE_OPTS = [
  "Organic (30 days)", "Baked in Paid (30 days)",
  "Pre-Negotiated Paid (30 days)", "Other"
];
const DEL_KEYS = [
  { key: "ig_feed",  label: "IG Feed",  planField: "ig_feed_qty",  crType: "IG Feed"  },
  { key: "ig_reel",  label: "IG Reel",  planField: "ig_reel_qty",  crType: "IG Reel"  },
  { key: "ig_story", label: "IG Story", planField: "ig_story_qty", crType: "IG Story" },
  { key: "tt",       label: "TikTok",   planField: "tt_qty",       crType: "TikTok"   },
];

function openPostDetailsModal(row, plan) {
  const active = DEL_KEYS.filter(d => (plan[d.planField] || 0) > 0);
  if (!active.length) {
    alert("Set deliverable quantities first, then configure usage and collab.");
    return;
  }
  const pd = plan.post_details || {};
  const bodyHtml = active.map(d => {
    const qty   = plan[d.planField] || 0;
    const posts = Array.from({length: qty}, (_, i) => (pd[d.key] || [])[i] || {usage: [], is_collab: false});
    return `<div class="form-section">${d.label} (${qty})</div>` +
      posts.map((p, i) => `
        <div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px">
          <div style="font-size:11px;font-weight:600;margin-bottom:8px;color:var(--dim)">Post ${i + 1}</div>
          <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px">
            ${USAGE_OPTS.map(u => `
              <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer">
                <input type="checkbox" class="pd-usage" data-key="${d.key}" data-idx="${i}" value="${u}" ${(p.usage||[]).includes(u) ? "checked" : ""}>
                ${u}
              </label>`).join("")}
          </div>
          <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;font-weight:600;color:var(--purple,#6b3fa0)">
            <input type="checkbox" class="pd-collab" data-key="${d.key}" data-idx="${i}" ${p.is_collab ? "checked" : ""}>
            Collab Post
          </label>
        </div>`).join("");
  }).join("");

  openModal(`Usage & Collab — ${esc(row.name || "")}`, bodyHtml, async () => {
    const newPd = {};
    active.forEach(d => {
      const qty = plan[d.planField] || 0;
      newPd[d.key] = Array.from({length: qty}, (_, i) => ({
        usage:    [...document.querySelectorAll(`.pd-usage[data-key="${d.key}"][data-idx="${i}"]:checked`)].map(cb => cb.value),
        is_collab: document.querySelector(`.pd-collab[data-key="${d.key}"][data-idx="${i}"]`)?.checked || false,
      }));
    });
    if (plan.id) {
      await apiPatch(`/api/paid_plan/${plan.id}`, {post_details: newPd});
    } else {
      const newPlan = await apiPost("/api/paid_plan", {influencer_id: row.id, post_details: newPd});
      if (newPlan?.id) plan.id = newPlan.id;
    }
    plan.post_details = newPd;
    closeModal();
  });
}

// Helper: auto-create N Content Review entries per deliverable type when Locked
async function autoCreateContentReviewEntries(influencerId, plan) {
  const existing = await apiGet("/api/content_review");

  // Match by influencerId OR by same ig_handle (handles INT/EXT ID mismatch)
  const igHandle = (plan.ig_handle || plan.influencer?.ig_handle || "").toLowerCase();
  const existingForInf = existing.filter(r =>
    r.influencer_id === influencerId ||
    (igHandle && (r.influencer?.ig_handle || "").toLowerCase() === igHandle)
  );

  const pd = plan.post_details || {};
  for (const d of DEL_KEYS) {
    const qty = plan[d.planField] || 0;
    const existingForType = existingForInf.filter(r => r.deliverable_type === d.crType);
    const existingCount   = existingForType.length;
    const posts = pd[d.key] || [];
    const toAdd = Math.max(0, qty - existingCount);
    for (let i = 0; i < toAdd; i++) {
      const postIdx   = existingCount + i;
      const postData  = posts[postIdx] || {};
      const usage     = (postData.usage || []).join(", ") || null;
      const is_collab = postData.is_collab || false;
      await apiPost("/api/content_review", {
        influencer_id:    influencerId,
        deliverable_type: d.crType,
        usage,
        is_collab,
      });
    }
  }
}

async function loadContentReview() {
  // Auto-sync row counts to match paid plan quantities on every load
  // Only removes rows that are completely blank — never deletes data you've entered
  try { await apiPost("/api/content_review/auto_sync", {}); } catch { /* ignore */ }
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
  const NCOLS = 27;

  $("cr-body").innerHTML = Object.values(groups).length ? Object.values(groups).map(group => {
    const inf = group.inf;

    // Parent row — flat string concat to avoid nested template literal parsing issues
    const groupKey   = "crg-" + group.infId;
    const isExpanded = crExpandedGroups.has(groupKey);
    const igLink = inf.ig_handle ? ('<a href="https://instagram.com/' + esc(inf.ig_handle) + '" target="_blank" style="color:var(--red);font-size:12px">@' + esc(inf.ig_handle) + '</a>') : "—";
    const ttLink = inf.tt_handle ? ('<a href="https://tiktok.com/@' + esc(inf.tt_handle) + '" target="_blank" style="color:var(--red);font-size:12px">@' + esc(inf.tt_handle) + '</a>') : "—";
    const tierBadge = inf.tier ? ('<span class="badge badge-int">' + esc(inf.tier) + '</span>') : "—";
    const parentRow = '<tr class="cr-parent-row" data-group="' + groupKey + '" style="background:var(--panel2);border-top:2px solid var(--border);cursor:pointer" onclick="toggleCRGroup(\'' + groupKey + '\',this)">'
      + '<td style="padding-left:12px;font-size:12px;white-space:nowrap"><span class="cr-arrow" style="margin-right:6px">' + (isExpanded ? '▼' : '▶') + '</span><button class="btn-sec btn-add-cr-del" data-inf-id="' + group.infId + '" style="padding:2px 8px;font-size:10px" onclick="event.stopPropagation()">+ Add</button></td>'
      + '<td style="white-space:nowrap"><strong>' + esc(inf.name||"") + '</strong></td>'
      + '<td>' + igLink + '</td>'
      + '<td>' + ttLink + '</td>'
      + '<td style="color:var(--dim);font-size:11px">' + fmt(inf.ig_followers) + '</td>'
      + '<td style="color:var(--dim);font-size:11px">' + fmt(inf.tt_followers) + '</td>'
      + '<td>' + tierBadge + '</td>'
      + '<td style="font-size:11px;color:var(--dim)">' + esc(inf.vertical||inf.archetype||"") + '</td>'
      + '<td style="font-size:11px">' + esc(inf.campaign||"") + '</td>'
      + '<td colspan="' + (NCOLS - 9) + '"></td>'
      + '</tr>';

    // Sub-rows — restore expanded state if group was previously open
    const subRows = group.records.map(r => `<tr class="cr-sub-row" data-group="${groupKey}" style="${isExpanded ? "" : "display:none"}">
      <td>
        <select class="cr-status" data-id="${r.id}" style="${iS};min-width:130px;font-size:10px">
          <option value="">—</option>
          ${CR_STATUSES.map(s=>`<option ${r.status===s?"selected":""}>${esc(s)}</option>`).join("")}
        </select>
      </td>
      <td></td><td></td><td></td><td></td><td></td><td></td><td></td>
      <td>
        <select class="cr-campaign" data-id="${r.id}" style="${iS};min-width:120px">
          <option value="">—</option>
          ${CR_CAMPAIGNS.map(c=>`<option ${r.campaign===c?"selected":""}>${esc(c)}</option>`).join("")}
        </select>
      </td>
      <td style="color:var(--dim);font-size:13px;padding-left:8px;white-space:nowrap">↳</td>
      <td style="white-space:nowrap;font-weight:600;font-size:12px">${esc(r.deliverable_type||"—")}</td>
      <td style="text-align:center">
        ${r.is_collab ? `<span class="badge badge-int" style="background:#ede8f5;color:#6b3fa0;border:1px solid #c5b0e0">Collab</span>` : `<span style="color:var(--dim);font-size:11px">—</span>`}
      </td>
      <td style="font-size:11px;color:var(--dim);min-width:160px;white-space:nowrap">
        ${r.usage ? r.usage.split(", ").map(u => `<div style="padding:1px 0">${esc(u)}</div>`).join("") : "—"}
      </td>
      <td><input type="date" class="cr-due" data-id="${r.id}" value="${r.content_due_date||""}" style="${iS};min-width:110px"></td>
      <td><input type="date" class="cr-live" data-id="${r.id}" value="${r.live_date||""}" style="${iS};min-width:110px"></td>
      <td><textarea class="cr-concept auto-expand" data-id="${r.id}" placeholder="Concept" style="${iS};min-width:110px">${esc(r.concept||"")}</textarea></td>
      <td><textarea class="cr-concept-fbk auto-expand" data-id="${r.id}" placeholder="Concept feedback" style="${iS};min-width:110px">${esc(r.concept_feedback||"")}</textarea></td>
      <td>
        <div style="display:flex;align-items:center;gap:4px">
          <input class="cr-cv1" data-id="${r.id}" value="${esc(r.content_v1||"")}" placeholder="Link…" style="${iS};min-width:80px">
          ${r.content_v1 ? `<a href="${esc(r.content_v1)}" target="_blank" style="color:var(--red);font-size:12px;flex-shrink:0">↗</a>` : ""}
        </div>
      </td>
      <td><textarea class="cr-cap1 auto-expand" data-id="${r.id}" placeholder="Caption" style="${iS};min-width:90px">${esc(r.caption_v1||"")}</textarea></td>
      <td><textarea class="cr-af1 auto-expand" data-id="${r.id}" placeholder="A8 notes" style="${iS};min-width:90px">${esc(r.a8_feedback_v1||"")}</textarea></td>
      <td style="background:rgba(202,1,0,.04)"><textarea class="cr-cf1 auto-expand" data-id="${r.id}" placeholder="Client feedback" style="${iS};min-width:110px">${esc(r.client_feedback_v1||"")}</textarea></td>
      <td>
        <div style="display:flex;align-items:center;gap:4px">
          <input class="cr-cv2" data-id="${r.id}" value="${esc(r.content_v2||"")}" placeholder="Link…" style="${iS};min-width:80px">
          ${r.content_v2 ? `<a href="${esc(r.content_v2)}" target="_blank" style="color:var(--red);font-size:12px;flex-shrink:0">↗</a>` : ""}
        </div>
      </td>
      <td><textarea class="cr-cap2 auto-expand" data-id="${r.id}" placeholder="Caption" style="${iS};min-width:90px">${esc(r.caption_v2||"")}</textarea></td>
      <td><textarea class="cr-af2 auto-expand" data-id="${r.id}" placeholder="A8 notes" style="${iS};min-width:90px">${esc(r.a8_feedback_v2||"")}</textarea></td>
      <td style="background:rgba(202,1,0,.04)"><textarea class="cr-cf2 auto-expand" data-id="${r.id}" placeholder="Client feedback" style="${iS};min-width:110px">${esc(r.client_feedback_v2||"")}</textarea></td>
      <td style="text-align:center">
        <input type="checkbox" class="cr-approved-chk" data-id="${r.id}" data-inf-id="${r.influencer_id}" data-live="${r.live_date||""}" data-due="${r.content_due_date||""}" data-del="${esc(r.deliverable_type||"")}" ${r.approved_by_client?"checked":""} style="accent-color:var(--green);width:16px;height:16px;cursor:pointer">
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
  wire("cr-status",      "status",            "change");
  wire("cr-campaign",    "campaign",          "change");
  // Due + live date wires — also sync to calendar
  document.querySelectorAll(".cr-due").forEach(el =>
    el.addEventListener("change", async () => {
      await apiPatch(`/api/content_review/${el.dataset.id}`, {content_due_date: el.value || null});
      const r = rows.find(x => String(x.id) === el.dataset.id);
      if (r) syncCalendarEntry(r.id, r.influencer_id, r.deliverable_type, r.live_date, el.value, r.approved_by_client, r.is_collab);
    })
  );
  document.querySelectorAll(".cr-live").forEach(el =>
    el.addEventListener("change", async () => {
      await apiPatch(`/api/content_review/${el.dataset.id}`, {live_date: el.value || null});
      const r = rows.find(x => String(x.id) === el.dataset.id);
      if (r) syncCalendarEntry(r.id, r.influencer_id, r.deliverable_type, el.value, r.content_due_date, r.approved_by_client, r.is_collab);
    })
  );
  wire("cr-concept",     "concept",          "blur");
  wire("cr-concept-fbk", "concept_feedback", "blur");
  wire("cr-cv1",         "content_v1");
  wire("cr-cap1",        "caption_v1",       "blur");
  wire("cr-af1",         "a8_feedback_v1",   "blur");
  wire("cr-cf1",         "client_feedback_v1","blur");
  wire("cr-cv2",         "content_v2");
  wire("cr-cap2",        "caption_v2",       "blur");
  wire("cr-af2",         "a8_feedback_v2",   "blur");
  wire("cr-cf2",         "client_feedback_v2","blur");

  // Approved checkbox → patch + sync calendar entry to approved/pending
  document.querySelectorAll(".cr-approved-chk").forEach(cb =>
    cb.addEventListener("change", async () => {
      const r = rows.find(x => String(x.id) === cb.dataset.id);
      await apiPatch(`/api/content_review/${cb.dataset.id}`, {approved_by_client: cb.checked});
      if (cb.checked) {
        // Approved → sync calendar entries
        if (r) syncCalendarEntry(r.id, r.influencer_id, r.deliverable_type, cb.dataset.live, cb.dataset.due, true, r.is_collab);
      } else {
        // Unapproved → delete linked calendar entries
        const crId = parseInt(cb.dataset.id);
        if (!calRows.length) { try { calRows = await apiGet("/api/content_calendar"); } catch {} }
        const toDelete = calRows.filter(c => c.content_review_id === crId);
        for (const cal of toDelete) {
          await fetch(`/api/content_calendar/${cal.id}?password=${encodeURIComponent(PW)}`, {method:"DELETE"});
        }
        calRows = calRows.filter(c => c.content_review_id !== crId);
        if (currentTab === "content-cal") renderCalendar();
      }
    })
  );

  // Auto-expand textareas
  document.querySelectorAll("textarea.auto-expand").forEach(el => {
    const resize = () => { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; };
    el.addEventListener("input", resize);
    resize(); // size on load
  });

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

$("btn-cr-cleanup")?.addEventListener("click", async () => {
  if (!confirm("This will delete extra duplicate rows so each creator only has the number of deliverables their Paid Plan specifies. Continue?")) return;
  const btn = $("btn-cr-cleanup");
  btn.disabled = true; btn.textContent = "Cleaning…";
  try {
    const res = await apiPost("/api/content_review/cleanup_duplicates", {});
    alert(`Done! ${res.deleted} duplicate row${res.deleted !== 1 ? "s" : ""} removed.`);
    loadContentReview();
  } catch(err) {
    alert("Error: " + err.message);
  } finally {
    btn.disabled = false; btn.textContent = "Clean Up Duplicates";
  }
});

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
          <option ${e.deliverable_type==="IG Reel"?"selected":""}>IG Reel</option>
          <option ${e.deliverable_type==="IG Story"?"selected":""}>IG Story</option>
          <option ${e.deliverable_type==="IG Feed"?"selected":""}>IG Feed</option>
          <option ${e.deliverable_type==="TikTok"?"selected":""}>TikTok</option>
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
window.updateBoostField = async (id, val) => {
  await apiPatch(`/api/live_posts/${id}`, {content_boosted: val});
};

async function loadLivePosts() {
  const data = await apiGet("/api/live_posts");
  $("lp-body").innerHTML = data.length ? data.map(r=>{
    const followers = r.influencer?.ig_followers || r.influencer?.tt_followers || 0;
    const views     = r.total_views || 0;
    const eng       = r.total_engagement || 0;
    const impRate   = (followers && views) ? ((views / followers) * 100).toFixed(1) + "%" : "—";
    const engRate   = (views && eng)       ? ((eng / views) * 100).toFixed(1) + "%" : "—";
    return `<tr>
    <td>${fmtDate(r.live_date)}</td>
    <td><strong>${esc(r.influencer?.name||"")}</strong></td>
    <td>${esc(r.campaign||"")}</td>
    <td style="font-size:11px">${esc(r.deliverable_type||"")}</td>
    <td style="font-size:11px">${esc(r.usage||"")}</td>
    <td>${fmtD(r.final_rate)}</td>
    <td>${r.live_link?'<a href="'+esc(r.live_link)+'" target="_blank">View ↗</a>':"—"}</td>
    <td>${fmt(r.total_views)}</td>
    <td style="color:var(--dim)">${impRate}</td>
    <td>${fmt(r.total_engagement)}</td>
    <td style="color:var(--dim)">${engRate}</td>
    <td>${r.cpv != null ? "$"+r.cpv : "—"}</td>
    <td>${r.cpe != null ? "$"+r.cpe : "—"}</td>
    <td>${esc(r.ig_spark_code||"")}</td>
    <td><input type="checkbox" ${r.content_boosted?"checked":""} onchange="updateBoostField(${r.id},this.checked)" style="accent-color:var(--red);width:15px;height:15px;cursor:pointer"></td>
    <td>
      <button class="btn-icon btn-edit-lp" data-id="${r.id}">✏</button>
      <button class="btn-icon btn-del-lp" data-id="${r.id}">✕</button>
    </td>
  </tr>`;}).join("") : `<tr><td colspan="16" class="empty-cell">No live posts yet.</td></tr>`;

  document.querySelectorAll(".btn-edit-lp").forEach(b=>
    b.addEventListener("click",()=>{ const row=data.find(r=>String(r.id)===b.dataset.id); if(row) openLivePostModal(row); })
  );
  document.querySelectorAll(".btn-del-lp").forEach(b=>
    b.addEventListener("click",async()=>{ if(!confirm("Delete?")) return; await apiDelete(`/api/live_posts/${b.dataset.id}?password=${encodeURIComponent(PW)}`); loadLivePosts(); })
  );
}

$("btn-add-lp").addEventListener("click", ()=>openLivePostModal(null));

$("btn-archive-sync")?.addEventListener("click", async () => {
  const btn = $("btn-archive-sync");
  btn.disabled = true; btn.textContent = "Syncing…";
  try {
    const result = await apiPost("/api/archive_sync", {});
    btn.textContent = `↻ Sync from Archive`;
    btn.disabled = false;
    const campInfo = result.total_campaigns_found > 0
      ? `\n• ${result.total_campaigns_found} Archive campaigns: ${(result.campaign_names||[]).join(", ")}`
      : `\n• 0 Archive campaigns found (check workspace/token)`;
    const matchInfo = result.handles_found_in_archive?.length
      ? `\n• Handles in Archive: ${result.handles_found_in_archive.join(", ")}\n• Matched to creators: ${(result.handles_matched_to_creators||[]).join(", ") || "none"}`
      : "";
    alert(`Archive sync complete:\n• ${result.synced} posts updated\n• ${result.created} new posts added\n• ${result.total_archive_posts} total posts found in Archive${campInfo}${matchInfo}`);
    loadLivePosts();
  } catch(err) {
    btn.textContent = "↻ Sync from Archive";
    btn.disabled = false;
    alert("Sync failed: " + err.message);
  }
});

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
      <div class="fld"><label>Deliverable</label>
        <select id="lpf-del">
          <option value="">—</option>
          <option ${e.deliverable_type==="IG Reel"?"selected":""}>IG Reel</option>
          <option ${e.deliverable_type==="IG Story"?"selected":""}>IG Story</option>
          <option ${e.deliverable_type==="IG Feed"?"selected":""}>IG Feed</option>
          <option ${e.deliverable_type==="TikTok"?"selected":""}>TikTok</option>
        </select>
      </div>
      <div class="fld"><label>Usage</label>
        <select id="lpf-usage">
          <option value="">—</option>
          <option ${e.usage==="Organic (30 days)"?"selected":""}>Organic (30 days)</option>
          <option ${e.usage==="Baked in Paid (30 days)"?"selected":""}>Baked in Paid (30 days)</option>
          <option ${e.usage==="Pre-Negotiated Paid (30 days)"?"selected":""}>Pre-Negotiated Paid (30 days)</option>
          <option ${e.usage==="Other"?"selected":""}>Other</option>
        </select>
      </div>
      <div class="fld"><label>Final Rate ($)</label><input type="number" id="lpf-rate" value="${e.final_rate||""}"></div>
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
    const lpPayload = {
      influencer_id: parseInt($("lpf-inf").value),
      live_date: $("lpf-date").value||null,
      campaign: $("lpf-campaign").value.trim(),
      deliverable_type: $("lpf-del").value,
      usage: $("lpf-usage").value,
      final_rate: n("lpf-rate"), cogs: n("lpf-cogs"),
      live_link: $("lpf-link").value.trim(), utm_link: $("lpf-utm").value.trim(),
      discount_code: $("lpf-code").value.trim(), ig_spark_code: $("lpf-ig-spark").value.trim(),
      tt_spark_code: $("lpf-tt-spark").value.trim(), paid_spend: n("lpf-paid-spend"),
      total_views: n("lpf-views"), likes: n("lpf-likes"), comments: n("lpf-comments"),
      shares: n("lpf-shares"), saves: n("lpf-saves"),
    };
    await (isEdit ? apiPatch(`/api/live_posts/${existing.id}`, lpPayload) : apiPost("/api/live_posts", lpPayload));
    closeModal(); loadLivePosts();
  });
}

// ── 7. Payment Status ─────────────────────────────────────────────────────────
async function loadPayments() {
  const data = await apiGet("/api/payment_status");
  const filter = $("pay-filter")?.value;
  let rows = data;
  if (filter === "paid")    rows = rows.filter(r=>r.added_to_quickbooks);
  if (filter === "pending") rows = rows.filter(r=>!r.added_to_quickbooks);

  const chk = (id, field, val) => `<input type="checkbox" ${val?"checked":""} onchange="updatePayField(${id},'${field}',this.checked)" style="accent-color:var(--red);width:15px;height:15px;cursor:pointer">`;
  $("pay-body").innerHTML = rows.length ? rows.map(r=>`<tr>
    <td><strong>${esc(r.influencer?.name||"")}</strong></td>
    <td>${esc(r.influencer?.email||"")}</td>
    <td>${fmtD(r.agreed_rate)}</td>
    <td style="font-size:11px">${esc(r.deliverables||"")}</td>
    <td>${fmtDate(r.live_date)}</td>
    <td>${chk(r.id,"content_live",r.content_live)}</td>
    <td>${fmtDate(r.payment_due_date)}</td>
    <td>${chk(r.id,"w9",r.w9)}</td>
    <td>${chk(r.id,"proper_invoice",r.proper_invoice)}</td>
    <td>${chk(r.id,"added_to_quickbooks",r.added_to_quickbooks)}</td>
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
var modalSubmitFn = null;

// Self-contained closeModal — no circular hoisting issue
function closeModal() {
  var ov = document.getElementById("modal-overlay");
  if (ov) { ov.style.display = "none"; ov.classList.add("hidden"); }
  modalSubmitFn = null;
}
window.closeModal = closeModal;

window.modalDoSave = async function() {
  if (!modalSubmitFn) return;
  const btn = document.getElementById("modal-submit");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try { await modalSubmitFn(); }
  catch(err) {
    alert("Error: " + err.message);
    if (btn) { btn.disabled = false; btn.textContent = "Save"; }
  }
};

function openModal(title, bodyHtml, onSubmit) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = bodyHtml + `
    <div class="modal-footer">
      <button class="btn-sec" id="modal-cancel" onclick="closeModal()">Cancel</button>
      <button class="btn-pri" id="modal-submit" onclick="modalDoSave()">Save</button>
    </div>`;
  var ov = document.getElementById("modal-overlay");
  ov.style.display = "flex";
  ov.classList.remove("hidden");
  document.getElementById("modal-close").onclick = closeModal;
  modalSubmitFn = onSubmit;
}

// Clicking outside the modal box also closes it
$("modal-overlay").addEventListener("click", e => { if(e.target.id==="modal-overlay") closeModal(); });
