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
- **App** (`next`): painel — apoiadores (`/pessoas`), demandas, produtividade, NPS, Telegram, WhatsApp,
  **`/interacoes`** (monitor de quem curtiu/comentou/compartilhou — por data/rede/pessoa, ao vivo) e
  **`/analise`** (Inteligência de Conteúdo — análise profunda de viralização por IA).
- **Worker `hermes`**: IA principal (Gemini → OpenRouter Hermes-405B fallback) — analisa/responde/relatório.
- **Worker `bond`**: agente de **redes sociais** do deputado (Twitter/X, Facebook, Instagram). Sincroniza posts,
  comentários, likes/shares → `BondPost`/`BondComentario`/`BondInteracao`/`BondFa`.
- **Worker `whatsapp`**: WhatsApp via **Baileys** (WhatsApp Web, grátis; conexão por **QR Code**).
- **IA = `gemini-2.5-flash`** (o `gemini-2.0-flash` foi descontinuado — ver §5).

## 2. ESTADO VIVO (deploy autônomo 2026-06-15)
- **Rodando na VM `jfn-core`** (Oracle ARM, a mesma do JFN) em **git worktree** `~/polimonitor`
  (branch `claude/polimonitor-app-ZClUe`, compartilha o `.git` do JFN; **não toca a produção JFN**).
- **5 processos via `pm2`** (online, estáveis, sobrevivem reboot via `pm2 save`+`startup`): `politimonitor`
  (app :3000, 1 instância fork — VM-safe), `bond-worker`, `hermes-worker`, `whatsapp-worker`, **`telegram-worker`**
  (poller do @BondCampanhaBot com comandos vivos — ver §7).
- **Acesso (AMBOS funcionando):** público **http://159.112.188.8:3000** (Security List da Oracle aberta p/ 3000 em
  0.0.0.0/0) · Tailscale **http://jfn-core:3000** (criptografado). Escuta em `*:3000`. **Login OK** (senha `JFNCAMPANHA`).
- **Identidade da instância (resolve confusão):** o **nome Oracle é `JFN-Worker`**, o **hostname do SO é `jfn-core`**
  — MESMA máquina (IP púb 159.112.188.8, priv 10.0.0.208, subnet 10.0.0.0/24=`subnet-20260603-1900`,
  região sa-saopaulo-1, shape A1.Flex). Não existe instância "jfn-core" separada.
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
3. **WhatsApp (QR):** ⏳ PENDENTE (deixado p/ depois pelo dono). O `whatsapp-worker` JÁ roda e **gera o QR a cada
   ~20s** (salva como data-URL em `Configuracao.whatsapp_qr`; `/api/whatsapp` entrega; tela `/whatsapp` exibe).
   Ação: logar no painel → tela *WhatsApp* → escanear (WhatsApp → Aparelhos conectados → Conectar um aparelho).
   Sessão salva em `.whatsapp-auth` (gitignored). ⚠️ **NÃO rodar `npm run whatsapp` à mão** (2ª instância briga com
   o worker do pm2; e `npm` só roda de dentro de `~/polimonitor`). O "code 408 / QR regenerado" no log é normal até escanear.
4. ~~**Facebook + Instagram:**~~ ✅ **LIGADO** (06-15) — `FACEBOOK_PAGE_TOKEN` no `.env` (Page token derivado do User
   token via `me/accounts`; o User token tinha as permissões certas). **Página "Jorge Felippe Neto" (58.533 seg.) +
   Instagram @depjorgefelippeneto (24.224 seg.) conectados** e lendo dados reais (posts, comentários). ⚠️ O Page token
   atual é **curto (~1-2h)** — pra virar permanente preciso da **App Secret** (developers.facebook.com → app → Config →
   Básico → "Mostrar"). **`TWITTER_BEARER_TOKEN`** = ainda PENDENTE (opcional). 🛑 **REUSAR 1 app Meta** (não criar
   vários — gera os duplicados "JFN Monitor e Ideia"; só clique humano cria app, código NÃO cria — verificado).
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
- **⛔ `gemini-2.0-flash` foi DESCONTINUADO** (404 "no longer available", 06-15) — quebrava TODA a IA do app.
  Atualizado p/ **`gemini-2.5-flash`** em `bond.ts`/`hermes.ts`/`ai.ts`/`campanha.ts`. Conferir o catálogo
  (`/v1beta/models?key=`) ao escolher modelo.
- **⛔ Workers (tsx) NÃO carregam `.env` sozinhos** — só o Next (app) carrega. Sem isso o `bond-worker` (sync agendado)
  fica sem `FACEBOOK_PAGE_TOKEN`/chaves. Fix: `import 'dotenv/config'` no `lib/db.ts` (importado por todos). `dotenv` instalado.
- **Instagram NÃO expõe QUEM curtiu** pela API (só a contagem) — `/interacoes` mostra curtidas-por-pessoa só onde a
  rede dá (Facebook likers / Twitter); comentários trazem quem+texto+post. Honesto: 0 ≠ erro, é limite da plataforma.
