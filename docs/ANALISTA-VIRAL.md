# Analista de Redes Sociais — PolitiMonitor (Hermes Viral)

Sistema que faz o Hermes **assistir, analisar e aprender** com os posts do Instagram de
@depjorgefelippeneto para diagnosticar viralização e recomendar os próximos posts — com
**inteligência progressiva** (aprende com os resultados reais e fica mais esperto a cada lote).

> **Filosofia:** 100% grátis no dia a dia (Cerebras free + Gemini free tier + RSS keyless).
> O único custo premium é a avaliação única do Claude (já feita), absorvida como playbook.

---

## Os 5 loops de autoaprimoramento

| # | Loop | Quem roda | Onde | Cadência |
|---|------|-----------|------|----------|
| 1 | **Inteligência progressiva** | Hermes | `src/lib/viral/aprendizado.ts` | semanal (sex 9h) + ação `aprender_viral` + botão "Aprender agora" |
| 2 | **Aprendizado de viralização** | Hermes | `algoritmo.ts` + `aprendizado.ts` (playbook) | injetado em toda análise/recomendação |
| 3 | **Análise da rede social** | Hermes | `analista.ts` + `relatorio.ts` | por post (event-driven 6h) + relatórios on-demand |
| 4 | **Observação / uso como humano** | Claude | workflow `politimonitor-5-loops` | manager roda sob demanda |
| 5 | **Caça-bugs do Bond** | Claude | workflow `politimonitor-5-loops` | manager roda sob demanda |

Loops 1-3 são autônomos no Hermes (modelos grátis). Loops 4-5 são "Claude rodando junto":
revisão de UX e de bugs que exige o modelo forte — orquestrados pelo workflow e aplicados pelo manager.

---

## Arquitetura (`src/lib/viral/`)

- **`algoritmo.ts`** — scoring PURO dos parâmetros do algoritmo do IG (Mosseri 2025), por superfície
  (reel/carrossel/feed/story) com gates de penalidade. 2 camadas: A (proxy, sem insights) e B (insights reais).
  Testes em `scripts/test-viral-algoritmo.ts`.
- **`tendencias.ts`** — sensor grátis keyless (Google Trends RSS + Google News RSS BR/RJ) → `BondTendencia`.
- **`analista.ts`** — orquestra por post: Gemini assiste a mídia (`social/midia.ts`) → estrutura via `callAI` →
  puxa insights reais (`getInstagramPostInsights`) → pontua (`algoritmo.ts`) → grava `BondViralScore` + `BondInsight`.
- **`benchmark.ts`** + **`referencias.ts`** — padrões de perfis de referência via `getInstagramBusinessDiscovery`.
- **`recomendador.ts`** — semanal: padrão próprio + tendências + benchmark + playbook → `BondRascunho` + ping Telegram.
- **`aprendizado.ts`** — inteligência progressiva: compara sends/alcance reais (campeões vs fracos),
  extrai o **playbook do perfil**, meta-cognição (calibração Spearman score×sends), guarda em `HermesMemoria`.
  `playbookAtual()` concatena o playbook aprendido + a avaliação premium do Claude e injeta nos prompts.
- **`relatorio.ts`** — relatórios semana/mês/post. O **por post** é uma autópsia profunda (gancho, copy/palavras,
  visual, ritmo, CTA, tema/timing, fit com o público, drivers do score), com a régua do playbook.

## Modelos Prisma
`BondViralScore` (análise por post) · `BondTendencia` (snapshot de tendência) · `BondRelatorio`
(relatórios semana/mês/post/diretor). Reusa `BondInsight`, `BondRascunho`, `HermesMemoria`.

## Camadas A/B + insights
- **Camada A**: sem insights — pontua por conteúdo (gancho/ritmo do Gemini) + engajamento/seguidor + tema.
- **Camada B (ATIVA)**: token permanente com `instagram_manage_insights` → reach/saves/sends reais.
  Token em `~/polimonitor/.env` e `~/JFN/.env`. App Meta = `981423928062418`.
  **Bug corrigido:** `getInstagramPostInsights` pedia métricas depreciadas (`impressions`/`engagement`/`video_views`);
  agora usa `reach,saved,shares,views,total_interactions,likes,comments` com fallback.

## Wiring (cadência)
- **Cron** (`crontab`): `viral-semanal` sexta 9h → `run-viral-semanal.sh` → tendências + benchmark + **aprendizado** + recomendação.
- **Worker** (`hermes-worker.ts`): `INTERVAL_VIRAL` 6h → `analisarPostsPendentes` (post novo = 1 análise).
- **Ações Hermes** (`acoes.ts`): `analisar_post_viral`, `analisar_posts_pendentes`, `aprender_viral`.
- **API** (`/api/bond`): GET `viral|relatorios|relatorio|playbook` · POST `analisar_viral|gerar_relatorio|aprender_viral`.
- **UI** (`/analise`): painel viral (score/diagnóstico por post) + Relatórios (semana/mês/post) +
  card "O que o Hermes aprendeu" (playbook + calibração).

## O playbook (a lei do perfil)
Aprendido dos dados reais: **send = identificação** (dor econômica, indignação com vilão, identidade Zona Oeste),
NÃO currículo de entregas nem intimidade/família (essas dão like, não send). Avaliação premium do Claude +
plano de 7 dias guardados em `HermesMemoria('viral','playbook_diretor')` e em `BondRelatorio(tipo='diretor')`.

## Como rodar / estender
- Backfill: `npx tsx scripts/backfill-viral.ts [n]` · Rescore camada B: `scripts/rescore-viral.ts`.
- Aprender agora: ação `aprender_viral` ou botão na aba.
- 5 loops (Claude): workflow `politimonitor-5-loops` (manager aplica os achados).
- Destravar insights do Facebook (além do IG): regerar token no app `981…` marcando `read_insights`.
