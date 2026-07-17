"""
MadeGood Paid System — FastAPI backend
"""

import os
import httpx
from fastapi import FastAPI, HTTPException, Depends
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Any
import config

app = FastAPI(title="MadeGood Paid System")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

HERE   = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")

# ── Auth ──────────────────────────────────────────────────────────────────────
class AuthBody(BaseModel):
    password: Optional[str] = None

def check_auth(password: Optional[str]):
    if config.APP_PASSWORD and password != config.APP_PASSWORD:
        raise HTTPException(status_code=401, detail="Wrong password.")

# ── Supabase helpers ──────────────────────────────────────────────────────────
def sb_headers():
    return {
        "apikey": config.SUPABASE_KEY,
        "Authorization": f"Bearer {config.SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

def sb_url(table: str, query: str = "") -> str:
    return f"{config.SUPABASE_URL}/rest/v1/{table}{query}"

async def sb_get(table: str, query: str = "") -> list:
    async with httpx.AsyncClient() as c:
        r = await c.get(sb_url(table, query), headers=sb_headers(), timeout=30)
        r.raise_for_status()
        return r.json()

async def sb_post(table: str, data: dict) -> dict:
    async with httpx.AsyncClient() as c:
        r = await c.post(sb_url(table), headers=sb_headers(), json=data, timeout=30)
        r.raise_for_status()
        return r.json()[0] if r.json() else {}

async def sb_patch(table: str, id: int, data: dict) -> dict:
    async with httpx.AsyncClient() as c:
        r = await c.patch(sb_url(table, f"?id=eq.{id}"), headers=sb_headers(), json=data, timeout=30)
        r.raise_for_status()
        return r.json()[0] if r.json() else {}

async def sb_delete(table: str, id: int):
    async with httpx.AsyncClient() as c:
        r = await c.delete(sb_url(table, f"?id=eq.{id}"), headers=sb_headers(), timeout=30)
        r.raise_for_status()

# ── Budget tracker helpers (existing MadeGood Supabase project) ───────────────
def mg_headers():
    return {
        "apikey": config.MG_BUDGET_KEY,
        "Authorization": f"Bearer {config.MG_BUDGET_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

async def mg_get(query: str = "") -> list:
    url = f"{config.MG_BUDGET_URL}/rest/v1/{config.MG_BUDGET_TABLE}{query}"
    async with httpx.AsyncClient() as c:
        r = await c.get(url, headers=mg_headers(), timeout=30)
        r.raise_for_status()
        return r.json()

async def mg_post(data: dict) -> dict:
    url = f"{config.MG_BUDGET_URL}/rest/v1/{config.MG_BUDGET_TABLE}"
    async with httpx.AsyncClient() as c:
        r = await c.post(url, headers=mg_headers(), json=data, timeout=30)
        r.raise_for_status()
        return r.json()[0] if r.json() else {}

async def mg_patch(id: int, data: dict) -> dict:
    url = f"{config.MG_BUDGET_URL}/rest/v1/{config.MG_BUDGET_TABLE}?id=eq.{id}"
    async with httpx.AsyncClient() as c:
        r = await c.patch(url, headers=mg_headers(), json=data, timeout=30)
        r.raise_for_status()
        return r.json()[0] if r.json() else {}

async def mg_delete(id: int):
    url = f"{config.MG_BUDGET_URL}/rest/v1/{config.MG_BUDGET_TABLE}?id=eq.{id}"
    async with httpx.AsyncClient() as c:
        r = await c.delete(url, headers=mg_headers(), timeout=30)
        r.raise_for_status()

# ── Auth check endpoint ───────────────────────────────────────────────────────
class PwCheck(BaseModel):
    password: Optional[str] = None

@app.post("/api/auth")
def auth(req: PwCheck):
    check_auth(req.password)
    return {"ok": True}

@app.post("/api/auth/client")
def auth_client(req: PwCheck):
    if config.CLIENT_PASSWORD and req.password != config.CLIENT_PASSWORD:
        raise HTTPException(status_code=401, detail="Wrong password.")
    return {"ok": True}

@app.get("/api/campaigns")
async def get_campaigns():
    """Returns all distinct campaign values used across the master list."""
    rows = await sb_get("paid_influencers",
        f"?client=eq.{config.CLIENT}&campaign=not.is.null&select=campaign")
    seen, result = set(), []
    for r in rows:
        c = (r.get("campaign") or "").strip()
        if c and c not in seen:
            seen.add(c); result.append(c)
    return sorted(result)

@app.get("/api/client/influencers")
async def get_client_influencers():
    """Public-ish endpoint for client view — returns EXT creators only."""
    return await sb_get("paid_influencers",
        f"?client=eq.{config.CLIENT}&list_type=eq.EXT&order=name.asc"
        f"&select=id,name,ig_handle,ig_url,tt_handle,tt_url,"
        f"ig_followers,tt_followers,tier,vertical,archetype,"
        f"location,location_country,gender,campaign,"
        f"client_approved,client_notes")

@app.patch("/api/client/influencers/{id}")
async def update_client_influencer(id: int, req: dict):
    """Allow clients to update only approval fields."""
    allowed = {k: v for k, v in req.items() if k in ("client_approved", "client_notes")}
    if not allowed:
        raise HTTPException(status_code=400, detail="No allowed fields.")
    return await sb_patch("paid_influencers", id, allowed)

@app.get("/api/client/calendar")
async def get_client_calendar():
    """Returns content calendar entries for the client view (no auth required)."""
    rows = await sb_get("content_calendar",
        f"?client=eq.{config.CLIENT}&order=scheduled_date.asc")
    influencers = await sb_get("paid_influencers",
        f"?client=eq.{config.CLIENT}&select=id,name,ig_handle,tt_handle")
    inf_map = {i["id"]: i for i in influencers}
    for r in rows:
        r["influencer"] = inf_map.get(r["influencer_id"], {})
    return rows

@app.get("/client")
def client_index():
    return FileResponse(os.path.join(STATIC, "client.html"))

# ── Master List (Influencers) ─────────────────────────────────────────────────
class InfluencerIn(BaseModel):
    password: Optional[str] = None
    list_type: str = "INT"
    name: Optional[str] = None
    ig_handle: Optional[str] = None
    ig_url: Optional[str] = None
    tt_handle: Optional[str] = None
    tt_url: Optional[str] = None
    ig_followers: Optional[float] = None
    tt_followers: Optional[float] = None
    total_followers: Optional[float] = None
    tier: Optional[str] = None
    vertical: Optional[str] = None
    archetype: Optional[str] = None
    location: Optional[str] = None
    gender: Optional[str] = None
    email: Optional[str] = None
    audience_age: Optional[str] = None
    shopmy_data: Optional[str] = None
    external_feedback: Optional[str] = None
    campaign: Optional[str] = None
    review_notes: Optional[str] = None
    location_country: Optional[str] = None
    int_status: Optional[str] = None
    client_approved: Optional[bool] = None
    client_notes: Optional[str] = None
    initial_rate: Optional[str] = None
    quoted_rate: Optional[str] = None
    outreach_usage: Optional[str] = None
    in_paid_plan: Optional[bool] = False

@app.get("/api/influencers")
async def get_influencers(list_type: str = "INT"):
    return await sb_get("paid_influencers",
        f"?client=eq.{config.CLIENT}&list_type=eq.{list_type}&order=name.asc")

@app.post("/api/influencers")
async def add_influencer(req: InfluencerIn):
    check_auth(req.password)
    data = req.model_dump(exclude={"password"})
    data["client"] = config.CLIENT
    if data.get("ig_followers") and data.get("tt_followers"):
        data["total_followers"] = (data["ig_followers"] or 0) + (data["tt_followers"] or 0)
    return await sb_post("paid_influencers", data)

@app.patch("/api/influencers/{id}")
async def update_influencer(id: int, req: dict):
    check_auth(req.pop("password", None))
    result = await sb_patch("paid_influencers", id, req)

    # When setting in_paid_plan=True, migrate any existing plan records from the
    # matching INT influencer to this EXT influencer so Paid Plan can find them directly
    if req.get("in_paid_plan") is True:
        try:
            inf_rec = await sb_get("paid_influencers", f"?id=eq.{id}&select=ig_handle")
            if inf_rec:
                handle = (inf_rec[0].get("ig_handle") or "").strip()
                if handle:
                    all_with_handle = await sb_get("paid_influencers",
                        f"?ig_handle=eq.{handle}&select=id")
                    other_ids = [str(i["id"]) for i in all_with_handle if i["id"] != id]
                    if other_ids:
                        other_plans = await sb_get("paid_plan",
                            f"?influencer_id=in.({',' .join(other_ids)})")
                        for p in other_plans:
                            await sb_patch("paid_plan", p["id"], {"influencer_id": id})
        except Exception:
            pass  # non-critical — Paid Plan handle-fallback still works

    # When removing from paid plan, cascade-delete plan records (check both direct ID and handle match)
    if req.get("in_paid_plan") is False:
        inf = await sb_get("paid_influencers", f"?id=eq.{id}&select=ig_handle")
        handle = (inf[0].get("ig_handle") or "") if inf else ""
        # Find all influencer IDs with same handle (catches INT/EXT cross-list)
        if handle:
            same_handle = await sb_get("paid_influencers",
                f"?ig_handle=eq.{handle}&select=id")
            ids = [str(i["id"]) for i in same_handle]
            plans = await sb_get("paid_plan",
                f"?influencer_id=in.({',' .join(ids)})")
        else:
            plans = await sb_get("paid_plan", f"?influencer_id=eq.{id}")
        for p in plans:
            await sb_delete("paid_plan", p["id"])
    return result

@app.delete("/api/influencers/{id}")
async def delete_influencer(id: int, password: str = ""):
    check_auth(password)
    await sb_delete("paid_influencers", id)
    return {"ok": True}

# ── Paid Plan ─────────────────────────────────────────────────────────────────
@app.get("/api/paid_plan")
async def get_paid_plan():
    # Return ALL in_paid_plan creators, merging with any existing plan record
    influencers = await sb_get("paid_influencers",
        f"?client=eq.{config.CLIENT}&in_paid_plan=eq.true&order=name.asc")
    plans = await sb_get("paid_plan",
        f"?client=eq.{config.CLIENT}&order=created_at.asc")
    # Map influencer_id -> first plan record (one plan per creator)
    plan_map = {}
    for p in plans:
        if p["influencer_id"] not in plan_map:
            plan_map[p["influencer_id"]] = p

    # Build handle → plan lookup for cross-list matching (INT plan ↔ EXT creator)
    all_infs = await sb_get("paid_influencers",
        f"?client=eq.{config.CLIENT}&select=id,ig_handle")
    inf_id_to_handle = {i["id"]: (i.get("ig_handle") or "").lower() for i in all_infs}
    handle_to_plan = {}
    for p in plans:
        handle = inf_id_to_handle.get(p["influencer_id"], "")
        if handle and handle not in handle_to_plan:
            handle_to_plan[handle] = p

    result = []
    for inf in influencers:
        handle = (inf.get("ig_handle") or "").lower()
        # First try direct ID match, then fall back to handle match (handles INT↔EXT cross-list plans)
        p = plan_map.get(inf["id"]) or handle_to_plan.get(handle, {})
        result.append({
            "id": p.get("id"),
            "influencer_id": inf["id"],
            "influencer": {
                "id": inf["id"], "name": inf["name"],
                "ig_handle": inf.get("ig_handle"),
                "ig_url": inf.get("ig_url"),
                "tt_handle": inf.get("tt_handle"),
                "tt_url": inf.get("tt_url"),
                "ig_followers": inf.get("ig_followers"),
                "tt_followers": inf.get("tt_followers"),
                "campaign": inf.get("campaign"),
            },
            "status": p.get("status"),
            "campaign": p.get("campaign"),
            "platform_format": p.get("platform_format"),
            "usage": p.get("usage"),
            "exclusivity": p.get("exclusivity"),
            "ig_impressions": p.get("ig_reels_impressions"),
            "ig_reels_impressions": p.get("ig_reels_impressions"),
            "tt_impressions": p.get("tt_impressions"),
            "ig_feed_qty":  p.get("ig_feed_qty", 0),
            "ig_reel_qty":  p.get("ig_reel_qty", 0),
            "ig_story_qty": p.get("ig_story_qty", 0),
            "tt_qty":       p.get("tt_qty", 0),
            "ig_reel_cpm": p.get("ig_reel_cpm"),
            "ig_story_cpm": p.get("ig_story_cpm"),
            "ig_feed_cpm": p.get("ig_feed_cpm"),
            "tt_cpm": p.get("tt_cpm"),
            "organic_pct": p.get("organic_pct"),
            "paid_pct": p.get("paid_pct"),
            "first_offer": p.get("first_offer"),
            "influencer_offer": p.get("influencer_offer"),
            "a8_counter": p.get("a8_counter"),
            "accepted_offer": p.get("accepted_offer"),
            "notes": p.get("notes"),
            "post_details": p.get("post_details") or {},
        })
    return result

@app.get("/api/paid_plan/all")
async def get_paid_plan_all():
    """Returns all paid_plan records with ig_handle for cross-list matching in Outreach"""
    plans = await sb_get("paid_plan", f"?client=eq.{config.CLIENT}&order=created_at.asc")
    if plans:
        ids = ",".join(str(p["influencer_id"]) for p in plans)
        infs = await sb_get("paid_influencers", f"?id=in.({ids})&select=id,ig_handle")
        id_to_handle = {i["id"]: (i.get("ig_handle") or "").lower() for i in infs}
        for p in plans:
            p["ig_handle"] = id_to_handle.get(p["influencer_id"], "")
    return plans

@app.post("/api/paid_plan")
async def add_paid_plan(req: dict):
    check_auth(req.pop("password", None))
    req["client"] = config.CLIENT
    return await sb_post("paid_plan", req)

@app.patch("/api/paid_plan/{id}")
async def update_paid_plan(id: int, req: dict):
    check_auth(req.pop("password", None))
    return await sb_patch("paid_plan", id, req)

@app.delete("/api/paid_plan/{id}")
async def delete_paid_plan(id: int, password: str = ""):
    check_auth(password)
    await sb_delete("paid_plan", id)
    return {"ok": True}

# ── Outreach (updates on influencer records) ──────────────────────────────────
@app.get("/api/outreach")
async def get_outreach():
    rows = await sb_get("paid_influencers",
        f"?client=eq.{config.CLIENT}&order=name.asc"
        f"&select=id,name,ig_handle,ig_url,tt_handle,tt_url,ig_followers,tt_followers,"
        f"list_type,tier,vertical,archetype,location,location_country,gender,email,"
        f"int_status,initial_rate,quoted_rate,outreach_usage,"
        f"outreach_status,outreach_owner,outreach_date,last_contact,outreach_notes,in_paid_plan")
    # Deduplicate by ig_handle — merge INT+EXT, exclude rejected-INT-only creators
    seen = {}
    for r in rows:
        key = (r.get("ig_handle") or r.get("name") or str(r["id"]))
        is_rejected_int = r.get("int_status") == "rejected" and r.get("list_type") == "INT"
        if key in seen:
            existing = seen[key]
            existing_rejected_int = existing.get("int_status") == "rejected" and existing.get("list_type") == "INT"
            if is_rejected_int:
                pass  # keep existing EXT record, ignore rejected INT
            elif existing_rejected_int:
                seen[key] = r  # replace rejected INT with EXT record
            else:
                seen[key]["list_type"] = "INT/EXT"
                # Take the most permissive values from both records
                if r.get("in_paid_plan"): seen[key]["in_paid_plan"] = True
                if r.get("client_approved"): seen[key]["client_approved"] = True
        else:
            if not is_rejected_int:
                seen[key] = r
            # rejected INT with no EXT counterpart → excluded from outreach
    return list(seen.values())

# ── Content Calendar ─────────────────────────────────────────────────────────
@app.get("/api/content_calendar")
async def get_content_calendar():
    rows = await sb_get("content_calendar",
        f"?client=eq.{config.CLIENT}&order=scheduled_date.asc")
    influencers = await sb_get("paid_influencers",
        f"?client=eq.{config.CLIENT}&select=id,name,ig_handle,ig_url,tt_handle,tt_url")
    inf_map = {i["id"]: i for i in influencers}
    for r in rows:
        r["influencer"] = inf_map.get(r["influencer_id"], {})
    return rows

@app.post("/api/content_calendar")
async def add_content_calendar(req: dict):
    check_auth(req.pop("password", None))
    req["client"] = config.CLIENT
    return await sb_post("content_calendar", req)

@app.patch("/api/content_calendar/{id}")
async def update_content_calendar(id: int, req: dict):
    check_auth(req.pop("password", None))
    return await sb_patch("content_calendar", id, req)

@app.delete("/api/content_calendar/{id}")
async def delete_content_calendar(id: int, password: str = ""):
    check_auth(password)
    await sb_delete("content_calendar", id)
    return {"ok": True}

@app.post("/api/content_calendar/sync_from_cr")
async def sync_calendar_from_cr(req: dict):
    """Rebuild all CR-linked calendar entries fresh from Content Review.
    Deletes stale entries and recreates them so calendar always matches CR exactly."""
    import json as _json
    from collections import defaultdict
    check_auth(req.pop("password", None))

    cr_rows = await sb_get("content_review",
        f"?client=eq.{config.CLIENT}&order=id.asc")

    # Backfill is_collab from post_details (same as get_content_review)
    plans    = await sb_get("paid_plan", f"?client=eq.{config.CLIENT}")
    all_infs = await sb_get("paid_influencers",
        f"?client=eq.{config.CLIENT}&select=id,ig_handle")
    id_to_handle = {i["id"]: (i.get("ig_handle") or "").lower() for i in all_infs}
    handle_to_plan = _best_plan(plans, id_to_handle)
    CR_TYPE_KEY = {"IG Feed":"ig_feed","IG Reel":"ig_reel","IG Story":"ig_story","TikTok":"tt"}
    counters: dict = defaultdict(int)
    for r in cr_rows:
        if not r.get("is_collab"):
            h  = id_to_handle.get(r["influencer_id"], "")
            pd = (handle_to_plan.get(h) or {}).get("post_details") or {}
            k  = CR_TYPE_KEY.get(r.get("deliverable_type",""), "")
            gk = (h, r.get("deliverable_type",""))
            idx = counters[gk]; counters[gk] += 1
            posts = pd.get(k, [])
            if idx < len(posts):
                r["is_collab"] = posts[idx].get("is_collab", False)

    # Delete all existing CR-linked calendar entries
    linked = await sb_get("content_calendar",
        f"?client=eq.{config.CLIENT}&content_review_id=not.is.null")
    for cal in linked:
        await sb_delete("content_calendar", cal["id"])

    created = 0
    for r in cr_rows:
        del_type = r.get("deliverable_type","")
        del_qty  = _json.dumps({
            "ig_feed":  1 if del_type=="IG Feed"  else 0,
            "ig_reel":  1 if del_type=="IG Reel"  else 0,
            "ig_story": 1 if del_type=="IG Story" else 0,
            "tiktok":   1 if del_type=="TikTok"   else 0,
        })
        base = {
            "client": config.CLIENT, "influencer_id": r["influencer_id"],
            "deliverable": del_qty,  "content_review_id": r["id"],
        }
        note = f"cr:{r['id']}"
        if r.get("content_due_date"):
            await sb_post("content_calendar", {**base,
                "scheduled_date": r["content_due_date"],
                "notes": f"{note}|type:due", "approved": False, "collab": False})
            created += 1
        if r.get("live_date"):
            await sb_post("content_calendar", {**base,
                "scheduled_date": r["live_date"],
                "notes": f"{note}|type:live",
                "approved": r.get("approved_by_client", False) or False,
                "collab":   r.get("is_collab", False) or False})
            created += 1

    return {"deleted": len(linked), "created": created}

# ── Shared helper: pick the best paid_plan record for a handle ────────────────
def _best_plan(plans: list, id_to_handle: dict) -> dict:
    """Returns handle → best plan. Prefers plan with post_details, then highest
    total qty, then highest id. Handles multiple INT/EXT records per creator."""
    def score(p: dict):
        has_pd  = 1 if (p.get("post_details") or {}) else 0
        qty     = sum((p.get(k) or 0) for k in ["ig_feed_qty","ig_reel_qty","ig_story_qty","tt_qty"])
        pid     = p.get("id") or 0
        return (has_pd, qty, pid)
    best: dict = {}
    for p in plans:
        handle = id_to_handle.get(p["influencer_id"], "")
        if handle:
            if handle not in best or score(p) > score(best[handle]):
                best[handle] = p
    return best

# ── Content Review ────────────────────────────────────────────────────────────
@app.get("/api/content_review")
async def get_content_review():
    rows = await sb_get("content_review",
        f"?client=eq.{config.CLIENT}&order=id.asc")
    influencers = await sb_get("paid_influencers",
        f"?client=eq.{config.CLIENT}"
        f"&select=id,name,ig_handle,ig_url,tt_handle,tt_url,"
        f"ig_followers,tt_followers,tier,vertical,archetype,campaign,location,gender")
    inf_map = {i["id"]: i for i in influencers}

    plans = await sb_get("paid_plan", f"?client=eq.{config.CLIENT}")
    all_infs = await sb_get("paid_influencers",
        f"?client=eq.{config.CLIENT}&select=id,ig_handle")
    id_to_handle = {i["id"]: (i.get("ig_handle") or "").lower() for i in all_infs}
    handle_to_plan = _best_plan(plans, id_to_handle)

    CR_TYPE_KEY = {"IG Feed": "ig_feed", "IG Reel": "ig_reel",
                   "IG Story": "ig_story", "TikTok": "tt"}

    # Group rows by (handle, deliverable_type) in id order to assign post index
    from collections import defaultdict
    group_counters: dict = defaultdict(int)

    for r in rows:
        r["influencer"] = inf_map.get(r["influencer_id"], {})
        # Backfill if usage not yet stored on the CR row itself
        if r.get("usage") is None:
            handle = id_to_handle.get(r["influencer_id"], "")
            plan   = handle_to_plan.get(handle, {})
            pd     = plan.get("post_details") or {}
            key    = CR_TYPE_KEY.get(r.get("deliverable_type", ""), "")
            posts  = pd.get(key, [])
            gk     = (handle, r.get("deliverable_type", ""))
            idx    = group_counters[gk]
            group_counters[gk] += 1
            if idx < len(posts):
                post = posts[idx]
                r["usage"]     = ", ".join(post.get("usage") or []) or None
                r["is_collab"] = post.get("is_collab", False)
    return rows

@app.post("/api/content_review")
async def add_content_review(req: dict):
    check_auth(req.pop("password", None))
    req["client"] = config.CLIENT
    return await sb_post("content_review", req)

@app.patch("/api/content_review/{id}")
async def update_content_review(id: int, req: dict):
    check_auth(req.pop("password", None))
    return await sb_patch("content_review", id, req)

@app.delete("/api/content_review/{id}")
async def delete_content_review(id: int, password: str = ""):
    check_auth(password)
    await sb_delete("content_review", id)
    return {"ok": True}

@app.post("/api/content_review/cleanup_duplicates")
async def cleanup_cr_duplicates(req: dict):
    check_auth(req.pop("password", None))
    return await _sync_content_review()

@app.post("/api/content_review/auto_sync")
async def auto_sync_content_review(req: dict):
    check_auth(req.pop("password", None))
    return await _sync_content_review()

async def _sync_content_review():
    """Sync CR rows to exactly match what Outreach shows for each creator.
    Uses the same plan-lookup logic as get_paid_plan so it's always consistent."""
    from collections import defaultdict

    cr_rows = await sb_get("content_review", f"?client=eq.{config.CLIENT}&order=id.asc")

    # id → handle map for all influencers
    all_infs = await sb_get("paid_influencers",
        f"?client=eq.{config.CLIENT}&select=id,ig_handle")
    id_to_handle = {i["id"]: (i.get("ig_handle") or "").lower() for i in all_infs}

    # Same logic as get_paid_plan: iterate in_paid_plan influencers, find plan by ID then handle
    paid_infs = await sb_get("paid_influencers",
        f"?client=eq.{config.CLIENT}&in_paid_plan=eq.true&order=name.asc")
    plans = await sb_get("paid_plan",
        f"?client=eq.{config.CLIENT}&order=created_at.asc")

    plan_map: dict = {}
    for p in plans:
        if p["influencer_id"] not in plan_map:
            plan_map[p["influencer_id"]] = p
    handle_to_plan: dict = {}
    for p in plans:
        h = id_to_handle.get(p["influencer_id"], "")
        if h and h not in handle_to_plan:
            handle_to_plan[h] = p

    CR_TYPES = [
        ("IG Feed",  "ig_feed_qty"),
        ("IG Reel",  "ig_reel_qty"),
        ("IG Story", "ig_story_qty"),
        ("TikTok",   "tt_qty"),
    ]

    def is_blank(r: dict) -> bool:
        fields = ["status","concept","concept_feedback","content_v1","content_v2",
                  "a8_feedback_v1","client_feedback_v1","a8_feedback_v2","client_feedback_v2"]
        return all(not r.get(f) for f in fields)

    # Group CR rows by (handle, deliverable_type) covering both INT and EXT ids
    groups: dict = defaultdict(list)
    for r in cr_rows:
        h = id_to_handle.get(r["influencer_id"], "")
        groups[(h, r.get("deliverable_type", ""))].append(r)

    seen_handles: set = set()
    added = 0
    deleted = 0

    for inf in paid_infs:
        handle = (inf.get("ig_handle") or "").lower()
        if not handle or handle in seen_handles:
            continue
        seen_handles.add(handle)

        # Exactly the same plan lookup Outreach uses
        plan = plan_map.get(inf["id"]) or handle_to_plan.get(handle, {})

        for del_type, qty_field in CR_TYPES:
            expected = plan.get(qty_field) or 0
            current  = groups.get((handle, del_type), [])
            count    = len(current)

            if count < expected:
                for _ in range(expected - count):
                    await sb_post("content_review", {
                        "client":          config.CLIENT,
                        "influencer_id":   inf["id"],
                        "deliverable_type": del_type,
                    })
                    added += 1
            elif count > expected:
                # Remove only blank excess rows — newest first so filled rows survive
                for r in list(reversed(current))[:(count - expected)]:
                    if is_blank(r):
                        await sb_delete("content_review", r["id"])
                        deleted += 1

    return {"added": added, "deleted": deleted}

# ── Live Posts ────────────────────────────────────────────────────────────────
@app.get("/api/live_posts")
async def get_live_posts():
    rows = await sb_get("live_posts",
        f"?client=eq.{config.CLIENT}&order=live_date.desc")
    influencers = await sb_get("paid_influencers",
        f"?client=eq.{config.CLIENT}&select=id,name,ig_handle,ig_followers,tt_followers")
    inf_map = {i["id"]: i for i in influencers}
    for r in rows:
        r["influencer"] = inf_map.get(r["influencer_id"], {})
        # Calculated KPIs
        cost = r.get("total_cost") or 0
        views = r.get("total_views") or 0
        eng = sum(r.get(f, 0) or 0 for f in ["likes","comments","shares","saves"])
        r["cpv"] = round(cost / views, 4) if views else None
        r["cpe"] = round(cost / eng, 4) if eng else None
        r["total_engagement"] = eng
    return rows

@app.post("/api/live_posts")
async def add_live_post(req: dict):
    check_auth(req.pop("password", None))
    req["client"] = config.CLIENT
    return await sb_post("live_posts", req)

@app.patch("/api/live_posts/{id}")
async def update_live_post(id: int, req: dict):
    check_auth(req.pop("password", None))
    return await sb_patch("live_posts", id, req)

# ── Payment Status ────────────────────────────────────────────────────────────
@app.get("/api/payment_status")
async def get_payment_status():
    rows = await sb_get("payment_status",
        f"?client=eq.{config.CLIENT}&order=payment_due_date.asc")
    influencers = await sb_get("paid_influencers",
        f"?client=eq.{config.CLIENT}&select=id,name,ig_handle,email")
    inf_map = {i["id"]: i for i in influencers}
    for r in rows:
        r["influencer"] = inf_map.get(r["influencer_id"], {})
    return rows

@app.post("/api/payment_status")
async def add_payment_status(req: dict):
    check_auth(req.pop("password", None))
    req["client"] = config.CLIENT
    return await sb_post("payment_status", req)

@app.patch("/api/payment_status/{id}")
async def update_payment_status(id: int, req: dict):
    check_auth(req.pop("password", None))
    return await sb_patch("payment_status", id, req)

# ── Budget Tracker (existing MadeGood Supabase) ───────────────────────────────
@app.get("/api/budget")
async def get_budget():
    rows = await mg_get("?order=date.desc,created_at.desc")
    return {"entries": rows, "campaigns": config.MG_BUDGET_CAMPAIGNS, "total_budget": config.MG_TOTAL_BUDGET}

@app.post("/api/budget")
async def add_budget(req: dict):
    check_auth(req.pop("password", None))
    return await mg_post(req)

@app.patch("/api/budget/{id}")
async def update_budget(id: int, req: dict):
    check_auth(req.pop("password", None))
    return await mg_patch(id, req)

@app.delete("/api/budget/{id}")
async def delete_budget(id: int, password: str = ""):
    check_auth(password)
    await mg_delete(id)
    return {"ok": True}

# ── Archive Sync ─────────────────────────────────────────────────────────────
ARCHIVE_URL       = "https://app.archive.com/api/v2"
ARCHIVE_TOKEN     = os.environ.get("ARCHIVE_APP_TOKEN", "WLeD7XUAgkWeuPUmwHHF5DHLrwZWiX3B")
ARCHIVE_WORKSPACE = "0cec8ea5-c3b3-4bb1-8083-eaab65719f8e"

async def archive_query(query: str, variables: dict) -> dict:
    headers = {
        "Authorization": f"Bearer {ARCHIVE_TOKEN}",
        "Content-Type": "application/json",
        "WORKSPACE-ID": ARCHIVE_WORKSPACE,
    }
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(ARCHIVE_URL, json={"query": query, "variables": variables}, headers=headers)
        r.raise_for_status()
        body = r.json()
        if "errors" in body and body.get("data") is None:
            raise Exception(f"Archive GraphQL error: {body['errors']}")
        return body.get("data") or {}

def detect_deliverable_type(url: str, platform: str) -> str:
    """Detect IG Reel / IG Story / IG Feed / TikTok from URL and platform."""
    url_lower = (url or "").lower()
    if "tiktok.com" in url_lower or platform == "TIKTOK":
        return "TikTok"
    if "/reel/" in url_lower:
        return "IG Reel"
    if "/stories/" in url_lower:
        return "IG Story"
    return "IG Feed"

@app.post("/api/archive_sync")
async def archive_sync(req: dict):
    check_auth(req.pop("password", None))

    # Get ALL master list creators (both INT and EXT) for handle lookup
    all_creators = await sb_get("paid_influencers",
        f"?client=eq.{config.CLIENT}"
        f"&select=id,name,ig_handle,tt_handle,ig_followers,tt_followers,campaign,outreach_usage")

    # Build handle → creator map (covers both lists)
    handle_to_creator = {}
    for c in all_creators:
        for h in [c.get("ig_handle"), c.get("tt_handle")]:
            if h:
                key = h.lower().lstrip("@")
                if key not in handle_to_creator:
                    handle_to_creator[key] = c

    if not handle_to_creator:
        return {"synced": 0, "created": 0, "message": "No creators in master list"}

    # Get paid_plan data for final rates
    plans = await sb_get("paid_plan", f"?client=eq.{config.CLIENT}")
    plan_map = {}
    for p in plans:
        if p["influencer_id"] not in plan_map:
            plan_map[p["influencer_id"]] = p

    # Step 1: Get all campaigns in the MadeGood workspace
    campaigns_q = """
    query {
      campaigns(first: 100) {
        nodes { id name }
      }
    }"""
    campaigns_data = await archive_query(campaigns_q, {})
    campaigns = campaigns_data.get("campaigns", {}).get("nodes", [])

    # Step 2: Query posts per campaign (campaignsIds filter is confirmed working)
    items_q = """
    query($cid: ID!, $after: String) {
      items(first: 100, after: $after,
            filter: { campaignsIds: [$cid] },
            sorting: { sortKey: PUBLISHED_AT, sortOrder: DESC }) {
        pageInfo { hasNextPage endCursor }
        nodes {
          originalUrl archivePublicUrl publishedAt
          socialProfile { accountName platform followers }
          currentEngagement { impressions likes comments shares saves earnedMediaValue }
        }
      }
    }"""

    all_posts = []
    seen_post_urls: set = set()
    for campaign in campaigns:
        after = None
        while True:
            data = await archive_query(items_q, {"cid": campaign["id"], "after": after})
            items_data = data.get("items", {})
            for node in items_data.get("nodes", []):
                url = (node.get("archivePublicUrl") or node.get("originalUrl") or "").rstrip("/")
                if url and url not in seen_post_urls:
                    seen_post_urls.add(url)
                    all_posts.append(node)
            if items_data.get("pageInfo", {}).get("hasNextPage"):
                after = items_data["pageInfo"]["endCursor"]
            else:
                break

    # Existing live posts indexed by URL for dedup
    live_posts = await sb_get("live_posts", f"?client=eq.{config.CLIENT}")
    existing_urls = {(lp.get("live_link") or "").rstrip("/") for lp in live_posts if lp.get("live_link")}
    lp_by_url = {(lp.get("live_link") or "").rstrip("/"): lp for lp in live_posts if lp.get("live_link")}

    synced = 0
    created = 0
    for post in all_posts:
        eng      = post.get("currentEngagement") or {}
        sp       = post.get("socialProfile") or {}
        # Prefer archivePublicUrl (permanent, works for Stories too)
        url      = (post.get("archivePublicUrl") or post.get("originalUrl") or "").rstrip("/")
        handle   = (sp.get("accountName") or "").lower().lstrip("@")
        creator  = handle_to_creator.get(handle)
        platform = sp.get("platform", "")

        # Skip if no URL or creator not in master list
        if not url or not creator:
            continue

        views    = int(eng.get("impressions") or 0)
        likes    = int(eng.get("likes") or 0)
        comments = int(eng.get("comments") or 0)
        shares   = int(eng.get("shares") or 0)
        saves    = int(eng.get("saves") or 0)
        total_eng = likes + comments + shares + saves

        metrics = {
            "total_views": views, "likes": likes,
            "comments": comments, "shares": shares, "saves": saves,
        }

        if url in lp_by_url:
            # Update existing entry metrics
            await sb_patch("live_posts", lp_by_url[url]["id"], metrics)
            synced += 1
        elif url not in existing_urls and post.get("publishedAt"):
            # Auto-fill from paid system data
            plan          = plan_map.get(creator["id"], {})
            final_rate    = plan.get("accepted_offer")
            deliverable   = detect_deliverable_type(url, platform)
            usage         = creator.get("outreach_usage") or plan.get("usage")
            campaign      = creator.get("campaign") or plan.get("campaign")

            await sb_post("live_posts", {
                "client":           config.CLIENT,
                "influencer_id":    creator["id"],
                "live_date":        post["publishedAt"][:10],
                "live_link":        url,
                "campaign":         campaign,
                "deliverable_type": deliverable,
                "usage":            usage,
                "final_rate":       final_rate,
                "total_cost":       final_rate,  # cost = agreed rate
                **metrics,
            })
            existing_urls.add(url)
            created += 1

    handles_in_system = list(handle_to_creator.keys())
    handles_in_posts  = list({(p.get("socialProfile") or {}).get("accountName","").lower().lstrip("@") for p in all_posts if p.get("socialProfile")})
    matched = [h for h in handles_in_posts if h in handle_to_creator]
    return {
        "synced": synced,
        "created": created,
        "total_archive_posts": len(all_posts),
        "total_campaigns_found": len(campaigns),
        "campaign_names": [c.get("name") for c in campaigns],
        "creators_in_system": len(handles_in_system),
        "handles_found_in_archive": handles_in_posts,
        "handles_matched_to_creators": matched,
    }

# ── Reporting (live aggregation) ──────────────────────────────────────────────
@app.get("/api/reporting")
async def get_reporting(start: str = "", end: str = ""):
    influencers = await sb_get("paid_influencers", f"?client=eq.{config.CLIENT}")
    paid_plan   = await sb_get("paid_plan",        f"?client=eq.{config.CLIENT}")
    live_posts  = await sb_get("live_posts",       f"?client=eq.{config.CLIENT}")
    payments    = await sb_get("payment_status",   f"?client=eq.{config.CLIENT}")

    def in_range(d):
        if not d: return True
        return (not start or d >= start) and (not end or d <= end)

    confirmed = [p for p in paid_plan if p.get("status") == "Locked"]
    live_in_range = [p for p in live_posts if in_range(p.get("live_date") or "")]

    total_cost = sum(p.get("total_cost") or 0 for p in live_in_range)
    total_views = sum(p.get("total_views") or 0 for p in live_in_range)

    return {
        "total_influencers": len(influencers),
        "int_count": len([i for i in influencers if i["list_type"] == "INT"]),
        "ext_count": len([i for i in influencers if i["list_type"] == "EXT"]),
        "in_paid_plan": len([i for i in influencers if i.get("in_paid_plan")]),
        "confirmed": len(confirmed),
        "live_posts": len(live_in_range),
        "total_spend": total_cost,
        "total_views": total_views,
        "cpv": round(total_cost / total_views, 4) if total_views else 0,
        "paid_count": len([p for p in payments if p.get("paid")]),
        "pending_payment": len([p for p in payments if not p.get("paid")]),
    }

# ── Serve frontend ────────────────────────────────────────────────────────────
@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC, "index.html"))

app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
