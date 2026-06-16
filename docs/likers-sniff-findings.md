# Diagnóstico da captura de curtidores (sniffer #3)

## Conclusão central
O endpoint REST `/api/v1/media/<pk>/likers/` está **morto pro web**: devolve
HTTP 200 `text/html` (o shell do app), não JSON — comprovado com pk numérico,
tanto via `ctx.request` quanto via `fetch` in-page. Não era bug de método.

O app web hoje busca os curtidores via **GraphQL**.

## Requisições reais capturadas ao abrir `/p/<code>/liked_by/`
Post de teste: `code=DYnZkhHlvNV`, `pk=3902200062764577621`.

Respostas `application/json` (as candidatas a "liked_by"):
| endpoint | doc_id |
|---|---|
| `https://www.instagram.com/graphql/query` | `27258191930500454` |
| `https://www.instagram.com/graphql/query` | `27228895850083205` |

(Houve também várias `text/javascript` em `/api/graphql` — provavelmente
bundles/relay, não dados; ignorar.)

Dump completo em `sniff-likers.json` (raiz do repo).

## Em aberto (validar quando voltar)
1. **Qual dos dois doc_id é o de curtidores?** Falta ver o corpo da resposta
   (o sniffer só logou headers/doc_id, não o body). O outro provavelmente é
   info do post/comentários.
2. **Resultado do scraper de DOM** (`getLikersDOM`): rodou no sniffer mas a
   linha foi cortada por um `| head -60` no comando — não foi falha do script.

## Dois caminhos possíveis (ambos prontos/quase no código)
- **A — Scraper de DOM** (`getLikersDOM`, já implementado): abre o modal
  `liked_by`, rola e lê os usernames do DOM. Imune a mudança de doc_id. É o
  método escolhido como primário. Falta só ver o número que extraiu.
- **B — GraphQL direto**: replicar o POST pra `/graphql/query` com o doc_id
  certo. Mais rápido/leve, mas quebra quando o IG troca o doc_id. Seria o
  plano B / otimização.

## Próximo passo (execução #4, quando autorizado)
Rodar a captura real com o método DOM em 3 posts (IG_SNIFF=false), conferir o
`likers.json`, e — se vier curtidores — commitar, dar push e restaurar
IG_NUM_POSTS=30. Execuções anti-ban usadas até aqui: 3 de 5.
