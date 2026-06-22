#!/bin/bash
cd /home/ubuntu/polimonitor || exit 1
/home/ubuntu/polimonitor/node_modules/.bin/tsx scripts/import-likers-sync.ts
# Curtidores POR POST (datados) -> BondInteracao: habilita o filtro por data na aba /interações.
/home/ubuntu/polimonitor/node_modules/.bin/tsx scripts/import-curtidores-por-post.ts
