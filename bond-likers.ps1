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

  # Pasta SINCRONIZADA do Syncthing (separada do repo!). Pergunta se nao existir.
  $syncDir = Get-EnvVal "LIKERS_OUT_DIR"
  if ((-not $syncDir) -or (-not (Test-Path $syncDir))) {
    $padrao = Join-Path (Split-Path $PSScriptRoot -Parent) "bond-sync"
    Write-Host "Qual o caminho da pasta 'bond-sync' que voce aceitou no Syncthing?" -ForegroundColor Yellow
    Write-Host "(NAO use a pasta do repo C:\jfn\Bond - tem que ser uma pasta separada)" -ForegroundColor DarkYellow
    $resp = Read-Host "Caminho (Enter = $padrao)"
    if ([string]::IsNullOrWhiteSpace($resp)) { $syncDir = $padrao } else { $syncDir = $resp.Trim().Trim('"') }
    Set-EnvVal "LIKERS_OUT_DIR" $syncDir
  }
  if (-not (Test-Path $syncDir)) { New-Item -ItemType Directory -Path $syncDir -Force | Out-Null }
  Write-Host "Saida (Syncthing): $syncDir" -ForegroundColor DarkGray

  # 4) Cookie (pede so se faltar)
  if (-not (Get-EnvVal "IG_SESSIONID")) { Set-EnvVal "IG_SESSIONID" (Read-Host "Cole o sessionid do Instagram") }
  if (-not (Get-EnvVal "IG_DS_USER_ID")){ Set-EnvVal "IG_DS_USER_ID" (Read-Host "Cole o ds_user_id") }
  if (-not (Get-EnvVal "IG_CSRFTOKEN")) { Set-EnvVal "IG_CSRFTOKEN" (Read-Host "Cole o csrftoken") }

  # 5) Dependencias (so na 1a vez). ErrorActionPreference=Continue p/ avisos do
  #    npm (stderr) NAO matarem o script — checamos so o codigo de saida.
  if (-not (Test-Path (Join-Path $PSScriptRoot "node_modules\playwright"))) {
    Write-Host "Instalando dependencias (uma vez, 1-2 min)..." -ForegroundColor Cyan
    $ErrorActionPreference = "Continue"
    npm install playwright dotenv 2>&1 | Out-Host
    $rc = $LASTEXITCODE
    if ($rc -eq 0) { npx playwright install chromium 2>&1 | Out-Host; $rc = $LASTEXITCODE }
    $ErrorActionPreference = "Stop"
    if ($rc -ne 0) { throw "Instalacao de dependencias falhou (codigo $rc). Veja acima." }
  }

  # 6) Captura (idem: avisos no stderr nao devem matar)
  Write-Host "Capturando... vai abrir uma janela do Chrome - NAO mexa." -ForegroundColor Cyan
  $ErrorActionPreference = "Continue"
  node scripts/captura-likers.mjs 2>&1 | Out-Host
  $rc = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  if ($rc -ne 0) { throw "A captura terminou com erro (codigo $rc). Veja acima." }

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
