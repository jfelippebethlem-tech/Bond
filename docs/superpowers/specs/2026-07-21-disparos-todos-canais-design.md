# Disparos — TODOS os canais (Email + Telegram + WhatsApp + SMS plugável)

**Data:** 2026-07-21
**Branch:** `feat/disparos-multicanal`
**Autor:** Claude Fable 5 (brainstorming com o dono)
**Antecede:** `2026-07-13-disparos-multicanal-design.md` (SMS Android + WhatsApp pool — já implementado)

---

## 1. Objetivo

Ampliar o disparo multicanal do bond/polimonitor para **todos os canais viáveis e gratuitos-primeiro**,
de modo que uma única campanha componha a mensagem uma vez e faça **fan-out** para Email, Telegram,
WhatsApp e SMS. Meta do dono: *"tentar todas"* — sem fantasia, sem risco à linha pessoal, sem derrubar a VM.

### Postura escolhida (decisão do dono)

**Opção B — 100% grátis, aceitando risco de chip descartável.** A linha pessoal do dono **nunca** é usada
como remetente em nenhum canal. Risco tolerado = chip **pré-pago descartável** de WhatsApp banido pela Meta.

---

## 2. Verdades de projeto (honestidade — não repetir os erros de premissa)

1. **SMS grátis-online-sem-chip que entregue no Brasil NÃO existe.** Entregar SMS a um celular BR exige
   pagar a taxa de terminação regulada (Anatel). Todo caminho "grátis" de SMS usa **um SIM físico** (seu
   chip, via app Android ou dongle USB). Serviços de "SMS grátis online" (email-to-SMS/TextBelt) **não
   cobrem operadoras BR**. Créditos de trial (Twilio/SMSDev) só servem para homologação (destinatário
   verificado, carimbo de trial). — Isto é fato verificado na fonte (2026), não opinião.
2. **A "queima" que dói é a do WhatsApp (ban da Meta).** SMS não sofre ban por volume; email/telegram idem.
3. **Alternativas ao Baileys usam navegador headless (Chromium por sessão, centenas de MB).** Na VM de
   2 vCPU / RAM limitada isso **derruba a máquina** (regra dura: *não crashar a VM*). Baileys (WebSocket
   direto, MBs por sessão) permanece o motor de WhatsApp. WPPConnect fica como plano B **documentado**, não
   implementado.
4. **Só base própria opt-in.** `Pessoa` com `tipo ∈ {apoiador, coordenador, cabo_eleitoral}` e consentimento
   registrado (newsletter/SMS/WhatsApp, conforme lei eleitoral). Número/email frio em massa = denúncia = ban.
   Regra de arquitetura, não opção.

### Custos e limites reais por canal (verificados 2026)

| Canal | Custo | Limite grátis | Risco | Remetente |
|---|---|---|---|---|
| **Email** (Brevo) | Grátis | **300/dia**, 100k contatos | Zero | domínio próprio |
| **Telegram** (canal do bot) | Grátis | Ilimitado | Zero | bot/canal próprio |
| **WhatsApp** (pool Baileys) | Grátis | Teto por chip (rampa) | Chip descartável banido | chips pré-pagos dedicados |
| **SMS** (plugável) | Seu chip: grátis · Pago: ~R$0,08 | — | Sua linha (só se usar seu chip) | chip dedicado ou remetente do gateway |

---

## 3. Arquitetura

Estende o fan-out que **já existe** (`lib/disparo.ts` → `WhatsappFila` + `SmsFila`), adicionando duas faixas
novas (Email, Telegram) e tornando o SMS **plugável por provider**. Nada do que já funciona é renomeado.

