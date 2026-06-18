# VALIDAÇÃO 1-POST — motor CDP cru. Roda SÓ no desktop, na CONTA-TESTE, vendo a janela.
# PRÉ-REQ: Chrome REAL logado, aberto com depuração:
#   chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\jfn\ig-profile"
# Uso:  .\captura\validar.ps1 -Alvo "perfil_publico_de_teste"
param([Parameter(Mandatory=$true)][string]$Alvo)
$env:IG_ENGINE = "cdp"; $env:IG_TARGET_USER = $Alvo; $env:IG_CDP_URL = "http://127.0.0.1:9222"
$env:IG_NUM_POSTS = "1"; $env:IG_RECENT = "1"; $env:IG_FORCE = "true"

# checa se o Chrome esta com a porta de debug aberta
try { $null = Invoke-WebRequest -Uri "http://127.0.0.1:9222/json/version" -UseBasicParsing -TimeoutSec 3 }
catch {
  Write-Host "❌ Chrome de debug NAO encontrado em :9222." -ForegroundColor Red
  Write-Host '   Abra:  chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\jfn\ig-profile"' -ForegroundColor Yellow
  exit 1
}
Write-Host "▶ VALIDACAO 1 post (cdp) alvo=@$Alvo — OLHE a janela do Chrome." -ForegroundColor Cyan
node captura\capture.mjs

$shots = if ($env:LIKERS_SHOTS_DIR) { $env:LIKERS_SHOTS_DIR } else { Join-Path $PSScriptRoot "shots" }
$man = Get-ChildItem -Path $shots -Recurse -Filter manifest.json -ErrorAction SilentlyContinue |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $man) { Write-Host "`n❌ Nenhum manifest.json gerado — a captura nao salvou nada." -ForegroundColor Red; exit 1 }
$j = Get-Content $man.FullName -Raw | ConvertFrom-Json
Write-Host "`n===== RESULTADO DA CAPTURA =====" -ForegroundColor Cyan
Write-Host ("  post:                 {0}" -f $j.code)
Write-Host ("  modal abriu:          {0}" -f $(if ($j.modalAbriu) { "SIM" } else { "NAO" }))
Write-Host ("  como abriu:           {0}" -f $(if ($j.viaLikedByUrl) { "fallback /liked_by/" } else { "clique humano" }))
Write-Host ("  prints de curtidas:   {0}" -f $j.likeShots.Count)
if ($j.modalAbriu -and $j.likeShots.Count -gt 0) {
  Write-Host "`n✅ CAPTURA OK. Os prints ja estao indo pra VM (Syncthing)." -ForegroundColor Green
  Write-Host "   Valide a EXTRACAO na VM:   bash parse/validar.sh" -ForegroundColor Green
} else {
  Write-Host "`n❌ Modal nao abriu / sem prints. NAO suba volume." -ForegroundColor Red
  Write-Host "   Abra o post_1.png da pasta do post p/ ver se foi bloqueio ou seletor mudado." -ForegroundColor Yellow
}
