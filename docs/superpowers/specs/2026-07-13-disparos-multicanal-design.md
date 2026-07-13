# Disparos multicanal — SMS (Android Gateway) + WhatsApp multi-chip blindado

**Data:** 2026-07-13
**Branch:** `feat/disparos-multicanal`
**Autor:** Claude Fable 5 (brainstorming com o dono)

---

## 1. Objetivo

Dar ao polimonitor a capacidade de **disparar mensagens em massa** para a base própria por
dois canais, no caminho **100% gratuito** (sem custo de API):

1. **SMS** — via **Android SMS Gateway** (app `capcom6/android-sms-gateway` em modo servidor
   local, API HTTP). Usa um chip com franquia de SMS; entrega no Brasil de verdade. SMS **não**
   sofre banimento por volume como o WhatsApp.
2. **WhatsApp** — via **pool de múltiplos chips** (vários Androids + Baileys), **blindado** para
   **queimar muito menos chip** (rotação, aquecimento, teto diário, jitter humano, opt-out,
   janela de horário, detecção de ban).

### Premissas e verdade de projeto (honestidade)

- **SMS grátis + sem chip + entrega no Brasil não coexistem em 2026.** TextBelt self-hosted é
  grátis e sem chip, mas seu mecanismo (email-to-SMS de operadora) **não cobre operadoras BR**;
  os gateways REST BR (SMSDev etc.) entregam sem chip mas são **pagos**. Decisão do dono:
  **abrir mão de "sem chip"** e usar Android Gateway (grátis, entrega, usa 1 chip).
- A "queima de chip" que dói é a do **WhatsApp** (ban da Meta). O foco da blindagem é esse.
- **Só base própria opt-in** (`Pessoa` tipo `apoiador`/`coordenador` com telefone). Número frio
  em massa = denúncia = ban. Isto é regra de arquitetura, não opção.

### Não-objetivos (YAGNI — fora deste ciclo)

- Fallback automático WhatsApp→SMS quando não entrega (fase 2).
- Aquecimento artificial trocando mensagens entre os próprios chips (fase 2).
- Provedor SMS REST pago como fallback (arquitetura fica preparada, mas não implementado agora).
- Agendamento sofisticado além do `agendadoPara` que a fila já suporta.

---

## 2. Arquitetura escolhida

**Abordagem B — faixa de SMS paralela + orquestração no topo.** Mantém `WhatsappFila` intacta
(tabela quente que já funciona), adiciona uma faixa de SMS espelhada, eleva o worker de WhatsApp
de 1 conexão para um **pool de N chips**, e coloca uma camada fina de orquestração de campanha
por cima. Motivo: cirúrgico (não renomeia tabela quente), canais isolados (semânticas diferentes),
e unifica onde de fato importa — na **campanha**.

```
                     ┌─────────────────────────────┐
   UI /disparos ───► │  disparo.ts (orquestração)  │
   API/bot/worker    │  resolve audiência + opt-out│
                     │  fan-out por canal          │
                     └───────┬─────────────┬───────┘
                             │             │
                     enfileira            enfileira
                             ▼             ▼
                     ┌───────────┐  ┌───────────┐
                     │WhatsappFila│  │  SmsFila  │   (Prisma)
                     └─────┬─────┘  └─────┬─────┘
                           │              │
                  ┌────────▼───────┐  ┌───▼──────────┐
                  │ whatsapp-worker│  │  sms-worker  │
                  │ POOL N chips   │  │ HTTP→gateway │
                  │ Baileys        │  │ Android      │
                  │ + BLINDAGEM    │  │              │
                  └────────────────┘  └──────────────┘
                     N Androids/chips     1 Android/chip
```

---

## 3. Modelo de dados (Prisma)

Alterações em `prisma/schema.prisma` (migração aditiva; nada é renomeado/removido).

### 3.1 `WhatsappNumero` (nova) — o pool de chips

```prisma
model WhatsappNumero {
  id               String    @id @default(cuid())
  rotulo           String    // ex: "chip-1 / Vivo / 21 99999-9999"
  status           String    @default("aquecendo") // "aquecendo"|"ativo"|"pausado"|"banido"
  sessionPath      String    @unique                // ./.whatsapp-auth/<id>
  tetoDiario       Int       @default(200)          // teto após aquecido
  nivelAquecimento Int       @default(1)            // dia da rampa (1..N)
  enviadosHoje     Int       @default(0)
  zeradoEm         DateTime?                         // data do último reset diário do contador
  ultimoEnvioEm    DateTime?
  criadoEm         DateTime  @default(now())
}
```

### 3.2 `SmsFila` (nova) — espelha `WhatsappFila`

```prisma
model SmsFila {
  id           String    @id @default(cuid())
  telefone     String    // E.164 ex: +5521999998888
  mensagem     String
  tipo         String    @default("notificacao")
  status       String    @default("pendente") // "pendente"|"enviado"|"erro"
  erro         String?
  pessoaId     String?
  referencia   String?
  tentativas   Int       @default(0)
  agendadoPara DateTime?
  criadoEm     DateTime  @default(now())
  enviadoEm    DateTime?
}
```

