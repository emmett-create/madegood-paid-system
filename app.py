"""
MadeGood Paid System — FastAPI backend
"""

import os
import re
import json
import time
import httpx
from anthropic import Anthropic
from contextvars import ContextVar
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel
from typing import Optional, Any
from google.oauth2 import service_account
from googleapiclient.discovery import build as gbuild
from dateutil import parser as dateparser
import config

app = FastAPI(title="Agency 8 Paid System")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Multi-tenant client context ───────────────────────────────────────────────
# Client registry lives in Supabase (`clients` table) so teammates can add a
# client from the hub UI without a code change or redeploy. Kept in an
# in-memory cache — refreshed at startup and immediately after any add — so
# the hot per-request middleware path never has to hit the network.
_clients_cache: dict = {}

async def refresh_clients_cache():
    global _clients_cache
    rows = await sb_get("clients")
    _clients_cache = {r["slug"]: r for r in rows}

current_client: ContextVar[str] = ContextVar("current_client", default=config.CLIENT)

class ClientContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Read client from ?ctx= query param (set by frontend based on URL path)
        ctx = request.query_params.get("ctx", "").strip()
        if ctx not in _clients_cache:
            ctx = current_client.get()
        token = current_client.set(ctx)
        response = await call_next(request)
        current_client.reset(token)
        return response

app.add_middleware(ClientContextMiddleware)

@app.on_event("startup")
async def _load_clients_on_startup():
    try:
        await refresh_clients_cache()
    except Exception as e:
        print(f"WARNING: could not load clients table at startup: {e}")

HERE   = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")

# ── Auth ──────────────────────────────────────────────────────────────────────
class AuthBody(BaseModel):
    password: Optional[str] = None

def check_auth(password: Optional[str]):
    if config.APP_PASSWORD and password != config.APP_PASSWORD:
        raise HTTPException(status_code=401, detail="Wrong password.")

_anthropic_client: Optional[Anthropic] = None

def get_anthropic_client() -> Anthropic:
    global _anthropic_client
    if not config.ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY is not configured on this deployment.")
    if _anthropic_client is None:
        _anthropic_client = Anthropic(api_key=config.ANTHROPIC_API_KEY)
    return _anthropic_client

# TEMPORARY — remove once the ANTHROPIC_API_KEY env var issue is confirmed fixed.
# Reports env var NAMES only (never values) — shows everything Render actually
# injected into this running process, to compare against what's set in the dashboard.
@app.get("/api/debug/env_keys")
def env_keys():
    return {"keys": sorted(os.environ.keys())}

# Reports presence/shape only; never returns the actual key value.
@app.get("/api/debug/anthropic_key_status")
def anthropic_key_status():
    key = config.ANTHROPIC_API_KEY
    if not key:
        return {"present": False}
    return {
        "present": True,
        "length": len(key),
        "starts_with": key[:8],
        "ends_with": key[-4:],
        "has_whitespace": key != key.strip(),
    }

# TEMPORARY — remove once the GOOGLE_CREDENTIALS_JSON import-wizard issue is
# confirmed fixed. Reports presence/shape/validity only; never the actual key.
@app.get("/api/debug/google_creds_status")
def google_creds_status():
    val = config.GOOGLE_CREDENTIALS_JSON
    if not val:
        return {"present": False}
    info = {
        "present": True,
        "length": len(val),
        "starts_with": val[:12],
        "ends_with": val[-6:],
        "has_leading_or_trailing_whitespace": val != val.strip(),
    }
    try:
        parsed = json.loads(val)
        info["valid_json"] = True
        info["has_client_email"] = "client_email" in parsed
        info["has_private_key"] = "private_key" in parsed
        info["client_email"] = parsed.get("client_email")
    except Exception as e:
        info["valid_json"] = False
        info["json_error"] = str(e)
    return info

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

async def sb_post_bulk(table: str, rows: list) -> list:
    """Insert many rows in one request — PostgREST accepts a JSON array body
    and returns the created rows in the same order. Used by the spreadsheet
    importer so a few-hundred-row sheet is a handful of requests, not one
    sequential round-trip per row (which risks timing out mid-import)."""
    if not rows:
        return []
    async with httpx.AsyncClient() as c:
        r = await c.post(sb_url(table), headers=sb_headers(), json=rows, timeout=60)
        r.raise_for_status()
        return r.json()

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
    if config.APP_PASSWORD and req.password != config.APP_PASSWORD:
        raise HTTPException(status_code=401, detail="Wrong password.")
    return {"ok": True}

@app.get("/api/campaigns")
async def get_campaigns():
    """Returns all distinct campaign values used across the master list, plus any
    reserved campaign names that have been created but not yet assigned to a creator."""
    rows = await sb_get("paid_influencers",
        f"?client=eq.{current_client.get()}&campaign=not.is.null&select=campaign")
    reserved = await sb_get("campaigns", f"?client=eq.{current_client.get()}&select=name")
    seen, result = set(), []
    for c in [(r.get("campaign") or "").strip() for r in rows] + [(r.get("name") or "").strip() for r in reserved]:
        if c and c not in seen:
            seen.add(c); result.append(c)
    return sorted(result)

