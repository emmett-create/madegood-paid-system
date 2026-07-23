"""
Agency 8 Paid System — configuration
One codebase, multiple client deployments via env vars.
"""

import os

# Supabase (shared DB — all clients separated by the `client` column)
SUPABASE_URL = os.environ.get("SUPABASE_URL") or "https://yuzlovqavpeoannfiqka.supabase.co"
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or ""

# Which client this deployment serves: "madegood" | "magna" | "evolvetogether"
CLIENT = os.environ.get("PAID_CLIENT", "madegood")

# Passwords — all deployments share the same internal password for hub auto-auth
APP_PASSWORD    = os.environ.get("APP_PASSWORD", "a8paid123")
CLIENT_PASSWORD = os.environ.get("CLIENT_PASSWORD", "client")

# Display name shown in the header
CLIENT_NAME = os.environ.get("CLIENT_NAME", {
    "madegood":      "MadeGood",
    "magna":         "Magna",
    "evolvetogether": "EvolveTogether",
}.get(CLIENT, CLIENT.title()))

# Budget tracker iframe URL (GitHub Pages) — leave empty if none
BUDGET_TRACKER_URL = os.environ.get("BUDGET_TRACKER_URL", {
    "madegood":       "https://emmett-create.github.io/madegood-budget-tracker/",
    "evolvetogether": "https://emmett-create.github.io/evolvetogether-budget-tracker/",
    "magna":          "",
}.get(CLIENT, ""))

# MadeGood budget tracker Supabase (read-only, only used when CLIENT=madegood)
MG_BUDGET_URL = "https://rieakopaagjwbueghsju.supabase.co"
MG_BUDGET_KEY = "sb_publishable_BmVmEjYrHQUTJxTUKZHfUQ_PPfnQAWy"
MG_BUDGET_TABLE = "madegood_budget_entries"
MG_BUDGET_CAMPAIGNS = {
    "a8_paid":       {"label": "A8 Paid Influencers",       "budget": 0},
    "madegood_paid": {"label": "MadeGood Paid Influencers",  "budget": 0},
    "shipping":      {"label": "Shipping & PR Mailers",      "budget": 0},
}
MG_TOTAL_BUDGET = 500_000
