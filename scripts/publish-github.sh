#!/usr/bin/env bash
set -euo pipefail

REPO_NAME="${1:-trading-discipline-workbench}"
VISIBILITY="${2:-private}"

if [[ "$VISIBILITY" != "private" && "$VISIBILITY" != "public" ]]; then
  echo "第二个参数只能是 private 或 public"
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git init
  git branch -M main
fi

if command -v gh >/dev/null 2>&1; then
  if ! gh auth status >/dev/null 2>&1; then
    echo "请先运行：gh auth login"
    exit 1
  fi
  if ! gh repo view "$REPO_NAME" >/dev/null 2>&1; then
    gh repo create "$REPO_NAME" "--$VISIBILITY" --source=. --remote=origin --push
  else
    git remote remove origin 2>/dev/null || true
    git remote add origin "$(gh repo view "$REPO_NAME" --json sshUrl --jq .sshUrl)"
    git push -u origin main
  fi
  echo "已推送到 GitHub：$REPO_NAME"
  exit 0
fi

if [[ -n "${GITHUB_TOKEN:-}" && -n "${GITHUB_OWNER:-}" ]]; then
  api_payload=$(printf '{"name":"%s","private":%s}' "$REPO_NAME" "$([[ "$VISIBILITY" == "private" ]] && echo true || echo false)")
  curl -fsS \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    https://api.github.com/user/repos \
    -d "$api_payload" >/dev/null || true
  git remote remove origin 2>/dev/null || true
  git remote add origin "https://github.com/$GITHUB_OWNER/$REPO_NAME.git"
  git push -u origin main
  echo "已推送到 GitHub：https://github.com/$GITHUB_OWNER/$REPO_NAME"
  exit 0
fi

cat <<'MSG'
没有找到 GitHub 授权方式。

任选一种：
1. 安装并登录 GitHub CLI：
   brew install gh
   gh auth login
   ./scripts/publish-github.sh trading-discipline-workbench private

2. 设置 GITHUB_TOKEN 和 GITHUB_OWNER：
   export GITHUB_TOKEN=你的token
   export GITHUB_OWNER=你的GitHub用户名
   ./scripts/publish-github.sh trading-discipline-workbench private
MSG
exit 1
