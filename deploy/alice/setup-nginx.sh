#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-alice.overment.ai}"
EMAIL="${EMAIL:-}"
WEBROOT="${WEBROOT:-/var/www/letsencrypt}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PRODUCTION_CONF="$REPO_ROOT/deploy/alice/nginx-${DOMAIN}.conf"
SITE_AVAILABLE="/etc/nginx/sites-available/${DOMAIN}"
SITE_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"
BOOTSTRAP_CONF="/etc/nginx/sites-available/${DOMAIN}.bootstrap"

if [[ "$EUID" -ne 0 ]]; then
  echo "Run with sudo: sudo DOMAIN=${DOMAIN} EMAIL=you@example.com bash deploy/alice/setup-nginx.sh" >&2
  exit 1
fi

if [[ ! -f "$PRODUCTION_CONF" ]]; then
  echo "Missing production nginx config: $PRODUCTION_CONF" >&2
  exit 1
fi

echo "Installing nginx and certbot..."
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y nginx certbot

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
  ufw allow 'Nginx Full'
fi

mkdir -p "$WEBROOT"
chown -R www-data:www-data "$WEBROOT"

cat > "$BOOTSTRAP_CONF" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root ${WEBROOT};
    }

    location / {
        default_type text/plain;
        return 200 "nginx bootstrap for ${DOMAIN}\n";
    }
}
NGINX

rm -f /etc/nginx/sites-enabled/default
ln -sfn "$BOOTSTRAP_CONF" "$SITE_ENABLED"

nginx -t
systemctl enable nginx
systemctl reload nginx || systemctl restart nginx

if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  echo "Requesting Let's Encrypt certificate for ${DOMAIN}..."
  if [[ -n "$EMAIL" ]]; then
    certbot certonly \
      --webroot \
      --webroot-path "$WEBROOT" \
      --domain "$DOMAIN" \
      --email "$EMAIL" \
      --agree-tos \
      --non-interactive
  else
    certbot certonly \
      --webroot \
      --webroot-path "$WEBROOT" \
      --domain "$DOMAIN" \
      --register-unsafely-without-email \
      --agree-tos \
      --non-interactive
  fi
else
  echo "Certificate already exists for ${DOMAIN}; skipping certbot issuance."
fi

cp "$PRODUCTION_CONF" "$SITE_AVAILABLE"
ln -sfn "$SITE_AVAILABLE" "$SITE_ENABLED"
rm -f "$BOOTSTRAP_CONF"

nginx -t
systemctl reload nginx

echo "nginx is configured for https://${DOMAIN}"
echo "Expected upstreams:"
echo "  app server:         http://127.0.0.1:3000"
echo "  Pulse API:          http://127.0.0.1:3737"