@app.post("/api/campaigns")
async def create_campaign(req: dict):
    """Reserve a new campaign name so it shows up as an option before any creator uses it."""
    check_auth(req.pop("password", None))
    name = (req.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Campaign name is required.")
    existing = await sb_get("campaigns", f"?client=eq.{current_client.get()}&name=eq.{name}&select=id")
    if not existing:
        await sb_post("campaigns", {"client": current_client.get(), "name": name})
    return {"ok": True, "name": name}

@app.patch("/api/campaigns/{name}")
async def rename_campaign(name: str, req: dict):
    """Rename a campaign everywhere it's used — on all creators AND the reserved-name record."""
    check_auth(req.pop("password", None))
    new_name = (req.get("new_name") or "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="new_name is required.")
    rows = await sb_get("paid_influencers",
        f"?client=eq.{current_client.get()}&campaign=eq.{name}&select=id")
    for r in rows:
        await sb_patch("paid_influencers", r["id"], {"campaign": new_name})
    reserved = await sb_get("campaigns", f"?client=eq.{current_client.get()}&name=eq.{name}&select=id")
    for r in reserved:
        await sb_patch("campaigns", r["id"], {"name": new_name})
    return {"renamed": len(rows)}

@app.delete("/api/campaigns/{name}")
async def delete_campaign(name: str, password: str = ""):
    """Remove a campaign option by clearing it from all creators that have it, and
    deleting the reserved-name record if one exists."""
    check_auth(password)
    rows = await sb_get("paid_influencers",
        f"?client=eq.{current_client.get()}&campaign=eq.{name}&select=id")
    for r in rows:
        await sb_patch("paid_influencers", r["id"], {"campaign": None})
    reserved = await sb_get("campaigns", f"?client=eq.{current_client.get()}&name=eq.{name}&select=id")
    for r in reserved:
        await sb_delete("campaigns", r["id"])
    return {"cleared": len(rows)}

@app.get("/api/client/influencers")
async def get_client_influencers():
    """Public-ish endpoint for client view — returns EXT creators only."""
    return await sb_get("paid_influencers",
        f"?client=eq.{current_client.get()}&list_type=eq.EXT&order=name.asc"
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
    """Returns the same merged calendar data the internal Content Calendar tab uses:
    manual content_calendar entries (excluding any linked to Content Review, same as
    internal) plus Content Review rows themselves (due dates + live dates)."""
    manual_rows = await get_content_calendar()
    manual = [r for r in manual_rows if not r.get("content_review_id")]
    cr_rows = await get_content_review()
    return {"manual": manual, "content_review": cr_rows}

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
    quoted_rate: Optional[str] = None
    landed_rate: Optional[float] = None
    outreach_usage: Optional[str] = None
    in_paid_plan: Optional[bool] = False

@app.get("/api/influencers")
async def get_influencers(list_type: str = "INT"):
    rows = await sb_get("paid_influencers",
        f"?client=eq.{current_client.get()}&list_type=eq.{list_type}&order=name.asc")
    # Backfill campaign from any same-handle record so INT/EXT always show the same value
    all_camp = await sb_get("paid_influencers",
        f"?client=eq.{current_client.get()}&campaign=not.is.null&select=ig_handle,campaign")
    handle_to_camp: dict = {}
    for r in all_camp:
        h = (r.get("ig_handle") or "").lower()
        if h and h not in handle_to_camp:
            handle_to_camp[h] = r["campaign"]
    for r in rows:
        if not r.get("campaign"):
            h = (r.get("ig_handle") or "").lower()
            if h in handle_to_camp:
                r["campaign"] = handle_to_camp[h]
    return rows

@app.post("/api/influencers")
async def add_influencer(req: InfluencerIn):
    check_auth(req.password)
    data = req.model_dump(exclude={"password"})
    data["client"] = current_client.get()
    if data.get("ig_followers") and data.get("tt_followers"):
        data["total_followers"] = (data["ig_followers"] or 0) + (data["tt_followers"] or 0)
    return await sb_post("paid_influencers", data)

@app.patch("/api/influencers/{id}")
async def update_influencer(id: int, req: dict):
    check_auth(req.pop("password", None))

    # Capture the handle BEFORE this edit lands. If ig_handle itself is one of the fields
    # being changed, duplicate rows (INT/EXT) still carry the OLD value at this point — matching
    # against the new value would find nothing, silently skipping the sync below entirely.
    old_handle = ""
    try:
        inf_rec = await sb_get("paid_influencers", f"?id=eq.{id}&select=ig_handle")
        old_handle = (inf_rec[0].get("ig_handle") or "").strip() if inf_rec else ""
    except Exception:
        pass

    result = await sb_patch("paid_influencers", id, req)

    # Sync shared fields across all records with the same ig_handle. Creators copied to the
    # external list live as a SEPARATE row (see "Copy to External"); without this sync, a
    # field saved on one duplicate silently "disappears" whenever get_outreach()'s dedup
    # happens to surface the other, stale duplicate on the next load. Internal is the source
    # of truth, but this runs symmetrically — editing either duplicate propagates to the other.
    SYNC_FIELDS = ("name", "ig_handle", "ig_url", "tt_handle", "tt_url",
                   "ig_followers", "tt_followers", "total_followers",
                   "tier", "vertical", "archetype", "location", "location_country",
                   "gender", "email", "review_notes",
                   "campaign", "outreach_date", "last_contact", "outreach_status",
                   "outreach_owner", "outreach_notes", "quoted_rate", "landed_rate")
    sync_payload = {f: req[f] for f in SYNC_FIELDS if f in req}
    other_ids = []
    if sync_payload and old_handle:
        try:
            others = await sb_get("paid_influencers",
                f"?ig_handle=eq.{old_handle}&id=neq.{id}&select=id")
            other_ids = [o["id"] for o in others]
            for oid in other_ids:
                await sb_patch("paid_influencers", oid, sync_payload)
            # Landed Rate flows into Paid Plan's Accepted Offer — Outreach happens first,
            # so this seeds/updates the final negotiated number on whatever plan record exists.
            if sync_payload.get("landed_rate") is not None:
                id_list = ",".join(str(i) for i in [id] + other_ids)
                plans = await sb_get("paid_plan", f"?influencer_id=in.({id_list})&select=id")
                for p in plans:
                    await sb_patch("paid_plan", p["id"], {"accepted_offer": sync_payload["landed_rate"]})
        except Exception:
            pass

    # When setting in_paid_plan=True, migrate any existing plan records from the
    # matching INT influencer to this EXT influencer so Paid Plan can find them directly
    if req.get("in_paid_plan") is True and old_handle:
        try:
            all_with_handle = await sb_get("paid_influencers",
                f"?ig_handle=eq.{old_handle}&select=id")
            plan_other_ids = [str(i["id"]) for i in all_with_handle if i["id"] != id]
            if plan_other_ids:
                other_plans = await sb_get("paid_plan",
                    f"?influencer_id=in.({',' .join(plan_other_ids)})")
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
        f"?client=eq.{current_client.get()}&in_paid_plan=eq.true&order=name.asc")
    plans = await sb_get("paid_plan",
        f"?client=eq.{current_client.get()}&order=created_at.asc")
    # Map influencer_id -> first plan record (one plan per creator)
    plan_map = {}
    for p in plans:
        if p["influencer_id"] not in plan_map:
            plan_map[p["influencer_id"]] = p

    # Build handle → plan lookup and handle → campaign (campaign may be on INT while in_paid_plan is on EXT)
    all_infs = await sb_get("paid_influencers",
        f"?client=eq.{current_client.get()}&select=id,ig_handle,campaign")
    handle_to_campaign: dict = {}
    for i in all_infs:
        h = (i.get("ig_handle") or "").lower()
        if h and i.get("campaign") and h not in handle_to_campaign:
            handle_to_campaign[h] = i["campaign"]
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
                "tier": inf.get("tier"),
                "vertical": inf.get("vertical") or inf.get("archetype"),
                "campaign": inf.get("campaign") or handle_to_campaign.get((inf.get("ig_handle") or "").lower()),
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
            "ig_feed_cpv":  p.get("ig_feed_cpv"),
            "ig_reel_cpv":  p.get("ig_reel_cpv"),
            "ig_story_cpv": p.get("ig_story_cpv"),
            "tt_cpv":       p.get("tt_cpv"),
            "accepted_offer": p.get("accepted_offer"),
            "notes": p.get("notes"),
            "post_details": p.get("post_details") or {},
        })
    return result

@app.get("/api/paid_plan/all")
async def get_paid_plan_all():
    """Returns all paid_plan records with ig_handle for cross-list matching in Outreach"""
    plans = await sb_get("paid_plan", f"?client=eq.{current_client.get()}&order=created_at.asc")
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
    req["client"] = current_client.get()
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

def build_extraction_schema(fields: list) -> dict:
    props = {}
    for f in fields:
        val_type = "number" if f.get("type") == "number" else "string"
        props[f["key"]] = {"anyOf": [{"type": val_type}, {"type": "null"}]}
    return {
        "type": "object",
        "properties": props,
        "required": [f["key"] for f in fields],
        "additionalProperties": False,
    }