```
                      ┌─────────────────────────────────────┐
   UI /disparos ────► │  disparo.ts (orquestração)          │
   API/bot/worker     │  resolve audiência + opt-out        │
                      │  fan-out por canal escolhido         │
                      └──┬──────────┬──────────┬──────────┬──┘
                enfileira      enfileira  enfileira   enfileira
                      ▼          ▼          ▼          ▼
                ┌─────────┐┌──────────┐┌─────────┐┌──────────┐
                │EmailFila││TelegramF.││WhatsappF.││ SmsFila  │  (Prisma)
                └────┬────┘└────┬─────┘└────┬────┘└────┬─────┘
                     ▼          ▼           ▼          ▼
              ┌───────────┐┌──────────┐┌─────────┐┌──────────────────┐
              │email-worker││tg-worker ││wa-worker││   sms-worker      │
              │  Brevo API ││ Bot API  ││ POOL    ││ provider plugável │
              │            ││ canal/DM ││ Baileys ││ android|gammu|rest│
              └───────────┘└──────────┘└─────────┘└──────────────────┘
                 grátis      grátis      grátis         seu chip/pago
```

**Contrato comum de todas as filas:** `{ status: pendente|enviado|erro, tentativas, agendadoPara, pessoaId,
campanhaId, referencia }` + destino específico do canal. Worker drena, respeita opt-out no envio, grava status.

---

## 4. Modelo de dados (Prisma — aditivo, nada removido)

### 4.1 `EmailFila` (nova)
```prisma
model EmailFila {
  id           String    @id @default(cuid())
  email        String    // normalizado (lower/trim)
  assunto      String
  corpoHtml    String
  corpoTexto   String?   // fallback text/plain
  tipo         String    @default("newsletter")
  status       String    @default("pendente") // pendente|enviado|erro
  erro         String?
  provedorId   String?   // messageId do Brevo (auditoria)
  pessoaId     String?
  campanhaId   String?
  referencia   String?
  tentativas   Int       @default(0)
  agendadoPara DateTime?
  criadoEm     DateTime  @default(now())
  enviadoEm    DateTime?
}
```

### 4.2 `TelegramFila` (nova)
```prisma
model TelegramFila {
  id           String    @id @default(cuid())
  destino      String    // "@canal" OU chat_id numérico (DM)
  modo         String    @default("canal") // canal|dm
  mensagem     String
  tipo         String    @default("broadcast")
  status       String    @default("pendente")
  erro         String?
  pessoaId     String?
  campanhaId   String?
  tentativas   Int       @default(0)
  agendadoPara DateTime?
  criadoEm     DateTime  @default(now())
  enviadoEm    DateTime?
}
```

### 4.3 `OptOut` — generalizar a chave para cross-canal real
Hoje `OptOut.telefone @unique`. Email não tem telefone. Solução mínima e retrocompatível:
adicionar coluna `email String?` e um índice; a checagem de opt-out passa a aceitar `{telefone?}` **ou**
`{email?}`. `telefone` continua `@unique` (não quebra); `email` ganha `@unique` esparso.
```prisma
model OptOut {
  // ...campos atuais...
  email String? @unique   // NOVO — opt-out de email por endereço
}
```

### 4.4 `Pessoa` — nada a mudar
Já tem `email String?` e `telegramUser String?`. Para **DM** de Telegram é preciso `chat_id` (não username):
capturado quando a pessoa fala com o bot. **Fase 1 usa broadcast em canal** (não precisa de chat_id);
DM individual fica para fase 2 (exige mapear `telegramUser → chatId`).

### 4.5 `Disparo` — estender o CSV de canais
`canais` passa a aceitar `email` e `telegram` além de `whatsapp,sms` (só validação, sem migração).

---

## 5. Componentes (unidade: o que faz · como usa · do que depende)

### 5.1 `src/lib/email.ts` (novo)
- **Faz:** `enfileirarEmail(opts)`, `enfileirarBroadcastEmail(...)` (espelha `sms.ts`, checa `OptOut` por
  email), e `enviarViaBrevo(email, assunto, html, texto)` → `POST https://api.brevo.com/v3/smtp/email`
  com header `api-key: BREVO_API_KEY`, corpo `{sender, to, subject, htmlContent, textContent}`.
- **Depende de:** `db`, `.env` (`BREVO_API_KEY`, `EMAIL_REMETENTE_NOME`, `EMAIL_REMETENTE_ENDERECO`).
- Rodapé de opt-out (link "descadastrar") **obrigatório** em todo corpo — exigência legal e de deliverability.

