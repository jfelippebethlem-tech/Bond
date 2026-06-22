# Captura de curtidores na conta DONA (@depjorgefelippeneto) — RESOLVIDO

> Atualizado 2026-06-22. O método do dono está **provado e em produção**. Este doc
> substitui o handoff antigo (que perseguia 2 "bugs" de clique no "N curtidas" —
> eram FANTASMA, ver seção "Lições").

## Método (definitivo)
Logado **COMO o dono**, a página `https://www.instagram.com/p/<code>/liked_by/` é uma
**PÁGINA inteira** (não modal) que lista **TODOS** os curtidores — sem o teto de ~100-103
que a Meta impõe a não-donos. Captura:

1. Navegar pra `/p/<code>/liked_by/`.
2. Rolar no **ritmo humano** (gesto CDP `synthesize_scroll_gesture`, 1–12s entre scrolls).
3. A cada scroll, unir os usernames da lista (`a[href^="/"]` de 1 segmento) — DOM-union.
4. **Escuta GraphQL passiva** em paralelo (lê o JSON que a página já buscou; rede de
   segurança p/ posts grandes). NUNCA faz `fetch` in-page nem forja token — 100% humano.
5. **Fim de scroll determinístico:** container no fundo (`scrollTop+clientHeight ≈
   scrollHeight`) + altura parou de crescer + sem spinner + nada novo, por 3 leituras
   (`motivo=fim_firme`). Fallback: nenhum nome novo por 12 voltas (`motivo=sem_novo_12`).

## Conta / perfil
- Perfil dedicado do dono: `C:\jfn\ig-profile-dono` (login manual 1x, persiste).
- Confirmação de identidade: cookie `ds_user_id == 1985223190` (@depjorgefelippeneto).
  Multi-conta: deixar o dono como conta **ATIVA**. Se não for o dono, o runner **ABORTA**
  (não regride ao teto ~100).

## Como rodar
- **Manual, N recentes:** `python captura/capturar_dono_runner.py` (`IG_N=10`, ou `IG_CODES=a,b`).
- **Produção/agendado:** `captura/capturar_producao.py` (método do dono + agenda/seleção/
  ledger originais). Escreve o contrato em `likers-sync/` → Syncthing → VM → politimonitor.
  - 1 ciclo: `IG_UM_CICLO=1` (ou `IG_CODES=...`). Teste rápido de scroll: `IG_SCROLL_MIN/MAX`.
- **Poller (Hermes comanda → poller executa):** `captura/poller_captura.py` (default perfil
  do dono, produção). Religar o cron quando quiser: `hermes cron resume captura-comando`
  (hoje não há cron — recriar se for usar o agendamento).

## Contrato de saída (em likers-sync/, alimenta o politimonitor)
- `posts-curtidores.json` — `{ code: [usernames] }` (fonte da verdade).
- `likers.json` — ranking `[{username, curtidas}]` (derivado).
- `posts-meta.json` — `[{code,url,taken_at,like_count_api,curtidores_capturados}]` (derivado).
- `captura-ledger.jsonl` — 1 linha por captura.

## Resultado validado (2026-06-22)
10 posts recentes capturados COMPLETOS (vs teto antigo de 100):
`180, 1021, 475, 327, 206, 423, 545, 438, 235, 286` → 2845 curtidores únicos no ranking.
9 de 10 vieram **≥ like_count** (prova de completude). O de `like_count=1818` rendeu 1021 —
a diferença (~797) são curtidas do **Facebook** do post cross-postado (NÃO é falha de captura;
`like_count` da Graph API soma IG+FB).

## Lições (não repetir)
- **O clique no "N curtidas" era FANTASMA.** A sessão anterior estava logada no
  `will turner mattos` (não-dono, teto 103) achando que era o dono — daí o teto e os "2 bugs".
  Confirmar SEMPRE a conta ativa (`ds_user_id`) antes de concluir qualquer "teto".
- `tab.get_content()` não é confiável no IG (React) — usar `select_all` + `get_html()`.
- `tab.find(text)` TRAVA. Handlers de Network do nodriver têm que ser `async def (evt, conn=None)`.
- Console do Windows é cp1252 — `sys.stdout.reconfigure(encoding="utf-8")` (emoji crasha).
- Tudo é desktop-only (anti-ban): `os.name=='nt'`; a VM só ingere.
