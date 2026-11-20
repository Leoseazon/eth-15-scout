# V3 Single-User Login — One-Time Setup

This applies only to the **V3** paper-only dashboard at https://leoseazon.github.io/eth-15-scout/v3/. It does not modify the existing V2 site, the Kalshi quote proxy, or the V3 trading account/database.

## What it does

- You choose **one username and one password**, privately on your own Windows computer.
- Cloudflare stores them in **encrypted Worker secrets**, not in GitHub or the public website code.
- You sign in to the dashboard using those exact credentials.
- Check **Remember this device for 30 days** to stay signed in after page refreshes and browser restarts on that device. The browser stores **only a signed, read-only session token**, not your password.
- After 30 days you sign in again with the **same username and password**. The credentials do not automatically rotate.
- Use **Sign out** to clear that browser's saved session.

## First-time Cloudflare deployment

**The code is prepared and CI-tested, but the gateway still needs to be deployed to your Cloudflare account.** You must do the following locally.

Open PowerShell on the Windows computer with your existing repository and Cloudflare Wrangler login:

```powershell
cd C:\Users\Admin\KalshiBot\eth-15-scout
git fetch origin
git switch v3-dashboard-gateway-20261119
git pull origin v3-dashboard-gateway-20261119
cd cloud
powershell -ExecutionPolicy Bypass -File .\deploy-viewer.ps1
```

The script checks the read-only Worker, deploys **eth-15-scout-v3-view** only, and asks for your username and password locally (password entry hidden). It also creates a random signing key. Your credentials are never displayed in chat or code. Choose a long unique password (minimum 16 characters).

**Do not paste passwords, session secrets, tokens or authenticated dashboard responses into ChatGPT or screenshots.** Only share non-sensitive success/error status.

The new viewer Worker requires access to the existing V3 Durable Object. The new archival `/v1/journal` endpoint is code-complete but **not yet deployed to the running V3 script**. The gateway can display the existing status and history read endpoints before that separately reviewed change, but full WATCH/PASS pagination and audio alerts need the new journal endpoint deployed safely.

## What remains after script completion

1. Load the V3 website and use the username/password that you just set locally.
2. Confirm current bot monitor/arm state and actual stored paper totals.
3. Safely deploy and verify the new V3 journal endpoint **without accidentally resetting V3 or changing `SCOUT_PAPER_MODE`**. The tracked baseline config defaults to disabled; do not run an unreviewed V3 deploy.
4. Verify full research CSV/JSON exports and distinct optional paper BUY / SELL sounds.

The **private login backend is not active** until the Cloudflare script succeeds. A completed GitHub Pages build publishes only the sign-in interface, not the private backend.
