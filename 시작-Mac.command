#!/bin/zsh
cd -- "$(dirname -- "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo '먼저 https://nodejs.org 에서 Node.js 24 LTS 이상을 설치하세요.'
  read -r '?Enter를 누르면 닫힙니다.'
  exit 1
fi
node scripts/start.mjs
if [ $? -ne 0 ]; then read -r '?오류 내용을 확인한 뒤 Enter를 누르세요.'; fi
