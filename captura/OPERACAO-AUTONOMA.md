# Captura de curtidores — Operação Autônoma (Hermes + poller)

> Estado em 2026-06-23. Captura COMPLETA dos curtidores dos posts do dono
> (@depjorgefelippeneto), rodando sozinha via Hermes no desktop, alimentando o
> politimonitor. Este doc cobre **tudo**: método, fiação, cadência, segurança,
> saídas, pendências e como operar.

---

## 1. Método (como captura)
Logado **COMO o dono** (perfil `C:\jfn\ig-profile-dono`), navega para
`https://www.instagram.com/p/<code>/liked_by/` — uma **página inteira** que lista os
curtidores. Captura:
- **Scroll humano** (gesto CDP `synthesize_scroll_gesture`), em passos de **~1 tela com
  15% de sobreposição** (não pula linhas mesmo se a lista virtualizar).
- Coleta tudo numa **única chamada `tab.evaluate`** (usernames + estado do scroll) —
  sem `select_all` por elemento (que travava em posts grandes).
- **Fim determinístico**: `faltam = scrollHeight − (scrollTop+clientHeight)`; fecha no
  fundo real (`fundo_atingido`) ou se o scroll não avança (`scroll_nao_avanca`).
- Identidade confirmada por cookie `ds_user_id == 1985223190` antes de capturar; se não
  for o dono, **aborta** (não regride ao teto de não-dono ~100).
- 100% humano: sem `fetch` in-page, sem token forjado. (Escuta GraphQL passiva é opcional.)

## 2. ⚠️ Teto de ~1000 (limite do Instagram, NÃO é bug nosso)
A Meta **capa** o nº de curtidores visualizáveis em **~1000** (server-side), mesmo pro
dono (não-dono ~100). Provado: API oficial não lista curtidores (só contagem); o
endpoint privado foi reduzido; nenhum cursor passa do teto. **Não há método client-side
que pegue TODOS de posts com >1000 likes.** Confirmado que o código NÃO corta (totais
variam; deu 1021 > 1000 lendo exatamente o DOM). **Único jeito de exceder:** capturar o
post **repetidamente enquanto ativo e UNIR** (a janela dos ~1000 mais recentes desliza)
— exigiria `salvar_por_post` fazer merge em vez de sobrescrever (NÃO implementado ainda).

## 3. Fiação autônoma (Hermes → poller → runner)
```
Hermes-Cron-Tick (Windows Task, tica 15/15min, Duration 24h)
   → roda  cron-tick.cmd → `hermes cron tick`
cron Hermes "captura-comando"  (0 5,6,7,8,9,10 * * *)
   → --no-agent --script  comandar-captura.py   (em AppData\Local\hermes\scripts)
   → escreve  likers-sync\captura-comando.json
poller_captura.py  (executor, roda na sessão do usuário)
   → lê o comando → roda  capturar_producao.py  (IG_UM_CICLO=1, perfil dono, produção)
   → captura 1 ciclo (6–10 posts) e grava o contrato
```
- **Persistência do poller**: `Startup\bond-poller.bat` (roda `pythonw poller_captura.py`
  no logon, sem janela) — sobrevive a reboot. (Registrar tarefa no Agendador exigia admin.)
- **Tick estendido**: `Hermes-Cron-Tick` Start=23:00, Interval 15min, Duration P1D (antes
  só 05:30–13:30) — cobre a janela 05–10h.

## 4. Cadência (regra do dono)
- **6 runs/dia, 1 por hora, 05h→10h, 7 dias/semana.**
- **6–10 posts por run** (aleatório), **sempre ≥1 post dos últimos 10 dias**.
- **Seg/Qui**: as 2 primeiras runs (05h, 06h) focam os posts **recentes**; as 4 restantes
  são aleatórias (1 recente + resto do backlog).
- Lógica em `selecionar()` (`capturar_producao.py`), localizada pelo relógio
  (`RUN_POR_HORA = {5:1,6:2,7:3,8:4,9:5,10:6}`).

