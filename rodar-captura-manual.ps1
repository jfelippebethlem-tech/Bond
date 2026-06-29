# ============================================================================
#  rodar-captura-manual.ps1  -  Dispara UMA run manual de captura de curtidores.
#  "Arma tudo": perfil do dono, modo producao, limpa lock de Chrome travado,
#  pergunta quantos posts, e roda na hora (pode trabalhar por cima - as flags
#  anti-occlusao impedem o freeze de janela oculta).
#  Chamado pelo atalho do desktop "Bond - Rodar Captura.bat".
#  NAO precisa do Claude/monitor: roda, mostra o log ao vivo e fecha no Enter.
# ============================================================================
$ErrorActionPreference = "Stop"
$PY     = "C:\Users\socah\AppData\Local\Programs\Python\Python312\python.exe"
$RUNNER = "C:\jfn\bond\captura\capturar_producao.py"
$OUT    = "C:\jfn\bond\likers-sync"
$LOG    = "$OUT\runner.log"

function Sair($code) { Write-Host ""; Read-Host "Enter p/ fechar" | Out-Null; exit $code }

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  BOND - Captura Manual de Curtidores (conta DONA)"           -ForegroundColor Cyan
Write-Host "============================================================`n" -ForegroundColor Cyan

# --- pre-checagens ---
if (-not (Test-Path $PY))     { Write-Host "ERRO: Python nao encontrado em $PY" -ForegroundColor Red; Sair 1 }
if (-not (Test-Path $RUNNER)) { Write-Host "ERRO: runner nao encontrado em $RUNNER" -ForegroundColor Red; Sair 1 }

# --- kill-switches ativos? ---
if (Test-Path "$OUT\.pause_captura") {
  Write-Host "[!] Existe .pause_captura - a captura esta PAUSADA." -ForegroundColor Yellow
  Write-Host "    Apague o arquivo $OUT\.pause_captura para poder rodar." -ForegroundColor Yellow
  Sair 1
}
if (Test-Path "$OUT\.cooldown_until") {
  $until = (Get-Content "$OUT\.cooldown_until" -ErrorAction SilentlyContinue | Select-Object -First 1)
  Write-Host "[!] Conta em COOLDOWN de 24h (ate $until) por bloqueio do IG." -ForegroundColor Yellow
  $r = Read-Host "Rodar mesmo assim? Apaga o cooldown. (S/N)"
  if ($r -match '^[Ss]') { Remove-Item "$OUT\.cooldown_until" -Force -ErrorAction SilentlyContinue }
  else { Write-Host "Cancelado." -ForegroundColor DarkGray; Sair 0 }
}

# --- ja tem captura rodando? (perfil do dono em uso = lock) ---
$rodando = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*ig-profile-dono*' })
if ($rodando.Count -gt 0) {
  Write-Host "[!] Ja existe captura usando o perfil do dono ($($rodando.Count) processos Chrome)." -ForegroundColor Yellow
  $r = Read-Host "Encerrar a anterior e iniciar uma NOVA? (S/N)"
  if ($r -match '^[Ss]') {
    $rodando | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Get-CimInstance Win32_Process | Where-Object {
      $_.Name -eq 'python.exe' -and $_.CommandLine -like '*capturar_producao.py*' } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
    Write-Host "Captura anterior encerrada.`n" -ForegroundColor DarkGray
  } else { Write-Host "Cancelado." -ForegroundColor DarkGray; Sair 0 }
}

# --- quantos posts? ---
$n = Read-Host "Quantos posts capturar? [Enter = 80]"
if ([string]::IsNullOrWhiteSpace($n)) { $n = "80" }
if ($n -notmatch '^[1-9][0-9]*$') { Write-Host "Numero invalido: '$n'" -ForegroundColor Red; Sair 1 }

Write-Host "`nIniciando captura de $n posts. Voce pode trabalhar normalmente." -ForegroundColor Green
Write-Host "(A janela do Chrome pode ficar atras das suas - nao tem problema.)`n" -ForegroundColor DarkGray

# --- arma o ambiente e roda (foreground, log ao vivo) ---
$env:IG_TARGET_USER = "depjorgefelippeneto"
$env:IG_PROFILE_DIR = "C:\jfn\ig-profile-dono"
$env:IG_UM_CICLO    = "1"
$env:IG_TESTE       = "0"
$env:IG_MIN_POSTS   = $n
$env:IG_MAX_POSTS   = $n
$env:PYTHONUTF8     = "1"

Set-Location "C:\jfn\bond"
& $PY $RUNNER
$rc = $LASTEXITCODE

Write-Host "`n============================================================" -ForegroundColor Cyan
if ($rc -eq 0) { Write-Host " PRONTO (rc=0). Ranking: http://159.112.188.8:3000/curtidores" -ForegroundColor Green }
else           { Write-Host " Terminou com rc=$rc - veja o log abaixo." -ForegroundColor Yellow }
Write-Host " Log completo: $LOG" -ForegroundColor DarkGray
Write-Host "============================================================" -ForegroundColor Cyan
Sair $rc
