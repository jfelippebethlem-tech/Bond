# Ferramenta de teste: **CDP cru** (motor B)

**O que é:** fala o DevTools Protocol direto com o Chrome REAL (via `ws`), **sem Playwright**.

**Como evita ban/bloqueio:**
- **Sem Playwright** → não tem os globals `__pwInitScripts`/`__playwright__binding__` pra Meta sondar.
- **Não habilita Runtime nem chama `Runtime.evaluate`** → NÃO roda JS na página (evita tanto o gatilho
  "script injetando código" quanto o leak de `Runtime.enable`).
- **Coordenadas pelo DOM domain** (`DOM.getBoxModel`) = inspeção do DOM já parseado, sem executar JS
  da página. Cliques/roda por `Input.dispatchMouseEvent` (eventos `isTrusted=true`, iguais aos de gente).
- **Comportamento humano** — mesma coreografia: entra no post, abre curtidas, rola tirando prints,
  **15–200s/post aleatório**, pausas e descansos.
- **Depuração fora do IG** — usernames extraídos dos prints na VM (Gemini).

**Pré-req no desktop:** Chrome aberto com `--remote-debugging-port=9222` + perfil logado.
**Rodar (na conta-teste primeiro!):** `.\captura\rodar-teste.ps1 -Alvo "<perfil_publico>"`

> Quase tão limpo quanto o nodriver, e fica todo em Node. Detalhe em `docs/CAPTURA-HUMANA-RUNBOOK.md`.
