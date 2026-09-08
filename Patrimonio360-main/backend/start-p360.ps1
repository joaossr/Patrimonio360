$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (!(Test-Path node_modules)) { npm install }
if (!(Test-Path .env)) { Copy-Item .env.example .env; Write-Host 'Criei .env a partir do .env.example. Preencha TELEGRAM_BOT_TOKEN e a credencial Firebase.' -ForegroundColor Yellow }
npm run dev