### 3.3 `OptOut` (nova) — opt-out por telefone, cross-canal

Chave por telefone (não por `pessoaId`) para valer em qualquer canal e para contatos fora de `Pessoa`.

```prisma
model OptOut {
  id        String   @id @default(cuid())
  telefone  String   @unique  // normalizado (dígitos, DDI 55)
  canal     String   @default("todos") // "todos"|"whatsapp"|"sms"
  origem    String?            // ex: "SAIR via whatsapp"
  criadoEm  DateTime @default(now())
}
```

### 3.4 `WhatsappFila` — 2 colunas aditivas

```prisma
  numeroId   String?   // qual chip do pool enviou (auditoria da rotação)
  campanhaId String?   // rastreio de campanha
```

### 3.5 `Disparo` (nova) — rastreio de campanha

```prisma
model Disparo {
  id           String   @id @default(cuid())
  titulo       String
  mensagem     String
  canais       String   // csv: "whatsapp,sms"
  audiencia    String   // ex: "apoiador,coordenador" ou filtro serializado
  totalAlvo    Int      @default(0)
  enfileirados Int      @default(0)
  criadoEm     DateTime @default(now())
}
```

---

## 4. Componentes (unidades isoladas)

Cada unidade: **o que faz · como se usa · do que depende.**

### 4.1 `src/lib/whatsapp.ts` (existente — estender)
- **O que faz:** helpers da fila do WhatsApp (já tem `enfileirarWhatsapp`, `enfileirarBroadcast`,
  `statusWhatsapp`, `normalizarTelefone`).
- **Mudança cirúrgica:** `enfileirarBroadcast` passa a checar `OptOut` antes de enfileirar;
  aceita `campanhaId`. `normalizarTelefone` é reusado pelo SMS.
- **Depende de:** `db` (Prisma).

### 4.2 `src/lib/pool.ts` (novo) — seleção e blindagem do pool
- **O que faz:** a lógica pura de "**qual chip usa agora**" e "**pode enviar?**". Round-robin
  ponderado por orçamento restante (`tetoEfetivo - enviadosHoje`) + menos-recente (`ultimoEnvioEm`).
  Calcula **teto efetivo** pela rampa de aquecimento. Faz o **reset diário** de `enviadosHoje`.
  Aplica **janela de horário** (config). Não fala com Baileys — só decide.
- **Como se usa:** `escolherNumero(): WhatsappNumero | null` · `tetoEfetivo(n)` · `registrarEnvio(n)`.
- **Depende de:** `db`, `Configuracao` (parâmetros de blindagem).
- **Testável** isoladamente (sem rede) — alvo principal de testes unitários.

### 4.3 `src/agent/whatsapp-worker.ts` (existente — refatorar p/ pool)
- **O que faz hoje:** 1 conexão Baileys drena `WhatsappFila`.
- **Alvo:** mantém **N conexões Baileys** (uma por `WhatsappNumero` com sessão própria em
  `./.whatsapp-auth/<id>`). Ao drenar a fila: pede `escolherNumero()` ao pool; aplica
  **throttle+jitter** (delay aleatório entre envios), **variação de conteúdo** (`{nome}` +
  micro-variações), envia pelo chip escolhido, grava `numeroId`, `registrarEnvio`. Trata
  **desconexão/logout (401/403)** marcando o chip `banido`, tirando do pool e alertando no Telegram.
- **Depende de:** `baileys`, `pool.ts`, `db`, `bot/telegram.ts` (alerta).

### 4.4 `src/lib/sms.ts` (novo) — fila + cliente do gateway
- **O que faz:** `enfileirarSms(opts)`, `enfileirarBroadcastSms(...)` (espelha whatsapp.ts,
  checa `OptOut`), e `enviarViaGateway(telefone, texto)` que faz `POST {SMS_GATEWAY_URL}/message`
  com Basic auth e corpo `{ textMessage: { text }, phoneNumbers: [telefone] }`.
  **Atenção ao formato:** `normalizarTelefone` devolve dígitos sem `+` (ex.: `5521999998888`); o gateway
  exige **E.164 com `+`** (`+5521999998888`) — o SMS prefixa `+` antes de enviar.
- **Depende de:** `db`, `.env` (`SMS_GATEWAY_URL`, `SMS_GATEWAY_USER`, `SMS_GATEWAY_PASS`).

### 4.5 `src/agent/sms-worker.ts` (novo)
- **O que faz:** drena `SmsFila` com throttle leve; chama `enviarViaGateway`; grava status/erro;
  respeita `agendadoPara`.
- **Depende de:** `sms.ts`, `db`.

### 4.6 `src/lib/disparo.ts` (novo) — orquestração de campanha
- **O que faz:** `dispararCampanha({ titulo, mensagem, audiencia, canais })`. Resolve a audiência
  (`Pessoa` por tipo+telefone+ativo), remove opt-outs, cria `Disparo`, e **fan-out**: enfileira em
  `WhatsappFila` e/ou `SmsFila` conforme `canais`, marcando `campanhaId`. Retorna contagens.
- **Depende de:** `whatsapp.ts`, `sms.ts`, `db`.

