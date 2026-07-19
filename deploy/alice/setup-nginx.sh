#!/usr/bin/env bash
set -euo pipefail

# Canonical host: overment.ai (apex). This installs the single nginx site
# defined in deploy/alice/nginx-overment.ai.conf, which also handles
# redirects from www.overment.ai and alice.overment.ai to the apex.
DOMAIN="${DOMAIN:-overment.ai}"
ALT_DOMAINS="${ALT_DOMAINS:-www.overment.ai,alice.overment.ai}"
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

# Build the full list of hostnames the certificate must cover: the apex plus
# any comma-separated alt domains (www.overment.ai, alice.overment.ai).
ALL_DOMAINS=("$DOMAIN")
if [[ -n "$ALT_DOMAINS" ]]; then
  IFS=',' read -r -a EXTRA <<<"$ALT_DOMAINS"
  for d in "${EXTRA[@]}"; do
    d="$(echo "$d" | xargs)"
    [[ -n "$d" ]] && ALL_DOMAINS+=("$d")
  done
fi

CERTBOT_DOMAIN_ARGS=()
SERVER_NAMES=""
for d in "${ALL_DOMAINS[@]}"; do
  CERTBOT_DOMAIN_ARGS+=(--domain "$d")
  SERVER_NAMES="${SERVER_NAMES}${SERVER_NAMES:+ }${d}"
done

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
    server_name ${SERVER_NAMES};

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

CERT_PATH="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
CERT_NEEDS_ISSUANCE=false
CERT_NEEDS_EXPANSION=false

if [[ ! -f "$CERT_PATH" ]]; then
  CERT_NEEDS_ISSUANCE=true
else
  for d in "${ALL_DOMAINS[@]}"; do
    if ! openssl x509 -in "$CERT_PATH" -noout -checkhost "$d" >/dev/null 2>&1; then
      CERT_NEEDS_EXPANSION=true
      break
    fi
  done
fi

if [[ "$CERT_NEEDS_ISSUANCE" == true || "$CERT_NEEDS_EXPANSION" == true ]]; then
  CERTBOT_ARGS=(
    certonly
    --webroot
    --webroot-path "$WEBROOT"
    --cert-name "$DOMAIN"
    "${CERTBOT_DOMAIN_ARGS[@]}"
    --agree-tos
    --non-interactive
  )

  if [[ "$CERT_NEEDS_EXPANSION" == true ]]; then
    echo "Expanding the existing ${DOMAIN} certificate to cover: ${SERVER_NAMES}"
    CERTBOT_ARGS+=(--expand)
  else
    echo "Requesting Let's Encrypt certificate for: ${SERVER_NAMES}"
  fi

  if [[ -n "$EMAIL" ]]; then
    CERTBOT_ARGS+=(--email "$EMAIL")
  elif [[ "$CERT_NEEDS_ISSUANCE" == true ]]; then
    CERTBOT_ARGS+=(--register-unsafely-without-email)
  fi

  certbot "${CERTBOT_ARGS[@]}"
else
  echo "Existing ${DOMAIN} certificate already covers: ${SERVER_NAMES}"
fi

cp "$PRODUCTION_CONF" "$SITE_AVAILABLE"
ln -sfn "$SITE_AVAILABLE" "$SITE_ENABLED"
rm -f "$BOOTSTRAP_CONF"

nginx -t
systemctl reload nginx

echo "nginx is configured for https://${DOMAIN} (with redirects from ${ALT_DOMAINS})"
echo "Expected upstream:"
echo "  app server (PM2 process wonderlands-app): http://127.0.0.1:3001"
