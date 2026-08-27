"""
Agency 8 Paid System — configuration
One codebase, multiple client deployments via env vars.
"""

import os

# Supabase (shared DB — all clients separated by the `client` column)
SUPABASE_URL = os.environ.get("SUPABASE_URL") or "https://yuzlovqavpeoannfiqka.supabase.co"
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or ""

# Which client this deployment serves: "madegood" | "magna" | "evolvetogether" | "stardust"
CLIENT = os.environ.get("PAID_CLIENT", "madegood")

# Passwords — all deployments share the same internal password for hub auto-auth
APP_PASSWORD    = os.environ.get("APP_PASSWORD", "a8paid123")
CLIENT_PASSWORD = os.environ.get("CLIENT_PASSWORD", "client")

# Anthropic API — used for screenshot-to-numbers extraction (Paid Plan impressions upload)
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")

# Display name shown in the header
CLIENT_NAME = os.environ.get("CLIENT_NAME", {
    "madegood":      "MadeGood",
    "magna":         "Magna",
    "evolvetogether": "EvolveTogether",
    "stardust":      "Stardust",
    "tacbrand":      "The Absorption Company (Brand)",
    "tacgrowth":     "The Absorption Company (Growth)",
}.get(CLIENT, CLIENT.title()))

# Archive workspace UUID per client (all use the same token)
ARCHIVE_WORKSPACE = os.environ.get("ARCHIVE_WORKSPACE", {
    "madegood":       "0cec8ea5-c3b3-4bb1-8083-eaab65719f8e",
    "magna":          "1a9f4270-c1c5-4dde-bcfa-3040589e9184",
    "evolvetogether": "c8493a78-3eb0-4bad-9567-70dc2dc76e98",
    "stardust":       "d7413c10-4ac9-4a69-b7a6-0e0babaad8a1",
    "tacbrand":       "77b77ba7-db31-44d2-819d-cc710cb89289",
    "tacgrowth":      "77b77ba7-db31-44d2-819d-cc710cb89289",
}.get(CLIENT, ""))

# Budget tracker iframe URL (GitHub Pages) — leave empty if none
BUDGET_TRACKER_URL = os.environ.get("BUDGET_TRACKER_URL", {
    "madegood":       "https://emmett-create.github.io/madegood-budget-tracker/",
    "evolvetogether": "https://emmett-create.github.io/evolvetogether-budget-tracker/",
    "magna":          "",
    "stardust":       "https://emmett-create.github.io/stardust-budget-tracker/",
    "tacbrand":       "",
    "tacgrowth":      "",
}.get(CLIENT, ""))

# Google Sheets (read-only) — used by the legacy-spreadsheet import wizard.
# Same shared service account used across every other Agency 8 tool. On
# Render, set GOOGLE_CREDENTIALS_JSON to the full JSON key content; locally
# falls back to the file already on disk from the other tools.
GOOGLE_CREDENTIALS_JSON = os.environ.get("GOOGLE_CREDENTIALS_JSON", "")
GOOGLE_CREDENTIALS_FILE = os.environ.get(
    "GOOGLE_CREDENTIALS_FILE",
    "/Users/emmett/agency8-influencer-tool/google-credentials.json",
)

# Lumanu (creator payments/tax-compliance/payouts) — Agency 8's own workspace
# pays vendors on behalf of every client (Platform-Mediated model). Read-only
# for now: pulls payables into the Payment Status tab, never creates/approves.
LUMANU_CLIENT_ID     = os.environ.get("LUMANU_CLIENT_ID", "py3N4HQFhYTC5FazB6nwA0DQjAzlvCmX")
LUMANU_CLIENT_SECRET = os.environ.get("LUMANU_CLIENT_SECRET", "xW_zSDiS0ofRxei_aEyDt2oheP5iwVzQNap4K0wjv1bkj5okNIJz5hSkvT44ukbF")
LUMANU_TOKEN_URL     = os.environ.get("LUMANU_TOKEN_URL", "https://auth.lumanu.com/oauth/token")
LUMANU_AUDIENCE      = os.environ.get("LUMANU_AUDIENCE", "https://lumanu-prod.hasura.app/v1/graphql")
LUMANU_API_BASE      = os.environ.get("LUMANU_API_BASE", "https://api.lumanu.com/api/rest")
LUMANU_WORKSPACE_ID  = os.environ.get("LUMANU_WORKSPACE_ID", "33a5c5e2-a2f5-4f92-a8d2-26335d59996a")

# Lumanu's QuickBooks sync requires a custom "GL Accounts" + "Invoice Date"
# value on every payable — not documented as required, discovered by trial.
# GL Account is an accounting classification, so it's per-client data (lives
# in the `clients` Supabase table as `lumanu_gl_account`, not here) — a
# client with no value set there can't send payables to Lumanu.
LUMANU_GL_ACCOUNT_POLICY_ID   = os.environ.get("LUMANU_GL_ACCOUNT_POLICY_ID", "4d245d2d-4533-428a-9a70-e88b22e84e47")
LUMANU_INVOICE_DATE_POLICY_ID = os.environ.get("LUMANU_INVOICE_DATE_POLICY_ID", "59915149-a154-41bf-820c-c4bb5ddf714d")

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