### 4.7 Opt-out inbound
- **O que faz:** no handler de mensagens recebidas do Baileys, se o texto for `SAIR`/`PARAR`/`STOP`
  (case/acento-insensível), grava `OptOut` para aquele telefone e responde confirmando.
- **Depende de:** `whatsapp-worker.ts`, `db`. (SMS inbound fica fora — gateway local não garante
  entrega de inbound de forma trivial; opt-out de SMS herda do `OptOut` global.)

### 4.8 UI `src/app/(app)/disparos/page.tsx` (novo) + `src/app/api/disparos/*`
- **O que faz:** (a) **Pool** — lista chips, status/aquecimento/contagem, ler QR de cada chip novo,
  pausar/remover; (b) **SMS** — status do gateway (ping) e config; (c) **Compor disparo** — texto,
  seleção de canais e audiência, prévia da contagem de alvos e opt-outs; (d) **Painel** — últimas
  campanhas com enfileirados/enviados/erros por canal.
- **Depende de:** APIs internas → `disparo.ts`, `pool.ts`, `sms.ts`, `whatsapp.ts`.
- A página `/whatsapp` atual (QR único) é absorvida pela aba Pool; manter rota antiga redirecionando.

---

## 5. Parâmetros de blindagem (em `Configuracao`, ajustáveis sem deploy)

| Chave | Default | Papel |
|---|---|---|
| `wa_janela_inicio` / `wa_janela_fim` | `9` / `20` | Só envia nesse horário (hora local) |
| `wa_jitter_min_s` / `wa_jitter_max_s` | `8` / `40` | Intervalo aleatório entre envios por chip |
| `wa_rampa` | `20,40,80,120,160,200` | Teto por dia de aquecimento (`nivelAquecimento`) |
| `wa_teto_max` | `200` | Teto diário do chip já aquecido |
| `wa_pausa_lote` | `a cada ~30 envios, 3–8 min` | Pausa longa periódica |

SMS: `sms_jitter_min_s`/`sms_jitter_max_s` (throttle leve; SMS não toma ban, mas evita flood da operadora).

---

## 6. Fluxo de dados (disparo em massa)

1. Dono compõe em `/disparos`: texto, canais `[whatsapp, sms]`, audiência `apoiador+coordenador`.
2. `dispararCampanha` resolve alvos, remove `OptOut`, cria `Disparo`, enfileira em ambas as filas.
3. `whatsapp-worker`: loop → `escolherNumero` (respeita teto/rampa/horário) → jitter → varia texto →
   envia pelo chip → grava `numeroId`/status → `registrarEnvio`. Se algum chip cai com logout → `banido`+alerta.
4. `sms-worker`: loop → throttle → `POST /message` no gateway Android → grava status.
5. UI lê contagens do `Disparo` + status do pool.

---

## 7. Tratamento de erro

- **Chip banido:** status `banido`, sai do pool, alerta Telegram; fila continua nos chips vivos.
- **Todos os chips no teto / fora de janela:** mensagens ficam `pendente`; worker reprocessa no próximo ciclo/dia.
- **Gateway SMS offline:** `POST` falha → `SmsFila.status='erro'` + `tentativas++`; retry com teto de tentativas.
- **Telefone inválido / em opt-out:** não enfileira (registrado na contagem do `Disparo`).
- **Reset diário:** `pool.ts` zera `enviadosHoje` quando `zeradoEm` < hoje (idempotente).

---

## 8. Testes

- **`pool.ts` (unitário, sem rede):** rampa de aquecimento calcula teto certo; round-robin escolhe o
  chip com mais orçamento/menos-recente; respeita janela de horário; reset diário idempotente; retorna
  `null` quando todos no teto.
- **`disparo.ts`:** fan-out enfileira nos canais certos; remove opt-outs; conta alvos corretamente.
- **`sms.ts`:** monta o corpo/headers certos do gateway (mock do fetch); normalização de telefone.
- **opt-out:** `SAIR`/`parar`/`Stop` (variações) gravam `OptOut` e bloqueiam reenvio.

---

## 9. Config (`.env`)

```
# SMS via Android Gateway (capcom6/android-sms-gateway, modo Local Server)
SMS_GATEWAY_URL=http://<ip-do-android-na-rede>:8080
SMS_GATEWAY_USER=<usuario mostrado no app>
SMS_GATEWAY_PASS=<senha mostrada no app>
```

WhatsApp: sem novas chaves — sessões dos chips ficam em `./.whatsapp-auth/<id>` (não commitar).

---

## 10. Impacto no que já existe

- `whatsapp.ts`: +checagem de opt-out no broadcast, +`campanhaId` (retrocompatível).
- `whatsapp-worker.ts`: refatorado de 1 conexão → pool (mudança maior, isolada nesse arquivo).
- `whatsapp/page.tsx` + `api/whatsapp/route.ts`: absorvidos pela aba Pool de `/disparos`; rota antiga redireciona.
- `package.json` script `launch`: `sms-worker` entra no concurrently.
- Prisma: 4 tabelas novas + 2 colunas aditivas (migração aditiva).
