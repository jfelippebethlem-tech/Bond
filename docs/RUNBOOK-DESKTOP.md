# RUNBOOK — Captura de curtidas + stories no DESKTOP (passo a passo)

> **Regra de ouro:** roda **SÓ no seu computador** (IP residencial). **NUNCA na VM** (IP de datacenter = ban na hora).
> Tudo é **read-only no seu próprio conteúdo** (baixo risco). As saídas vão pela pasta do **Syncthing** → VM → site.

Recipe (a partir de 17/06/2026): **2 execuções/dia, 20 posts cada (40/dia)**, conta **principal (owner)**, janela **desde 1º/jan/2026**.
- **10:00 (manhã):** 10 posts **mais recentes** (re-capturados todo dia, pois as curtidas continuam chegando) **+ 10 do backfill** por data.
- **22:00 (noite):** 20 posts do **backfill** ainda não rodados (por data, de 1º/jan p/ frente).
- Em cada post: **curtidas** (todos os curtidores) **+ stories** (quem resharou — *experimental*, ver §5).

---

## 1. Pré-requisitos (uma vez)
1. **Node.js LTS** instalado (https://nodejs.org). Confirme no PowerShell: `node -v`.
2. **Syncthing** rodando e a pasta `likers-sync` sincronizada entre desktop e VM (já configurado).
3. Pasta do projeto no desktop: **`C:\jfn\bond`** (este repo). O perfil do navegador fica em **`C:\jfn\ig-profile`**.

## 2. Primeira execução — LOGIN + dependências (uma vez)
No PowerShell:
```powershell
cd C:\jfn\bond
powershell -ExecutionPolicy Bypass -File .\bond-likers.ps1
```
- Instala as dependências (1–2 min na 1ª vez).
- Abre uma janela do Instagram: **faça login na conta principal** (`@depjorgefelippeneto`), inclusive **2FA**.
- A sessão fica **salva no perfil** `C:\jfn\ig-profile` e se renova sozinha — você não loga de novo (só se cair).

> Esta primeira rodada é o setup. A partir daqui, use o **diário** (§3).

## 3. Registrar os 2 horários (uma vez)
```powershell
cd C:\jfn\bond
powershell -ExecutionPolicy Bypass -File .\bond-likers-diario.ps1 -Instalar
```
Cria duas tarefas no **Agendador de Tarefas do Windows**:
- **BondLikersManha** → todo dia **10:00** (modo `manha`).
- **BondLikersNoite** → todo dia **22:00** (modo `noite`).

Elas rodam **sozinhas** (janela oculta). Confira em *Agendador de Tarefas → Biblioteca*.
> ⚠️ O PC precisa estar **ligado** no horário. Se ficar desligado, é só rodar na mão (§4) quando ligar — o backfill é **resumível** (continua de onde parou).

## 4. Rodar na mão (teste / recuperar um horário perdido)
```powershell
cd C:\jfn\bond
powershell -ExecutionPolicy Bypass -File .\bond-likers-diario.ps1 -Mode manha   # 10 recentes + 10 backfill
powershell -ExecutionPolicy Bypass -File .\bond-likers-diario.ps1 -Mode noite   # 20 backfill
```
A janela mostra o progresso `[n/20] <post> -> X curtidores`. No fim: *"PRONTO (modo)"*.

## 5. STORIES é EXPERIMENTAL — validar antes de confiar
O Instagram **não tem** uma lista web estável de "quem resharou seu post no story"; só o **dono** às vezes vê.
O coletor tenta (best-effort) e **degrada honesto**: se não achar, grava vazio (NÃO inventa).
**Como validar (faça 1×):** rode `-Mode manha` e depois abra, na pasta `likers-sync`, o arquivo **`stories-leaderboard.json`**:
- Se tiver nomes → **funciona**, deixa ligado (`IG_STORIES=true`).
- Se vier **vazio em vários posts** → o IG não expõe isso pelo web; me avise que eu **desligo** os stories (`IG_STORIES=false`) pra não gastar navegação à toa. (As curtidas continuam normalmente.)

## 6. Onde ver no site (VM)
- **Curtidores / ranking:** http://159.112.188.8:3000/curtidores
- **Interações (por data/rede/pessoa):** http://159.112.188.8:3000/interacoes
- O importador da VM roda a cada 5 min e puxa o que o Syncthing trouxe — depois de uma captura, aguarde alguns minutos e atualize a página.

## 7. Se a conta bloquear (curtidas vindo vazias)
O coletor tem **abort-on-bloqueio**: se **3 posts seguidos** vierem sem curtidores (sinal de bloqueio), ele **PARA na hora** (não martela — martelar transforma bloqueio curto em longo).
- O que fazer: **espere esfriar (horas)** e rode de novo. Nada de rodar várias vezes seguidas.
- A VM te **avisa no Telegram** se precisar logar de novo.

## 8. Conferência / logs (na pasta `C:\jfn\bond`)
- **`bond-likers-log.txt`** — log de cada execução (mande pra mim se der erro).
- Na pasta `likers-sync`:
  - **`likers.json` / `leaderboard.csv`** — ranking de curtidas (compat).
  - **`posts-meta.json`** — por post: **URL** + **5 primeiras palavras da legenda** + nº de curtidas/stories (alimenta as tabelas do site).
  - **`stories-leaderboard.json`** — quem mais resharou nos stories (experimental).
  - **`captura-ledger.json`** — controle do **backfill** (quais posts já rodaram). **Não apague** (senão o backfill recomeça do zero).
  - **`likers-status.json`** — ok/erro do último run (a VM lê e avisa no Telegram).

## 9. Ajustes finos (opcional — arquivo `.env` em `C:\jfn\bond`)
| Variável | Padrão | O que faz |
|---|---|---|
| `IG_SINCE` | `2026-01-01` | janela: só posts a partir desta data |
| `IG_NUM_POSTS` | `20` | posts por execução |
| `IG_RECENT` | `10` | nº de recentes sempre re-capturados (manhã) |
| `IG_STORIES` | `true` | liga/desliga a captura de stories |
| `IG_MAX_FALHAS` | `3` | aborta após N posts seguidos sem curtidores |
| `IG_PAUSA_MIN/MAX` | `6000/20000` | pausa (ms) entre posts (ritmo humano) |
| `IG_DESCANSO_MIN/MAX` | `45000/150000` | descanso longo (ms) a cada 3–7 posts |

## 10. Lembretes anti-ban (não negociável)
1. **Nunca na VM.** Só no desktop.
2. **Não rode várias vezes seguidas** no mesmo dia (além dos 2 horários). Atividade acumulada é o que bloqueia.
3. Se vier bloqueio: **PARE e espere** — não insista.
4. Mantenha o **ritmo humano** (os defaults já fazem isso).
