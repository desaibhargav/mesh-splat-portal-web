#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_ROOT="${WEB_ROOT:-/var/www/mesh-splat-portal}"
SITE_NAME="${SITE_NAME:-mesh-splat-portal}"
SITE_AVAILABLE="/etc/nginx/sites-available/$SITE_NAME"
SITE_ENABLED="/etc/nginx/sites-enabled/$SITE_NAME"
BACKEND_ORIGIN="${BACKEND_ORIGIN:-}"

cd "$APP_ROOT"

git pull --ff-only
npm ci
npm run build

sudo mkdir -p "$WEB_ROOT"
sudo rsync -a --delete dist/ "$WEB_ROOT/"
sudo chown -R www-data:www-data "$WEB_ROOT"

if [[ -n "$BACKEND_ORIGIN" ]]; then
  sudo tee "$SITE_AVAILABLE" >/dev/null <<EOF
server {
    listen 80;
    server_name _;

    root $WEB_ROOT;
    index index.html;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location /api/ {
        proxy_pass $BACKEND_ORIGIN/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /files/ {
        proxy_pass $BACKEND_ORIGIN/files/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Range \$http_range;
        proxy_set_header If-Range \$http_if_range;
        proxy_buffering off;
        proxy_cache off;
        proxy_store off;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
else
  sudo tee "$SITE_AVAILABLE" >/dev/null <<EOF
server {
    listen 80;
    server_name _;

    root $WEB_ROOT;
    index index.html;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
fi

sudo ln -sfn "$SITE_AVAILABLE" "$SITE_ENABLED"
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

echo "Deployed mesh-splat-portal-web to $WEB_ROOT"
