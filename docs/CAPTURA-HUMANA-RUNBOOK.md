# RUNBOOK — Captura HUMANA de curtidores (orquestrada pelo Hermes)

> **Objetivo:** capturar quem curtiu posts do Instagram sem que a Meta detecte automação.
> Risco real de **ban** se bloquear de novo (palavra do dono). Por isso: **conta-teste primeiro**,
> volume baixo, tempos aleatórios, e **nada de testar pela VM** (IP de datacenter = ban na hora).
> Atualizado: 2026-06-18.

---

## 1. A grande virada (por que o método antigo era pego)
Pesquisa em fontes especializadas (Castle.io, AlterLab, Proxidize, Scrapfly — 2026):

- **A Meta distingue toque humano de "script injetando código" e bane na hora.** → O método antigo
  (`fetch()` injetado em `/api/v1/media/<pk>/likers/` + `scrollTop=`) é exatamente o padrão pego.
  Aliás esse endpoint REST **já morreu** pra conta (devolve HTML) — sintoma do bloqueio.
- **O próprio Playwright é detectável por fingerprint**, mesmo com mouse perfeito: expõe
  `window.__pwInitScripts` / `__playwright__binding__`, `navigator.webdriver`, e side-effects de CDP
  (incl. `Runtime.enable`). Parte do risco é a **ferramenta**, não o comportamento.
- **O que MAIS importa e já está certo:** IP residencial (desktop), 1 conta, **volume baixo + tempos
  aleatórios**. "Uma técnica que serve pra 100/dia falha em 10.000/dia." TLS/JA3 não dá pra corrigir
  por software — mas Chrome real + IP residencial já é normal.

**Decisão:** capturar só com **input de usuário real (mouse/roda/teclado) + SCREENSHOT**, e extrair os
usernames **DEPOIS, fora do Instagram** (parser na VM). Zero injeção de código na página.

---

## 2. Arquitetura (duas fases que nunca se misturam)

```
DESKTOP (IP residencial, Hermes dirige)                VM jfn-core (NÃO toca o IG)
────────────────────────────────────────              ─────────────────────────────
captura/  (3 motores, MESMA saída)                     parse/parse_likers.py (Gemini visão)
  capture.mjs        IG_ENGINE=cdp|playwright            lê os prints → @usernames
  capture_nodriver.py IG_ENGINE=nodriver                 dedup → likers.json + posts-meta.json
   → mouse + screenshot, 15–200s/post aleatório   ──┐         │ grava em LIKERS_OUT_DIR
   → shots/<target>/<code>/{post_1.png,             │ Syncthing │
        likes_NNNN.png, manifest.json}              └──────────▶ scripts/import-likers-sync.ts (cron 5min)
                                                                  → BondFa → site /interacoes
```

**Os 3 motores, do mais seguro ao menor esforço:**
| Motor | `IG_ENGINE` | Rastros | Quando |
|---|---|---|---|
| **nodriver** (Python) | `nodriver` | CDP-nativo, **sem** globals de Playwright, sem webdriver | padrão-ouro — preferir |
| **CDP cru** (Node) | `cdp` | sem Playwright, sem `Runtime.evaluate`, coords via DOM domain | ótimo, fica em Node |
| **Playwright** (Node) | `playwright` | risco residual dos globals do Playwright | comparação / menor mudança |

Todos escrevem **a mesma saída** → o parser e o site não sabem (nem se importam com) qual motor rodou.

---

## 3. Pré-requisitos no desktop (uma vez)
1. **Chrome real instalado** + um **perfil dedicado** logado no Instagram (`C:\jfn\ig-profile`).
   Logar **na mão** a primeira vez (usuário+senha+2FA); a sessão fica salva no perfil.
2. Para os motores `cdp` e `playwright` conectado — abrir o Chrome com depuração:
   ```
   chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\jfn\ig-profile"
   ```
3. Para o motor `nodriver`: `pip install nodriver`.
4. `copy captura\.env.example captura\.env` e preencher (ver §6).

---

## 4. ⚠️ Conta-teste ANTES da sua (ordem obrigatória)
1. Criar uma **conta fake** (sem post nenhum), logar no perfil dedicado do desktop.
2. Rodar a captura mirando um **perfil PÚBLICO de outra pessoa** (`IG_TARGET_USER=<perfil>`),
   testando os 3 motores um a um. Conferir nos prints se o modal de curtidas abriu de verdade.
