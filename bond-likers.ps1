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
param([switch]$Scheduled)  # -Scheduled = execucao automatica (agendador), nao pausa no fim

# ---------------------------------------------------------------------------
# DESATIVADO 2026-06-26 — o caminho AGENDADO vira no-op.
# Este e o metodo ANTIGO/CAPADO (~100 curtidores) que SOBRESCREVIA o contrato de
# producao (likers-sync) toda sexta via a tarefa Windows "BondLikersSemanal". Foi
# substituido pela captura COMPLETA do dono (captura/capturar_producao.py, via poller
# + cron do Hermes). A tarefa nao pode ser desabilitada por aqui (exige admin), entao
# neutralizamos o script: o disparo agendado sai sem capturar e NAO toca no contrato.
# Para reabilitar este metodo, remova este bloco. Detalhes em docs/LIMPEZA-2026-06-26.md
if ($Scheduled) {
    Write-Host "BondLikersSemanal: metodo capado DESATIVADO (ver docs/LIMPEZA-2026-06-26.md). Saindo sem capturar." -ForegroundColor Yellow
    exit 0
}
# ---------------------------------------------------------------------------

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

  # Pasta SINCRONIZADA do Syncthing. Detecta automaticamente onde voce aceitou:
  # dentro do repo (C:\jfn\bond\likers-sync) OU irma (C:\jfn\likers-sync).
  $syncDir = Get-EnvVal "LIKERS_OUT_DIR"
  if ((-not $syncDir) -or (-not (Test-Path $syncDir))) {
    $cand1 = Join-Path $PSScriptRoot "likers-sync"                       # dentro do repo
    $cand2 = Join-Path (Split-Path $PSScriptRoot -Parent) "likers-sync"  # pasta irma
    if (Test-Path $cand1) { $syncDir = $cand1 }
    elseif (Test-Path $cand2) { $syncDir = $cand2 }
    elseif ($Scheduled) { $syncDir = $cand1 }
    else {
      $resp = Read-Host "Caminho da pasta 'likers-sync' do Syncthing (Enter = $cand1)"
      $syncDir = if ([string]::IsNullOrWhiteSpace($resp)) { $cand1 } else { $resp.Trim().Trim('"') }
    }
    Set-EnvVal "LIKERS_OUT_DIR" $syncDir
  }
  if (-not (Test-Path $syncDir)) { New-Item -ItemType Directory -Path $syncDir -Force | Out-Null }
  Write-Host "Saida (Syncthing): $syncDir" -ForegroundColor DarkGray

  # 4) Perfil de navegador DEDICADO (sem copiar cookie). Voce loga 1x na janela.
  $perfilDir = Join-Path (Split-Path $PSScriptRoot -Parent) "ig-profile"
  Set-EnvVal "IG_PROFILE_DIR" $perfilDir

  # 4.5) Auto-agendamento: toda SEXTA as 9h (registra UMA vez; roda sozinho depois)
  if (-not $Scheduled) {
    $taskName = "BondLikersSemanal"
    if (-not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) {
      try {
        $act = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-ExecutionPolicy Bypass -WindowStyle Hidden -File `"" + $PSCommandPath + "`" -Scheduled")
        $trg = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Friday -At 9am
        Register-ScheduledTask -TaskName $taskName -Action $act -Trigger $trg -Description "Bond: captura semanal de curtidores" -Force | Out-Null
        Write-Host "Agendado: roda sozinho toda SEXTA as 9h. (tarefa '$taskName')" -ForegroundColor Green
      } catch { Write-Host "Nao consegui agendar automaticamente: $($_.Exception.Message)" -ForegroundColor Yellow }
    } else { Write-Host "Ja agendado (toda sexta as 9h)." -ForegroundColor DarkGray }
  }

  # 5) Dependencias. Checa o ARQUIVO real do playwright (nao so a pasta), pra
  #    pegar instalacao quebrada (ex.: node_modules de Linux vindo do Syncthing).
  $pwOk = Test-Path (Join-Path $PSScriptRoot "node_modules\playwright\index.js")
  if (-not $pwOk) {
    Write-Host "Instalando dependencias (1a vez ou conserto, 1-2 min)..." -ForegroundColor Cyan
    $ErrorActionPreference = "Continue"
    # se houver node_modules quebrado (ex.: de Linux), apaga so o playwright p/ reinstalar limpo
    $pwDir = Join-Path $PSScriptRoot "node_modules\playwright"
    if (Test-Path $pwDir) { Remove-Item -Recurse -Force $pwDir -ErrorAction SilentlyContinue }
    npm install playwright dotenv 2>&1 | Out-Host
    $rc = $LASTEXITCODE
    if ($rc -eq 0) { npx playwright install chromium 2>&1 | Out-Host; $rc = $LASTEXITCODE }
    $ErrorActionPreference = "Stop"
    if ($rc -ne 0) { throw "Instalacao de dependencias falhou (codigo $rc). Veja acima." }
  }

  # 6) Captura. Interativo = voce pode logar na janela; agendado = nao espera login.
  if ($Scheduled) { $env:IG_INTERACTIVE = "false" } else { $env:IG_INTERACTIVE = "true" }
  Write-Host "Abrindo o Instagram... Se pedir LOGIN, faca o login na janela (com 2FA). Senao, so aguarde." -ForegroundColor Cyan
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
  if (-not $Scheduled) { Write-Host ""; Read-Host "Pressione Enter para fechar" }
}
