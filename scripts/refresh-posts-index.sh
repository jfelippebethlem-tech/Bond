#!/bin/bash
# Atualiza o posts-index.json do coletor de curtidores DIRETO DA VM (Graph API, HTTP puro).
#
# Por quê daqui: no desktop o refrescar_index falha SEMPRE — o indexar_posts.py procura as chaves
# em C:\Users\socah\...\TODAS-as-chaves.env, que não existe naquela máquina, e o poller não injeta
# FACEBOOK_PAGE_TOKEN/INSTAGRAM_BUSINESS_ID no ambiente. Índice congelado => selecionar() nunca vê
# post novo => a captura fica só no backlog antigo (foi assim de 22/06 a 04/07).
# A VM TEM as chaves (.env do polimonitor); escrevemos o índice na pasta sincronizada e o
# Syncthing entrega ao desktop antes da janela de captura (05–10h). É a ÚNICA escrita da VM na
# pasta sincronizada — o desktop só escreve esse arquivo se o reindex local dele voltar a funcionar.
cd /home/ubuntu/likers-sync/captura || exit 1
export $(grep -E '^(FACEBOOK_PAGE_TOKEN|INSTAGRAM_BUSINESS_ID)=' /home/ubuntu/polimonitor/.env | tr -d '"' | xargs)
python3 indexar_posts.py 2>&1 | tail -3