@app.post("/api/extract_screenshot_metrics")
async def extract_screenshot_metrics(req: dict):
    """Generic screenshot-to-numbers extraction (Claude vision) used by both the Paid
    Plan Impressions upload and the Live Posts metrics upload. Caller supplies the
    exact fields it wants read off the screenshot; the model returns those, and only
    those, keyed by field `key`."""
    check_auth(req.pop("password", None))
    image_b64 = req.get("image_base64")
    media_type = req.get("media_type") or "image/png"
    fields = req.get("fields") or []
    if not image_b64:
        raise HTTPException(status_code=400, detail="image_base64 is required.")
    if not fields:
        raise HTTPException(status_code=400, detail="fields is required.")

    field_list = "\n".join(f"- {f['key']}: {f['label']}" for f in fields)
    client = get_anthropic_client()
    response = client.messages.create(
        model="claude-opus-5",
        max_tokens=2048,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
                {"type": "text", "text": (
                    "This is a screenshot of Instagram or TikTok analytics/insights. Extract exactly these "
                    "metrics as shown on screen:\n" + field_list + "\n\n"
                    "For numeric metrics, expand abbreviations to full integers (e.g. '12.3K' -> 12300, "
                    "'1.2M' -> 1200000), no commas or units. For duration/time metrics, return the text "
                    "exactly as displayed (e.g. '1:32' or '45s'). Return null for any metric not visible "
                    "in the screenshot."
                )},
            ],
        }],
        output_config={"format": {"type": "json_schema", "schema": build_extraction_schema(fields)}},
    )

    if response.stop_reason == "refusal":
        raise HTTPException(status_code=502, detail="Claude declined to process this image.")

    text = next(b.text for b in response.content if b.type == "text")
    return json.loads(text)

# ── Outreach (updates on influencer records) ──────────────────────────────────
@app.get("/api/outreach")
async def get_outreach():
    rows = await sb_get("paid_influencers",
        f"?client=eq.{current_client.get()}&order=name.asc,id.asc"
        f"&select=id,name,ig_handle,ig_url,tt_handle,tt_url,ig_followers,tt_followers,"
        f"list_type,tier,vertical,archetype,location,location_country,gender,email,"
        f"int_status,quoted_rate,landed_rate,outreach_usage,"
        f"outreach_status,outreach_owner,outreach_date,last_contact,outreach_notes,in_paid_plan")
    # Deduplicate by ig_handle — merge INT+EXT, exclude rejected-INT-only creators
    MERGE_FIELDS = ("outreach_date", "last_contact", "outreach_status", "outreach_owner",
                     "outreach_notes", "quoted_rate", "landed_rate")
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
                # Backfill outreach fields from whichever duplicate actually has them — the two
                # rows can diverge (e.g. a date saved before update_influencer's cross-sync ran)
                for f in MERGE_FIELDS:
                    if not seen[key].get(f) and r.get(f):
                        seen[key][f] = r[f]
        else:
            if not is_rejected_int:
                seen[key] = r
            # rejected INT with no EXT counterpart → excluded from outreach
    return list(seen.values())

# ── Content Calendar ─────────────────────────────────────────────────────────
@app.get("/api/content_calendar")
async def get_content_calendar():
    rows = await sb_get("content_calendar",
        f"?client=eq.{current_client.get()}&order=scheduled_date.asc")
    influencers = await sb_get("paid_influencers",
        f"?client=eq.{current_client.get()}&select=id,name,ig_handle,ig_url,tt_handle,tt_url")
    inf_map = {i["id"]: i for i in influencers}
    for r in rows:
        r["influencer"] = inf_map.get(r["influencer_id"], {})
    return rows

@app.post("/api/content_calendar")
async def add_content_calendar(req: dict):
    check_auth(req.pop("password", None))
    req["client"] = current_client.get()
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
        f"?client=eq.{current_client.get()}&order=id.asc")

    # Backfill is_collab from post_details (same as get_content_review)
    plans    = await sb_get("paid_plan", f"?client=eq.{current_client.get()}")
    all_infs = await sb_get("paid_influencers",
        f"?client=eq.{current_client.get()}&select=id,ig_handle")
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
        f"?client=eq.{current_client.get()}&content_review_id=not.is.null")
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
            "client": current_client.get(), "influencer_id": r["influencer_id"],
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
        f"?client=eq.{current_client.get()}&order=id.asc")
    influencers = await sb_get("paid_influencers",
        f"?client=eq.{current_client.get()}"
        f"&select=id,name,ig_handle,ig_url,tt_handle,tt_url,"
        f"ig_followers,tt_followers,tier,vertical,archetype,campaign,location,gender")
    inf_map = {i["id"]: i for i in influencers}

    # Build handle → campaign backfill (same as get_influencers — campaign may be on INT not EXT)
    all_infs_camp = await sb_get("paid_influencers",
        f"?client=eq.{current_client.get()}&select=id,ig_handle,campaign")
    handle_to_campaign_cr: dict = {}
    for i in all_infs_camp:
        h = (i.get("ig_handle") or "").lower()
        if h and i.get("campaign") and h not in handle_to_campaign_cr:
            handle_to_campaign_cr[h] = i["campaign"]
    for inf in inf_map.values():
        if not inf.get("campaign"):
            h = (inf.get("ig_handle") or "").lower()
            if h in handle_to_campaign_cr:
                inf["campaign"] = handle_to_campaign_cr[h]

    plans = await sb_get("paid_plan", f"?client=eq.{current_client.get()}")
    all_infs = all_infs_camp
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
    req["client"] = current_client.get()
    return await sb_post("content_review", req)

@app.get("/api/client/content_review")
async def get_client_content_review():
    """Read-only mirror of Content Review for the client view — same data, same shape."""
    return await get_content_review()

@app.patch("/api/client/content_review/{id}")
async def update_client_content_review(id: int, req: dict):
    """Allow clients to update only their feedback fields."""
    allowed = {k: v for k, v in req.items() if k in ("client_feedback_v1", "client_feedback_v2")}
    if not allowed:
        raise HTTPException(status_code=400, detail="No allowed fields.")
    return await sb_patch("content_review", id, allowed)

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

    cr_rows = await sb_get("content_review", f"?client=eq.{current_client.get()}&order=id.asc")

    # id → handle map for all influencers
    all_infs = await sb_get("paid_influencers",
        f"?client=eq.{current_client.get()}&select=id,ig_handle")
    id_to_handle = {i["id"]: (i.get("ig_handle") or "").lower() for i in all_infs}

    # Same logic as get_paid_plan: iterate in_paid_plan influencers, find plan by ID then handle
    paid_infs = await sb_get("paid_influencers",
        f"?client=eq.{current_client.get()}&in_paid_plan=eq.true&order=name.asc")
    plans = await sb_get("paid_plan",
        f"?client=eq.{current_client.get()}&order=created_at.asc")

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
        handle = (inf.get("ig_handle") or "").strip().lower()
        if not handle or handle in seen_handles:
            continue
        seen_handles.add(handle)

        # Exactly the same plan lookup Outreach uses
        plan = plan_map.get(inf["id"]) or handle_to_plan.get(handle, {})

        for del_type, qty_field in CR_TYPES:
            expected = plan.get(qty_field) or 0
            # Always re-read current from groups (updated live as rows are added)
            current  = groups.get((handle, del_type), [])
            count    = len(current)

            if count < expected:
                for _ in range(expected - count):
                    new_row = await sb_post("content_review", {
                        "client":           current_client.get(),
                        "influencer_id":    inf["id"],
                        "deliverable_type": del_type,
                    })
                    # Update groups immediately so any re-visit of same handle sees new rows
                    groups[(handle, del_type)].append(new_row or {})
                    added += 1
            elif count > expected:
                # Remove only blank excess rows — newest first so filled rows survive
                for r in list(reversed(current))[:(count - expected)]:
                    if is_blank(r):
                        await sb_delete("content_review", r["id"])
                        groups[(handle, del_type)].remove(r)
                        deleted += 1

    return {"added": added, "deleted": deleted}

