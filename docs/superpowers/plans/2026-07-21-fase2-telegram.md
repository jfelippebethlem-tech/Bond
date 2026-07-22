# Fase 2 — Canal Telegram (broadcast em canal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Adicionar Telegram como canal de disparo grátis (broadcast num canal do bot), integrado ao fan-out multicanal, com testes.

**Architecture:** Espelha a faixa de Email/SMS, com uma diferença: broadcast de Telegram é **1 mensagem para o canal** (todos os inscritos veem), não 1 por pessoa. `TelegramFila` (Prisma) drenada por `telegram-worker.ts` → `telegramDrain.ts` (núcleo testável). Envio via Bot API HTTP direto (`fetch`), reusando `TELEGRAM_BOT_TOKEN`; NÃO reusa a instância de polling do `bot/telegram.ts`.

**Tech Stack:** Next.js 14, Prisma+SQLite, TypeScript, tsx, `fetch`. Mini test-runner (`npm test`).

## Global Constraints

- **Canal é opt-in nativo** (a pessoa entra/sai do canal) → sem opt-out a gerenciar no DB.
- **Destino do broadcast** = `TELEGRAM_CANAL` do `.env` (`@handle` ou chat_id numérico). Sem ele configurado, `enfileirarBroadcastTelegram` retorna `enfileirados: 0` (degrada com graça).
- **Não reusar** `new TelegramBot(...polling:true)` — usar Bot API via `fetch`.
- **Migração aditiva**; `db:push` NOS DOIS bancos (prod.db via `.env` + dev-disparos.db via `DATABASE_URL` override) — senão o client regenerado quebra a suíte.
- Retorno dos senders: `{ ok: boolean; id?: string; erro?: string }`.
- Casar estilo de `sms.ts`/`email.ts`.

---

### Task 1: Schema `TelegramFila` (+ db:push nos 2 bancos)

**Files:** Modify `prisma/schema.prisma`.

- [ ] Adicionar model:
```prisma
// ── Fila de mensagens Telegram (broadcast em canal via Bot API, grátis) ──
model TelegramFila {
  id           String    @id @default(cuid())
  destino      String    // "@canal" ou chat_id numérico
  modo         String    @default("canal") // canal|dm
  mensagem     String
  tipo         String    @default("broadcast")
  status       String    @default("pendente") // pendente|enviado|erro|cancelado
  erro         String?
  pessoaId     String?
  campanhaId   String?
  tentativas   Int       @default(0)
  agendadoPara DateTime?
  criadoEm     DateTime  @default(now())
  enviadoEm    DateTime?

  @@index([status])
}
```
- [ ] `npm run db:push` (prod.db) → "in sync".
- [ ] `DATABASE_URL="file:./dev-disparos.db" npm run db:push` (teste) → "in sync".
- [ ] Sanidade: `npx tsx -e "import {prisma} from './src/lib/db'; prisma.telegramFila.count().then(n=>{console.log('ok',n);process.exit(0)})"` → `ok 0`.
- [ ] Commit.

---

### Task 2: `lib/telegram-broadcast.ts` — envio Bot API + enfileirar broadcast

**Files:** Create `src/lib/telegram-broadcast.ts`; Test `src/tests/run.ts`.

**Produces:**
- `enviarTelegramMensagem(destino: string, texto: string): Promise<{ ok: boolean; id?: string; erro?: string }>`
- `enfileirarBroadcastTelegram(mensagem: string, tipo?: string, campanhaId?: string): Promise<{ enfileirados: number; destino: string | null }>`