3. **Limite conhecido (Lição 5):** como **não-dono**, a Meta corta os curtidores em **~100/post**.
   Isso é teto de servidor, não bug — serve só pra validar o mecanismo.
4. Só depois de o pipeline rodar limpo na conta-teste, apontar pra **sua** conta como **dono**
   (logar como você, `IG_TARGET_USER` vazio → usa `IG_PERFIL`). Como dono, a lista vem completa.

---

## 5. Como o Hermes roda (passo a passo)
**Desktop — captura (1 motor por vez no teste; o escolhido em produção):**
```bash
# motor CDP cru (precisa do Chrome aberto com --remote-debugging-port=9222)
IG_ENGINE=cdp        IG_TARGET_USER=<perfil_teste> node captura/capture.mjs
# motor Playwright
IG_ENGINE=playwright IG_TARGET_USER=<perfil_teste> node captura/capture.mjs
# motor nodriver
IG_ENGINE=nodriver   IG_TARGET_USER=<perfil_teste> python captura/capture_nodriver.py
```
Saída: `captura/shots/<target>/<code>/` com `post_1.png`, `likes_0001.png…`, `manifest.json`.
O Syncthing leva pra VM (`~/likers-sync/captura/shots/`).

**VM — depuração (NÃO toca o IG):**
```bash
cd ~/likers-sync && python3 parse/parse_likers.py     # ou: bash parse/run-parse.sh
```
Gera `likers.json` + `posts-meta.json` em `LIKERS_OUT_DIR`. O **cron de import (5min)** já
joga no site — `scripts/import-likers-sync.ts` foi corrigido p/ achar o arquivo certo (busca a
`likers.json` mais recente sob `~/likers-sync`, resolve o bug do caminho aninhado).

**Detecção de bloqueio (o "0 curtidores" que era confundido com sucesso):**
- A captura **aborta** se o modal não abrir em `IG_MAX_FALHAS` posts seguidos (não martela).
- O parser **marca `suspeita_bloqueio`** quando o modal abriu mas vieram **0 usernames** — aí dá pra
  olhar o `likes_0001.png` e ver com o olho se foi bloqueio ou post realmente sem curtidas.

---

## 6. Depuração com a assinatura **Gemini Plus** (OAuth, sem custo de API)
Por padrão o parser usa `GEMINI_PROVIDER=apikey` (free tier do `gemini-2.5-flash` — cobre o volume,
roda headless, zero login). Para usar a **cota da sua assinatura Plus** com `gemini-2.5-pro`:

1. No Hermes: configurar o provider Google como **OAuth + Code Assist** (não AI Studio) em
   `~/.hermes/config.yaml`; reiniciar; clicar no link de auth e logar na conta do Plus.
2. Salvar o **access token** num arquivo e apontar o parser:
   ```bash
   GEMINI_PROVIDER=oauth GEMINI_OAUTH_TOKEN_FILE=~/.hermes/gemini_oauth_token \
   GEMINI_MODEL=gemini-2.5-pro python3 parse/parse_likers.py
   ```
   (Se o endpoint do Code Assist diferir, setar `GEMINI_ENDPOINT`.)
3. Fallback automático: se o Gemini falhar (cota/erro), o parser cai no **OpenRouter visão grátis**
   (`OPENROUTER_API_KEY` já existe) — então o pipeline nunca trava por causa de billing.

> Nota honesta: a assinatura do **app** Gemini Plus é separada da **API key**. O token OAuth do
> Code Assist é o que dá a cota da assinatura para chamadas programáticas; o passo 1 exige **um login
> interativo seu** (uma vez). Sem isso, o `apikey` free tier já resolve este volume.

---

## 7. Regras de segurança (não negociáveis)
- 🛑 **Nunca rodar a captura pela VM** (IP de datacenter = ban). Captura só no desktop residencial.
- 🛑 **`.pause_captura`**: se existir em `~/likers-sync` / `LIKERS_OUT_DIR` / `shots`, a captura sai
  sem tocar o IG. A VM cria esse arquivo quando suspeita de bloqueio; só apagar após cooldown.
- ⏳ **Pouco e devagar:** `IG_NUM_POSTS` baixo, 1 execução por dia no máximo, tempos 15–200s aleatórios,
  descansos longos a cada 3–7 posts. Se bloquear, **parar** e esfriar (24–48h).
- 🔭 Conferir os prints depois: se vierem vazios/estranhos, é bloqueio — não insistir.
```
