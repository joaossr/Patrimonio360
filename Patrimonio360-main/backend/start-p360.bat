@echo off
setlocal
cd /d "%~dp0"

echo.
echo ================================================
echo       PATRIMONIO 360 - BACKEND
 echo ================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado.
  echo Instale o Node.js LTS em https://nodejs.org/
  pause
  exit /b 1
)

if not exist package.json (
  echo [ERRO] package.json nao encontrado.
  pause
  exit /b 1
)

if not exist .env (
  echo [ERRO] .env nao encontrado.
  echo Crie o arquivo .env a partir do .env.example.
  pause
  exit /b 1
)

if not exist service-account.json (
  echo [ERRO] service-account.json nao encontrado.
  echo Coloque sua chave privada do Firebase dentro desta pasta com esse nome.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [INFO] Instalando dependencias...
  call npm install
  if errorlevel 1 (
    echo [ERRO] npm install falhou.
    pause
    exit /b 1
  )
)

echo [INFO] Iniciando backend...
echo [INFO] Teste depois em http://localhost:8787/health
echo.
call npm run dev

if errorlevel 1 (
  echo.
  echo [ERRO] O backend encerrou com erro.
  pause
)
