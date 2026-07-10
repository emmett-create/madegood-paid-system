"""
MadeGood Paid System — configuration
"""

import os

# Supabase (new project for paid system tables)
# Set these in Render env vars; for local dev they come from ~/.env.shared
SUPABASE_URL = os.environ.get("SUPABASE_URL") or "https://yuzlovqavpeoannfiqka.supabase.co"
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or ""

# MadeGood budget tracker Supabase (existing project — read-only for the budget tab)
MG_BUDGET_URL = "https://rieakopaagjwbueghsju.supabase.co"
MG_BUDGET_KEY = "sb_publishable_BmVmEjYrHQUTJxTUKZHfUQ_PPfnQAWy"
MG_BUDGET_TABLE = "madegood_budget_entries"
MG_BUDGET_CAMPAIGNS = {
    "a8_paid":       {"label": "A8 Paid Influencers",       "budget": 0},
    "madegood_paid": {"label": "MadeGood Paid Influencers",  "budget": 0},
    "shipping":      {"label": "Shipping & PR Mailers",      "budget": 0},
}
MG_TOTAL_BUDGET = 500_000

APP_PASSWORD    = os.environ.get("APP_PASSWORD", "a8paid123")
CLIENT_PASSWORD = os.environ.get("CLIENT_PASSWORD", "client")

# Client identifier (for future multi-client support)
CLIENT = "madegood"