# ── Live Posts ────────────────────────────────────────────────────────────────
@app.get("/api/live_posts")
async def get_live_posts():
    rows = await sb_get("live_posts",
        f"?client=eq.{current_client.get()}&order=live_date.desc")
    influencers = await sb_get("paid_influencers",
        f"?client=eq.{current_client.get()}&select=id,name,ig_handle,ig_followers,tt_followers")
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
    req["client"] = current_client.get()
    return await sb_post("live_posts", req)

@app.patch("/api/live_posts/{id}")
async def update_live_post(id: int, req: dict):
    check_auth(req.pop("password", None))
    return await sb_patch("live_posts", id, req)

@app.delete("/api/live_posts/{id}")
async def delete_live_post(id: int, password: str = "", permanent: bool = False):
    check_auth(password)
    if permanent:
        rows = await sb_get("live_posts", f"?id=eq.{id}&select=live_link")
        live_link = (rows[0].get("live_link") if rows else "") or ""
        live_link = live_link.rstrip("/")
        if live_link:
            already = await sb_get("live_posts_excluded",
                f"?client=eq.{current_client.get()}&live_link=eq.{live_link}")
            if not already:
                await sb_post("live_posts_excluded",
                    {"client": current_client.get(), "live_link": live_link})
    await sb_delete("live_posts", id)
    return {"ok": True}

# ── Gifted Licensing ─────────────────────────────────────────────────────────
@app.get("/api/gifted_licensing")
async def get_gifted_licensing():
    rows = await sb_get("gifted_licensing",
        f"?client=eq.{current_client.get()}&order=live_date.desc")
    influencers = await sb_get("paid_influencers",
        f"?client=eq.{current_client.get()}&select=id,name,ig_handle")
    inf_map = {i["id"]: i for i in influencers}
    for r in rows:
        r["influencer"] = inf_map.get(r["influencer_id"], {})
    return rows

@app.post("/api/gifted_licensing")
async def add_gifted_licensing(req: dict):
    check_auth(req.pop("password", None))
    req["client"] = current_client.get()
    return await sb_post("gifted_licensing", req)

@app.patch("/api/gifted_licensing/{id}")
async def update_gifted_licensing(id: int, req: dict):
    check_auth(req.pop("password", None))
    return await sb_patch("gifted_licensing", id, req)

@app.delete("/api/gifted_licensing/{id}")
async def delete_gifted_licensing(id: int, password: str = ""):
    check_auth(password)
    await sb_delete("gifted_licensing", id)
    return {"ok": True}

# ── Payment Status ────────────────────────────────────────────────────────────
@app.get("/api/payment_status")
async def get_payment_status():
    rows = await sb_get("payment_status",
        f"?client=eq.{current_client.get()}&order=payment_due_date.asc")
    influencers = await sb_get("paid_influencers",
        f"?client=eq.{current_client.get()}&select=id,name,ig_handle,email")
    inf_map = {i["id"]: i for i in influencers}
    for r in rows:
        r["influencer"] = inf_map.get(r["influencer_id"], {})
    return rows

@app.post("/api/payment_status")
async def add_payment_status(req: dict):
    check_auth(req.pop("password", None))
    req["client"] = current_client.get()
    return await sb_post("payment_status", req)

@app.patch("/api/payment_status/{id}")
async def update_payment_status(id: int, req: dict):
    check_auth(req.pop("password", None))
    return await sb_patch("payment_status", id, req)

# ── Legacy spreadsheet import ──────────────────────────────────────────────────
# Lets a teammate bring an old paid-creator spreadsheet (pre-dating this tool)
# into Master List / Payment Status / Content Review, with a manual column-
# mapping step rather than guessing — every client's old sheet has a different
# layout, so there's no reliable auto-detect. Read-only against the source
# sheet; every write is an explicit create/update the caller mapped by hand.
_sheets_client = None

def sheets():
    global _sheets_client
    if _sheets_client is None:
        if config.GOOGLE_CREDENTIALS_JSON:
            info = json.loads(config.GOOGLE_CREDENTIALS_JSON)
            creds = service_account.Credentials.from_service_account_info(
                info, scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"])
        else:
            creds = service_account.Credentials.from_service_account_file(
                config.GOOGLE_CREDENTIALS_FILE, scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"])
        _sheets_client = gbuild("sheets", "v4", credentials=creds)
    return _sheets_client

def _extract_sheet_id(url_or_id: str) -> str:
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9_-]+)", url_or_id)
    return m.group(1) if m else url_or_id.strip()

def _num(s):
    if not s:
        return None
    s = re.sub(r"[^0-9.\-]", "", str(s))
    try:
        return float(s) if s not in ("", "-", ".") else None
    except ValueError:
        return None

def _parse_date(s):
    if not s or not str(s).strip():
        return None
    try:
        return dateparser.parse(str(s), fuzzy=True).date().isoformat()
    except (ValueError, OverflowError):
        return None

async def _read_tab_rows(sheet_id: str, tab: str) -> list:
    resp = sheets().spreadsheets().values().get(
        spreadsheetId=sheet_id, range=f"'{tab}'!A1:AZ2000").execute()
    values = resp.get("values", [])
    if not values:
        return []
    width = len(values[0])
    return [r + [""] * (width - len(r)) for r in values[1:]]

def _cell(row: list, mapping: dict, field: str) -> str:
    idx = mapping.get(field)
    if idx is None or idx < 0 or idx >= len(row):
        return ""
    return (row[idx] or "").strip()

ROSTER_FIELDS = [
    "name", "ig_handle", "tt_handle", "ig_followers", "tt_followers", "tier",
    "gender", "vertical", "location", "email", "campaign", "outreach_notes",
    "quoted_rate", "landed_rate", "deliverables",
]

