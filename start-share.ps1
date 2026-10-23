# Local share: set LLM_API_KEY first, then run this script.
#   $env:LLM_API_KEY = "sk-...."
#   powershell -ExecutionPolicy Bypass -File .\start-share.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not $env:LLM_API_KEY) {
  Write-Host 'Set LLM_API_KEY first: $env:LLM_API_KEY = "sk-..."'
  exit 1
}

$node = Start-Process -FilePath "node" -ArgumentList "server.js" -PassThru -WindowStyle Hidden
Write-Host ("server pid=" + $node.Id + "  http://127.0.0.1:5173")

Start-Sleep -Seconds 1

# Prefer cloudflared (no account). ngrok needs authtoken first.
$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cf) {
  $cfCandidates = @(
    "$env:ProgramFiles\cloudflared\cloudflared.exe",
    "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe"
  )
  foreach ($p in $cfCandidates) {
    if (Test-Path $p) { $cf = $p; break }
  }
}

if ($cf) {
  Write-Host "Using cloudflared. Copy the https://....trycloudflare.com URL below."
  if ($cf -is [string]) { & $cf tunnel --url http://127.0.0.1:5173 }
  else { & cloudflared tunnel --url http://127.0.0.1:5173 }
} else {
  Write-Host "cloudflared not found. Install it, or configure ngrok:"
  Write-Host "  1) https://dashboard.ngrok.com/get-started/your-authtoken"
  Write-Host '  2) ngrok config add-authtoken YOUR_TOKEN'
  Write-Host "  3) ngrok http 5173"
  Stop-Process -Id $node.Id -Force -ErrorAction SilentlyContinue
  exit 1
}
