@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo 먼저 https://nodejs.org 에서 Node.js 24 LTS 이상을 설치하세요.
  pause
  exit /b 1
)
node scripts/start.mjs
pause
