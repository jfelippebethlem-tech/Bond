# ============================================================================
#  bond-likers-diario.ps1 — captura DIÁRIA (2x/dia) de curtidas + stories.
#
#  Recipe do dono (a partir de 2026-06-17):
#    - 10:00 (manhã): 20 posts = 10 mais RECENTES (curtidas+stories, re-rodados todo dia)
#                     + 10 do BACKFILL por data (de 1º/jan/2026 p/ frente).
#    - 22:00 (noite): 20 posts do BACKFILL ainda não rodados (de 1º/jan p/ frente).
#  Conta PRINCIPAL (owner) — pega TODOS os curtidores (sem o teto de 104).
#
#  PRÉ-REQUISITO (uma vez): rode bond-likers.ps1 normal — instala deps e faz o LOGIN
#  no perfil dedicado. Depois disto, este script roda sozinho (a sessão fica salva).
#
#  REGISTRAR os 2 horários (uma vez):
#    powershell -ExecutionPolicy Bypass -File .\bond-likers-diario.ps1 -Instalar
#  RODAR AGORA na mão (teste):
#    powershell -ExecutionPolicy Bypass -File .\bond-likers-diario.ps1 -Mode manha
#
#  RODA SÓ NO SEU COMPUTADOR (IP residencial). NUNCA na VM.
# ============================================================================
param(
  [ValidateSet('manha','noite')] [string]$Mode = 'manha',
  [switch]$Scheduled,   # execução automática (agendador): não pausa, não espera login
  [switch]$Instalar     # registra as 2 tarefas (10:00 e 22:00) e sai
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# ── -Instalar: registra as duas tarefas agendadas e sai ─────────────────────────
if ($Instalar) {
  $tasks = @(
    @{ Nome = "BondLikersManha"; Hora = "10:00"; Modo = "manha" },
    @{ Nome = "BondLikersNoite"; Hora = "22:00"; Modo = "noite" }
  )
  foreach ($t in $tasks) {
    $arg = "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Scheduled -Mode $($t.Modo)"
    $act = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg
    $trg = New-ScheduledTaskTrigger -Daily -At $t.Hora
    Register-ScheduledTask -TaskName $t.Nome -Action $act -Trigger $trg -Force `
      -Description "Bond: captura diária de curtidas/stories ($($t.Modo))" | Out-Null
    Write-Host "Agendado: $($t.Nome) -> todo dia às $($t.Hora) (modo $($t.Modo))" -ForegroundColor Green
  }
  Write-Host "Pronto. As 2 tarefas rodam sozinhas. (Confira no 'Agendador de Tarefas' do Windows.)" -ForegroundColor Cyan
  return
}

try { Start-Transcript -Path (Join-Path $PSScriptRoot "bond-likers-log.txt") -Append | Out-Null } catch {}
try {
  Write-Host "=== Bond - Captura diária ($Mode) ===" -ForegroundColor Cyan
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js nao encontrado. Rode bond-likers.ps1 primeiro." }
  if (-not (Test-Path (Join-Path $PSScriptRoot "node_modules\playwright\index.js"))) {
    throw "Dependencias ausentes. Rode bond-likers.ps1 UMA vez (instala deps + login) antes do diario."
  }

  # Recipe do run (sobrepoe o .env; dotenv NAO sobrescreve env ja definido) ──────
  $env:IG_CAPTURE_LOCAL = "true"
  $env:IG_MODE          = $Mode
  $env:IG_SINCE         = "2026-01-01"
  $env:IG_NUM_POSTS     = "20"
  $env:IG_RECENT        = "10"
  $env:IG_STORIES       = "true"
  $env:IG_INTERACTIVE   = if ($Scheduled) { "false" } else { "true" }
  $env:IG_TARGET_USER   = ""   # OWNER (sem 2a conta) = pega todos os curtidores

  # Pasta sincronizada (Syncthing) — detecta como no bond-likers.ps1
  $envFile = Join-Path $PSScriptRoot ".env"
  function Get-EnvVal($n){ if(Test-Path $envFile){ $l=Select-String -Path $envFile -Pattern ("^"+$n+"=") -EA SilentlyContinue; if($l){ return ($l.Line -replace ("^"+$n+"="),"").Trim('"').Trim() } } return $null }
  $syncDir = Get-EnvVal "LIKERS_OUT_DIR"
  if ((-not $syncDir) -or (-not (Test-Path $syncDir))) {
    $cand1 = Join-Path $PSScriptRoot "likers-sync"; $cand2 = Join-Path (Split-Path $PSScriptRoot -Parent) "likers-sync"
    $syncDir = if (Test-Path $cand1) { $cand1 } elseif (Test-Path $cand2) { $cand2 } else { $cand1 }
  }
  $env:LIKERS_OUT_DIR = $syncDir
  if (-not (Get-EnvVal "IG_PROFILE_DIR")) { $env:IG_PROFILE_DIR = Join-Path (Split-Path $PSScriptRoot -Parent) "ig-profile" }
  Write-Host "modo=$Mode · saida=$syncDir · 20 posts (10 recentes na manha) · stories=on" -ForegroundColor DarkGray

  $ErrorActionPreference = "Continue"
  node scripts/captura-likers.mjs 2>&1 | Out-Host
  $rc = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  if ($rc -ne 0) { throw "Captura terminou com erro (codigo $rc) — veja acima/bond-likers-log.txt." }
  Write-Host "PRONTO ($Mode). Ranking: http://159.112.188.8:3000/curtidores" -ForegroundColor Green
}
catch {
  Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
  try { Stop-Transcript | Out-Null } catch {}
  if (-not $Scheduled) { Read-Host "Pressione Enter para fechar" }
}