### 5.2 `src/agent/email-worker.ts` (novo)
- **Faz:** drena `EmailFila` respeitando o **teto diário do provedor** (default 300/dia Brevo, em
  `Configuracao:email_teto_dia`), throttle leve, `agendadoPara`. Excedeu o teto → deixa `pendente` p/ amanhã.
- **Depende de:** `email.ts`, `db`.

### 5.3 `src/lib/telegram-broadcast.ts` (novo — NÃO confundir com `bot/telegram.ts`)
- **Faz:** `enfileirarBroadcastTelegram(mensagem, {canal})` e `enviarTelegramBroadcast(destino, modo, texto)`
  → `sendMessage` do Bot API para o canal configurado (`TELEGRAM_CANAL`). Reusa `TELEGRAM_BOT_TOKEN`.
- **Depende de:** `db`, `.env` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CANAL`).

### 5.4 `src/agent/telegram-worker.ts` (novo)
- **Faz:** drena `TelegramFila` (rate-limit do Telegram: ~30 msg/s global, ~20/min por chat de grupo —
  throttle conservador), grava status.
- **Depende de:** `telegram-broadcast.ts`, `db`.

### 5.5 `src/lib/sms.ts` (existente — refatorar para **provider plugável**)
- **Faz hoje:** um único caminho (Android gateway).
- **Alvo:** interface `SmsProvider { enviar(telefone, texto): Promise<{ok, id?, erro?}> }` com 3 implementações
  selecionáveis por `Configuracao:sms_provider` (ou `.env SMS_PROVIDER`):
  - `android` — POST no android-sms-gateway (**modo Cloud** para a VM alcançar o celular; ou Local se houver
    túnel Tailscale). **Já implementado** — vira uma das implementações.
  - `gammu` — POST num pequeno endpoint gammu-smsd rodando em **máquina local com dongle USB + SIM**
    (documentado; endpoint HTTP fino). Implementação = mesmo shape do android (URL diferente).
  - `rest` — provider REST **pago** BR (GTI SMS / SMSDev), remetente alfanumérico, **não usa chip do dono**.
    Config: `SMS_REST_URL`, `SMS_REST_KEY`. Implementado atrás da mesma interface.
- **Depende de:** `db`, `.env`. `enfileirarSms`/`enfileirarBroadcastSms` **não mudam** (fila é a mesma).
- `sms-worker.ts` passa a resolver o provider ativo e chamar `provider.enviar(...)`.

### 5.6 `src/lib/disparo.ts` (existente — estender)
- **Faz:** `dispararCampanha({titulo, mensagem, audiencia, canais})`. `canais` agora aceita
  `'email'|'telegram'|'whatsapp'|'sms'`. Fan-out enfileira em cada fila conforme escolha; email usa
  `Pessoa.email` (não telefone) para audiência; telegram usa canal configurado (audiência = inscritos).
- `validarCorpoDisparo` amplia `CANAIS_VALIDOS`.

### 5.7 UI `src/app/(app)/disparos/page.tsx` + `src/app/api/disparos/*` (estender)
- **Compor:** checkboxes dos 4 canais; para email, campo **assunto** + corpo (o corpo pode ser texto simples
  convertido em HTML com rodapé de opt-out automático). Prévia de alvos por canal (contagem separada:
  quantos têm email, quantos telefone, inscritos no canal TG, chips ativos).
- **Status:** cartões de saúde por canal — Brevo (ping/quota do dia), Telegram (bot conectado + canal),
  pool WhatsApp (chips/aquecimento), SMS (provider ativo + ping).
- **Painel:** por campanha, enviados/erros **por canal**.

---

## 6. Opt-out cross-canal

- **Telefone** (`SAIR`/`PARAR`/`STOP`): já capturado inbound no WhatsApp; vale para WhatsApp+SMS.
- **Email:** link "descadastrar" no rodapé → rota `GET /api/optout?e=<hash>` grava `OptOut.email`. Sem hash
  válido, não faz nada (anti-abuso).
- **Telegram:** canal é opt-in nativo (a pessoa sai do canal quando quer) — sem opt-out a gerenciar no DB.
- Checagem no **enfileirar e no enviar** (defesa em profundidade), já é o padrão do código atual.

---

## 7. Go-live (runbooks — o operacional que só o dono faz)

1. **Email (Brevo):** criar conta grátis; autenticar o **domínio** (SPF+DKIM — sem isso cai em spam);
   pegar `BREVO_API_KEY`. Sem domínio próprio → deliverability sofre (documentar como pré-requisito).
2. **Telegram:** criar/definir o **canal** do mandato; adicionar o bot como **admin**; setar `TELEGRAM_CANAL`.
3. **WhatsApp:** comprar N chips **pré-pagos descartáveis** (nunca a linha do dono); pôr o SIM num Android;
   cadastrar chip em `/disparos` (aba Pool) e **escanear o QR uma vez**. A VM segura a sessão. Rampa liga só.
4. **SMS:** escolher provider — `android` (instalar android-sms-gateway no celular, **modo Cloud**) OU `rest`
   (contratar GTI/SMSDev, não toca a linha). Setar `SMS_PROVIDER` + credenciais.

---

## 8. Testes (sem rede, banco de teste isolado — herda a trava anti-prod existente)

- `email.ts`: monta corpo/headers Brevo corretos (mock fetch); normaliza email; injeta rodapé de opt-out;
  `enfileirarBroadcastEmail` remove opt-outs e conta alvos.
- `email-worker`: respeita teto diário (para no limite, retoma no dia seguinte — idempotente).
- `telegram-broadcast.ts`: monta `sendMessage` certo; throttle não estoura rate-limit.
- `sms.ts` plugável: resolve provider por config; cada provider monta a requisição certa (mock fetch);
  troca de provider não afeta a fila.
- `disparo.ts`: fan-out para os 4 canais; email por `Pessoa.email`, sms/wa por telefone; opt-out por canal.
- opt-out email: hash inválido não grava; hash válido grava `OptOut.email` e bloqueia reenvio.

---

## 9. Config (`.env`) — aditivo

```
# Email (Brevo — grátis 300/dia)
BREVO_API_KEY=...
EMAIL_REMETENTE_NOME=Gabinete ...
EMAIL_REMETENTE_ENDERECO=contato@seudominio.com.br

# Telegram broadcast (reusa TELEGRAM_BOT_TOKEN já existente)
TELEGRAM_CANAL=@canal_do_mandato

# SMS — provider plugável
SMS_PROVIDER=android            # android | gammu | rest
# android (capcom6, modo Cloud): SMS_GATEWAY_URL/USER/PASS (já existem)
# gammu (dongle USB, máquina local): SMS_GAMMU_URL
# rest (pago BR, não usa chip): SMS_REST_URL, SMS_REST_KEY
```

Nenhuma chave é assumida como "free tier" sem verificação (regra §4.1). Brevo 300/dia e Telegram grátis
foram verificados na fonte em 2026; qualquer provider pago tem custo por mensagem explícito antes de ligar.

---

## 10. Fora de escopo (confirmado inviável / baixo valor)

- **iMessage** — Apple não tem API; só de um Mac com o app Mensagens. Inviável na VM Linux.
- **MMS** — praticamente morto no Brasil, caro; sem valor.
- **SMS Flash (class-0)** — sai só por SMSC de operadora (pago); a pilha Android padrão não expõe.
- **SMS grátis internacional pro Brasil** — não existe (§2.1).
- **DM individual de Telegram** — fase 2 (exige mapear `telegramUser → chat_id`).
- **Fallback automático entre canais** — fase 2.

---

## 11. Fases de entrega

| Fase | Entrega | Valor |
|---|---|---|
| **1** ✅ entregue 2026-07-21 | Canal **Email** (Brevo) fim-a-fim: lib+fila+worker+opt-out+UI+testes | ⭐ grátis, online, zero risco |
| **2** | Canal **Telegram** (broadcast em canal): lib+fila+worker+UI+testes | ⭐ grátis, zero ban |
| **3** | **SMS plugável** (android+gammu+rest atrás de interface) + status na UI | "tentar todas" |
| **4** | Go-live: pareamento WhatsApp (chips descartáveis) + config Brevo/TG/SMS + teste real numa fatia pequena da lista | ligar de verdade |

Cada fase é mergeável isolada; a UI degrada com graça se um canal não estiver configurado (mostra "configure").
