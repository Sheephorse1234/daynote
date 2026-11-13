#!/bin/zsh
cd -- "$(dirname -- "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
node scripts/start.mjs --package
read -r '?release 폴더를 확인하세요. Enter를 누르면 닫힙니다.'