- [ ] Testes:
```ts
  console.log('\n✈️  Telegram — lib')

  await test('enfileirarBroadcastTelegram cria 1 linha p/ o canal configurado', async () => {
    const { enfileirarBroadcastTelegram } = await import('@/lib/telegram-broadcast')
    process.env.TELEGRAM_CANAL = '@canal_teste'
    const before = await prisma.telegramFila.count()
    const r = await enfileirarBroadcastTelegram('oi canal', 'broadcast', undefined)
    const after = await prisma.telegramFila.count()
    assert(r.enfileirados === 1, 'deveria enfileirar 1')
    assert(r.destino === '@canal_teste', 'destino deveria ser o canal')
    assert(after - before === 1, 'deveria criar 1 linha')
  })

  await test('enfileirarBroadcastTelegram sem canal configurado não enfileira', async () => {
    const { enfileirarBroadcastTelegram } = await import('@/lib/telegram-broadcast')
    delete process.env.TELEGRAM_CANAL
    const before = await prisma.telegramFila.count()
    const r = await enfileirarBroadcastTelegram('oi', 'broadcast', undefined)
    const after = await prisma.telegramFila.count()
    assert(r.enfileirados === 0, 'sem canal não enfileira')
    assert(after === before, 'não cria linha')
  })
```
- [ ] Rodar (falha), implementar, rodar (passa):
```ts
/**
 * Canal Telegram GRATUITO — broadcast num canal do bot via Bot API HTTP.
 * NÃO reusa a instância de polling de bot/telegram.ts (conflitaria).
 * Envio real drenado por telegram-worker.ts → telegramDrain.ts.
 */
import { prisma } from './db'

export async function enviarTelegramMensagem(destino: string, texto: string): Promise<{ ok: boolean; id?: string; erro?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { ok: false, erro: 'TELEGRAM_BOT_TOKEN não configurado' }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: destino, text: texto, disable_web_page_preview: true }),
    })
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { message_id?: number }; description?: string }
    if (!res.ok || !j.ok) return { ok: false, erro: j.description || `telegram ${res.status}` }
    return { ok: true, id: j.result?.message_id ? String(j.result.message_id) : undefined }
  } catch (e) {
    return { ok: false, erro: String(e) }
  }
}

export async function enfileirarBroadcastTelegram(mensagem: string, tipo = 'broadcast', campanhaId?: string): Promise<{ enfileirados: number; destino: string | null }> {
  const destino = (process.env.TELEGRAM_CANAL || '').trim() || null
  if (!destino) return { enfileirados: 0, destino: null }
  await prisma.telegramFila.create({ data: { destino, modo: 'canal', mensagem, tipo, campanhaId } })
  return { enfileirados: 1, destino }
}
```
- [ ] Commit.

---

### Task 3: `telegramDrain.ts` + worker + scripts

**Files:** Create `src/lib/telegramDrain.ts`, `src/agent/telegram-worker.ts`; Modify `package.json`; Test `src/tests/run.ts`.

**Produces:** `drenarFilaTelegram(deps?): Promise<{ enviados: number; falhas: number }>` (deps: `enviar?`, `agora?`, `esperar?`).

