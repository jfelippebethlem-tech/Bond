#!/bin/bash
set -e

echo "=== Atualizando PolitiMonitor ==="

# Vai para a raiz do projeto a partir da localização deste script (artefato autônomo)
cd "$(dirname "$0")/.."

git fetch origin
git pull origin claude/polimonitor-app-ZClUe

npm ci
npx prisma db push          # aplica mudanças do schema (este projeto usa db push, não migrations)
npm run build

mkdir -p logs
cp deploy/ecosystem.config.js ./ecosystem.config.js
pm2 reload ecosystem.config.js --update-env

echo "=== Atualização concluída! ==="
pm2 status