# Everything from the "detail" tab (Content Review / Live Posts history) — one
# combined field list because on a real historical sheet these all live on the
# same physical tab. Each entry is (destination_table, destination_column).
# Grouped in the UI by table so it's clear where each field actually lands.
DETAIL_FIELD_DEST = {
    # → content_review
    "cr_deliverable_type":   ("content_review", "deliverable_type"),
    "cr_month":              ("content_review", "month"),
    "cr_concept":             ("content_review", "concept"),
    "cr_concept_feedback":    ("content_review", "concept_feedback"),
    "cr_notes":               ("content_review", "notes"),
    "cr_content_v1":          ("content_review", "content_v1"),
    "cr_caption_v1":          ("content_review", "caption_v1"),
    "cr_a8_feedback_v1":      ("content_review", "a8_feedback_v1"),
    "cr_client_feedback_v1":  ("content_review", "client_feedback_v1"),
    "cr_content_v2":          ("content_review", "content_v2"),
    "cr_caption_v2":          ("content_review", "caption_v2"),
    "cr_a8_feedback_v2":      ("content_review", "a8_feedback_v2"),
    "cr_client_feedback_v2":  ("content_review", "client_feedback_v2"),
    "cr_content_due_date":    ("content_review", "content_due_date"),
    "cr_live_date":           ("content_review", "live_date"),
    "cr_approved_by_client":  ("content_review", "approved_by_client"),
    # → paid_plan
    "pp_contract_link":       ("paid_plan", "contract_link"),
    # → payment_status (updates the row created during roster import, or
    #   creates one if the roster tab didn't have a rate for this creator)
    "ps_agreed_rate":         ("payment_status", "agreed_rate"),
    "ps_deliverables":        ("payment_status", "deliverables"),
    "ps_paid":                ("payment_status", "paid"),
    # → live_posts (one row per detail-tab row, only if any lp_ field is filled)
    "lp_live_date":           ("live_posts", "live_date"),
    "lp_raw_content_link":    ("live_posts", "raw_content_link"),
    "lp_live_link":           ("live_posts", "live_link"),
    "lp_ig_spark_code":       ("live_posts", "ig_spark_code"),
    "lp_tt_spark_code":       ("live_posts", "tt_spark_code"),
    "lp_utm_link":            ("live_posts", "utm_link"),
    "lp_discount_code":       ("live_posts", "discount_code"),
    "lp_total_views":         ("live_posts", "total_views"),
    "lp_likes":               ("live_posts", "likes"),
    "lp_comments":            ("live_posts", "comments"),
    "lp_shares":              ("live_posts", "shares"),
    "lp_saves":               ("live_posts", "saves"),
    "lp_impressions":         ("live_posts", "impressions"),
    "lp_reach":               ("live_posts", "reach"),
    "lp_emv":                 ("live_posts", "emv"),
    "lp_engagements":         ("live_posts", "engagements"),
    "lp_cpm":                 ("live_posts", "cpm"),
}
DETAIL_FIELDS = ["name"] + list(DETAIL_FIELD_DEST.keys())
DETAIL_DATE_FIELDS = {"cr_content_due_date", "cr_live_date", "lp_live_date"}
DETAIL_BOOL_FIELDS = {"cr_approved_by_client", "ps_paid"}
DETAIL_NUM_FIELDS = {
    "ps_agreed_rate", "lp_total_views", "lp_likes", "lp_comments", "lp_shares", "lp_saves",
    "lp_impressions", "lp_reach", "lp_emv", "lp_engagements", "lp_cpm",
}

class ImportSheetBody(BaseModel):
    sheet_url: str
    password: Optional[str] = None

@app.post("/api/import/tabs")
async def import_tabs(body: ImportSheetBody):
    check_auth(body.password)
    sid = _extract_sheet_id(body.sheet_url)
    try:
        meta = sheets().spreadsheets().get(spreadsheetId=sid, fields="sheets(properties(title))").execute()
    except Exception as e:
        raise HTTPException(status_code=400,
            detail=f"Couldn't open that sheet — check the link, and make sure it's shared with agency8-sheets-bot@a8-apify-tool.iam.gserviceaccount.com. ({e})")
    tabs = [s["properties"]["title"] for s in meta.get("sheets", [])]
    return {"sheet_id": sid, "tabs": tabs}

class ImportPreviewBody(BaseModel):
    sheet_id: str
    tab: str
    password: Optional[str] = None

@app.post("/api/import/preview")
async def import_preview(body: ImportPreviewBody):
    check_auth(body.password)
    try:
        rows = await _read_tab_rows(body.sheet_id, body.tab)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Couldn't read that tab: {e}")
    header_resp = sheets().spreadsheets().values().get(
        spreadsheetId=body.sheet_id, range=f"'{body.tab}'!A1:AZ1").execute()
    headers = header_resp.get("values", [[]])[0] if header_resp.get("values") else []
    non_blank = [r for r in rows if any(c.strip() for c in r)]
    return {"headers": headers, "sample_rows": non_blank[:5], "total_rows": len(non_blank)}

class ImportExecuteBody(BaseModel):
    sheet_id: str
    roster_tab: Optional[str] = None
    roster_mapping: Optional[dict] = None    # {field: column_index}
    detail_tab: Optional[str] = None
    detail_mapping: Optional[dict] = None    # {DETAIL_FIELD_DEST key: column_index}
    password: Optional[str] = None

def _detail_value(row, mapping, field):
    raw = _cell(row, mapping, field)
    if not raw:
        return None
    if field in DETAIL_DATE_FIELDS:
        return _parse_date(raw)
    if field in DETAIL_BOOL_FIELDS:
        return raw.strip().lower() in ("yes", "true", "y", "✓", "1", "complete", "completed", "approved", "paid")
    if field in DETAIL_NUM_FIELDS:
        return _num(raw)
    return raw

