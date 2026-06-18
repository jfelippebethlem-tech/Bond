# TESTE — motor nodriver (padrão-ouro anti-detecção). Roda SÓ no desktop (IP residencial).
# Uso:  .\captura\rodar-teste.ps1 -Alvo "perfil_publico_de_teste"
param([Parameter(Mandatory=$true)][string]$Alvo)
$env:IG_ENGINE   = "nodriver"
$env:IG_TARGET_USER = $Alvo
Write-Host "▶ motor=nodriver alvo=@$Alvo  (15-200s/post aleatorio, so mouse+screenshot)"
python captura\capture_nodriver.py
