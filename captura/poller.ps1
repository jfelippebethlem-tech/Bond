# POLLER DO DESKTOP — escuta o Telegram do Bond (via comando.json que o Syncthing traz)
# e roda a captura HUMANA + depuração quando você manda /capturar no @BondCampanhaBot.
# Reporta de volta pelo resposta.json (o bot relata no Telegram).
#
# Deixe esta janela ABERTA no desktop. Roda SÓ no desktop (IP residencial). NUNCA na VM.
# Uso:  .\captura\poller.ps1 -Alvo "perfil_alvo" -Motor nodriver
#       (Motor: nodriver | cdp ; Alvo: o perfil a capturar — sua conta ou a de teste)
param(
  [string]$Alvo = $env:IG_TARGET_USER,
  [ValidateSet('nodriver','cdp')][string]$Motor = $(if ($env:IG_ENGINE) { $env:IG_ENGINE } else { 'nodriver' }),
  [int]$Posts = 12
)
$ErrorActionPreference = 'Continue'
$raiz   = Split-Path $PSScriptRoot -Parent          # C:\jfn\bond (raiz sincronizada)
$cmdF   = Join-Path $raiz 'comando.json'
$respF  = Join-Path $raiz 'resposta.json'
if (-not $Alvo) { Write-Host "❌ Informe -Alvo (perfil a capturar)" -ForegroundColor Red; exit 1 }

function Responder($ok, $msg) {
  @{ ok = $ok; msg = $msg; quando = (Get-Date).ToString('s') } | ConvertTo-Json -Compress | Set-Content -Path $respF -Encoding UTF8
}
function LerComando { try { Get-Content $cmdF -Raw | ConvertFrom-Json } catch { $null } }
function MarcarFeito($c) { $c.feito = $true; $c | ConvertTo-Json -Compress | Set-Content -Path $cmdF -Encoding UTF8 }

Write-Host "👂 Poller ativo. Motor=$Motor Alvo=@$Alvo. Mande /capturar no @BondCampanhaBot." -ForegroundColor Cyan
Write-Host "   (Deixe esta janela aberta. Ctrl+C para parar.)`n" -ForegroundColor DarkGray

while ($true) {
  # trava de pausa: se a VM sinalizou bloqueio, não toca no IG
  if ((Test-Path (Join-Path $raiz '.pause_captura')) -or (Test-Path (Join-Path $raiz 'likers-sync\.pause_captura'))) {
    Start-Sleep -Seconds 15; continue
  }
  $c = LerComando
  if ($c -and $c.acao -eq 'capturar' -and -not $c.feito) {
    Write-Host "📡 /capturar recebido — rodando ($Motor, @$Alvo)..." -ForegroundColor Green
    Responder $true "captura começou (motor $Motor, alvo @$Alvo). Vou avisar quando terminar."
    $env:IG_ENGINE = $Motor; $env:IG_TARGET_USER = $Alvo; $env:IG_NUM_POSTS = "$Posts"
    try {
      if ($Motor -eq 'nodriver') { python captura\capture_nodriver.py } else { node captura\capture.mjs }
    } catch { Responder $false ("erro na captura: " + $_.Exception.Message); MarcarFeito $c; continue }

    # depura os prints LOCALMENTE (Gemini) e grava likers.json na pasta sincronizada
    Write-Host "🔎 depurando os prints (Gemini)..." -ForegroundColor Green
    $extra = ""
    try {
      $saida = python parse\parse_likers.py 2>&1 | Out-String
      Write-Host $saida
      $m = [regex]::Match($saida, "(\d+)\s+curtidores distintos")
      if ($m.Success) { $extra = " — $($m.Groups[1].Value) curtidores extraídos" }
    } catch { $extra = " — (parse falhou: $($_.Exception.Message))" }

    Responder $true ("captura + depuração concluídas$extra. Veja em /curtidores (o site importa em ~5min).")
    MarcarFeito $c
    Write-Host "✅ feito. Aguardando próximo /capturar.`n" -ForegroundColor Cyan
  }
  Start-Sleep -Seconds 12
}
