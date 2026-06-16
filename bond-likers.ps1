# ============================================================================
#  bond-likers.ps1  —  UM arquivo que faz TUDO no desktop:
#  configura, captura QUEM CURTIU os posts recentes e envia pro monitor (VM).
#
#  COMO USAR (no Windows, dentro de C:\jfn\bond):
#    - Clique com o botão direito neste arquivo > "Executar com o PowerShell"
#    - OU no PowerShell:  powershell -ExecutionPolicy Bypass -File bond-likers.ps1
#
#  RODA SÓ NO SEU COMPUTADOR (IP residencial). Nunca na VM.
#  Não contém senhas — pede o cookie 1 vez e salva no .env LOCAL (que fica fora do git).
# ============================================================================
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Write-Host "=== Bond — Captura de Curtidores (desktop) ===" -ForegroundColor Cyan

# 1) Node instalado?
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js nao encontrado. Instale em https://nodejs.org (versao LTS) e rode de novo." -ForegroundColor Red
  Read-Host "Enter para sair"; exit 1
}

# 2) Helpers de .env
$envFile = Join-Path $PSScriptRoot ".env"
function Get-EnvVal($name) {
  if (Test-Path $envFile) {
    $l = Select-String -Path $envFile -Pattern "^$name=" -ErrorAction SilentlyContinue
    if ($l) { return ($l.Line -replace "^$name=", "").Trim('"').Trim() }
  }
  return $null
}
function Set-EnvVal($name, $val) {
  if (-not (Test-Path $envFile)) { New-Item $envFile -ItemType File | Out-Null }
  $content = @(Get-Content $envFile -ErrorAction SilentlyContinue)
  $line = "$name=`"$val`""
  if ($content -match "^$name=") {
    ($content -replace "^$name=.*", $line) | Set-Content $envFile -Encoding UTF8
  } else {
    Add-Content $envFile $line -Encoding UTF8
  }
}

# 3) Valores fixos (não são secretos). Transporte = Syncthing (pasta sincronizada).
Set-EnvVal "IG_CAPTURE_LOCAL" "true"
Set-EnvVal "IG_PERFIL"        "depjorgefelippeneto"
if (-not (Get-EnvVal "IG_NUM_POSTS")) { Set-EnvVal "IG_NUM_POSTS" "12" }

# Pasta sincronizada (Syncthing): irmã do repo -> C:\jfn\bond-sync
$syncDir = Join-Path (Split-Path $PSScriptRoot -Parent) "bond-sync"
Set-EnvVal "LIKERS_OUT_DIR" $syncDir
if (-not (Test-Path $syncDir)) {
  Write-Host "ATENCAO: aceite a pasta 'bond-sync' do Syncthing apontando para:" -ForegroundColor Yellow
  Write-Host "   $syncDir" -ForegroundColor Yellow
}

# 4) Pede o cookie SÓ se faltar (uma vez)
if (-not (Get-EnvVal "IG_SESSIONID")) { Set-EnvVal "IG_SESSIONID" (Read-Host "Cole o sessionid do Instagram") }
if (-not (Get-EnvVal "IG_DS_USER_ID")){ Set-EnvVal "IG_DS_USER_ID" (Read-Host "Cole o ds_user_id") }
if (-not (Get-EnvVal "IG_CSRFTOKEN")) { Set-EnvVal "IG_CSRFTOKEN" (Read-Host "Cole o csrftoken") }

# 5) Instala dependencias (so na 1a vez)
if (-not (Test-Path (Join-Path $PSScriptRoot "node_modules\playwright"))) {
  Write-Host "Instalando dependencias (uma vez, pode demorar 1-2 min)..." -ForegroundColor Cyan
  npm install playwright dotenv | Out-Host
  npx playwright install chromium | Out-Host
}

# 6) Captura
Write-Host "Capturando os posts recentes... vai abrir uma janela do Chrome — NAO mexa." -ForegroundColor Cyan
Write-Host "Se aparecer qualquer bloqueio do Instagram, o script para sozinho." -ForegroundColor Yellow
node scripts/captura-likers.mjs

Write-Host ""
Write-Host "Pronto! Veja o ranking em: http://159.112.188.8:3000/curtidores" -ForegroundColor Green
Read-Host "Enter para fechar"
