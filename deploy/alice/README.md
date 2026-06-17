# alice.overment.ai deployment

This repo deploys the main Wonderlands app with a self-hosted GitHub Actions runner in `~/wonderlands`.
The companion `~/wonderlands-pulse` event API deploys with its own runner and is proxied at `/pulse/`.

## GitHub runner

This workflow expects a repo self-hosted runner installed under `~/wonderlands` and running as the `alice` user. No VPS SSH deployment secrets are required for this workflow.

## One-time VPS setup

Install runtime packages:

```bash
sudo apt update
sudo apt install -y nginx rsync
# Install Node.js 24 by your preferred method, then verify:
node --version
npm --version
```

Create deployment directories:

```bash
mkdir -p ~/wonderlands/shared/var/files ~/wonderlands/shared/tmp
mkdir -p ~/wonderlands-pulse/shared/data
chmod 700 ~/wonderlands/shared ~/wonderlands-pulse/shared
```

Create `~/wonderlands/shared/server.env` from `deploy/alice/server.env.example` and fill secrets.
If you use MCP servers in the app, create `~/wonderlands/shared/.mcp-servers.json` too.

GitHub Actions starts/restarts the app with PM2 as `wonderlands-app`. If you need to do it manually after a checkout exists:

```bash
cd ~/wonderlands/current/apps/server
pm2 start npm --name wonderlands-app -- run start
pm2 save
```

## Nginx / domain

Point `alice.overment.ai` DNS to the VPS, then run the nginx setup script from this repo on the VPS:

```bash
sudo EMAIL=you@example.com bash deploy/alice/setup-nginx.sh
```

The script installs nginx/certbot, creates a temporary HTTP-only site for the Let's Encrypt challenge, requests the certificate, then installs `deploy/alice/nginx-alice.overment.ai.conf`.

Routing:

- `/ai/` serves the built Svelte client
- `/` and `/api` proxy to the main app API on `127.0.0.1:3001`
- `/pulse/` proxies to Wonderlands Pulse on `127.0.0.1:3737`

External event registration URL:

```txt
POST https://alice.overment.ai/pulse/api/events
x-api-key: <Wonderlands Pulse API_KEY>
```
