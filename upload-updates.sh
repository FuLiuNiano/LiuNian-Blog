#!/usr/bin/env bash
set -Eeuo pipefail

# 只上传 Leaf Blog 的公开部署文件，不会使用 git add .。

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

die() {
  printf '[error] %s\n' "$*" >&2
  exit 1
}

log() {
  printf '[leaf-blog] %s\n' "$*"
}

[[ -d .git ]] || die "当前目录不是 Git 仓库"

REMOTE_URL="$(git remote get-url origin 2>/dev/null || true)"
[[ -n "$REMOTE_URL" ]] || die "没有找到 origin 远程仓库"

BRANCH="$(git branch --show-current)"
[[ -n "$BRANCH" ]] || die "无法确定当前 Git 分支"

FILES=(
  README.md
  DEPLOY.md
  deploy.sh
  server.js
  lib/hot-topics.js
  public/js/app.js
  public/css/style.css
  start-blog.ps1
  stop-blog.ps1
  upload-updates.sh
)

is_allowed_file() {
  local candidate="$1"
  local allowed
  for allowed in "${FILES[@]}"; do
    [[ "$candidate" == "$allowed" ]] && return 0
  done
  return 1
}

check_staged_scope() {
  local staged_file
  while IFS= read -r staged_file; do
    [[ -z "$staged_file" ]] && continue
    is_allowed_file "$staged_file" || die "发现不在允许列表中的暂存文件：$staged_file"
  done <<< "$1"
}

# 如果用户之前暂存了其他文件，先停止，避免误上传。
check_staged_scope "$(git diff --cached --name-only)"

for file in "${FILES[@]}"; do
  [[ -f "$file" ]] || die "缺少文件：$file"
done

git add -- "${FILES[@]}"
STAGED_FILES="$(git diff --cached --name-only)"
check_staged_scope "$STAGED_FILES"

# 这些路径和敏感内容不允许进入本次提交。
if printf '%s\n' "$STAGED_FILES" | grep -Eq '(^|/)(\.env|data/(leaf-blog\.db|leaf-blog\.db-(wal|shm)|users\.json|comments\.json|guestbook\.json|journals\.json|state\.json|site\.json)|backups|logs|public/uploads)(/|$)'; then
  die "暂存区包含隐私文件，已停止上传"
fi

if git diff --cached | grep -Eiq -- '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|AWS_SECRET_ACCESS_KEY=|SMTP_PASS=[^$[:space:]]+|ADMIN_PASSWORD=[^$[:space:]]+'; then
  die "暂存内容疑似包含密钥或真实密码，已停止上传"
fi

git diff --cached --check || die "暂存内容存在格式错误"

if [[ -z "$STAGED_FILES" ]]; then
  log "没有需要上传的修改"
  exit 0
fi

GIT_NAME="$(git config --local user.name 2>/dev/null || true)"
GIT_EMAIL="$(git config --local user.email 2>/dev/null || true)"
if [[ -z "$GIT_NAME" || -z "$GIT_EMAIL" ]]; then
  printf 'Git 提交需要作者姓名和邮箱。邮箱建议使用 GitHub Settings -> Emails 中的 noreply 地址。\n'
  read -r -p '提交作者姓名： ' GIT_NAME
  read -r -p '提交作者邮箱： ' GIT_EMAIL
  [[ -n "$GIT_NAME" && -n "$GIT_EMAIL" ]] || die "作者姓名和邮箱不能为空"
  git config --local user.name "$GIT_NAME"
  git config --local user.email "$GIT_EMAIL"
fi

COMMIT_MESSAGE="${1:-增加每日热点和主页内容分类}"
git commit -m "$COMMIT_MESSAGE"

log "开始推送到：$REMOTE_URL"
git push -u origin "$BRANCH"
log "上传完成：$BRANCH"