## 5. Segurança / anti-ban (kill-switches)
- **Guard anti-throttle**: captura DEGRADADA (scroll travado, `n≤15` com `api>30`, ou
  colapso vs último) é **DESCARTADA** — NÃO sobrescreve o bom valor no contrato.
- **Abort-on-bloqueio**: 2 capturas degradadas seguidas = conta throttled → **aborta o ciclo**.
- **Cooldown 24h** (`.cooldown_until`): no bloqueio, grava agora+24h; `rodar()` checa no
  topo (antes de abrir o browser) e **não captura** enquanto ativo; auto-expira em 24h.
- **Pausa manual**: criar `likers-sync\.pause_captura` para parar tudo na hora; apagar p/ retomar.
- Tudo é **desktop-only** (`os.name=='nt'`); a VM só ingere.

## 6. Saídas (contrato em likers-sync\ → Syncthing → VM → site)
- `posts-curtidores.json` — `{ "<code>": ["user1",…] }`  ← fonte da verdade
- `likers.json` — ranking `[{username, curtidas}]`  (derivado)
- `posts-meta.json` — `[{code, url, taken_at(epoch s), like_count_api, curtidores_capturados}]`
- `captura-ledger.jsonl` — 1 linha por captura (ok/degradado).
- **NÃO mudar formato sem avisar** — o importador do site (`import-curtidores-por-post.ts`)
  depende dele. O **desktop NÃO grava no banco**; o site ingere do Syncthing.
- **Syncthing**: pasta `likers-sync` (path `c:\jfn\bond`) ↔ ORACLE VM, conectado, em dia.
  Obs.: existe sobreposição com a pasta `bond-sync` (mesmo path) — hoje sem erro, mas vale
  vigiar. Sincroniza o repo inteiro (pesado); `.stignore` seria melhoria.

## 7. Pendências
- [ ] **(admin)** Desativar a task antiga `BondLikersSemanal` (sexta 09:00, roda
  `bond-likers.ps1`→`captura-likers.mjs` método capado que SOBRESCREVE o contrato):
  `Disable-ScheduledTask -TaskName 'BondLikersSemanal'` (PowerShell **como admin**).
- [ ] **Reconsertar 3 posts** corrompidos num throttle (ficaram em 11):
  `DZiOFCvxBAI`, `DZ2m4eEOpE1`, `DZxjaHSuJke` — recaptura quando a conta estiver fresca
  (a cadência de Seg/Qui os repega, ou um run direcionado com `IG_CODES=...`).
- [ ] **>1000 por união** (seção 2): só se o dono quiser passar do teto.
- [ ] **(opcional)** `.stignore` no Syncthing + resolver sobreposição bond-sync/likers-sync.

## 8. Como operar (comandos)
- Status do cron: `hermes cron list`
- Captura ao vivo: `Get-Content C:\jfn\bond\likers-sync\runner.log -Tail 5 -Wait`
- Hermes tiquando: `Get-Content C:\Users\socah\AppData\Local\hermes\logs\cron-tick.log -Tail 5 -Wait`
- Syncthing: GUI em `http://127.0.0.1:8384` (ver likers-sync "Up to Date" + ORACLE VM "Connected")
- Pausar agora: criar `C:\jfn\bond\likers-sync\.pause_captura`  | Retomar: apagar o arquivo
- Forçar descanso 24h: criar `.cooldown_until` com um timestamp ISO futuro
- Run direcionado (manual): `IG_CODES=cod1,cod2 IG_UM_CICLO=1 python captura\capturar_producao.py`

## 9. Arquivos
- `captura/capturar_producao.py` — runner (método dono + cadência + guard + cooldown).
- `captura/poller_captura.py` — executor (lê comando do Hermes, roda o runner).
- `captura/capturar_dono_runner.py` — runner manual dos N recentes (uso pontual).
- `~/AppData/Local/hermes/scripts/comandar-captura.py` — commander do cron (escreve o comando).
- `Startup\bond-poller.bat` — sobe o poller no logon.
- Memória/handoff: `captura/HANDOFF-CAPTURA-OFICIAL.md`.