@app.post("/api/import/execute")
async def import_execute(body: ImportExecuteBody):
    check_auth(body.password)
    client = current_client.get()
    result = {
        "creators_created": 0, "creators_updated": 0,
        "payment_status_created": 0, "payment_status_updated": 0,
        "paid_plan_created": 0, "paid_plan_updated": 0,
        "content_review_created": 0, "live_posts_created": 0,
        "detail_skipped_no_match": [],
    }

    existing = await sb_get("paid_influencers", f"?client=eq.{client}&select=id,name")
    name_to_id = {e["name"].strip().lower(): e["id"] for e in existing if e.get("name")}
    # Tracks the payment_status / paid_plan row created for each creator during the
    # roster pass, so the detail pass can update the SAME row instead of creating a
    # second one when both tabs carry rate/deliverables data for the same person.
    inf_to_payment_status_id = {}
    inf_to_paid_plan_id = {}

    if body.roster_tab and body.roster_mapping:
        try:
            rows = await _read_tab_rows(body.sheet_id, body.roster_tab)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Couldn't read roster tab: {e}")

        # Pass 1: build payloads. Split into brand-new creators (bulk-inserted
        # a batch at a time) vs existing ones (patched individually — rare in
        # practice, since name-matching only hits on a re-run). A sheet with a
        # few hundred rows done one HTTP round-trip per row risks timing out
        # mid-import; batching keeps a 300-person sheet to a handful of calls.
        new_entries, update_entries = [], []
        for row in rows:
            name = _cell(row, body.roster_mapping, "name")
            if not name:
                continue
            ig_followers = _num(_cell(row, body.roster_mapping, "ig_followers"))
            tt_followers = _num(_cell(row, body.roster_mapping, "tt_followers"))
            payload = {
                "name": name,
                "ig_handle": _cell(row, body.roster_mapping, "ig_handle").lstrip("@") or None,
                "tt_handle": _cell(row, body.roster_mapping, "tt_handle").lstrip("@") or None,
                "ig_followers": ig_followers,
                "tt_followers": tt_followers,
                "total_followers": (ig_followers or 0) + (tt_followers or 0) if (ig_followers or tt_followers) else None,
                "tier": _cell(row, body.roster_mapping, "tier") or None,
                "gender": _cell(row, body.roster_mapping, "gender") or None,
                "vertical": _cell(row, body.roster_mapping, "vertical") or None,
                "location": _cell(row, body.roster_mapping, "location") or None,
                "email": _cell(row, body.roster_mapping, "email") or None,
                "campaign": _cell(row, body.roster_mapping, "campaign") or None,
                "outreach_notes": _cell(row, body.roster_mapping, "outreach_notes") or None,
                "quoted_rate": _cell(row, body.roster_mapping, "quoted_rate") or None,
                "landed_rate": _num(_cell(row, body.roster_mapping, "landed_rate")),
            }
            payload = {k: v for k, v in payload.items() if v is not None}
            rate = _num(_cell(row, body.roster_mapping, "landed_rate"))
            deliverables = _cell(row, body.roster_mapping, "deliverables")
            key = name.strip().lower()
            entry = {"key": key, "payload": payload, "rate": rate, "deliverables": deliverables,
                      "campaign": _cell(row, body.roster_mapping, "campaign") or None}
            if key in name_to_id:
                update_entries.append(entry)
            else:
                new_entries.append(entry)

        # Existing creators — individually patched (small in practice).
        for e in update_entries:
            inf_id = name_to_id[e["key"]]
            await sb_patch("paid_influencers", inf_id, e["payload"])
            result["creators_updated"] += 1
            e["inf_id"] = inf_id

        # Brand-new creators — bulk-inserted in chunks of 100.
        CHUNK = 100
        for i in range(0, len(new_entries), CHUNK):
            batch = new_entries[i:i+CHUNK]
            bulk_payload = [{**e["payload"], "client": client, "list_type": "INT", "in_paid_plan": True} for e in batch]
            created_rows = await sb_post_bulk("paid_influencers", bulk_payload)
            for e, created in zip(batch, created_rows):
                inf_id = created.get("id")
                e["inf_id"] = inf_id
                name_to_id[e["key"]] = inf_id
                result["creators_created"] += 1

        # Rate/deliverables → Payment Status + Paid Plan, also bulk-inserted.
        rated = [e for e in (new_entries + update_entries) if e["rate"] and e.get("inf_id")]
        for i in range(0, len(rated), CHUNK):
            batch = rated[i:i+CHUNK]
            ps_rows = await sb_post_bulk("payment_status", [{
                "client": client, "influencer_id": e["inf_id"],
                "agreed_rate": e["rate"], "deliverables": e["deliverables"] or None,
                "status": "Imported from spreadsheet",
            } for e in batch])
            pp_rows = await sb_post_bulk("paid_plan", [{
                "client": client, "influencer_id": e["inf_id"],
                "status": "Locked", "accepted_offer": e["rate"],
                "campaign": e["campaign"], "notes": e["deliverables"] or None,
            } for e in batch])
            for e, ps, pp in zip(batch, ps_rows, pp_rows):
                inf_to_payment_status_id[e["inf_id"]] = ps.get("id")
                inf_to_paid_plan_id[e["inf_id"]] = pp.get("id")
            result["payment_status_created"] += len(ps_rows)
            result["paid_plan_created"] += len(pp_rows)

    if body.detail_tab and body.detail_mapping:
        try:
            rows = await _read_tab_rows(body.sheet_id, body.detail_tab)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Couldn't read the detail tab: {e}")
        for row in rows:
            name = _cell(row, body.detail_mapping, "name")
            if not name:
                continue
            inf_id = name_to_id.get(name.strip().lower())
            if not inf_id:
                result["detail_skipped_no_match"].append(name)
                continue

            cr_payload, ps_payload, lp_payload, contract_link = {}, {}, {}, None
            for field, (table, col) in DETAIL_FIELD_DEST.items():
                val = _detail_value(row, body.detail_mapping, field)
                if val is None:
                    continue
                if table == "content_review": cr_payload[col] = val
                elif table == "payment_status": ps_payload[col] = val
                elif table == "live_posts": lp_payload[col] = val
                elif table == "paid_plan": contract_link = val

            if cr_payload:
                await sb_post("content_review", {"client": client, "influencer_id": inf_id, **cr_payload})
                result["content_review_created"] += 1

            if ps_payload:
                existing_ps_id = inf_to_payment_status_id.get(inf_id)
                if existing_ps_id:
                    await sb_patch("payment_status", existing_ps_id, ps_payload)
                    result["payment_status_updated"] += 1
                else:
                    ps = await sb_post("payment_status", {"client": client, "influencer_id": inf_id, **ps_payload})
                    inf_to_payment_status_id[inf_id] = ps.get("id")
                    result["payment_status_created"] += 1

            if contract_link:
                existing_pp_id = inf_to_paid_plan_id.get(inf_id)
                if existing_pp_id:
                    await sb_patch("paid_plan", existing_pp_id, {"contract_link": contract_link})
                    result["paid_plan_updated"] += 1
                else:
                    pp = await sb_post("paid_plan", {
                        "client": client, "influencer_id": inf_id,
                        "status": "Locked", "contract_link": contract_link,
                    })
                    inf_to_paid_plan_id[inf_id] = pp.get("id")
                    result["paid_plan_created"] += 1

            if lp_payload:
                await sb_post("live_posts", {"client": client, "influencer_id": inf_id, **lp_payload})
                result["live_posts_created"] += 1

    return result

# ── Lumanu (read-only payables sync) ──────────────────────────────────────────
# Agency 8 has one Lumanu workspace that pays every client's creators. There's
# no per-client field on a payable, so a client's payables are found by matching
# the client's display name / creator emails / IG handles against each payable's
# description and vendor_email. Read-only: never creates, approves, or funds
# anything in Lumanu — just surfaces what's already there.
_lumanu_token_cache = {"token": None, "expires_at": 0}
_lumanu_payables_cache = {"data": None, "at": 0}
_LUMANU_CACHE_TTL = 60

async def _lumanu_token() -> str:
    if _lumanu_token_cache["token"] and time.time() < _lumanu_token_cache["expires_at"] - 60:
        return _lumanu_token_cache["token"]
    async with httpx.AsyncClient() as c:
        r = await c.post(config.LUMANU_TOKEN_URL, json={
            "grant_type": "client_credentials",
            "client_id": config.LUMANU_CLIENT_ID,
            "client_secret": config.LUMANU_CLIENT_SECRET,
            "audience": config.LUMANU_AUDIENCE,
        }, timeout=15)
        r.raise_for_status()
        data = r.json()
    _lumanu_token_cache["token"] = data["access_token"]
    _lumanu_token_cache["expires_at"] = time.time() + data["expires_in"]
    return _lumanu_token_cache["token"]

async def _lumanu_get(path: str, params: dict = None) -> dict:
    token = await _lumanu_token()
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{config.LUMANU_API_BASE}{path}",
            headers={"Authorization": f"Bearer {token}"}, params=params or {}, timeout=20)
        r.raise_for_status()
        return r.json()

async def _lumanu_post(path: str, body: dict) -> dict:
    token = await _lumanu_token()
    async with httpx.AsyncClient() as c:
        r = await c.post(f"{config.LUMANU_API_BASE}{path}",
            headers={"Authorization": f"Bearer {token}"}, json=body, timeout=20)
        r.raise_for_status()
        return r.json()

async def _lumanu_all_payables() -> list:
    now = time.time()
    if _lumanu_payables_cache["data"] is not None and now - _lumanu_payables_cache["at"] < _LUMANU_CACHE_TTL:
        return _lumanu_payables_cache["data"]
    out, offset, limit = [], 0, 100
    while True:
        data = await _lumanu_get("/payable", {"workspace_id": config.LUMANU_WORKSPACE_ID, "limit": limit, "offset": offset})
        batch = data.get("data", [])
        out.extend(batch)
        offset += limit
        if offset >= data.get("total", 0) or not batch:
            break
    _lumanu_payables_cache["data"] = out
    _lumanu_payables_cache["at"] = now
    return out

