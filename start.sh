#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
#  PolitiMonitor — Script de inicialização único
#  Uso: ./start.sh
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

header() { echo -e "\n${BOLD}${BLUE}══ $1 ══${NC}"; }
ok()     { echo -e "  ${GREEN}✅ $1${NC}"; }
warn()   { echo -e "  ${YELLOW}⚠️  $1${NC}"; }
err()    { echo -e "  ${RED}❌ $1${NC}"; }
info()   { echo -e "  ℹ️  $1"; }

echo -e "${BOLD}"
echo "  ╔═══════════════════════════════════╗"
echo "  ║   🏛️   PolitiMonitor  v0.1.0      ║"
echo "  ║   Sistema de Gestão do Gabinete   ║"
echo "  ╚═══════════════════════════════════╝"
echo -e "${NC}"

# ── 1. Verificar Node.js ───────────────────────────────────────────────────────
header "Verificando dependências"

if ! command -v node &>/dev/null; then
  err "Node.js não encontrado. Instale em https://nodejs.org"
  exit 1
fi

NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
ok "Node.js $NODE_VER"

# ── 2. Verificar .env ──────────────────────────────────────────────────────────
header "Configuração"

if [ ! -f ".env" ]; then
  warn ".env não encontrado — criando a partir de .env.example..."
  if [ -f ".env.example" ]; then
    cp .env.example .env
    warn "Arquivo .env criado. Edite-o com suas chaves antes de continuar."
    warn "Abrindo .env para edição (Ctrl+C para pular)..."
    sleep 2
    "${EDITOR:-nano}" .env 2>/dev/null || warn "Edite .env manualmente depois."
  else
    err ".env.example também não encontrado!"
    exit 1
  fi
else
  ok ".env encontrado"
fi

# Exporta variáveis do .env para o processo atual
set -o allexport
# shellcheck disable=SC1091
source .env 2>/dev/null || true
set +o allexport

# Verifica variáveis obrigatórias
missing=0
for var in AUTH_SECRET ADMIN_PASSWORD DATABASE_URL; do
  if [ -z "${!var:-}" ]; then
    err "Variável $var não configurada no .env"
    missing=1
  fi
done
[ "$missing" -eq 1 ] && exit 1
ok "Variáveis obrigatórias presentes"

# Avisa sobre IA
if [ -z "${GEMINI_API_KEY:-}" ] && [ -z "${OPENROUTER_API_KEY:-}" ]; then
  warn "Nenhuma chave de IA configurada — IA ficará desativada"
  info "Obtenha grátis: GEMINI_API_KEY em aistudio.google.com"
  info "              OPENROUTER_API_KEY em openrouter.ai (para Hermes)"
else
  [ -n "${GEMINI_API_KEY:-}" ]     && ok "Gemini AI configurado"
  [ -n "${OPENROUTER_API_KEY:-}" ] && ok "OpenRouter (Hermes) configurado"
fi

[ -n "${TELEGRAM_BOT_TOKEN:-}" ] && ok "Telegram Bot configurado" || info "Telegram não configurado (opcional)"

# ── 3. Instalar dependências ────────────────────────────────────────────────────
header "Dependências npm"

if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules/.package-lock.json" ]; then
  info "Instalando dependências..."
  npm install --silent
  ok "Dependências instaladas"
else
  ok "node_modules já atualizado"
fi

# ── 4. Banco de dados ───────────────────────────────────────────────────────────
header "Banco de dados"

info "Sincronizando schema..."
npx prisma db push --skip-generate 2>&1 | grep -E "Done|sync|error" || true
ok "Banco de dados sincronizado"

# ── 5. Rodar testes ─────────────────────────────────────────────────────────────
header "Testes"

if npm test 2>&1; then
  ok "Todos os testes passaram"
else
  err "Alguns testes falharam — verifique o .env e tente novamente"
  echo ""
  read -rp "  Continuar mesmo assim? (s/N) " resp
  [[ "$resp" =~ ^[sS]$ ]] || exit 1
fi

# ── 6. Build de produção ou modo dev ────────────────────────────────────────────
header "Iniciando"

MODE="${1:-dev}"

if [ "$MODE" = "prod" ]; then
  info "Fazendo build de produção..."
  npm run build
  echo ""
  ok "Build concluído!"
  echo ""
  echo -e "  ${BOLD}Iniciando em modo produção...${NC}"
  echo -e "  ${GREEN}Acesse: http://localhost:3000${NC}"
  echo -e "  ${GREEN}Senha:  ${ADMIN_PASSWORD:-admin123}${NC}"
  echo ""
  npm run launch
else
  echo ""
  echo -e "  ${BOLD}Iniciando em modo desenvolvimento...${NC}"
  echo -e "  ${GREEN}🏛  App:    http://localhost:3000${NC}"
  echo -e "  ${GREEN}🪽  Hermes: rodando em paralelo${NC}"
  echo -e "  ${YELLOW}Senha:  ${ADMIN_PASSWORD:-admin123}${NC}"
  echo ""
  echo -e "  ${BOLD}Pressione Ctrl+C para parar tudo.${NC}"
  echo ""
  npm run launch
fi
