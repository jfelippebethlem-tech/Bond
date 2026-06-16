# STATUS da captura de curtidores — PARADO no teto anti-ban (5/5)

Data: 2026-06-16. Branch: `likers-dom-scrape-wip`.

## TL;DR
O bug original ("getLikers recebe HTML") está **diagnosticado e explicado**, mas
a captura **ainda não foi validada com curtidores reais**. Parei por ter batido
o limite OBRIGATÓRIO de 5 execuções anti-ban no dia, com fortes sinais de que a
conta entrou em throttle/soft-block nesta sessão.

## O que foi descoberto (sólido)
1. REST `/api/v1/media/<pk>/likers/` está **morto pro web**: HTTP 200 `text/html`
   (shell do app), não JSON. Vale pra `ctx.request` E pra `fetch` in-page, com pk
   numérico. **Não era** bug de método nem de id.
2. O modal `liked_by` carrega via **`POST /graphql/query`** (application/json).
   Sniffer (#3) capturou: doc_ids candidatos `27258191930500454` e
   `27228895850083205`. Ver `sniff-likers.json`.

## O que foi implementado
`getLikersDOM()` reescrito: navega no post → escuta respostas → abre os
curtidores → lê o JSON do `/graphql/query` (primário) + scrape do modal
`role="dialog"` (fallback). Não precisa forjar tokens (fb_dtsg/lsd).

## Por que ainda não funcionou (execuções #4 e #5)
- #4 (navegação direta a `/p/<code>/liked_by/`): `sem_dialog`.
- #5 (navega no post + clica curtidas, fluxo do sniffer): `graphqlCaps=0`,
  DOM=0, API=0 — **nenhuma** requisição de curtidores disparou.
- No sniffer #3 (mesmo fluxo) as requisições DISPARARAM. A diferença de
  comportamento entre #3 e #5, somada a: enxurrada de ~2663 chamadas falhas de
  um script externo + página caindo 2x + 5 sessões no mesmo dia, aponta para
  **throttle/soft-block temporário da conta**, não bug de código.

## Próximos passos (quando houver execução disponível DE NOVO)
> ⚠️ Só depois de um COOLDOWN (idealmente no dia seguinte, IP residencial). Hoje
> não — `CLAUDE_LOCK.json` segue ATIVO de propósito pra impedir que o Hermes/cron
> de sexta martele uma conta possivelmente bloqueada.

1. Confirmar saúde da conta: abrir o IG no perfil `C:\jfn\ig-profile` na mão e
   ver se há checkpoint/"atividade suspeita". Se houver, resolver manualmente.
2. Reproduzir o fluxo do sniffer (escutar `response` ANTES do `page.goto`) — no
   #5 o listener foi anexado depois; voltar a anexar antes do goto pode ser o que
   faltou pra capturar o `/graphql/query`.
3. Se o modal voltar a carregar, o `getLikersDOM` atual já deve extrair (DOM+API).
4. Plano B: replicar o `POST /graphql/query` com o doc_id de likers + tokens
   (fb_dtsg/lsd/__hs do `__hsdp`) lidos da própria página.
5. Ao validar: commitar, `git push`, restaurar `IG_NUM_POSTS=30`, e só então
   liberar `CLAUDE_LOCK.json` (apagar / `ativo:false`).

## Orçamento anti-ban
5/5 execuções usadas hoje. PARADO. Nenhuma nova execução sem cooldown + ok do dono.
