# Arquitetura: DESKTOP vs VM — JFN e Bond (FUNDAMENTAL)

> **Por que este doc existe:** o código dos dois repos (JFN e Bond) vive nas DUAS
> máquinas (desktop e VM). O que decide **o que roda onde** são GUARDS e CONFIG, não
> a presença do código. Mexer sem respeitar esta divisão desorganiza tudo e arrisca BAN.
> Última atualização: 2026-06-22 (reflete a arquitetura ATUAL; supera notas antigas
> em RUNBOOK-DESKTOP/CAPTURA-HUMANA-RUNBOOK que falam de 10h/22h e screenshot+OCR).

## As duas máquinas

| | DESKTOP | VM |
|---|---|---|
| SO | Windows 10 | Ubuntu (Oracle Cloud, ARM) |
| IP | **residencial** (varia) | **datacenter** (159.112.188.8) |
| Usuário | `socah` (`C:\...`) | `ubuntu` (`/home/ubuntu/...`) |
| Papel | **captura / coleta** (precisa de IP residencial) | **produção 24/7**: serve sites, ingere, publica, orquestra |
| Hermes | `C:\Users\socah\AppData\Local\hermes\` (agente local) | instância própria (gateway/bot/workers) |

## ⛔ REGRAS DE FERRO (não violar)

1. **Captura e LOGIN do Instagram = SÓ no DESKTOP.** IP de datacenter = ban na hora.
   Todos os entrypoints que tocam o IG têm guard `garantir_somente_desktop()` /
   `IG_CAPTURE_DISABLED` que **aborta (exit 9) se `os.name != 'nt'`** (a VM é Linux).
   Guardados: `captura/capture_nodriver.py`, `captura/capture.mjs`→`lib/flow.mjs`,
   `captura/login_nodriver.py`, `captura/validar_captura.py`, `captura/capturar_producao.py`.
   A VM PODE ter as cópias (git/Syncthing) — elas se recusam a rodar. `parse_likers.py`
   NÃO tem guard de propósito: só faz OCR de prints locais, não acessa o IG → roda na VM.

2. **Telegram / bot "Yoda" = SÓ na VM.** O desktop NÃO usa Telegram (senão conflita:
   "terminated by other getUpdates"). No `.env` do Hermes desktop o `TELEGRAM_BOT_TOKEN`
   está COMENTADO de propósito → o gateway do desktop não sobe a plataforma Telegram.

3. **Coleta SIAFE/DOERJ/SEI (Chrome 9222, JFN) = DESKTOP** (usa CPF/sessão pessoal); a VM
   só faz fallback HTTP de dados públicos. Mesma lógica do IG: o que é pessoal/sessão fica no desktop.

4. **Update-safe:** NUNCA editar arquivos dentro do repo clonado do Hermes
   (`...\hermes\hermes-agent\`) — o `git stash/pull` do `hermes update` quebra. Só mexer em
   config do usuário (`.env`, `config.yaml`, `webui/settings.json`, `gateway-service/`,
   `~/.hermes/scripts/`) e tarefas do Windows.

## Distribuição de código e dados

| Repo | Desktop | VM | Como distribui |
|---|---|---|---|
| **JFN** | `C:\jfn\jfn` | `/home/ubuntu/JFN` (Docker) | **git pull** (código). Sem Syncthing. |
| **Bond** | `C:\jfn\bond` | `/home/ubuntu/...` (PM2/Next.js) | **git** (código) + **Syncthing** (dados de captura) |

**Pastas Syncthing** (config em `%LOCALAPPDATA%\Syncthing\config.xml`):
- `bond-sync` → `C:\jfn\Bond` (repo Bond)
- `likers-sync` → `C:\jfn\bond` (saída da captura: `likers-sync/*.json`)
- `vault` → `C:\Users\socah\jfn` (Obsidian + `hermes-migracao/` = chaves mestras)

> Como o repo Bond inteiro sincroniza por Syncthing, **os guards chegam na VM mesmo sem
> git push**. Já o JFN depende de `git pull` na VM.

## REPO JFN — quem faz o quê

| | DESKTOP | VM |
|---|---|---|
| Auditor compliance (SIAFE2/DOERJ/SEI/PNCP) | ✅ Chrome 9222 + OCR CAPTCHA (sessão pessoal) | fallback HTTP de dados públicos (Docker) |
| API/painel (porta 8000) | dev/teste (`HERMES.bat`/`hermes.ps1`) | produção 24/7 (`docker compose`) |
| Hermes "Auditor 24h" | opcional | ✅ ciclo contínuo |
| **Fix de gateway/update** | — | (o dono committa aqui; aplicar no desktop é update-safe) |

## REPO BOND — quem faz o quê

| | DESKTOP | VM |
|---|---|---|
| **Captura de curtidores** (`captura/`) | ✅ ÚNICO lugar — Chrome real, método exato | ⛔ guardado (não roda) |
| Site **politimonitor** (Next.js, :3000) | — | ✅ produção (PM2) |
| **`/api/ingest`** (recebe curtidores do desktop) | — | ✅ |
| Workers PM2 (bond/hermes/telegram/whatsapp) | — | ✅ |
| OCR/import dos likers | (não precisa: método novo já dá usernames) | `parse_likers.py` (legado) + `import-likers-sync.ts` |

### Fluxo da captura (ATUAL)
```
DESKTOP (IP residencial)                         VM (IP datacenter)
─────────────────────────────────────────────   ──────────────────────────────
capturar_producao.py  (método EXATO: gesto CDP
  em background + união de usernames do DOM)
  → likers-sync/{posts-curtidores,likers,        Syncthing →  ~/likers-sync/
     posts-meta}.json                                         import-likers-sync.ts (cron 5min)
                                                              → BD → politimonitor :3000 (PRIVADO, só o dono)
```
- **Método exato** (DOM-union) substitui o screenshot→Gemini-OCR antigo (que perdia gente).
  Validado: post `DWrerwnj6yP` = 50 únicos == like_count 50 da Meta API.
- **Índice de posts** via Meta Graph API: `captura/indexar_posts.py` → `posts-index.json`
  (2615 posts, permalink+like_count+timestamp). Token `FACEBOOK_PAGE_TOKEN` é de produção.
- **Agenda (alvo):** início 05:30–05:45, ~1 ciclo/h (jitter ±10min), 5 posts/h, ~8h/dia (40/dia);
  ciclo 1 = 2 dos 10 recentes (rotativo) + 3 antigos; depois backlog antigo; Seg/Qui prioriza os 10
  recentes. Timing humano 1–12s em tudo. Conta teste (itsbernardof) capa ~104; conta real sem cap.

## Config específica por máquina (não misturar)

**DESKTOP** (`captura/.env` e `.env` do Hermes desktop):
- `IG_PROFILE_DIR=C:\jfn\ig-profile` (perfil logado), `IG_TARGET_USER=depjorgefelippeneto`
- `LIKERS_OUT_DIR=C:\jfn\bond\likers-sync`
- `TELEGRAM_BOT_TOKEN` **COMENTADO** (desktop não usa Telegram)
- `SIAFE_USER/SIAFE_PASS` (JFN, sessão pessoal)

**VM**:
- paths `/home/ubuntu/...`, `DATABASE_URL`, `NEXT_PUBLIC_APP_URL=http://IP:3000`
- `FACEBOOK_PAGE_TOKEN` (Meta, produção), `TELEGRAM_BOT_TOKEN` (o bot **da VM**)
- `AUTH_SECRET`, `ADMIN_PASSWORD` (login do painel)

> Chaves mestras de todos os provedores: `hermes-migracao/TODAS-as-chaves.env` (Syncthing vault).
> Aplicadas nas duas máquinas, mas **cada lado neutraliza o que não deve rodar**
> (desktop: sem Telegram; VM: captura guardada).
