# TESTE — motor CDP cru (DevTools direto, sem Playwright). Roda SÓ no desktop (IP residencial).
# PRÉ-REQ: abra o Chrome REAL logado com depuração ANTES:
#   chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\jfn\ig-profile"
# Uso:  .\captura\rodar-teste.ps1 -Alvo "perfil_publico_de_teste"
param([Parameter(Mandatory=$true)][string]$Alvo)
$env:IG_ENGINE   = "cdp"
$env:IG_TARGET_USER = $Alvo
$env:IG_CDP_URL  = "http://127.0.0.1:9222"
Write-Host "▶ motor=cdp alvo=@$Alvo  (precisa do Chrome aberto com --remote-debugging-port=9222)"
node captura\capture.mjs