@app.get("/api/lumanu/payables")
async def get_lumanu_payables():
    if not config.LUMANU_CLIENT_ID:
        return []
    client_row = _clients_cache.get(current_client.get(), {})
    display_name = (client_row.get("display_name") or current_client.get()).lower()
    influencers = await sb_get("paid_influencers",
        f"?client=eq.{current_client.get()}&select=name,ig_handle,email")
    emails  = {i["email"].lower() for i in influencers if i.get("email")}
    handles = {i["ig_handle"].lower().lstrip("@") for i in influencers if i.get("ig_handle")}
    try:
        payables = await _lumanu_all_payables()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Lumanu API error: {e}")
    matched = []
    for p in payables:
        desc = (p.get("description") or "").lower()
        vemail = (p.get("vendor_email") or "").lower()
        if display_name in desc or vemail in emails or any(h and h in desc for h in handles):
            matched.append({
                "id":              p.get("id"),
                "description":     p.get("description"),
                "amount":          (p.get("amount") or 0) / 100,
                "vendor_email":    p.get("vendor_email"),
                "vendor_status":   p.get("vendor_status"),
                "status":          p.get("status"),
                "payable_status":  p.get("payable_status"),
                "due_date":        p.get("due_date"),
                "invoice_number":  p.get("invoice_number"),
            })
    matched.sort(key=lambda x: x.get("due_date") or "", reverse=True)
    return matched

@app.get("/api/lumanu/payables/{id}/invoice")
async def get_lumanu_invoice(id: str):
    try:
        return await _lumanu_get(f"/payable/{id}/invoice-pdf")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Lumanu API error: {e}")

class CreateLumanuPayableBody(BaseModel):
    payment_status_id: int
    password: Optional[str] = None

@app.post("/api/lumanu/payables/create")
async def create_lumanu_payable(body: CreateLumanuPayableBody):
    check_auth(body.password)
    if not config.LUMANU_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Lumanu is not configured on this deployment.")

    client_row = _clients_cache.get(current_client.get(), {})
    gl_account = client_row.get("lumanu_gl_account")
    if not gl_account:
        raise HTTPException(status_code=400,
            detail="GL Account isn't set up for this client yet — ask whoever manages QuickBooks for the right value.")

    rows = await sb_get("payment_status", f"?id=eq.{body.payment_status_id}")
    if not rows:
        raise HTTPException(status_code=404, detail="Payment Status entry not found.")
    row = rows[0]
    if row.get("lumanu_payable_id"):
        raise HTTPException(status_code=400, detail="Already sent to Lumanu.")
    if not row.get("agreed_rate"):
        raise HTTPException(status_code=400, detail="Set an Agreed Rate before sending to Lumanu.")
    if not row.get("payment_due_date"):
        raise HTTPException(status_code=400, detail="Set a Payment Due date before sending to Lumanu.")

    inf_rows = await sb_get("paid_influencers", f"?id=eq.{row['influencer_id']}")
    inf = inf_rows[0] if inf_rows else {}
    email = (inf.get("email") or "").strip()
    if not email:
        raise HTTPException(status_code=400,
            detail=f"{inf.get('name') or 'This creator'} has no email on file — add one in the Master List first.")

    creator_name = inf.get("name") or inf.get("ig_handle") or "Creator"
    description = f"{client_row.get('display_name') or current_client.get()} — {creator_name} — {row.get('deliverables') or 'Influencer payment'}"

    payload = {
        "workspace_id": config.LUMANU_WORKSPACE_ID,
        "payee_email":  email,
        "amount":       int(round(float(row["agreed_rate"]) * 100)),
        "description":  description,
        "due_date":     row["payment_due_date"],
        "custom_fields": [
            {"label": "Invoice Date", "type": "local_date", "value": time.strftime("%Y-%m-%d"),
             "policy_id": config.LUMANU_INVOICE_DATE_POLICY_ID},
            {"label": "GL Accounts", "type": "text", "value": gl_account,
             "policy_id": config.LUMANU_GL_ACCOUNT_POLICY_ID},
        ],
    }
    try:
        created = await _lumanu_post("/payable", payload)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Lumanu API error: {e}")

    payable_id = created.get("id")
    if payable_id:
        await sb_patch("payment_status", body.payment_status_id, {"lumanu_payable_id": payable_id})
    _lumanu_payables_cache["data"] = None  # force a fresh fetch so it shows immediately

    return {"ok": True, "lumanu_payable_id": payable_id}

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
ARCHIVE_URL   = "https://app.archive.com/api/v2"
ARCHIVE_TOKEN = os.environ.get("ARCHIVE_APP_TOKEN", "WLeD7XUAgkWeuPUmwHHF5DHLrwZWiX3B")

# Per-client Archive workspace — resolved from current_client on every request
# (not a single fixed value, since one server process serves all clients) via
# the `clients` table / _clients_cache rather than a hardcoded dict.

