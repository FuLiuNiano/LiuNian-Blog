#!/usr/bin/env bash
set -Eeuo pipefail

# Leaf Blog 一键部署脚本（Ubuntu / Debian）
# 示例：sudo bash deploy.sh --domain blog.example.com

BLOG_APP_DIR="${BLOG_APP_DIR:-/srv/leaf-blog}"
BLOG_USER="${BLOG_USER:-leaf}"
BLOG_DOMAIN="${BLOG_DOMAIN:-}"
BLOG_PORT="${BLOG_PORT:-}"
BLOG_PORT_EXPLICIT=false
if [[ -n "$BLOG_PORT" ]]; then
  BLOG_PORT_EXPLICIT=true
else
  BLOG_PORT=8080
fi
BLOG_ENABLE_HTTPS="${BLOG_ENABLE_HTTPS:-false}"
BLOG_HTTPS_EMAIL="${BLOG_HTTPS_EMAIL:-}"
BLOG_CONFIGURE_NGINX="${BLOG_CONFIGURE_NGINX:-true}"
BLOG_STATE_DIR="${BLOG_STATE_DIR:-/var/lib/leaf-blog}"
BLOG_BACKUP_DIR="${BLOG_BACKUP_DIR:-/var/backups/leaf-blog}"
BLOG_SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOG_GROUP=""
BLOG_NODE_BIN=""
BLOG_NPM_BIN=""

