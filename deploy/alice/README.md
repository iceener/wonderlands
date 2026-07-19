# overment.ai deployment

This repo deploys the Wonderlands app with a self-hosted GitHub Actions runner in `~/wonderlands`, supervised by PM2 (not systemd) as a single process named `wonderlands-app`.

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
chmod 700 ~/wonderlands/shared
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

`overment.ai` (apex) is the canonical host. Point `overment.ai`, `www.overment.ai`, and `alice.overment.ai` DNS at the VPS, then run the nginx setup script from this repo on the VPS:

```bash
sudo EMAIL=you@example.com bash deploy/alice/setup-nginx.sh
```

The script installs nginx/certbot, creates a temporary HTTP-only site for the Let's Encrypt challenge covering all three hostnames, requests a certificate for `overment.ai` with `www.overment.ai` and `alice.overment.ai` as subject alternative names, then installs `deploy/alice/nginx-overment.ai.conf`.

Routing:

- `overment.ai/ai/` and `overment.ai/ai/assets/` serve the built Svelte client directly from nginx
- `overment.ai/` (everything else) proxies to the app (PM2 process `wonderlands-app`) on `127.0.0.1:3001`
- `www.overment.ai` and `alice.overment.ai` return a 301 redirect to the equivalent `overment.ai` path
