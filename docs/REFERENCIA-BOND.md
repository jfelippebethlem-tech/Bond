# PolitiMonitor / BOND — DOCUMENTO ÚNICO DE REFERÊNCIA

> **Doc de referência do projeto BOND/PolitiMonitor** (separado do JFN — decisão do dono 2026-06-15:
> "o documento-referência agora vai ser dividido"). Mantido ENXUTO: estado vivo + deploy + o que depende do dono.
> Detalhe vai pro git. **Honestidade sempre.** Estética de entregável (padrão do dono).

Última atualização: 2026-06-15.

---

## 1. O QUE É
**PolitiMonitor** = app de **gestão de gabinete + monitoramento de redes** para **Deputado Estadual (RJ)**.
Stack: **Next.js 14** (React/Tailwind) + **Prisma (SQLite)** + agentes de IA. Nasceu como branch do repo JFN
(`claude/polimonitor-app-ZClUe`) mas é **projeto SEPARADO** (remove o tooling Python do JFN). **Ideal futuro: repo próprio.**
- **App** (`next`): painel — apoiadores (`/pessoas`), demandas, produtividade, NPS, Telegram, WhatsApp.
- **Worker `hermes`**: IA principal (Gemini → OpenRouter Hermes-405B fallback) — analisa/responde/relatório.
- **Worker `bond`**: agente de **redes sociais** do deputado (Twitter/X, Facebook, Instagram).
- **Worker `whatsapp`**: WhatsApp via **Baileys** (WhatsApp Web, grátis; conexão por **QR Code**).

## 2. ESTADO VIVO (deploy autônomo 2026-06-15)
- **Rodando na VM `jfn-core`** (Oracle ARM, a mesma do JFN) em **git worktree** `~/polimonitor`
  (branch `claude/polimonitor-app-ZClUe`, compartilha o `.git` do JFN; **não toca a produção JFN**).
- **4 processos via `pm2`** (online, estáveis, 0 restart): `politimonitor` (app :3000, 1 instância fork — VM-safe),
  `bond-worker`, `hermes-worker`, `whatsapp-worker`. **`pm2 save` + `pm2 startup` feitos → sobrevive reboot.**
- **Acesso:** **http://100.123.89.59:3000** (Tailscale — dono está na tailnet) · público `http://159.112.188.8:3000`
  só se a Security List da Oracle liberar a :3000. Escuta em `*:3000`.
- **DB:** `prisma/prod.db` (SQLite, `db push` aplicado, todas as tabelas criadas).
- **Build:** `npm run build` OK (prisma generate + next build). `npm install` = 427 pacotes.
- **`.env`** (`~/polimonitor/.env`, chmod 600, gitignored): `AUTH_SECRET` (gerado), `ADMIN_PASSWORD` (TEMP — trocar),
  `GEMINI_API_KEY` + `OPENROUTER_API_KEY` (reusadas do JFN), `DEPUTY_NAME="Jorge Felippe Neto"` / `DEPUTY_PARTY=PL` /
  `DEPUTY_STATE=RJ`, `TELEGRAM_BOT_TOKEN` = **@BondCampanhaBot** (bot PRÓPRIO do dono, NÃO o do Yoda → sem conflito 409).
  `DATABASE_URL="file:./prod.db"`.

## 3. COMO OPERAR
```bash
cd ~/polimonitor                         # worktree do projeto
export PATH="$HOME/.npm-global/bin:$PATH"
pm2 ls                                    # status dos 4 processos
pm2 logs politimonitor                    # logs do app (ou bond-worker/hermes-worker/whatsapp-worker)
pm2 restart all                           # reiniciar tudo
git pull && npm install && npm run build && pm2 restart all   # atualizar (na branch)
```
Logs ficam em `~/polimonitor/logs/`. Config pm2 = `~/polimonitor/ecosystem.config.js` (cópia da raiz, app=1 instância
fork p/ VM-safe; o original `deploy/ecosystem.config.js` mantém 2 cluster p/ máquinas maiores).

## 4. ⚠️ O QUE DEPENDE DO DONO (itens humanos)
1. ~~**Senha admin:**~~ ✅ **FEITA** (definida pelo dono — só no `.env`, fora do git). 06-15
2. ~~**Identidade:** `DEPUTY_NAME`/`DEPUTY_PARTY`~~ ✅ **FEITO** (Jorge Felippe Neto / PL / RJ — 06-15).
3. **WhatsApp (QR):** abrir `/whatsapp` no painel (logado) e **escanear o QR** com o celular → conecta a sessão
   (salva em `.whatsapp-auth`, gitignored). Sem isso o worker WhatsApp fica aguardando. ⏳ PENDENTE
4. **Redes (opcional, p/ o Bond):** `TWITTER_BEARER_TOKEN`/`TWITTER_USERNAME` (developer.twitter.com) e
   `FACEBOOK_PAGE_TOKEN` (developers.facebook.com, Página + Instagram Business). Sem eles o Bond roda mas sem dados.
5. ~~**Telegram próprio:**~~ ✅ **FEITO** (token do **@BondCampanhaBot** no `.env`; bot separado do Yoda — 06-15).
6. **Acesso público (opcional):** liberar a porta 3000 (ou 80 via nginx) na **Security List da Oracle** se quiser
   acesso fora da Tailscale. O `deploy/setup.sh` configura nginx (path já auto-detectado — fix `892f6bc`).
7. **Repo próprio (ideal):** migrar de branch do JFN para um repositório dedicado.

## 5. DECISÕES / LIÇÕES
- **NUNCA o token do Yoda no Telegram do PolitiMonitor** (2 pollers no mesmo bot = conflito `getUpdates` 409).
- **Worktree, não checkout na árvore JFN** — a branch deleta o tooling Python do JFN; isolar protege a produção.
- **`ecosystem.config.js` roda da RAIZ** (`__dirname`); em `deploy/` ele procura `deploy/node_modules` (erro). O
  `setup.sh` copia pra raiz — replicado no deploy manual.
- **nginx.conf** tinha `/root/JFN` fixo → quebrava assets; agora `__APP_DIR__` + substituição no `setup.sh` (`892f6bc`).
- App = **1 instância fork** nesta VM (2 vCPU compartilhada com o JFN) — não usar cluster 2x aqui.

## 6. CHANGELOG
- **06-15 (deploy autônomo inicial):** worktree `~/polimonitor` criado; `.env` montado (chaves JFN reusadas, Telegram
  vazio); `npm install` (427 pkg) + Prisma `db push` + `next build` OK; **4 processos no pm2** (app+bond+hermes+whatsapp),
  estáveis, persistidos (save+startup); acesso por Tailscale validado (HTTP 200 no `/login`). Fix `nginx.conf` path
  (`892f6bc`). Itens humanos pendentes no §4 (senha, identidade, QR WhatsApp, tokens de rede). Doc criado.
