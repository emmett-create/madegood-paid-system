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
    # When removing from paid plan, cascade-delete the plan record
    if req.get("in_paid_plan") is False:
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
    result = []
    for inf in influencers:
        p = plan_map.get(inf["id"], {})
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
            },
            "status": p.get("status"),
            "campaign": p.get("campaign"),
            "platform_format": p.get("platform_format"),
            "usage": p.get("usage"),
            "exclusivity": p.get("exclusivity"),
            "ig_reels_impressions": p.get("ig_reels_impressions"),
            "ig_stories_impressions": p.get("ig_stories_impressions"),
            "tt_impressions": p.get("tt_impressions"),
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
        })
    return result

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
    return await sb_get("paid_influencers",
        f"?client=eq.{config.CLIENT}&order=name.asc"
        f"&select=id,name,ig_handle,ig_url,tt_handle,tt_url,ig_followers,tt_followers,"
        f"list_type,tier,vertical,archetype,location,gender,email,"
        f"outreach_status,outreach_owner,outreach_date,last_contact,outreach_notes,in_paid_plan")

# ── Content Calendar ─────────────────────────────────────────────────────────
@app.get("/api/content_calendar")
async def get_content_calendar():
    rows = await sb_get("content_calendar",
        f"?client=eq.{config.CLIENT}&order=scheduled_date.asc")
    influencers = await sb_get("paid_influencers",
        f"?client=eq.{config.CLIENT}&select=id,name,ig_handle")
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

# ── Content Review ────────────────────────────────────────────────────────────
@app.get("/api/content_review")
async def get_content_review():
    rows = await sb_get("content_review",
        f"?client=eq.{config.CLIENT}&order=content_due_date.asc")
    influencers = await sb_get("paid_influencers",
        f"?client=eq.{config.CLIENT}&select=id,name,ig_handle")
    inf_map = {i["id"]: i for i in influencers}
    for r in rows:
        r["influencer"] = inf_map.get(r["influencer_id"], {})
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

# ── Live Posts ────────────────────────────────────────────────────────────────
@app.get("/api/live_posts")
async def get_live_posts():
    rows = await sb_get("live_posts",
        f"?client=eq.{config.CLIENT}&order=live_date.desc")
    influencers = await sb_get("paid_influencers",
        f"?client=eq.{config.CLIENT}&select=id,name,ig_handle")
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
