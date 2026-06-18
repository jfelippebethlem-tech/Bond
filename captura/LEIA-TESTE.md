# Ferramenta de teste: **nodriver** (motor A)

**O que é:** dirige o Chrome REAL pelo DevTools Protocol de forma nativa, feito para
não ser detectado.

**Como evita ban/bloqueio:**
- **Sem rastro de framework** — não usa Playwright, então NÃO existe `__pwInitScripts` /
  `__playwright__binding__` pra Meta sondar; e `navigator.webdriver` fica `false`.
- **Sem injetar código na página** — só mouse/roda/teclado + **screenshot**. A Meta não vê
  "script injetando código" (o gatilho que bane na hora).
- **Comportamento humano** — entra no post, abre as curtidas e rola com a roda tirando prints,
  com **tempo aleatório de 15–200s por post**, pausas pra "ler" e descansos longos a cada 3–7 posts.
- **Depuração fora do IG** — os @usernames saem dos prints DEPOIS, na VM (Gemini). Não se pede
  nada ao site.

**Pré-req no desktop:** `pip install nodriver` + Chrome instalado + perfil logado.
**Rodar (na conta-teste primeiro!):** `.\captura\rodar-teste.ps1 -Alvo "<perfil_publico>"`

> **Recomendado.** É o de menor risco. Veja o passo-a-passo completo em `docs/CAPTURA-HUMANA-RUNBOOK.md`.
