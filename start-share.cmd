@echo off
cd /d "%~dp0"
if "%LLM_API_KEY%"=="" (
  echo 请先设置: set LLM_API_KEY=sk-你的密钥
  exit /b 1
)
start "atoms-demo" /min cmd /c "node server.js"
timeout /t 2 /nobreak >nul
set "CF="
where cloudflared >nul 2>&1 && set "CF=cloudflared"
if "%CF%"=="" if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if "%CF%"=="" if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles%\cloudflared\cloudflared.exe"
if "%CF%"=="" (
  echo cloudflared 未找到。不要用未登录的 ngrok。
  echo 安装: winget install Cloudflare.cloudflared
  exit /b 1
)
echo 复制下方 https://....trycloudflare.com 发给别人
"%CF%" tunnel --url http://127.0.0.1:5173