- **Sync via APP, não worker, p/ teste** (o app tem o `.env` carregado): `POST /api/bond {acao:'sync'}`. Após mudar o
  `.env`, **reiniciar `politimonitor`** (Next lê o `.env` no boot).
- **⛔ Cookie `secure` + HTTP = login quebrado** (bug real 06-15): `secure:true` (era `NODE_ENV==='production'`) faz o
  navegador DESCARTAR o cookie em HTTP puro → login dá 200 mas "volta" pra tela. Fix: `secure` gated por env
  `COOKIE_SECURE` (default false; ativar só com nginx+TLS). 2 pontos: `api/auth/login/route.ts` + `lib/auth.ts`.
- **Firewall:** a VM usa **iptables puro** (NÃO ufw — `ufw` não existe). Liberar porta = `iptables -I INPUT <n> -p tcp
  --dport <p> -j ACCEPT` ANTES do REJECT + `netfilter-persistent save`. **Mas o gate real é a Security List da Oracle**
  (cloud), não o iptables. Testar acesso externo de fora (ex.: `ssh server-1 'curl IP:porta'`) — de dentro da VM o IP
  público falha por *hairpin NAT* (≠ porta fechada).
- **`npm`/`pm2` só de `~/polimonitor`** (root do projeto). `pm2` está em `~/.npm-global/bin` — já no PATH via `.profile`/`.bashrc`.

## 6. BOT @BondCampanhaBot — COMANDOS VIVOS
`src/bot/telegram.ts` (rodando como `telegram-worker` no pm2; `polling:true`). **Bot PRÓPRIO** (token no `.env`, NÃO o
do Yoda). Comandos **gated ao dono** (`TELEGRAM_OWNER_ID`), registrados no menu "/" via `setMyCommands` (escopo do chat):
`/acesso` `/painel` `/whatsapp` `/redes` `/senha` `/ajuda` + **`/status` AO VIVO** (consulta o DB: nº de apoiadores/
mensagens/demandas + fetch da saúde do app). Mensagens de **cidadãos** seguem indo p/ a caixa (`TelegramMensagem`);
mensagens do dono NÃO poluem a caixa. **Captura de credenciais/MFA pelo Telegram** (tokens, códigos) usa leitura passiva
do `state.db` do Yoda — ver o fluxo no JFN (`mfa_telegram`). ⚠️ 1 poller só por bot (2 = conflito 409).

## 7. CHANGELOG
- **06-15 (⭐ redes conectadas + Interações + Inteligência de Conteúdo):** Facebook (Página 58,5k) + Instagram (@dep…,
  24,2k) **conectados** (Page token derivado do User token via `me/accounts`) — lendo posts/comentários reais (244
  pessoas, 909 comentários). Nova tela **`/interacoes`**: quem curtiu/comentou/compartilhou, **filtro por data** com
  presets (hoje/semana/mês/ano/mês-específico) + cards de totais + **modo ao vivo** (auto-refresh 20s) + drill-down nos
  comentários por pessoa. **Fix 06-16:** o filtro por data agora usa a **data REAL** do comentário (`publicadoEm` =
  created_time FB / timestamp IG), não a hora de ingestão (`criadoEm`) — antes o filtro era ignorado. Legado sem
  `publicadoEm` cai no `criadoEm` e é backfillado a cada sync. Nova tela **`/analise`**: IA (`analiseProfunda`) cruza posts reais → o que viralizou/não,
  **benchmark com perfis virais da DIREITA**, **alavancas do algoritmo** (saves/shares/Reels/1ª hora), plano de ação.
  Fixes: **Gemini 2.0→2.5** (2.0 descontinuado, quebrava toda IA) + **dotenv nos workers** (sync agendado = tudo vivo).
  Pendente: **posts do Facebook ainda sincronizam 0** (Página achada, mas `getFacebookPosts` traz 0 — investigar) ·
  Page token curto (falta App Secret p/ longa duração).
- **06-15 (acesso público + login + bot):** Security List da Oracle aberta (porta 3000 pública, validada de fora via
  server-1); **fix do login** (cookie `secure` quebrava em HTTP → `COOKIE_SECURE`); senha `JFNCAMPANHA`; **comandos vivos**
  no @BondCampanhaBot (`telegram-worker`, 5º processo pm2); identidade Oracle esclarecida (JFN-Worker=jfn-core). WhatsApp:
  worker gera QR, falta o dono escanear. iptables 80/443/3000 liberados + persistidos.
- **06-15 (deploy autônomo inicial):** worktree `~/polimonitor` criado; `.env` montado (chaves JFN reusadas, Telegram
  vazio); `npm install` (427 pkg) + Prisma `db push` + `next build` OK; **4 processos no pm2** (app+bond+hermes+whatsapp),
  estáveis, persistidos (save+startup); acesso por Tailscale validado (HTTP 200 no `/login`). Fix `nginx.conf` path
  (`892f6bc`). Itens humanos pendentes no §4 (senha, identidade, QR WhatsApp, tokens de rede). Doc criado.
