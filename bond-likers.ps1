# ============================================================================
#  bond-likers.ps1  —  UM arquivo que faz TUDO no desktop:
#  configura, captura QUEM CURTIU os posts recentes e manda pro monitor (via Syncthing).
#
#  COMO RODAR (recomendado, pra ver o que acontece):
#    1. Abra o PowerShell
#    2. cd C:\jfn\bond
#    3. powershell -ExecutionPolicy Bypass -File .\bond-likers.ps1
#
#  RODA SÓ NO SEU COMPUTADOR (IP residencial). Nunca na VM. Sem senhas no arquivo.
#  Se algo der errado, NÃO fecha sozinho e grava tudo em bond-likers-log.txt
# ============================================================================
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
try { Start-Transcript -Path (Join-Path $PSScriptRoot "bond-likers-log.txt") -Force | Out-Null } catch {}

try {
  Write-Host "=== Bond - Captura de Curtidores (desktop) ===" -ForegroundColor Cyan

  # 1) Node instalado?
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js nao encontrado. Instale a versao LTS em https://nodejs.org , feche e abra o PowerShell, e rode de novo."
  }
  Write-Host ("Node: " + (node -v)) -ForegroundColor DarkGray

  # 2) Helpers de .env
  $envFile = Join-Path $PSScriptRoot ".env"
  function Get-EnvVal($name) {
    if (Test-Path $envFile) {
      $l = Select-String -Path $envFile -Pattern ("^" + $name + "=") -ErrorAction SilentlyContinue
      if ($l) { return ($l.Line -replace ("^" + $name + "="), "").Trim('"').Trim() }
    }
    return $null
  }
  function Set-EnvVal($name, $val) {
    if (-not (Test-Path $envFile)) { New-Item $envFile -ItemType File | Out-Null }
    $content = @(Get-Content $envFile -ErrorAction SilentlyContinue)
    $line = "$name=`"$val`""
    if ($content -match ("^" + $name + "=")) {
      ($content -replace ("^" + $name + "=.*"), $line) | Set-Content $envFile -Encoding UTF8
    } else {
      Add-Content $envFile $line -Encoding UTF8
    }
  }

  # 3) Valores fixos. Transporte = Syncthing (pasta sincronizada).
  Set-EnvVal "IG_CAPTURE_LOCAL" "true"
  Set-EnvVal "IG_PERFIL"        "depjorgefelippeneto"
  if (-not (Get-EnvVal "IG_NUM_POSTS")) { Set-EnvVal "IG_NUM_POSTS" "12" }

  $syncDir = Join-Path (Split-Path $PSScriptRoot -Parent) "bond-sync"
  Set-EnvVal "LIKERS_OUT_DIR" $syncDir
  if (-not (Test-Path $syncDir)) {
    Write-Host "AVISO: a pasta sincronizada ainda nao existe:" -ForegroundColor Yellow
    Write-Host "   $syncDir" -ForegroundColor Yellow
    Write-Host "   (aceite a pasta 'bond-sync' no Syncthing apontando pra esse caminho. O script continua e cria a pasta tambem.)" -ForegroundColor Yellow
  }

  # 4) Cookie (pede so se faltar)
  if (-not (Get-EnvVal "IG_SESSIONID")) { Set-EnvVal "IG_SESSIONID" (Read-Host "Cole o sessionid do Instagram") }
  if (-not (Get-EnvVal "IG_DS_USER_ID")){ Set-EnvVal "IG_DS_USER_ID" (Read-Host "Cole o ds_user_id") }
  if (-not (Get-EnvVal "IG_CSRFTOKEN")) { Set-EnvVal "IG_CSRFTOKEN" (Read-Host "Cole o csrftoken") }

  # 5) Dependencias (so na 1a vez)
  if (-not (Test-Path (Join-Path $PSScriptRoot "node_modules\playwright"))) {
    Write-Host "Instalando dependencias (uma vez, 1-2 min)..." -ForegroundColor Cyan
    npm install playwright dotenv 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "npm install falhou. Veja o erro acima." }
    npx playwright install chromium 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "playwright install falhou. Veja o erro acima." }
  }

  # 6) Captura
  Write-Host "Capturando... vai abrir uma janela do Chrome - NAO mexa." -ForegroundColor Cyan
  node scripts/captura-likers.mjs
  if ($LASTEXITCODE -ne 0) { throw "A captura terminou com erro (codigo $LASTEXITCODE). Veja acima." }

  Write-Host ""
  Write-Host "PRONTO! Veja o ranking em: http://159.112.188.8:3000/curtidores" -ForegroundColor Green
}
catch {
  Write-Host ""
  Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Mande o arquivo bond-likers-log.txt (nesta pasta) que eu te ajudo." -ForegroundColor Yellow
}
finally {
  try { Stop-Transcript | Out-Null } catch {}
  Write-Host ""
  Read-Host "Pressione Enter para fechar"
}