- [ ] Teste:
```ts
  console.log('\n✈️  Telegram — drain')

  await test('drenarFilaTelegram envia pendentes e marca enviado', async () => {
    const { drenarFilaTelegram } = await import('@/lib/telegramDrain')
    await prisma.telegramFila.create({ data: { destino: '@c', modo: 'canal', mensagem: `tg${Date.now()}` } })
    const enviados: string[] = []
    const r = await drenarFilaTelegram({ enviar: async (destino: string) => { enviados.push(destino); return { ok: true, id: '1' } }, esperar: async () => {} })
    assert(r.enviados >= 1, 'deveria enviar ao menos 1')
    assert(enviados.includes('@c'), 'deveria mandar pro destino')
  })

  await test('drenarFilaTelegram marca erro após esgotar tentativas', async () => {
    const { drenarFilaTelegram } = await import('@/lib/telegramDrain')
    const id = (await prisma.telegramFila.create({ data: { destino: '@x', modo: 'canal', mensagem: 'f', tentativas: 2 } })).id
    const r = await drenarFilaTelegram({ enviar: async () => ({ ok: false, erro: 'boom' }), esperar: async () => {} })
    assert(r.falhas >= 1, 'deveria contar falha')
    const linha = await prisma.telegramFila.findUnique({ where: { id } })
    assert(linha?.status === 'erro', `status deveria ser erro, veio ${linha?.status}`)
  })
```
- [ ] Implementar `src/lib/telegramDrain.ts`:
```ts
/** Núcleo TESTÁVEL do drain de Telegram — separado do worker. */
import { prisma } from './db'
import { enviarTelegramMensagem } from './telegram-broadcast'

const MAX_TENTATIVAS = 3

export async function drenarFilaTelegram(deps?: {
  enviar?: (destino: string, texto: string) => Promise<{ ok: boolean; id?: string; erro?: string }>
  agora?: () => Date
  esperar?: (ms: number) => Promise<void>
}): Promise<{ enviados: number; falhas: number }> {
  const enviar = deps?.enviar ?? enviarTelegramMensagem
  const agora = deps?.agora ?? (() => new Date())
  const esperar = deps?.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)))

  const pendentes = await prisma.telegramFila.findMany({
    where: {
      status: 'pendente',
      tentativas: { lt: MAX_TENTATIVAS },
      OR: [{ agendadoPara: null }, { agendadoPara: { lte: agora() } }],
    },
    orderBy: { criadoEm: 'asc' },
    take: 30,
  })

  let enviados = 0, falhas = 0
  for (const msg of pendentes) {
    const r = await enviar(msg.destino, msg.mensagem)
    if (r.ok) {
      await prisma.telegramFila.update({ where: { id: msg.id }, data: { status: 'enviado', enviadoEm: agora(), erro: null } })
      enviados++
    } else {
      const tentativas = msg.tentativas + 1
      await prisma.telegramFila.update({ where: { id: msg.id }, data: { tentativas, status: tentativas >= MAX_TENTATIVAS ? 'erro' : 'pendente', erro: r.erro ?? 'falha no envio' } })
      falhas++
    }
    await esperar(1_500)
  }
  return { enviados, falhas }
}
```
- [ ] Implementar `src/agent/telegram-worker.ts`:
```ts
/**
 * Telegram Worker — drena TelegramFila e envia via Bot API (grátis).
 * Execute: npm run telegram
 * Config em .env: TELEGRAM_BOT_TOKEN, TELEGRAM_CANAL.
 */
import { drenarFilaTelegram } from '../lib/telegramDrain'

const INTERVALO_FILA = 20_000

let drenando = false

async function drenarFila() {
  if (drenando) return
  drenando = true
  try {
    const r = await drenarFilaTelegram()
    if (r.enviados || r.falhas) console.log(`[Telegram] enviados=${r.enviados} falhas=${r.falhas}`)
  } finally {
    drenando = false
  }
}

async function main() {
  console.log('✈️  Telegram Worker iniciando (Bot API)...')
  setInterval(() => { drenarFila().catch((e) => console.error('[Telegram] erro fila:', e)) }, INTERVALO_FILA)
  console.log('[Telegram] ✓ Rodando. Fila a cada 20s.\n')
}

main().catch((err) => { console.error('[Telegram] Erro fatal:', err); process.exit(1) })
```
- [ ] `package.json`: adicionar `"telegram": "tsx src/agent/telegram-worker.ts",` e o worker no `launch`.
- [ ] Commit.

---

### Task 4: Fan-out — `disparo.ts` integra o canal telegram

**Files:** Modify `src/lib/disparo.ts`; Test `src/tests/run.ts`.

**Produces:** `CANAIS_VALIDOS += 'telegram'`; `dispararCampanha` retorna também `telegram: number`; tipos de `canais` incluem `'telegram'`.

- [ ] Teste:
```ts
  console.log('\n📢 Disparo — fan-out telegram')

  await test('dispararCampanha enfileira telegram quando canal configurado', async () => {
    const { dispararCampanha } = await import('@/lib/disparo')
    process.env.TELEGRAM_CANAL = '@canal_teste'
    const before = await prisma.telegramFila.count()
    const r = await dispararCampanha({ titulo: 'C', mensagem: 'oi', audiencia: ['apoiador'], canais: ['telegram'] })
    const after = await prisma.telegramFila.count()
    assert(r.telegram === 1, 'deveria contar 1 telegram')
    assert(after - before === 1, 'deveria criar 1 linha')
  })
```
- [ ] Implementar (import, CANAIS_VALIDOS, tipos, branch telegram, retorno).
- [ ] Commit.

---

### Task 5: UI + .env.example + spec + build + regressão

**Files:** Modify `src/app/(app)/disparos/page.tsx`, `.env.example`, spec.

- [ ] UI: checkbox `✈️ Telegram`, aviso "vai pro canal (inscritos)", incluir `telegram` no resultado.
- [ ] `.env.example`: `TELEGRAM_CANAL=@canal_do_mandato`.
- [ ] Spec: marcar Fase 2 ✅ entregue.
- [ ] `npm run build` → compila.
- [ ] `npm test` → tudo verde.
- [ ] Commit.

## Self-Review
- Envio Bot API sem polling ✅ · fila+drain+worker espelham email ✅ · fan-out consistente (retorna telegram) ✅ · sem opt-out (canal opt-in nativo) ✅ · db:push nos 2 bancos ✅.
