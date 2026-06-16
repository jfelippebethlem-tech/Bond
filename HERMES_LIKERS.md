# 🤖 HERMES — Captura de Curtidores (Instagram) + Controle pelo Telegram

> Documento de instruções para o **Hermes do DESKTOP**. A IA do Hermes é fraca:
> siga **exatamente**, na ordem, sem inventar passos.

---

## 1. Onde está cada coisa (mapa de arquivos)

### No DESKTOP (Windows), dentro de `C:\jfn\`
| Item | Caminho | O que é |
|---|---|---|
| Repositório Bond | `C:\jfn\bond\` | o código (clonado do GitHub) |
| **Script de captura** (método do Leaderboard) | `C:\jfn\bond\scripts\captura-likers.mjs` | faz o scraping in-page (API interna do IG) |
| **Executável único** | `C:\jfn\bond\bond-likers.ps1` | instala, agenda sexta, e roda a captura |
| Perfil do navegador (login salvo) | `C:\jfn\ig-profile\` | onde a sessão do IG fica salva |
| `.env` local (cookie/senha) | `C:\jfn\bond\.env` | `IG_USERNAME`, `IG_PASSWORD`, etc. (só no desktop) |
| Estado da retomada | `C:\jfn\bond\likers-state.json` | progresso (pra continuar de onde parou) |
| **Pasta sincronizada (Syncthing)** | `C:\jfn\likers-sync\` | troca de arquivos com a VM |

### Na pasta sincronizada `C:\jfn\likers-sync\` (= `~/likers-sync/` na VM)
| Arquivo | Quem escreve | Pra quê |
|---|---|---|
| `likers.json` | desktop (captura) | ranking de curtidores → a VM importa |
| `likers-status.json` | desktop (captura) | status (ok / precisa_login) |
| `comando.json` | **VM (bot Telegram)** | ordens pro Hermes (capturar / login / código 2FA) |
| `resposta.json` | **Hermes (desktop)** | resposta do Hermes → volta pro Telegram |

### Na VM (servidor) — NÃO mexer, é referência
- Importador: `~/polimonitor/scripts/import-likers-sync.ts` (lê `likers.json` a cada 5 min → monitor `/curtidores`)
- Bot Telegram: `~/polimonitor/src/bot/telegram.ts` (escreve `comando.json`, lê `resposta.json`)

---

## 2. Regras gerais do Hermes (decore)
1. Você roda **NO DESKTOP do dono**. NUNCA na VM.
2. A cada **15 segundos**, leia `C:\jfn\likers-sync\comando.json`.
3. Se o campo `feito` for `true`, **não faça nada**.
4. Ao terminar QUALQUER comando: escreva a resposta em `C:\jfn\likers-sync\resposta.json` e marque `comando.json` com `feito: true`.
5. Nunca invente. Se não souber, escreva `{ "ok": false, "msg": "nao sei" }` em `resposta.json` e pare.

---

## 3. COMANDO A — "capturar" 🟢 (seguro)
Quando `comando.json` = `{ "acao": "capturar", "feito": false }`:
1. Abra o PowerShell.
2. Rode EXATAMENTE:
   ```
   cd C:\jfn\bond
   powershell -ExecutionPolicy Bypass -File .\bond-likers.ps1 -Scheduled
   ```
3. Espere terminar (pode levar minutos).
4. Escreva em `resposta.json`: `{ "ok": true, "msg": "captura feita" }`
5. Em `comando.json`, mude `feito` para `true`.

---

## 4. COMANDO B — "login_instagram" 🔴 (com 2FA relay)
Quando `comando.json` = `{ "acao": "login_instagram", "feito": false }`:
1. Abra o navegador usando o perfil `C:\jfn\ig-profile`.
2. Vá em `https://www.instagram.com/accounts/login/`.
3. No campo **Usuário**, digite o valor de `IG_USERNAME` do arquivo `C:\jfn\bond\.env`.
4. No campo **Senha**, digite o valor de `IG_PASSWORD` do `.env`.
5. Clique **Entrar**.
6. Quando aparecer a tela **"Digite o código de autenticação"** (2FA): **PARE**.
7. Escreva em `resposta.json`: `{ "ok": true, "msg": "esperando codigo", "aguardando_2fa": true }`
   - (isso faz o bot avisar o dono no Telegram pra mandar o código)
8. Agora **releia `comando.json` a cada 3 SEGUNDOS** procurando o campo `codigo_2fa`.
9. Assim que aparecer `"codigo_2fa": "123456"`:
   - **Digite IMEDIATAMENTE** esse número no campo do 2FA (tem ~10 segundos).
   - Clique **Confirmar**.
10. Resultado:
    - Logou → `resposta.json` = `{ "ok": true, "msg": "logado" }`
    - Erro → `resposta.json` = `{ "ok": false, "msg": "<texto exato do erro>" }`
11. Marque `comando.json` com `feito: true`.

---

## 5. Fluxo completo (visão geral)
```
Telegram (dono) → Bot na VM → escreve comando.json → Syncthing → DESKTOP
   → HERMES lê comando.json (15s) → executa (capturar OU login)
   → escreve resposta.json → Syncthing → VM → Bot repassa ao Telegram
```

Para o **2FA**: o dono manda `/login`, o Hermes chega na tela do código e escreve
`aguardando_2fa: true`; o bot avisa o dono; o dono manda `/codigo 123456`; o bot
injeta `codigo_2fa` no `comando.json`; o Hermes digita. Tudo em segundos.

---

## 6. ⚠️ Segurança (o dono já aceitou)
- O Comando B exige a **senha do IG** salva em `C:\jfn\bond\.env` (só no desktop, fora do git).
- Login automatizado tem **risco de bloqueio** do Instagram. Use com parcimônia.
- Alternativa segura (sem senha): quando a sessão morrer, logar **manualmente** na janela.