log() { printf '[leaf-blog] %s\n' "$*"; }
warn() { printf '[warning] %s\n' "$*" >&2; }
die() { printf '[error] %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Leaf Blog 一键部署
  sudo bash deploy.sh --domain blog.example.com

选项：
  --domain NAME        域名；不填写时交互询问
  --app-dir PATH       项目目录，默认 /srv/leaf-blog
  --user NAME          运行用户，默认 leaf
  --port NUMBER        Node 本机端口，默认 8080
  --https-email EMAIL  申请 HTTPS 证书的邮箱
  --https              自动申请 HTTPS
  --no-nginx            不安装或配置系统 Nginx（使用 1Panel 反向代理）
  --help               显示帮助

脚本不会删除数据库、JSON、文章或备份，也不会覆盖已有 .env。
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) [[ $# -ge 2 ]] || die "--domain 需要一个值"; BLOG_DOMAIN="$2"; shift 2 ;;
    --app-dir) [[ $# -ge 2 ]] || die "--app-dir 需要一个值"; BLOG_APP_DIR="$2"; shift 2 ;;
    --user) [[ $# -ge 2 ]] || die "--user 需要一个值"; BLOG_USER="$2"; shift 2 ;;
    --port) [[ $# -ge 2 ]] || die "--port 需要一个值"; BLOG_PORT="$2"; BLOG_PORT_EXPLICIT=true; shift 2 ;;
    --https-email) [[ $# -ge 2 ]] || die "--https-email 需要一个值"; BLOG_HTTPS_EMAIL="$2"; shift 2 ;;
    --https) BLOG_ENABLE_HTTPS=true; shift ;;
    --no-nginx) BLOG_CONFIGURE_NGINX=false; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "未知选项：$1（使用 --help 查看用法）" ;;
  esac
done

[[ "$(id -u)" == "0" ]] || die "请使用 sudo 运行"
[[ -f "$BLOG_SOURCE_DIR/server.js" ]] || die "脚本必须放在 leaf-blog 项目根目录"
[[ "$BLOG_APP_DIR" = /* && "$BLOG_STATE_DIR" = /* && "$BLOG_BACKUP_DIR" = /* ]] || die "目录必须使用绝对路径"
[[ "$BLOG_APP_DIR" != *' '* && "$BLOG_STATE_DIR" != *' '* && "$BLOG_BACKUP_DIR" != *' '* ]] || die "部署目录不能包含空格"
[[ "$BLOG_PORT" =~ ^[0-9]+$ && "$BLOG_PORT" -ge 1 && "$BLOG_PORT" -le 65535 ]] || die "端口必须是 1-65535 之间的数字"
[[ "$BLOG_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || die "运行用户名称不合法"
[[ -f /etc/debian_version && -x "$(command -v apt-get || true)" ]] || die "此脚本只支持 Ubuntu / Debian"

if [[ -z "$BLOG_DOMAIN" ]]; then
  [[ -t 0 ]] || die "非交互执行时必须提供 --domain"
  read -r -p "请输入博客域名： " BLOG_DOMAIN
fi
[[ "$BLOG_DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || die "域名格式不合法"

if [[ "$BLOG_ENABLE_HTTPS" == true && "$BLOG_CONFIGURE_NGINX" != true ]]; then
  die "使用 --no-nginx 时请在 1Panel 中配置 HTTPS，不要同时使用 --https"
fi

package_installed() { dpkg-query -s "$1" >/dev/null 2>&1; }
install_missing_packages() {
  local missing=()
  local package_name
  for package_name in "$@"; do
    package_installed "$package_name" || missing+=("$package_name")
  done
  if ((${#missing[@]} == 0)); then
    log "系统依赖已存在，跳过安装"
  else
    log "安装缺少的系统依赖：${missing[*]}"
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y "${missing[@]}"
  fi
}

system_packages=(redis-server redis-tools sqlite3 git curl ca-certificates build-essential rsync openssl)
if [[ "$BLOG_CONFIGURE_NGINX" == true ]]; then
  system_packages+=(nginx)
fi
install_missing_packages "${system_packages[@]}"

node_major=0
if command -v node >/dev/null 2>&1; then node_major="$(node -p "Number(process.versions.node.split('.')[0])")"; fi
if [[ "$node_major" =~ ^[0-9]+$ ]] && ((node_major >= 22)) && command -v npm >/dev/null 2>&1; then
  log "Node.js $(node --version) 和 npm 已存在，跳过安装"
else
  log "安装 Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi
BLOG_NODE_BIN="$(command -v node)"
BLOG_NPM_BIN="$(command -v npm)"
(($(node -p "Number(process.versions.node.split('.')[0])") >= 22)) || die "Node.js 版本低于 22"

if id "$BLOG_USER" >/dev/null 2>&1; then
  log "运行用户 $BLOG_USER 已存在，跳过创建"
else
  useradd --system --user-group --home-dir "$BLOG_APP_DIR" --shell /usr/sbin/nologin "$BLOG_USER"
fi
BLOG_GROUP="$(id -gn "$BLOG_USER")"

systemctl stop leaf-blog.service >/dev/null 2>&1 || true
install -d -o "$BLOG_USER" -g "$BLOG_GROUP" "$BLOG_APP_DIR" "$BLOG_STATE_DIR" "$BLOG_BACKUP_DIR"
if [[ "$BLOG_SOURCE_DIR" != "$BLOG_APP_DIR" ]]; then
  rsync -a \
    --exclude '.env' --exclude 'node_modules/' --exclude '.run/' --exclude 'logs/' --exclude 'backups/' \
    --exclude 'data/*.db' --exclude 'data/*.db-*' \
    --exclude 'data/users.json' --exclude 'data/comments.json' --exclude 'data/guestbook.json' --exclude 'data/journals.json' \
    --exclude 'data/state.json' --exclude 'data/site.json' --exclude 'public/uploads/' \
    "$BLOG_SOURCE_DIR/" "$BLOG_APP_DIR/"
fi

if [[ ! -f "$BLOG_APP_DIR/.env" ]]; then
  [[ -t 0 ]] || die "未找到 .env；非交互执行请先创建 $BLOG_APP_DIR/.env"
  read -r -p "后台管理员 QQ 号： " BLOG_ADMIN_ACCOUNT
  while true; do
    read -r -s -p "后台密码（至少 8 位，建议 20 位以上）： " BLOG_ADMIN_PASSWORD
    printf '\n'
    [[ ${#BLOG_ADMIN_PASSWORD} -ge 8 ]] && break
    warn "密码长度不足 8 位"
  done
  read -r -p "SMTP QQ 邮箱（可留空）： " BLOG_SMTP_USER
  BLOG_SMTP_PASS=""
  BLOG_SMTP_FROM=""
  if [[ -n "$BLOG_SMTP_USER" ]]; then
    read -r -s -p "SMTP 授权码： " BLOG_SMTP_PASS
    printf '\n'
    read -r -p "SMTP 发件人（回车使用 SMTP 邮箱）： " BLOG_SMTP_FROM
    BLOG_SMTP_FROM="${BLOG_SMTP_FROM:-$BLOG_SMTP_USER}"
  fi
  read -r -p "域名黑名单（可留空，逗号分隔）： " BLOG_LINK_BLOCKLIST
  BLOG_OTP_SECRET="$(openssl rand -hex 32)"
  install -m 600 -o "$BLOG_USER" -g "$BLOG_GROUP" /dev/null "$BLOG_APP_DIR/.env"
  cat > "$BLOG_APP_DIR/.env" <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=$BLOG_PORT
TRUST_PROXY=true
DB_PATH=$BLOG_STATE_DIR/leaf-blog.db
REDIS_URL=redis://127.0.0.1:6379
ADMIN_ACCOUNT=$BLOG_ADMIN_ACCOUNT
ADMIN_PASSWORD=$BLOG_ADMIN_PASSWORD
BACKUP_ENABLED=true
BACKUP_INTERVAL_HOURS=24
BACKUP_KEEP=7
BACKUP_DIR=$BLOG_BACKUP_DIR
VIEW_DEDUP_MINUTES=30
LINK_BLOCKLIST=$BLOG_LINK_BLOCKLIST
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=$BLOG_SMTP_USER
SMTP_PASS=$BLOG_SMTP_PASS
SMTP_FROM=$BLOG_SMTP_FROM
OTP_TTL_MINUTES=5
OTP_HASH_SECRET=$BLOG_OTP_SECRET
OTP_EMAIL_DAILY_LIMIT=10
OTP_IP_DAILY_LIMIT=10
OTP_GLOBAL_DAILY_LIMIT=500
EOF
  chmod 600 "$BLOG_APP_DIR/.env"
else
  log "已有 .env，跳过生成和覆盖"
fi

chown -R "$BLOG_USER:$BLOG_GROUP" "$BLOG_APP_DIR" "$BLOG_STATE_DIR" "$BLOG_BACKUP_DIR"
chmod 600 "$BLOG_APP_DIR/.env"

env_port_from_file=""
if grep -qE '^[[:space:]]*PORT[[:space:]]*=' "$BLOG_APP_DIR/.env"; then
  env_port_from_file="$(sed -nE 's/^[[:space:]]*PORT[[:space:]]*=([0-9]+)[[:space:]]*$/\1/p' "$BLOG_APP_DIR/.env" | head -n 1)"
  [[ "$env_port_from_file" =~ ^[0-9]+$ ]] || die "$BLOG_APP_DIR/.env 中的 PORT 必须是数字"
  if [[ "$BLOG_PORT_EXPLICIT" != true ]]; then
    BLOG_PORT="$env_port_from_file"
  fi
fi
[[ "$BLOG_PORT" =~ ^[0-9]+$ && "$BLOG_PORT" -ge 1 && "$BLOG_PORT" -le 65535 ]] || die "端口必须是 1-65535 之间的数字"

set_env_port() {
  local env_file="$1"
  if grep -qE '^[[:space:]]*PORT[[:space:]]*=' "$env_file"; then
    sed -i -E "s/^[[:space:]]*PORT[[:space:]]*=.*/PORT=$BLOG_PORT/" "$env_file"
  else
    printf '\nPORT=%s\n' "$BLOG_PORT" >> "$env_file"
  fi
}
if [[ "$BLOG_PORT_EXPLICIT" == true || -z "$env_port_from_file" ]]; then
  set_env_port "$BLOG_APP_DIR/.env"
fi
runuser -u "$BLOG_USER" -- "$BLOG_NPM_BIN" ci --omit=dev --prefix "$BLOG_APP_DIR"

systemctl enable --now redis-server.service
[[ "$(redis-cli ping 2>/dev/null || true)" == "PONG" ]] || die "Redis 未正常响应"

cat > /etc/systemd/system/leaf-blog.service <<EOF
[Unit]
Description=Leaf Blog
After=network-online.target redis-server.service
Wants=network-online.target
[Service]
Type=simple
User=$BLOG_USER
Group=$BLOG_GROUP
WorkingDirectory=$BLOG_APP_DIR
ExecStart=$BLOG_NODE_BIN $BLOG_APP_DIR/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=$BLOG_APP_DIR/data $BLOG_STATE_DIR $BLOG_BACKUP_DIR
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now leaf-blog.service

if [[ "$BLOG_CONFIGURE_NGINX" == true ]]; then
cat > /etc/nginx/sites-available/leaf-blog <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $BLOG_DOMAIN;
    location ~ ^/(?:\.env(?:$|/)|data(?:/|$)|logs(?:/|$)|backups(?:/|$)|\.git(?:/|$)|node_modules(?:/|$)) { return 404; }
    location / {
        proxy_pass http://127.0.0.1:$BLOG_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
        client_max_body_size 2m;
    }
}
EOF

nginx_link=/etc/nginx/sites-enabled/leaf-blog
if [[ -e "$nginx_link" && ! -L "$nginx_link" ]]; then die "$nginx_link 已是普通文件，请手动处理"; fi
ln -sfn /etc/nginx/sites-available/leaf-blog "$nginx_link"
nginx -t
systemctl enable --now nginx.service
systemctl reload nginx.service
else
  log "已跳过系统 Nginx；请在 1Panel 中将域名反向代理到 http://127.0.0.1:$BLOG_PORT"
fi

healthy=false
for _ in {1..30}; do
  if curl -fsS "http://127.0.0.1:$BLOG_PORT/api/health" >/dev/null; then healthy=true; break; fi
  sleep 1
done
[[ "$healthy" == true ]] || { journalctl -u leaf-blog -n 80 --no-pager >&2 || true; die "Leaf Blog 启动失败"; }

if ! journalctl -u leaf-blog -n 40 --no-pager | grep -q '共享状态：Redis'; then
  warn "服务已启动，但日志没有显示 Redis；请检查 .env"
fi
if runuser -u "$BLOG_USER" -- "$BLOG_NPM_BIN" run check-links --prefix "$BLOG_APP_DIR"; then
  log "外部资源检查通过"
else
  warn "发现外部资源超时或失效；网站已部署，请稍后替换问题资源"
fi

if [[ "$BLOG_ENABLE_HTTPS" == true ]]; then
  [[ -n "$BLOG_HTTPS_EMAIL" ]] || { read -r -p "申请 HTTPS 使用的邮箱： " BLOG_HTTPS_EMAIL; }
  [[ -n "$BLOG_HTTPS_EMAIL" ]] || die "启用 HTTPS 时必须提供邮箱"
  install_missing_packages certbot python3-certbot-nginx
  certbot --nginx --non-interactive --agree-tos --redirect --email "$BLOG_HTTPS_EMAIL" -d "$BLOG_DOMAIN"
fi

log "部署完成"
if [[ "$BLOG_CONFIGURE_NGINX" == true ]]; then
  printf '\n访问地址：http%s://%s\n' "$([[ "$BLOG_ENABLE_HTTPS" == true ]] && printf 's' || true)" "$BLOG_DOMAIN"
else
  printf '\n应用地址（供 1Panel 反向代理）：http://127.0.0.1:%s\n' "$BLOG_PORT"
fi
printf '健康检查：curl http://127.0.0.1:%s/api/health\n' "$BLOG_PORT"
printf '日志：journalctl -u leaf-blog -f\n'