async def archive_query(query: str, variables: dict) -> dict:
    headers = {
        "Authorization": f"Bearer {ARCHIVE_TOKEN}",
        "Content-Type": "application/json",
        "WORKSPACE-ID": _clients_cache.get(current_client.get(), {}).get("archive_workspace_id") or "",
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

@app.get("/api/archive_debug")
async def archive_debug():
    """Diagnostic endpoint — tests Archive API connection and returns raw results."""
    results = {
        "token": ARCHIVE_TOKEN[:8] + "...",
        "client": current_client.get(),
        "workspace": _clients_cache.get(current_client.get(), {}).get("archive_workspace_id") or "",
    }

    # Test 1: campaigns query
    try:
        campaigns_data = await archive_query("query { campaigns(first: 50) { nodes { id name } } }", {})
        campaigns = campaigns_data.get("campaigns", {}).get("nodes", [])
        results["campaigns_count"] = len(campaigns)
        results["campaigns"] = [c.get("name") for c in campaigns]
    except Exception as e:
        results["campaigns_error"] = str(e)

    # Test 2: introspect Item fields to find correct names
    try:
        intro = await archive_query("""
        query {
          item_fields: __type(name: "Item") { fields { name } }
          sort_keys:   __type(name: "ItemSortKey") { enumValues { name } }
          profile_fields: __type(name: "SocialProfile") { fields { name } }
        }""", {})
        results["item_fields"]    = [f["name"] for f in (intro.get("item_fields") or {}).get("fields") or []]
        results["sort_keys"]      = [v["name"] for v in (intro.get("sort_keys") or {}).get("enumValues") or []]
        results["profile_fields"] = [f["name"] for f in (intro.get("profile_fields") or {}).get("fields") or []]
    except Exception as e:
        results["introspect_error"] = str(e)

    # Test 3: minimal items query using first campaign
    if results.get("campaigns_count", 0) > 0:
        cid = campaigns[0]["id"]
        try:
            items_data = await archive_query("""
            query($cid: ID!) {
              items(first: 3, filter: { campaignsIds: [$cid] }) {
                nodes {
                  originalUrl archivePublicUrl
                  socialProfile { accountName followers }
                  currentEngagement { impressions likes comments shares earnedMediaValue }
                }
              }
            }""", {"cid": cid})
            nodes = items_data.get("items", {}).get("nodes", [])
            results["items_sample_count"] = len(nodes)
            results["items_sample"] = [
                {"handle": n.get("socialProfile", {}).get("accountName"),
                 "url": n.get("archivePublicUrl") or n.get("originalUrl")}
                for n in nodes
            ]
        except Exception as e:
            results["items_sample_error"] = str(e)

    return results

@app.post("/api/archive_sync")
async def archive_sync(req: dict):
    check_auth(req.pop("password", None))

    # Get ALL master list creators (both INT and EXT) for handle lookup
    all_creators = await sb_get("paid_influencers",
        f"?client=eq.{current_client.get()}"
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
    plans = await sb_get("paid_plan", f"?client=eq.{current_client.get()}")
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

    # Step 2: Query posts per campaign
    items_q = """
    query($cid: ID!, $after: String) {
      items(first: 100, after: $after,
            filter: { campaignsIds: [$cid] }) {
        pageInfo { hasNextPage endCursor }
        nodes {
          originalUrl archivePublicUrl
          socialProfile { accountName followers }
          currentEngagement { impressions likes comments shares earnedMediaValue }
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
    live_posts = await sb_get("live_posts", f"?client=eq.{current_client.get()}")
    existing_urls = {(lp.get("live_link") or "").rstrip("/") for lp in live_posts if lp.get("live_link")}
    lp_by_url = {(lp.get("live_link") or "").rstrip("/"): lp for lp in live_posts if lp.get("live_link")}

    # URLs the user explicitly deleted — never re-create these from a sync
    excluded_rows = await sb_get("live_posts_excluded", f"?client=eq.{current_client.get()}")
    excluded_urls = {(e.get("live_link") or "").rstrip("/") for e in excluded_rows if e.get("live_link")}

    synced = 0
    created = 0
    for post in all_posts:
        eng      = post.get("currentEngagement") or {}
        sp       = post.get("socialProfile") or {}
        # Prefer archivePublicUrl (permanent, works for Stories too)
        url      = (post.get("archivePublicUrl") or post.get("originalUrl") or "").rstrip("/")
        handle   = (sp.get("accountName") or "").lower().lstrip("@")
        creator  = handle_to_creator.get(handle)

        # Skip if no URL or creator not in master list
        if not url or not creator:
            continue

        views    = int(eng.get("impressions") or 0)
        likes    = int(eng.get("likes") or 0)
        comments = int(eng.get("comments") or 0)
        shares   = int(eng.get("shares") or 0)

        metrics = {
            "total_views": views, "likes": likes,
            "comments": comments, "shares": shares,
        }

        if url in lp_by_url:
            await sb_patch("live_posts", lp_by_url[url]["id"], metrics)
            synced += 1
        elif url in excluded_urls:
            continue
        elif url not in existing_urls:
            plan          = plan_map.get(creator["id"], {})
            final_rate    = plan.get("accepted_offer")
            deliverable   = detect_deliverable_type(url, "")
            usage         = creator.get("outreach_usage") or plan.get("usage")
            campaign      = creator.get("campaign") or plan.get("campaign")

            await sb_post("live_posts", {
                "client":           current_client.get(),
                "influencer_id":    creator["id"],
                "live_link":        url,
                "campaign":         campaign,
                "deliverable_type": deliverable,
                "usage":            usage,
                "final_rate":       final_rate,
                "total_cost":       final_rate,
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
    influencers = await sb_get("paid_influencers", f"?client=eq.{current_client.get()}")
    paid_plan   = await sb_get("paid_plan",        f"?client=eq.{current_client.get()}")
    live_posts  = await sb_get("live_posts",       f"?client=eq.{current_client.get()}")
    payments    = await sb_get("payment_status",   f"?client=eq.{current_client.get()}")

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

# ── Client registry API (self-service "add a client" for the hub) ────────────
def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())

async def _lookup_archive_workspace_id(name: str) -> str:
    """Best-effort match against Archive's own workspace list by name. Returns
    "" (not an error) if nothing matches — the client still gets created,
    just without Live Posts/Archive sync wired up yet."""
    name_key = name.strip().lower()
    if not name_key:
        return ""
    query = "query($c:String){ workspaces(after:$c){ pageInfo{hasNextPage endCursor} nodes{id name} } }"
    cursor = None
    for _ in range(10):  # ~200 workspaces max, plenty of headroom
        headers = {"Authorization": f"Bearer {ARCHIVE_TOKEN}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(ARCHIVE_URL, json={"query": query, "variables": {"c": cursor}}, headers=headers)
        r.raise_for_status()
        data = r.json().get("data", {}).get("workspaces", {})
        for node in data.get("nodes", []):
            if name_key in (node.get("name") or "").strip().lower():
                return node["id"]
        if not data.get("pageInfo", {}).get("hasNextPage"):
            break
        cursor = data["pageInfo"]["endCursor"]
    return ""

@app.get("/api/clients")
def list_clients():
    return sorted(_clients_cache.values(), key=lambda c: c["display_name"])

class AddClientBody(BaseModel):
    password: Optional[str] = None
    display_name: str
    archive_workspace_name: Optional[str] = ""
    budget_tracker_url: Optional[str] = ""

@app.post("/api/clients")
async def add_client(body: AddClientBody):
    check_auth(body.password)
    display_name = body.display_name.strip()
    slug = _slugify(display_name)
    if not slug:
        raise HTTPException(status_code=400, detail="Client name can't be blank.")
    if slug in _clients_cache:
        raise HTTPException(status_code=400, detail=f"A client called \"{display_name}\" already exists.")

    archive_workspace_id = await _lookup_archive_workspace_id(body.archive_workspace_name or "")

    row = {
        "slug":                 slug,
        "display_name":         display_name,
        "budget_tracker_url":   (body.budget_tracker_url or "").strip(),
        "archive_workspace_id": archive_workspace_id,
    }
    await sb_post("clients", row)
    await refresh_clients_cache()
    return {
        "ok": True,
        "slug": slug,
        "archive_matched": bool(archive_workspace_id),
    }

# ── Serve frontend ────────────────────────────────────────────────────────────
@app.get("/api/app_config")
def app_config(ctx: str = ""):
    client = ctx if ctx in _clients_cache else config.CLIENT
    info = _clients_cache.get(client, {})
    return {
        "client":             client,
        "client_name":        info.get("display_name") or client.title(),
        "budget_tracker_url": info.get("budget_tracker_url") or "",
    }

@app.get("/hub")
def hub():
    return FileResponse(os.path.join(STATIC, "hub.html"))

@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC, "gateway.html"))

@app.get("/{client_slug}/client")
def client_view(client_slug: str):
    if client_slug not in _clients_cache:
        raise HTTPException(status_code=404)
    return FileResponse(os.path.join(STATIC, "client.html"))

@app.get("/{client_slug}")
def client_app(client_slug: str):
    # Any client added via /api/clients works immediately — no new route needed.
    if client_slug in _clients_cache:
        return FileResponse(os.path.join(STATIC, "index.html"))
    # Not a client — fall back to serving it as a static asset (logo.png,
    # style.css, app.js, icon.png, ...) since this route's wildcard would
    # otherwise shadow the StaticFiles mount below for single-segment paths.
    asset_path = os.path.join(STATIC, client_slug)
    if os.path.isfile(asset_path):
        return FileResponse(asset_path)
    raise HTTPException(status_code=404)

app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
