# Disparos Multicanal — Implementation Plan

> **STATUS (2026-07-13): IMPLEMENTADO e verificado.** 13 tarefas + review de branch + fix wave + itens deferidos. Suíte 52/52, `tsc` limpo, `next build` isolado OK. Branch `feat/disparos-multicanal`; NÃO deployado (ver runbook abaixo). Todo o desenvolvimento rodou contra a cópia `prisma/dev-disparos.db`; `prod.db` intocado.
>
> ### Hardening pós-review + itens deferidos (resolvidos)
> - **Opt-out** aplicado no enqueue transacional (`enfileirarWhatsapp`) E no ponto de envio dos 2 workers (marca `cancelado`); cobre WhatsApp e SMS.
> - **Rampa de aquecimento** progride (`registrarEnvio` sobe `nivelAquecimento` no reset diário; teto = tamanho da rampa EFETIVA, incl. custom de `Configuracao`).
> - **Audiência** propagada no fan-out (`enfileirarBroadcast`/`enfileirarBroadcastSms`/`dispararCampanha`).
> - **Anti-duplicação**: guarda de re-entrância (`drenando`) nos 2 workers.
> - **Variação de texto**: `expandirSpintax` `{a|b|c}` — variação VISÍVEL, **grátis e offline** (sem IA no hot path: chamar LLM por mensagem em massa arriscaria estourar free tier, contra a regra de custo). WhatsApp = spintax + micro-variação invisível; SMS = `{nome}` + spintax (sem invisível). Conforme a regra "IA só gratuita", qualquer variação por IA futura usa só o stack grátis (Hermes/Groq/OpenRouter `:free`).
> - **UI** `/disparos`: `try/catch` nos fetch; checkbox SMS desabilitado e auto-desmarcado quando o gateway está offline. `sms-status` = `force-dynamic` (evita congelar o status no build).
> - `erro` limpo ao suceder após falha (ambos workers).
>
> ### Runbook de deploy (pendências OPERACIONAIS, não código)
> 1. `db:push` no `prod.db` real (4 tabelas novas — aditivo).
> 2. Matar o whatsapp-worker legado antes de subir o pool (senão os dois drenam a mesma fila).
> 3. Cadastrar chip(s) em `/disparos` e **re-parear** (sessão nova em `.whatsapp-auth/<id>`).
> 4. Instalar `capcom6/android-sms-gateway` no Android e preencher `SMS_GATEWAY_URL/USER/PASS` no `.env`.
> 5. TZ do processo = `America/Sao_Paulo` (janela 9–20h depende disso).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao polimonitor disparo em massa gratuito por SMS (Android Gateway) e WhatsApp multi-chip blindado, com opt-out e rastreio de campanha.

**Architecture:** Abordagem B do spec — `WhatsappFila` intacta; nova faixa `SmsFila`; worker de WhatsApp elevado de 1 conexão para pool de N chips com blindagem; camada fina `disparo.ts` orquestra a campanha nos dois canais. Lógica de decisão (seleção do pool, variação de texto, opt-out, montagem do request SMS) fica em funções **puras** testáveis; os workers são camada fina verificada por integração.

**Tech Stack:** Next.js 14 + TypeScript, Prisma 5 + SQLite, Baileys (`@whiskeysockets/baileys`), `tsx`. Testes no runner custom `src/tests/run.ts` (`npm test`).

## Global Constraints

- **Só base própria opt-in:** audiência = `Pessoa` com `tipo` in (`apoiador`,`coordenador`), `ativo=true`, `telefone != null`. Nunca número frio.
- **Migração aditiva:** nada renomeado/removido no schema. Aplicar com `npm run db:push` (SQLite, sem `prisma migrate`).
- **Sem custo de API:** SMS via Android Gateway local; WhatsApp via Baileys. Nenhuma chave paga.
- **IA só gratuita:** este sistema não usa IA na forma atual (variação é determinística, personalização é `{nome}`). Se IA for adicionada (ex.: gerar variações naturais de texto para anti-ban), usar EXCLUSIVAMENTE o stack gratuito já existente do projeto (cadeia Hermes / Groq `llama-3.3-70b-versatile` / OpenRouter `:free`) — nunca provedor pago, nunca free tier finito.
- **Telefone:** `normalizarTelefone` devolve dígitos com DDI 55 sem `+` (ex.: `5521999998888`). Gateway SMS exige E.164 com `+`.
- **Import de Baileys sempre dinâmico** (`await import(...)`) — nunca entra no build do Next.
- **Sessões de chip** ficam em `./.whatsapp-auth/<numeroId>` — não commitar (já no `.gitignore` como `.whatsapp-auth`).
- **Estilo de teste:** adicionar blocos `await test('nome', async () => { ... assert(...) })` dentro do `main()` de `src/tests/run.ts`. Rodar com `npm test`. Funções puras testadas sem DB; funções de DB seguem o padrão create→assert→delete.
- **Commits:** convenção semântica (`feat:`/`fix:`/`docs:`).

---

## File Structure

- `prisma/schema.prisma` — **modificar**: +`WhatsappNumero`, +`SmsFila`, +`OptOut`, +`Disparo`; +2 colunas em `WhatsappFila`.
- `src/lib/optout.ts` — **criar**: matcher de palavra de opt-out (puro) + persistência.
- `src/lib/pool.ts` — **criar**: seleção de chip + blindagem (núcleo puro) + wrappers de DB.
- `src/lib/whatsapp.ts` — **modificar**: `personalizar`/`microVariacao` (puros); opt-out + `campanhaId` no broadcast.
- `src/lib/sms.ts` — **criar**: `montarRequisicaoGateway` (puro) + fila + envio + broadcast.
- `src/lib/disparo.ts` — **criar**: `dispararCampanha` (orquestração/fan-out).
- `src/agent/whatsapp-worker.ts` — **modificar**: refatorar para pool + jitter + variação + opt-out inbound + detecção de ban.
- `src/agent/sms-worker.ts` — **criar**: drena `SmsFila` → gateway.
- `src/app/api/disparos/route.ts` + `src/app/api/disparos/numero/route.ts` + `src/app/api/disparos/sms-status/route.ts` — **criar**: APIs.
- `src/app/(app)/disparos/page.tsx` — **criar**: UI (pool, SMS, compor, painel).
- `src/app/(app)/whatsapp/page.tsx` — **modificar**: redireciona para `/disparos`.
- `package.json` — **modificar**: `sms-worker` no `launch`; script `sms`.
- `.env.example` — **modificar**: chaves do gateway SMS.
- `src/tests/run.ts` — **modificar**: novos testes.

---

## Task 1: Schema — tabelas e colunas novas

**Files:**
- Modify: `prisma/schema.prisma`
- Test: `src/tests/run.ts`

**Interfaces:**
- Produces (modelos Prisma): `WhatsappNumero { id, rotulo, status, sessionPath, tetoDiario:Int, nivelAquecimento:Int, enviadosHoje:Int, zeradoEm:DateTime?, ultimoEnvioEm:DateTime?, criadoEm }`, `SmsFila { id, telefone, mensagem, tipo, status, erro?, pessoaId?, referencia?, tentativas:Int, agendadoPara?, criadoEm, enviadoEm? }`, `OptOut { id, telefone @unique, canal, origem?, criadoEm }`, `Disparo { id, titulo, mensagem, canais, audiencia, totalAlvo:Int, enfileirados:Int, criadoEm }`. `WhatsappFila` ganha `numeroId String?`, `campanhaId String?`.

- [ ] **Step 1: Write the failing test**

Adicionar em `src/tests/run.ts`, dentro de `main()`, após o bloco `⚙️  Configurações`:

```ts
  // ── 6. Disparos multicanal — schema ─────────────────────────────────────────
  console.log('\n📣 Disparos — schema')

  await test('CRUD WhatsappNumero', async () => {
    const n = await prisma.whatsappNumero.create({
      data: { rotulo: '__teste__chip__', sessionPath: '.whatsapp-auth/__t__' },
    })
    assert(n.status === 'aquecendo', `Status padrão incorreto: ${n.status}`)
    assert(n.tetoDiario === 200, `Teto padrão incorreto: ${n.tetoDiario}`)
    assert(n.enviadosHoje === 0, 'enviadosHoje devia iniciar 0')
    await prisma.whatsappNumero.delete({ where: { id: n.id } })
  })

  await test('CRUD SmsFila', async () => {
    const s = await prisma.smsFila.create({ data: { telefone: '5521999998888', mensagem: '__t__' } })
    assert(s.status === 'pendente', `Status padrão incorreto: ${s.status}`)
    await prisma.smsFila.delete({ where: { id: s.id } })
  })

  await test('OptOut é único por telefone', async () => {
    const o = await prisma.optOut.create({ data: { telefone: '5521000000000' } })
    let violou = false
    try { await prisma.optOut.create({ data: { telefone: '5521000000000' } }) } catch { violou = true }
    assert(violou, 'Telefone duplicado em OptOut deveria falhar (unique)')
    await prisma.optOut.delete({ where: { id: o.id } })
  })

  await test('CRUD Disparo', async () => {
    const d = await prisma.disparo.create({ data: { titulo: '__t__', mensagem: 'oi', canais: 'whatsapp', audiencia: 'apoiador' } })
    assert(d.enfileirados === 0, 'enfileirados devia iniciar 0')
    await prisma.disparo.delete({ where: { id: d.id } })
  })

  await test('WhatsappFila aceita numeroId e campanhaId', async () => {
    const f = await prisma.whatsappFila.create({ data: { telefone: '5521999998888', mensagem: '__t__', numeroId: 'x', campanhaId: 'y' } })
    assert(f.numeroId === 'x' && f.campanhaId === 'y', 'Colunas novas não persistiram')
    await prisma.whatsappFila.delete({ where: { id: f.id } })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `prisma.whatsappNumero` / `prisma.smsFila` / `prisma.optOut` / `prisma.disparo` indefinidos (modelos não existem no client).

- [ ] **Step 3: Adicionar os modelos ao schema**

Em `prisma/schema.prisma`, adicionar ao fim do arquivo:

```prisma
model WhatsappNumero {
  id               String    @id @default(cuid())
  rotulo           String
  status           String    @default("aquecendo") // "aquecendo"|"ativo"|"pausado"|"banido"
  sessionPath      String    @unique
  tetoDiario       Int       @default(200)
  nivelAquecimento Int       @default(1)
  enviadosHoje     Int       @default(0)
  zeradoEm         DateTime?
  ultimoEnvioEm    DateTime?
  criadoEm         DateTime  @default(now())
}

model SmsFila {
  id           String    @id @default(cuid())
  telefone     String
  mensagem     String
  tipo         String    @default("notificacao")
  status       String    @default("pendente")
  erro         String?
  pessoaId     String?
  referencia   String?
  tentativas   Int       @default(0)
  agendadoPara DateTime?
  criadoEm     DateTime  @default(now())
  enviadoEm    DateTime?
}

model OptOut {
  id        String   @id @default(cuid())
  telefone  String   @unique
  canal     String   @default("todos")
  origem    String?
  criadoEm  DateTime @default(now())
}

model Disparo {
  id           String   @id @default(cuid())
  titulo       String
  mensagem     String
  canais       String
  audiencia    String
  totalAlvo    Int      @default(0)
  enfileirados Int      @default(0)
  criadoEm     DateTime @default(now())
}
```

E dentro de `model WhatsappFila { ... }`, após a linha `referencia   String?`, adicionar:

```prisma
  numeroId     String?
  campanhaId   String?
```

- [ ] **Step 4: Aplicar schema e regenerar client**

Run: `npm run db:push && npx prisma generate`
Expected: `Your database is now in sync with your Prisma schema.` e `Generated Prisma Client`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS nos 5 novos testes de schema.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma src/tests/run.ts
git commit -m "feat: schema de disparos multicanal (WhatsappNumero, SmsFila, OptOut, Disparo)"
```

---

## Task 2: Opt-out — matcher puro + persistência

**Files:**
- Create: `src/lib/optout.ts`
- Test: `src/tests/run.ts`

**Interfaces:**
- Produces: `isPalavraOptOut(texto: string): boolean` · `estaOptOut(telefone: string): Promise<boolean>` · `registrarOptOut(telefone: string, canal?: string, origem?: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Adicionar em `src/tests/run.ts` (após os testes de schema):

```ts
  console.log('\n🚫 Opt-out')

  await test('isPalavraOptOut reconhece variações (acento/caixa/espaço)', async () => {
    const { isPalavraOptOut } = await import('@/lib/optout')
    for (const p of ['SAIR', 'sair', ' Parar ', 'PARE', 'stop', 'Descadastrar', 'cancelar'])
      assert(isPalavraOptOut(p), `Deveria reconhecer "${p}"`)
    for (const p of ['saindo de casa', 'obrigado', 'quero saber mais'])
      assert(!isPalavraOptOut(p), `NÃO deveria reconhecer "${p}"`)
  })

  await test('registrarOptOut + estaOptOut roundtrip', async () => {
    const { registrarOptOut, estaOptOut } = await import('@/lib/optout')
    const tel = '5521555550000'
    assert(!(await estaOptOut(tel)), 'Não deveria estar opt-out ainda')
    await registrarOptOut(tel, 'whatsapp', '__teste__')
    assert(await estaOptOut(tel), 'Deveria estar opt-out após registrar')
    // idempotente: registrar de novo não quebra
    await registrarOptOut(tel, 'whatsapp', '__teste__')
    await prisma.optOut.deleteMany({ where: { telefone: tel } })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — módulo `@/lib/optout` não encontrado.

- [ ] **Step 3: Implementar `src/lib/optout.ts`**

```ts
import { prisma } from './db'

const PALAVRAS = ['sair', 'parar', 'pare', 'stop', 'descadastrar', 'cancelar']

/** Normaliza (sem acento, minúsculo, trim) e testa se é um comando de opt-out. */
export function isPalavraOptOut(texto: string): boolean {
  const t = (texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
  return PALAVRAS.includes(t)
}

export async function estaOptOut(telefone: string): Promise<boolean> {
  const o = await prisma.optOut.findUnique({ where: { telefone } })
  return !!o
}

export async function registrarOptOut(telefone: string, canal = 'todos', origem?: string): Promise<void> {
  await prisma.optOut.upsert({
    where: { telefone },
    update: { canal, origem },
    create: { telefone, canal, origem },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS nos 2 testes de opt-out.

- [ ] **Step 5: Commit**

```bash
git add src/lib/optout.ts src/tests/run.ts
git commit -m "feat: opt-out cross-canal (matcher puro + persistência)"
```

---

## Task 3: Pool — seleção de chip e blindagem (núcleo puro)

**Files:**
- Create: `src/lib/pool.ts`
- Test: `src/tests/run.ts`

**Interfaces:**
- Produces:
  - Tipo `NumeroPool = { id: string; status: string; tetoDiario: number; nivelAquecimento: number; enviadosHoje: number; ultimoEnvioEm: Date | null; zeradoEm: Date | null }`
  - Tipo `ParametrosPool = { rampa: number[]; tetoMax: number; janelaInicio: number; janelaFim: number }`
  - `tetoEfetivo(n: NumeroPool, p: ParametrosPool): number`
  - `dentroDaJanela(agora: Date, p: ParametrosPool): boolean`
  - `precisaResetDiario(n: NumeroPool, agora: Date): boolean`
  - `escolherNumero(numeros: NumeroPool[], agora: Date, p: ParametrosPool): NumeroPool | null`
  - `PARAMS_PADRAO: ParametrosPool`

- [ ] **Step 1: Write the failing test**

Adicionar em `src/tests/run.ts`:

```ts
  console.log('\n🎯 Pool de chips (blindagem)')

  await test('tetoEfetivo segue a rampa e satura no tetoMax', async () => {
    const { tetoEfetivo } = await import('@/lib/pool')
    const p = { rampa: [20, 40, 80], tetoMax: 200, janelaInicio: 9, janelaFim: 20 }
    const base = { id: 'a', status: 'ativo', tetoDiario: 200, enviadosHoje: 0, ultimoEnvioEm: null, zeradoEm: null }
    assert(tetoEfetivo({ ...base, nivelAquecimento: 1 }, p) === 20, 'nível 1 → 20')
    assert(tetoEfetivo({ ...base, nivelAquecimento: 3 }, p) === 80, 'nível 3 → 80')
    assert(tetoEfetivo({ ...base, nivelAquecimento: 9 }, p) === 80, 'nível além da rampa → último (80)')
  })

  await test('dentroDaJanela respeita horário', async () => {
    const { dentroDaJanela } = await import('@/lib/pool')
    const p = { rampa: [200], tetoMax: 200, janelaInicio: 9, janelaFim: 20 }
    const dia = (h: number) => new Date(2026, 6, 13, h, 0, 0)
    assert(dentroDaJanela(dia(10), p), '10h dentro'); assert(!dentroDaJanela(dia(3), p), '3h fora')
    assert(!dentroDaJanela(dia(20), p), '20h fora (fim exclusivo)')
  })

  await test('escolherNumero pega o de maior orçamento restante', async () => {
    const { escolherNumero } = await import('@/lib/pool')
    const p = { rampa: [100], tetoMax: 100, janelaInicio: 0, janelaFim: 24 }
    const agora = new Date(2026, 6, 13, 12, 0, 0)
    const a = { id: 'a', status: 'ativo', tetoDiario: 100, nivelAquecimento: 1, enviadosHoje: 90, ultimoEnvioEm: null, zeradoEm: agora }
    const b = { id: 'b', status: 'ativo', tetoDiario: 100, nivelAquecimento: 1, enviadosHoje: 10, ultimoEnvioEm: null, zeradoEm: agora }
    assert(escolherNumero([a, b], agora, p)?.id === 'b', 'Devia escolher b (mais orçamento)')
  })

  await test('escolherNumero ignora banido/pausado e retorna null se todos no teto', async () => {
    const { escolherNumero } = await import('@/lib/pool')
    const p = { rampa: [100], tetoMax: 100, janelaInicio: 0, janelaFim: 24 }
    const agora = new Date(2026, 6, 13, 12, 0, 0)
    const banido = { id: 'a', status: 'banido', tetoDiario: 100, nivelAquecimento: 1, enviadosHoje: 0, ultimoEnvioEm: null, zeradoEm: agora }
    const cheio = { id: 'b', status: 'ativo', tetoDiario: 100, nivelAquecimento: 1, enviadosHoje: 100, ultimoEnvioEm: null, zeradoEm: agora }
    assert(escolherNumero([banido, cheio], agora, p) === null, 'Nenhum elegível → null')
  })

  await test('escolherNumero fora da janela retorna null', async () => {
    const { escolherNumero } = await import('@/lib/pool')
    const p = { rampa: [100], tetoMax: 100, janelaInicio: 9, janelaFim: 20 }
    const agora = new Date(2026, 6, 13, 3, 0, 0)
    const n = { id: 'a', status: 'ativo', tetoDiario: 100, nivelAquecimento: 1, enviadosHoje: 0, ultimoEnvioEm: null, zeradoEm: agora }
    assert(escolherNumero([n], agora, p) === null, 'Fora da janela → null')
  })

  await test('precisaResetDiario detecta virada de dia', async () => {
    const { precisaResetDiario } = await import('@/lib/pool')
    const hoje = new Date(2026, 6, 13, 12, 0, 0)
    const ontem = new Date(2026, 6, 12, 23, 0, 0)
    const base = { id: 'a', status: 'ativo', tetoDiario: 100, nivelAquecimento: 1, enviadosHoje: 50, ultimoEnvioEm: null }
    assert(precisaResetDiario({ ...base, zeradoEm: null }, hoje), 'zeradoEm null → reset')
    assert(precisaResetDiario({ ...base, zeradoEm: ontem }, hoje), 'ontem → reset')
    assert(!precisaResetDiario({ ...base, zeradoEm: hoje }, hoje), 'hoje → sem reset')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — módulo `@/lib/pool` não encontrado.

- [ ] **Step 3: Implementar `src/lib/pool.ts`**

```ts
export type NumeroPool = {
  id: string
  status: string
  tetoDiario: number
  nivelAquecimento: number
  enviadosHoje: number
  ultimoEnvioEm: Date | null
  zeradoEm: Date | null
}

export type ParametrosPool = {
  rampa: number[]
  tetoMax: number
  janelaInicio: number
  janelaFim: number
}

export const PARAMS_PADRAO: ParametrosPool = {
  rampa: [20, 40, 80, 120, 160, 200],
  tetoMax: 200,
  janelaInicio: 9,
  janelaFim: 20,
}

function mesmoDia(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function tetoEfetivo(n: NumeroPool, p: ParametrosPool): number {
  const idx = Math.min(Math.max(n.nivelAquecimento, 1), p.rampa.length) - 1
  return Math.min(p.rampa[idx], p.tetoMax)
}

export function dentroDaJanela(agora: Date, p: ParametrosPool): boolean {
  const h = agora.getHours()
  return h >= p.janelaInicio && h < p.janelaFim
}

export function precisaResetDiario(n: NumeroPool, agora: Date): boolean {
  return !n.zeradoEm || !mesmoDia(n.zeradoEm, agora)
}

/** Round-robin ponderado: maior orçamento restante; empate → menos recente. */
export function escolherNumero(numeros: NumeroPool[], agora: Date, p: ParametrosPool): NumeroPool | null {
  if (!dentroDaJanela(agora, p)) return null
  const elegiveis = numeros
    .filter((n) => n.status === 'ativo' || n.status === 'aquecendo')
    .map((n) => {
      const usados = precisaResetDiario(n, agora) ? 0 : n.enviadosHoje
      return { n, orcamento: tetoEfetivo(n, p) - usados }
    })
    .filter((x) => x.orcamento > 0)
  if (elegiveis.length === 0) return null
  elegiveis.sort((a, b) => {
    if (b.orcamento !== a.orcamento) return b.orcamento - a.orcamento
    const ta = a.n.ultimoEnvioEm ? a.n.ultimoEnvioEm.getTime() : 0
    const tb = b.n.ultimoEnvioEm ? b.n.ultimoEnvioEm.getTime() : 0
    return ta - tb
  })
  return elegiveis[0].n
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS nos 6 testes do pool.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pool.ts src/tests/run.ts
git commit -m "feat: núcleo puro do pool de chips (rampa, janela, rotação, reset)"
```

---

## Task 4: Pool — wrappers de DB

**Files:**
- Modify: `src/lib/pool.ts`
- Test: `src/tests/run.ts`

**Interfaces:**
- Consumes: `NumeroPool`, `PARAMS_PADRAO` (Task 3)
- Produces: `carregarNumeros(): Promise<NumeroPool[]>` · `registrarEnvio(id: string, agora?: Date): Promise<void>` · `marcarBanido(id: string): Promise<void>` · `carregarParametros(): Promise<ParametrosPool>`

- [ ] **Step 1: Write the failing test**

Adicionar em `src/tests/run.ts`:

```ts
  await test('registrarEnvio incrementa contador e reseta na virada de dia', async () => {
    const { registrarEnvio } = await import('@/lib/pool')
    const n = await prisma.whatsappNumero.create({
      data: { rotulo: '__t__', sessionPath: '.whatsapp-auth/__reg__', enviadosHoje: 5, zeradoEm: new Date(2020, 0, 1) },
    })
    await registrarEnvio(n.id) // zeradoEm antigo → deve resetar p/ 1
    const depois = await prisma.whatsappNumero.findUnique({ where: { id: n.id } })
    assert(depois?.enviadosHoje === 1, `Esperado 1 após reset+envio, veio ${depois?.enviadosHoje}`)
    assert(!!depois?.ultimoEnvioEm, 'ultimoEnvioEm devia ser setado')
    await prisma.whatsappNumero.delete({ where: { id: n.id } })
  })

  await test('marcarBanido muda status', async () => {
    const { marcarBanido } = await import('@/lib/pool')
    const n = await prisma.whatsappNumero.create({ data: { rotulo: '__t__', sessionPath: '.whatsapp-auth/__ban__', status: 'ativo' } })
    await marcarBanido(n.id)
    const depois = await prisma.whatsappNumero.findUnique({ where: { id: n.id } })
    assert(depois?.status === 'banido', `Status esperado banido, veio ${depois?.status}`)
    await prisma.whatsappNumero.delete({ where: { id: n.id } })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `registrarEnvio` / `marcarBanido` não exportados por `@/lib/pool`.

- [ ] **Step 3: Adicionar wrappers ao fim de `src/lib/pool.ts`**

```ts
import { prisma } from './db'

export async function carregarNumeros(): Promise<NumeroPool[]> {
  return prisma.whatsappNumero.findMany({
    select: { id: true, status: true, tetoDiario: true, nivelAquecimento: true, enviadosHoje: true, ultimoEnvioEm: true, zeradoEm: true },
  })
}

export async function registrarEnvio(id: string, agora: Date = new Date()): Promise<void> {
  const n = await prisma.whatsappNumero.findUnique({ where: { id } })
  if (!n) return
  const reset = precisaResetDiario(
    { ...n, ultimoEnvioEm: n.ultimoEnvioEm, zeradoEm: n.zeradoEm } as NumeroPool,
    agora,
  )
  await prisma.whatsappNumero.update({
    where: { id },
    data: {
      enviadosHoje: reset ? 1 : n.enviadosHoje + 1,
      zeradoEm: reset ? agora : n.zeradoEm,
      ultimoEnvioEm: agora,
    },
  })
}

export async function marcarBanido(id: string): Promise<void> {
  await prisma.whatsappNumero.update({ where: { id }, data: { status: 'banido' } })
}

export async function carregarParametros(): Promise<ParametrosPool> {
  const rows = await prisma.configuracao.findMany({
    where: { chave: { in: ['wa_janela_inicio', 'wa_janela_fim', 'wa_teto_max', 'wa_rampa'] } },
  })
  const cfg = Object.fromEntries(rows.map((r) => [r.chave, r.valor]))
  return {
    rampa: cfg['wa_rampa'] ? cfg['wa_rampa'].split(',').map((x) => parseInt(x.trim(), 10)) : PARAMS_PADRAO.rampa,
    tetoMax: cfg['wa_teto_max'] ? parseInt(cfg['wa_teto_max'], 10) : PARAMS_PADRAO.tetoMax,
    janelaInicio: cfg['wa_janela_inicio'] ? parseInt(cfg['wa_janela_inicio'], 10) : PARAMS_PADRAO.janelaInicio,
    janelaFim: cfg['wa_janela_fim'] ? parseInt(cfg['wa_janela_fim'], 10) : PARAMS_PADRAO.janelaFim,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS nos 2 testes de wrapper.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pool.ts src/tests/run.ts
git commit -m "feat: wrappers de DB do pool (carregar, registrarEnvio, marcarBanido, parâmetros)"
```

---

## Task 5: WhatsApp lib — personalização, variação e opt-out no broadcast

**Files:**
- Modify: `src/lib/whatsapp.ts`
- Test: `src/tests/run.ts`

**Interfaces:**
- Consumes: `estaOptOut` (Task 2)
- Produces: `personalizar(texto: string, nome?: string | null): string` · `microVariacao(texto: string, seed: number): string` · `enfileirarBroadcast(mensagem, tipo?, referencia?, campanhaId?)` agora pula opt-outs e grava `campanhaId`.

- [ ] **Step 1: Write the failing test**

Adicionar em `src/tests/run.ts`:

```ts
  console.log('\n✉️  WhatsApp — conteúdo')

  await test('personalizar troca {nome} pelo primeiro nome', async () => {
    const { personalizar } = await import('@/lib/whatsapp')
    assert(personalizar('Oi {nome}!', 'João Silva') === 'Oi João!', 'Substituição de {nome} falhou')
    assert(personalizar('Olá {nome}', '') === 'Olá ', 'Nome vazio deveria virar string vazia')
    assert(personalizar('Sem token', 'Maria') === 'Sem token', 'Sem {nome} não deveria mudar')
  })

  await test('microVariacao é identidade no seed 0 e varia no resto (mesmo conteúdo visível)', async () => {
    const { microVariacao } = await import('@/lib/whatsapp')
    assert(microVariacao('oi', 0) === 'oi', 'seed 0 deveria ser idêntico')
    const v = microVariacao('oi', 1)
    assert(v !== 'oi', 'seed 1 deveria variar')
    assert(v.replace(/​/g, '') === 'oi', 'variação só pode adicionar caracteres invisíveis')
  })

  await test('enfileirarBroadcast pula telefones em opt-out', async () => {
    const { enfileirarBroadcast } = await import('@/lib/whatsapp')
    const p = await prisma.pessoa.create({ data: { nome: '__optoutbc__', tipo: 'apoiador', telefone: '21955551234', ativo: true } })
    const { registrarOptOut } = await import('@/lib/optout')
    await registrarOptOut('5521955551234', 'todos', '__teste__')
    const r = await enfileirarBroadcast('msg teste', 'broadcast', undefined, '__camp__')
    const naFila = await prisma.whatsappFila.count({ where: { telefone: '5521955551234' } })
    assert(naFila === 0, 'Telefone em opt-out não deveria ser enfileirado')
    // limpeza
    await prisma.whatsappFila.deleteMany({ where: { campanhaId: '__camp__' } })
    await prisma.optOut.deleteMany({ where: { telefone: '5521955551234' } })
    await prisma.pessoa.delete({ where: { id: p.id } })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `personalizar`/`microVariacao` não existem; broadcast não filtra opt-out.

- [ ] **Step 3: Editar `src/lib/whatsapp.ts`**

Adicionar imports no topo (após `import { prisma } from './db'`):

```ts
import { estaOptOut } from './optout'
```

Adicionar funções puras (após `normalizarTelefone`):

```ts
const INVISIVEL = '​' // zero-width space — varia o conteúdo sem alterar o texto visível

/** Substitui {nome} pelo primeiro nome (string vazia se não houver nome). */
export function personalizar(texto: string, nome?: string | null): string {
  const primeiro = (nome || '').trim().split(/\s+/)[0] || ''
  return texto.replace(/\{nome\}/g, primeiro)
}

/** Micro-variação determinística (0 = idêntico) para evitar mensagens byte-a-byte iguais em massa. */
export function microVariacao(texto: string, seed: number): string {
  const n = ((seed % 3) + 3) % 3
  return texto + INVISIVEL.repeat(n)
}
```

Substituir a assinatura e o corpo de `enfileirarBroadcast`:

```ts
// Envia em massa para todos os apoiadores com telefone (broadcast)
export async function enfileirarBroadcast(
  mensagem: string,
  tipo: TipoMensagem = 'broadcast',
  referencia?: string,
  campanhaId?: string,
) {
  const apoiadores = await prisma.pessoa.findMany({
    where: { tipo: { in: ['apoiador', 'coordenador'] }, ativo: true, telefone: { not: null } },
    select: { id: true, telefone: true },
  })
  let enfileirados = 0
  for (const p of apoiadores) {
    const tel = normalizarTelefone(p.telefone!)
    if (!tel) continue
    if (await estaOptOut(tel)) continue
    await prisma.whatsappFila.create({
      data: { telefone: tel, mensagem, tipo, pessoaId: p.id, referencia, campanhaId },
    })
    enfileirados++
  }
  return { enfileirados, totalApoiadores: apoiadores.length }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS nos 3 testes de conteúdo/opt-out.

- [ ] **Step 5: Commit**

```bash
git add src/lib/whatsapp.ts src/tests/run.ts
git commit -m "feat: personalização + micro-variação de texto e opt-out no broadcast de WhatsApp"
```

---

## Task 6: WhatsApp worker — pool de chips + blindagem + opt-out inbound

**Files:**
- Modify: `src/agent/whatsapp-worker.ts`
- Verificação: integração (worker precisa de Baileys/chip real — não há unit test de worker no projeto, seguindo o padrão existente)

**Interfaces:**
- Consumes: `escolherNumero`, `carregarNumeros`, `carregarParametros`, `registrarEnvio`, `marcarBanido` (Tasks 3–4); `personalizar`, `microVariacao` (Task 5); `isPalavraOptOut`, `registrarOptOut` (Task 2); `setConfig` (existente); `enviarTelegram` (de `src/bot/telegram.ts`, ver Step 1).
- Produces: worker que mantém 1 conexão Baileys por `WhatsappNumero` e drena `WhatsappFila` com blindagem.

- [ ] **Step 1: Verificar a API de alerta do Telegram**

Run: `grep -nE "export (async )?function (enviarTelegram|notificar|sendTelegram)" src/bot/telegram.ts`
Expected: um nome exportado para enviar mensagem ao dono. Usar esse nome no Step 2 (abaixo assume `enviarTelegram(texto: string)`; se o nome real diferir, ajustar a chamada). Se não houver função de envio simples, usar `console.error` como fallback do alerta e seguir.

- [ ] **Step 2: Reescrever `src/agent/whatsapp-worker.ts`**

```ts
/**
 * WhatsApp Worker — POOL de chips (Baileys, grátis) com blindagem anti-ban.
 * Execute: npm run whatsapp
 *
 * Cada linha de WhatsappNumero vira uma conexão Baileys com sessão própria em
 * ./.whatsapp-auth/<numeroId>. A fila WhatsappFila é drenada escolhendo o chip
 * pelo pool (rampa de aquecimento, teto diário, janela de horário, rotação),
 * com jitter humano entre envios e micro-variação de conteúdo. Opt-out inbound
 * (SAIR/PARAR/...) é respeitado. Chip deslogado é marcado como banido e sai do pool.
 */
import { prisma } from '../lib/db'
import { setConfig, personalizar, microVariacao, normalizarTelefone } from '../lib/whatsapp'
import { escolherNumero, carregarNumeros, carregarParametros, registrarEnvio, marcarBanido } from '../lib/pool'
import { isPalavraOptOut, registrarOptOut } from '../lib/optout'
import qrcode from 'qrcode'
import path from 'path'

const INTERVALO_FILA = 15_000
const MAX_TENTATIVAS = 3

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const socks = new Map<string, any>()      // numeroId -> socket
const conectados = new Set<string>()       // numeroIds conectados

async function alerta(texto: string) {
  try {
    const mod = await import('../bot/telegram')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (mod as any).enviarTelegram
    if (typeof fn === 'function') { await fn(texto); return }
  } catch { /* ignora */ }
  console.error('[WhatsApp][ALERTA]', texto)
}

async function iniciarChip(numeroId: string, rotulo: string) {
  const baileys = await import('@whiskeysockets/baileys')
  const makeWASocket = baileys.default
  const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys

  const authDir = path.resolve(process.cwd(), '.whatsapp-auth', numeroId)
  const { state, saveCreds } = await useMultiFileAuthState(authDir)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logger: { level: 'silent', child: () => ({ level: 'silent', error() {}, warn() {}, info() {}, debug() {}, trace() {}, fatal() {} }), error() {}, warn() {}, info() {}, debug() {}, trace() {}, fatal() {} } as any,
  })
  socks.set(numeroId, sock)
  sock.ev.on('creds.update', saveCreds)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sock.ev.on('connection.update', async (update: any) => {
    const { connection, lastDisconnect, qr } = update
    if (qr) {
      const dataUrl = await qrcode.toDataURL(qr)
      await setConfig(`whatsapp_qr_${numeroId}`, dataUrl)
      await setConfig(`whatsapp_status_${numeroId}`, 'aguardando_qr')
    }
    if (connection === 'open') {
      conectados.add(numeroId)
      await setConfig(`whatsapp_qr_${numeroId}`, '')
      await setConfig(`whatsapp_status_${numeroId}`, 'conectado')
      await prisma.whatsappNumero.update({ where: { id: numeroId }, data: { status: 'ativo' } }).catch(() => {})
      console.log(`[WhatsApp] ✓ chip "${rotulo}" conectado`)
    }
    if (connection === 'close') {
      conectados.delete(numeroId)
      const code = lastDisconnect?.error?.output?.statusCode
      const deslogado = code === DisconnectReason.loggedOut
      await setConfig(`whatsapp_status_${numeroId}`, deslogado ? 'desconectado' : 'reconectando')
      if (deslogado) {
        await marcarBanido(numeroId)
        await alerta(`⚠️ Chip WhatsApp "${rotulo}" foi deslogado/banido e saiu do pool.`)
      } else {
        setTimeout(() => iniciarChip(numeroId, rotulo).catch((e) => console.error(e)), 5000)
      }
    }
  })

  // Opt-out inbound
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sock.ev.on('messages.upsert', async (m: any) => {
    try {
      for (const msg of m.messages || []) {
        if (msg.key?.fromMe) continue
        const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text || ''
        if (!texto || !isPalavraOptOut(texto)) continue
        const jid: string = msg.key?.remoteJid || ''
        const tel = normalizarTelefone(jid.split('@')[0])
        if (!tel) continue
        await registrarOptOut(tel, 'whatsapp', 'SAIR via whatsapp')
        await sock.sendMessage(jid, { text: 'Pronto, você não receberá mais mensagens. 👋' })
        console.log(`[WhatsApp] opt-out registrado: ${tel}`)
      }
    } catch (e) { console.error('[WhatsApp] erro opt-out inbound:', e) }
  })
}

function jitterMs(): number {
  const min = 8_000, max = 40_000
  return min + Math.floor(Math.random() * (max - min))
}

async function drenarFila() {
  if (conectados.size === 0) return
  const params = await carregarParametros()
  const pendentes = await prisma.whatsappFila.findMany({
    where: {
      status: 'pendente',
      tentativas: { lt: MAX_TENTATIVAS },
      OR: [{ agendadoPara: null }, { agendadoPara: { lte: new Date() } }],
    },
    orderBy: { criadoEm: 'asc' },
    take: 50,
  })

  for (const msg of pendentes) {
    const numeros = (await carregarNumeros()).filter((n) => conectados.has(n.id))
    const escolhido = escolherNumero(numeros, new Date(), params)
    if (!escolhido) break // sem chip elegível agora (teto/janela) — tenta no próximo ciclo
    const sock = socks.get(escolhido.id)
    if (!sock) continue

    const pessoa = msg.pessoaId ? await prisma.pessoa.findUnique({ where: { id: msg.pessoaId }, select: { nome: true } }) : null
    const texto = microVariacao(personalizar(msg.mensagem, pessoa?.nome), Math.floor(Math.random() * 3))
    const jid = `${msg.telefone}@s.whatsapp.net`
    try {
      await sock.sendMessage(jid, { text: texto })
      await prisma.whatsappFila.update({ where: { id: msg.id }, data: { status: 'enviado', enviadoEm: new Date(), numeroId: escolhido.id } })
      await registrarEnvio(escolhido.id)
      console.log(`[WhatsApp] ✓ ${msg.telefone} via ${escolhido.id}`)
    } catch (e) {
      const tentativas = msg.tentativas + 1
      await prisma.whatsappFila.update({
        where: { id: msg.id },
        data: { tentativas, status: tentativas >= MAX_TENTATIVAS ? 'erro' : 'pendente', erro: String(e) },
      })
    }
    await new Promise((r) => setTimeout(r, jitterMs()))
  }
}

async function main() {
  const numeros = await prisma.whatsappNumero.findMany({ where: { status: { not: 'banido' } } })
  if (numeros.length === 0) {
    console.log('[WhatsApp] ⚠️ Nenhum chip cadastrado. Cadastre em /disparos (aba Pool) e reinicie.')
  }
  for (const n of numeros) await iniciarChip(n.id, n.rotulo)
  setInterval(() => { drenarFila().catch((e) => console.error('[WhatsApp] erro fila:', e)) }, INTERVALO_FILA)
  console.log(`[WhatsApp] ✓ Pool rodando (${numeros.length} chip[s]). Fila a cada 15s.\n`)
}

main().catch((err) => { console.error('[WhatsApp] Erro fatal:', err); process.exit(1) })
```

- [ ] **Step 3: Verificar que compila (typecheck)**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem erros no `whatsapp-worker.ts`. (Se `enviarTelegram` não existir, o `as any` já protege; ajustar nome se o tsc apontar.)

- [ ] **Step 4: Verificação de integração (manual, sem chip novo)**

Run: `npm run whatsapp`
Expected: log `Pool rodando (N chip[s])` ou o aviso de "Nenhum chip cadastrado". Não deve crashar. Encerrar com Ctrl-C.

- [ ] **Step 5: Commit**

```bash
git add src/agent/whatsapp-worker.ts
git commit -m "feat: worker de WhatsApp vira pool multi-chip blindado (rotação, jitter, variação, opt-out, detecção de ban)"
```

---

## Task 7: SMS lib — request do gateway (puro) + fila + envio

**Files:**
- Create: `src/lib/sms.ts`
- Test: `src/tests/run.ts`

**Interfaces:**
- Consumes: `normalizarTelefone` (existente), `estaOptOut` (Task 2)
- Produces: `montarRequisicaoGateway(telefone, texto, cfg): { url, headers, body }` · `enfileirarSms(opts): Promise<{ok:boolean;motivo?:string;telefone?:string}>` · `enfileirarBroadcastSms(mensagem, tipo?, campanhaId?): Promise<{enfileirados:number;totalApoiadores:number}>` · `enviarViaGateway(telefone, texto): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

Adicionar em `src/tests/run.ts`:

```ts
  console.log('\n📲 SMS — gateway')

  await test('montarRequisicaoGateway monta E.164, path e Basic auth', async () => {
    const { montarRequisicaoGateway } = await import('@/lib/sms')
    const req = montarRequisicaoGateway('5521999998888', 'oi', { url: 'http://10.0.0.5:8080/', user: 'u', pass: 'p' })
    assert(req.url === 'http://10.0.0.5:8080/message', `URL incorreta: ${req.url}`)
    const body = JSON.parse(req.body)
    assert(body.phoneNumbers[0] === '+5521999998888', `E.164 incorreto: ${body.phoneNumbers[0]}`)
    assert(body.textMessage.text === 'oi', 'Texto incorreto')
    const auth = req.headers['Authorization']
    assert(auth === 'Basic ' + Buffer.from('u:p').toString('base64'), `Auth incorreto: ${auth}`)
  })

  await test('enfileirarSms rejeita telefone inválido e pula opt-out', async () => {
    const { enfileirarSms } = await import('@/lib/sms')
    const r1 = await enfileirarSms({ telefone: '123', mensagem: 'x' })
    assert(!r1.ok, 'Telefone inválido deveria falhar')
    const { registrarOptOut } = await import('@/lib/optout')
    await registrarOptOut('5521944443333', 'todos', '__teste__')
    const r2 = await enfileirarSms({ telefone: '21944443333', mensagem: 'x' })
    assert(!r2.ok && r2.motivo === 'opt-out', `Deveria pular opt-out, veio ${JSON.stringify(r2)}`)
    await prisma.optOut.deleteMany({ where: { telefone: '5521944443333' } })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — módulo `@/lib/sms` não encontrado.

- [ ] **Step 3: Implementar `src/lib/sms.ts`**

```ts
import { prisma } from './db'
import { normalizarTelefone } from './whatsapp'
import { estaOptOut } from './optout'

type GatewayCfg = { url: string; user: string; pass: string }

export function montarRequisicaoGateway(telefone: string, texto: string, cfg: GatewayCfg) {
  const e164 = telefone.startsWith('+') ? telefone : '+' + telefone
  const auth = Buffer.from(`${cfg.user}:${cfg.pass}`).toString('base64')
  return {
    url: `${cfg.url.replace(/\/$/, '')}/message`,
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` } as Record<string, string>,
    body: JSON.stringify({ textMessage: { text: texto }, phoneNumbers: [e164] }),
  }
}

function cfgDoAmbiente(): GatewayCfg | null {
  const url = process.env.SMS_GATEWAY_URL
  const user = process.env.SMS_GATEWAY_USER
  const pass = process.env.SMS_GATEWAY_PASS
  if (!url || !user || !pass) return null
  return { url, user, pass }
}

export async function enviarViaGateway(telefone: string, texto: string): Promise<boolean> {
  const cfg = cfgDoAmbiente()
  if (!cfg) { console.error('[SMS] gateway não configurado (.env)'); return false }
  const req = montarRequisicaoGateway(telefone, texto, cfg)
  try {
    const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body })
    return res.ok
  } catch (e) { console.error('[SMS] erro no gateway:', e); return false }
}

export async function enfileirarSms(opts: { telefone: string; mensagem: string; tipo?: string; pessoaId?: string; referencia?: string; agendadoPara?: Date }) {
  const tel = normalizarTelefone(opts.telefone)
  if (!tel) return { ok: false as const, motivo: 'telefone inválido' }
  if (await estaOptOut(tel)) return { ok: false as const, motivo: 'opt-out' }
  await prisma.smsFila.create({
    data: { telefone: tel, mensagem: opts.mensagem, tipo: opts.tipo ?? 'notificacao', pessoaId: opts.pessoaId, referencia: opts.referencia, agendadoPara: opts.agendadoPara },
  })
  return { ok: true as const, telefone: tel }
}

export async function enfileirarBroadcastSms(mensagem: string, tipo = 'broadcast', campanhaId?: string) {
  const apoiadores = await prisma.pessoa.findMany({
    where: { tipo: { in: ['apoiador', 'coordenador'] }, ativo: true, telefone: { not: null } },
    select: { id: true, telefone: true },
  })
  let enfileirados = 0
  for (const p of apoiadores) {
    const r = await enfileirarSms({ telefone: p.telefone!, mensagem, tipo, pessoaId: p.id, referencia: campanhaId })
    if (r.ok) enfileirados++
  }
  return { enfileirados, totalApoiadores: apoiadores.length }
}
```

Nota: `SmsFila` não tem coluna `campanhaId`; o broadcast grava a referência da campanha em `referencia` (o `Disparo` já rastreia contagens agregadas).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS nos 2 testes de SMS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sms.ts src/tests/run.ts
git commit -m "feat: lib de SMS (request do gateway puro + fila + envio + broadcast)"
```

---

## Task 8: SMS worker

**Files:**
- Create: `src/agent/sms-worker.ts`
- Verificação: integração (precisa do gateway Android para envio real)

**Interfaces:**
- Consumes: `enviarViaGateway` (Task 7)
- Produces: worker que drena `SmsFila`.

- [ ] **Step 1: Implementar `src/agent/sms-worker.ts`**

```ts
/**
 * SMS Worker — drena SmsFila e envia via Android SMS Gateway (capcom6, modo Local Server).
 * Execute: npm run sms
 * Config em .env: SMS_GATEWAY_URL, SMS_GATEWAY_USER, SMS_GATEWAY_PASS.
 */
import { prisma } from '../lib/db'
import { enviarViaGateway } from '../lib/sms'

const INTERVALO_FILA = 15_000
const MAX_TENTATIVAS = 3

function jitterMs(): number {
  const min = 3_000, max = 10_000
  return min + Math.floor(Math.random() * (max - min))
}

async function drenarFila() {
  const pendentes = await prisma.smsFila.findMany({
    where: {
      status: 'pendente',
      tentativas: { lt: MAX_TENTATIVAS },
      OR: [{ agendadoPara: null }, { agendadoPara: { lte: new Date() } }],
    },
    orderBy: { criadoEm: 'asc' },
    take: 50,
  })
  for (const msg of pendentes) {
    const ok = await enviarViaGateway(msg.telefone, msg.mensagem)
    if (ok) {
      await prisma.smsFila.update({ where: { id: msg.id }, data: { status: 'enviado', enviadoEm: new Date() } })
      console.log(`[SMS] ✓ ${msg.telefone}`)
    } else {
      const tentativas = msg.tentativas + 1
      await prisma.smsFila.update({ where: { id: msg.id }, data: { tentativas, status: tentativas >= MAX_TENTATIVAS ? 'erro' : 'pendente', erro: 'falha no gateway' } })
    }
    await new Promise((r) => setTimeout(r, jitterMs()))
  }
}

async function main() {
  console.log('📲 SMS Worker iniciando (Android Gateway)...')
  setInterval(() => { drenarFila().catch((e) => console.error('[SMS] erro fila:', e)) }, INTERVALO_FILA)
  console.log('[SMS] ✓ Rodando. Fila a cada 15s.\n')
}

main().catch((err) => { console.error('[SMS] Erro fatal:', err); process.exit(1) })
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem erros no `sms-worker.ts`.

- [ ] **Step 3: Verificação de integração (sem gateway configurado)**

Run: `npm run sms` (adicionar o script no Task 10; por ora `npx tsx src/agent/sms-worker.ts`)
Expected: `SMS Worker iniciando...` e `Rodando`. Sem gateway no `.env`, envios logam "gateway não configurado" mas o worker não crasha. Encerrar com Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add src/agent/sms-worker.ts
git commit -m "feat: SMS worker drena SmsFila via Android Gateway"
```

---

## Task 9: Orquestração — `dispararCampanha`

**Files:**
- Create: `src/lib/disparo.ts`
- Test: `src/tests/run.ts`

**Interfaces:**
- Consumes: `enfileirarBroadcast` (Task 5), `enfileirarBroadcastSms` (Task 7)
- Produces: `dispararCampanha(opts: { titulo: string; mensagem: string; audiencia: string[]; canais: Array<'whatsapp'|'sms'> }): Promise<{ disparoId: string; whatsapp: number; sms: number; totalAlvo: number }>`

- [ ] **Step 1: Write the failing test**

Adicionar em `src/tests/run.ts`:

```ts
  console.log('\n📣 Disparo — orquestração')

  await test('dispararCampanha faz fan-out nos canais e rastreia Disparo', async () => {
    const { dispararCampanha } = await import('@/lib/disparo')
    const p = await prisma.pessoa.create({ data: { nome: 'Fulano Teste', tipo: 'apoiador', telefone: '21988887777', ativo: true } })
    const r = await dispararCampanha({ titulo: '__camp__', mensagem: 'Olá {nome}', audiencia: ['apoiador'], canais: ['whatsapp', 'sms'] })
    assert(r.whatsapp >= 1, 'Deveria enfileirar ao menos 1 no WhatsApp')
    assert(r.sms >= 1, 'Deveria enfileirar ao menos 1 no SMS')
    const d = await prisma.disparo.findUnique({ where: { id: r.disparoId } })
    assert(d?.canais === 'whatsapp,sms', `canais incorreto: ${d?.canais}`)
    // limpeza
    await prisma.whatsappFila.deleteMany({ where: { telefone: '5521988887777' } })
    await prisma.smsFila.deleteMany({ where: { telefone: '5521988887777' } })
    await prisma.disparo.delete({ where: { id: r.disparoId } })
    await prisma.pessoa.delete({ where: { id: p.id } })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — módulo `@/lib/disparo` não encontrado.

- [ ] **Step 3: Implementar `src/lib/disparo.ts`**

```ts
import { prisma } from './db'
import { enfileirarBroadcast } from './whatsapp'
import { enfileirarBroadcastSms } from './sms'

export async function dispararCampanha(opts: {
  titulo: string
  mensagem: string
  audiencia: string[]
  canais: Array<'whatsapp' | 'sms'>
}): Promise<{ disparoId: string; whatsapp: number; sms: number; totalAlvo: number }> {
  const totalAlvo = await prisma.pessoa.count({
    where: { tipo: { in: opts.audiencia }, ativo: true, telefone: { not: null } },
  })
  const disparo = await prisma.disparo.create({
    data: { titulo: opts.titulo, mensagem: opts.mensagem, canais: opts.canais.join(','), audiencia: opts.audiencia.join(','), totalAlvo },
  })

  let whatsapp = 0
  let sms = 0
  if (opts.canais.includes('whatsapp')) {
    const r = await enfileirarBroadcast(opts.mensagem, 'broadcast', undefined, disparo.id)
    whatsapp = r.enfileirados
  }
  if (opts.canais.includes('sms')) {
    const r = await enfileirarBroadcastSms(opts.mensagem, 'broadcast', disparo.id)
    sms = r.enfileirados
  }
  await prisma.disparo.update({ where: { id: disparo.id }, data: { enfileirados: whatsapp + sms } })
  return { disparoId: disparo.id, whatsapp, sms, totalAlvo }
}
```

Nota: `enfileirarBroadcast` filtra `tipo in (apoiador,coordenador)` internamente; `opts.audiencia` alimenta o `totalAlvo` e o registro. Se `audiencia` trouxer tipos fora desse conjunto, o broadcast os ignora (comportamento intencional da Global Constraint "só base própria").

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS no teste de orquestração.

- [ ] **Step 5: Commit**

```bash
git add src/lib/disparo.ts src/tests/run.ts
git commit -m "feat: dispararCampanha — orquestração de fan-out multicanal com rastreio"
```

---

## Task 10: Wiring — scripts, .env, launch

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `src/agent/sms-worker.ts` (Task 8)
- Produces: script `sms`; `sms-worker` no `launch`; documentação de `.env`.

- [ ] **Step 1: Adicionar script e incluir no launch**

Em `package.json`, na seção `scripts`, adicionar após a linha `"whatsapp": ...`:

```json
    "sms": "tsx src/agent/sms-worker.ts",
```

E no valor de `"launch"`, acrescentar o worker de SMS ao `concurrently` (adicionar o nome `📲 SMS` e o comando `"tsx src/agent/sms-worker.ts"` ao fim da lista de nomes e de comandos):

```json
    "launch": "concurrently --prefix-colors \"bgBlue.bold,bgMagenta.bold,bgGreen.bold,bgYellow.bold,bgCyan.bold\" --names \"🏛 APP,🪽 HERMES,🔗 BOND,📱 WPP,📲 SMS\" \"next dev\" \"tsx src/agent/hermes-worker.ts\" \"tsx src/agent/bond-worker.ts\" \"tsx src/agent/whatsapp-worker.ts\" \"tsx src/agent/sms-worker.ts\"",
```

- [ ] **Step 2: Documentar chaves no `.env.example`**

Adicionar ao fim de `.env.example`:

```
# SMS via Android Gateway (capcom6/android-sms-gateway — modo Local Server)
#   1. Instale o app no Android, ative "Local Server", anote usuário/senha e IP.
#   2. O Android e a VM precisam se enxergar na rede (mesma LAN ou túnel).
SMS_GATEWAY_URL=http://192.168.0.10:8080
SMS_GATEWAY_USER=
SMS_GATEWAY_PASS=
```

- [ ] **Step 3: Verificar que o launch parseia**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json ok')"`
Expected: `package.json ok`

- [ ] **Step 4: Commit**

```bash
git add package.json .env.example
git commit -m "chore: script sms + sms-worker no launch + chaves do gateway no .env.example"
```

---

## Task 11: API de disparos

**Files:**
- Create: `src/app/api/disparos/route.ts`
- Create: `src/app/api/disparos/numero/route.ts`
- Create: `src/app/api/disparos/sms-status/route.ts`
- Test: `src/tests/run.ts` (testa o handler de POST via lógica factorável — a validação do corpo)

**Interfaces:**
- Consumes: `dispararCampanha` (Task 9)
- Produces: `GET /api/disparos` (lista campanhas + status do pool), `POST /api/disparos` (dispara), `POST /api/disparos/numero` (cadastra chip), `GET /api/disparos/sms-status` (ping gateway), `validarCorpoDisparo(body): { ok, erro?, valor? }`.

- [ ] **Step 1: Write the failing test (validação do corpo — puro)**

Adicionar em `src/tests/run.ts`:

```ts
  console.log('\n🌐 API disparos — validação')

  await test('validarCorpoDisparo exige titulo, mensagem e ao menos 1 canal', async () => {
    const { validarCorpoDisparo } = await import('@/app/api/disparos/route')
    assert(!validarCorpoDisparo({}).ok, 'Vazio deveria falhar')
    assert(!validarCorpoDisparo({ titulo: 't', mensagem: 'm', canais: [] }).ok, 'Sem canal deveria falhar')
    assert(!validarCorpoDisparo({ titulo: 't', mensagem: 'm', canais: ['x'] }).ok, 'Canal inválido deveria falhar')
    const bom = validarCorpoDisparo({ titulo: 't', mensagem: 'm', canais: ['whatsapp'], audiencia: ['apoiador'] })
    assert(bom.ok && bom.valor?.canais[0] === 'whatsapp', 'Corpo válido deveria passar')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — módulo `@/app/api/disparos/route` não encontrado / `validarCorpoDisparo` inexistente.

- [ ] **Step 3: Implementar `src/app/api/disparos/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { dispararCampanha } from '@/lib/disparo'

const CANAIS_VALIDOS = ['whatsapp', 'sms']

export function validarCorpoDisparo(body: unknown): { ok: boolean; erro?: string; valor?: { titulo: string; mensagem: string; canais: Array<'whatsapp'|'sms'>; audiencia: string[] } } {
  const b = (body || {}) as Record<string, unknown>
  const titulo = typeof b.titulo === 'string' ? b.titulo.trim() : ''
  const mensagem = typeof b.mensagem === 'string' ? b.mensagem.trim() : ''
  const canais = Array.isArray(b.canais) ? (b.canais as string[]) : []
  const audiencia = Array.isArray(b.audiencia) && b.audiencia.length ? (b.audiencia as string[]) : ['apoiador', 'coordenador']
  if (!titulo) return { ok: false, erro: 'titulo obrigatório' }
  if (!mensagem) return { ok: false, erro: 'mensagem obrigatória' }
  if (!canais.length) return { ok: false, erro: 'selecione ao menos um canal' }
  if (!canais.every((c) => CANAIS_VALIDOS.includes(c))) return { ok: false, erro: 'canal inválido' }
  return { ok: true, valor: { titulo, mensagem, canais: canais as Array<'whatsapp'|'sms'>, audiencia } }
}

export async function GET() {
  const [campanhas, numeros] = await Promise.all([
    prisma.disparo.findMany({ orderBy: { criadoEm: 'desc' }, take: 30 }),
    prisma.whatsappNumero.findMany({ orderBy: { criadoEm: 'asc' } }),
  ])
  return NextResponse.json({ campanhas, numeros })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const v = validarCorpoDisparo(body)
  if (!v.ok || !v.valor) return NextResponse.json({ erro: v.erro }, { status: 400 })
  const r = await dispararCampanha(v.valor)
  return NextResponse.json(r)
}
```

- [ ] **Step 4: Implementar `src/app/api/disparos/numero/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// Cadastra um chip novo no pool. O QR aparece depois na config whatsapp_qr_<id> (worker).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const rotulo = typeof body?.rotulo === 'string' ? body.rotulo.trim() : ''
  if (!rotulo) return NextResponse.json({ erro: 'rotulo obrigatório' }, { status: 400 })
  const n = await prisma.whatsappNumero.create({ data: { rotulo, sessionPath: '' } })
  await prisma.whatsappNumero.update({ where: { id: n.id }, data: { sessionPath: `.whatsapp-auth/${n.id}` } })
  return NextResponse.json({ id: n.id, rotulo, aviso: 'Reinicie o worker de WhatsApp para parear este chip (QR em /disparos).' })
}
```

- [ ] **Step 5: Implementar `src/app/api/disparos/sms-status/route.ts`**

```ts
import { NextResponse } from 'next/server'

export async function GET() {
  const url = process.env.SMS_GATEWAY_URL
  if (!url) return NextResponse.json({ configurado: false, online: false })
  try {
    const res = await fetch(url, { method: 'GET' })
    return NextResponse.json({ configurado: true, online: res.ok || res.status === 401 }) // 401 = servidor vivo, só exige auth
  } catch {
    return NextResponse.json({ configurado: true, online: false })
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`
Expected: PASS no teste de validação.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/disparos src/tests/run.ts
git commit -m "feat: API de disparos (listar/disparar, cadastrar chip, status do gateway SMS)"
```

---

## Task 12: UI `/disparos` + redirect da página antiga

**Files:**
- Create: `src/app/(app)/disparos/page.tsx`
- Modify: `src/app/(app)/whatsapp/page.tsx`
- Verificação: manual (Next dev) — sem test runner de componente no projeto

**Interfaces:**
- Consumes: `GET/POST /api/disparos`, `POST /api/disparos/numero`, `GET /api/disparos/sms-status` (Task 11); config `whatsapp_qr_<id>` / `whatsapp_status_<id>` (Task 6). Reutiliza a rota existente `GET /api/whatsapp` (que devolve config) se disponível; caso contrário lê `whatsapp_qr_<id>` via um pequeno endpoint. Ver Step 1.

- [ ] **Step 1: Descobrir como a página lê config no client**

Run: `sed -n '1,60p' src/app/\(app\)/whatsapp/page.tsx`
Expected: ver como a página atual busca `whatsapp_status`/`whatsapp_qr` (provável `fetch('/api/whatsapp')`). Reusar o mesmo mecanismo por chip (chaves `whatsapp_status_<id>`/`whatsapp_qr_<id>`). Se a API atual só devolve a chave única, estender `src/app/api/whatsapp/route.ts` para aceitar `?numeroId=<id>` e devolver as chaves por chip.

- [ ] **Step 2: Implementar `src/app/(app)/disparos/page.tsx`**

```tsx
'use client'
import { useEffect, useState } from 'react'

type Numero = { id: string; rotulo: string; status: string; enviadosHoje: number; tetoDiario: number; nivelAquecimento: number }
type Campanha = { id: string; titulo: string; canais: string; totalAlvo: number; enfileirados: number; criadoEm: string }

export default function DisparosPage() {
  const [numeros, setNumeros] = useState<Numero[]>([])
  const [campanhas, setCampanhas] = useState<Campanha[]>([])
  const [smsOnline, setSmsOnline] = useState<boolean | null>(null)
  const [titulo, setTitulo] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [canais, setCanais] = useState<string[]>(['whatsapp'])
  const [novoRotulo, setNovoRotulo] = useState('')
  const [msg, setMsg] = useState('')

  async function carregar() {
    const r = await fetch('/api/disparos').then((x) => x.json())
    setNumeros(r.numeros || [])
    setCampanhas(r.campanhas || [])
    const s = await fetch('/api/disparos/sms-status').then((x) => x.json())
    setSmsOnline(s.online)
  }
  useEffect(() => { carregar() }, [])

  function toggleCanal(c: string) {
    setCanais((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))
  }

  async function disparar() {
    setMsg('Enviando...')
    const r = await fetch('/api/disparos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo, mensagem, canais, audiencia: ['apoiador', 'coordenador'] }),
    }).then((x) => x.json())
    if (r.erro) setMsg('Erro: ' + r.erro)
    else { setMsg(`Enfileirado: ${r.whatsapp} WhatsApp + ${r.sms} SMS (alvo: ${r.totalAlvo})`); setTitulo(''); setMensagem(''); carregar() }
  }

  async function addChip() {
    if (!novoRotulo.trim()) return
    await fetch('/api/disparos/numero', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rotulo: novoRotulo }) })
    setNovoRotulo(''); carregar()
  }

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-bold">Disparos</h1>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Compor disparo</h2>
        <input className="w-full border rounded p-2" placeholder="Título da campanha" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        <textarea className="w-full border rounded p-2 h-28" placeholder="Mensagem (use {nome} para personalizar)" value={mensagem} onChange={(e) => setMensagem(e.target.value)} />
        <div className="flex gap-4">
          <label className="flex items-center gap-2"><input type="checkbox" checked={canais.includes('whatsapp')} onChange={() => toggleCanal('whatsapp')} /> WhatsApp</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={canais.includes('sms')} onChange={() => toggleCanal('sms')} /> SMS {smsOnline === false && <span className="text-red-500 text-xs">(gateway offline)</span>}</label>
        </div>
        <button className="bg-blue-600 text-white rounded px-4 py-2" onClick={disparar}>Disparar</button>
        {msg && <p className="text-sm">{msg}</p>}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Pool de chips (WhatsApp)</h2>
        <div className="flex gap-2">
          <input className="border rounded p-2 flex-1" placeholder="Rótulo do novo chip (ex: chip-1 / Vivo)" value={novoRotulo} onChange={(e) => setNovoRotulo(e.target.value)} />
          <button className="bg-green-600 text-white rounded px-4" onClick={addChip}>Adicionar chip</button>
        </div>
        <table className="w-full text-sm border">
          <thead><tr className="bg-gray-100"><th className="text-left p-2">Rótulo</th><th className="p-2">Status</th><th className="p-2">Hoje/Teto</th><th className="p-2">Aquecimento</th></tr></thead>
          <tbody>
            {numeros.map((n) => (
              <tr key={n.id} className="border-t">
                <td className="p-2">{n.rotulo}</td>
                <td className="p-2 text-center">{n.status}</td>
                <td className="p-2 text-center">{n.enviadosHoje}/{n.tetoDiario}</td>
                <td className="p-2 text-center">nível {n.nivelAquecimento}</td>
              </tr>
            ))}
            {numeros.length === 0 && <tr><td colSpan={4} className="p-3 text-center text-gray-500">Nenhum chip. Adicione e reinicie o worker para ler o QR.</td></tr>}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Últimas campanhas</h2>
        <table className="w-full text-sm border mt-2">
          <thead><tr className="bg-gray-100"><th className="text-left p-2">Título</th><th className="p-2">Canais</th><th className="p-2">Enfileirados/Alvo</th></tr></thead>
          <tbody>
            {campanhas.map((c) => (
              <tr key={c.id} className="border-t"><td className="p-2">{c.titulo}</td><td className="p-2 text-center">{c.canais}</td><td className="p-2 text-center">{c.enfileirados}/{c.totalAlvo}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
```

- [ ] **Step 3: Redirecionar a página antiga `/whatsapp`**

Substituir o conteúdo de `src/app/(app)/whatsapp/page.tsx` por:

```tsx
import { redirect } from 'next/navigation'
export default function WhatsappPage() { redirect('/disparos') }
```

- [ ] **Step 4: Verificação manual**

Run: `npm run dev` e abrir `http://localhost:3000/disparos`
Expected: página carrega; formulário de compor, tabela de pool (vazia), painel de campanhas. `/whatsapp` redireciona para `/disparos`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/disparos/page.tsx" "src/app/(app)/whatsapp/page.tsx"
git commit -m "feat: UI /disparos (compor + pool + painel) e redirect da página antiga"
```

- [ ] **Step 6: Ajustar o link da sidebar (se necessário)**

Run: `grep -n "whatsapp" src/components/layout/Sidebar.tsx`
Expected: se houver um item "WhatsApp" apontando para `/whatsapp`, trocar o rótulo para "Disparos" e o href para `/disparos`. Editar, então:

```bash
git add src/components/layout/Sidebar.tsx
git commit -m "chore: sidebar aponta para /disparos"
```

---

## Task 13: Suíte final + finalização da branch

**Files:** nenhum novo

- [ ] **Step 1: Rodar a suíte completa**

Run: `npm test`
Expected: todos os testes passam (schema, opt-out, pool, conteúdo, SMS, orquestração, validação de API).

- [ ] **Step 2: Typecheck geral**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem erros.

- [ ] **Step 3: Build do Next (garante que Baileys não vazou pro bundle)**

Run: `npm run build`
Expected: build conclui sem erro. (Se falhar por import de Baileys, confirmar que todo uso é `await import(...)` dentro de worker, nunca em código de página/route.)

- [ ] **Step 4: Finalização**

Usar a skill `superpowers:finishing-a-development-branch` para decidir merge/PR da branch `feat/disparos-multicanal`.

---

## Self-Review (preenchido)

**Cobertura do spec:**
- §3.1 `WhatsappNumero` → Task 1. §3.2 `SmsFila` → Task 1. §3.3 `OptOut` → Task 1/2. §3.4 colunas `WhatsappFila` → Task 1. §3.5 `Disparo` → Task 1/9.
- §4.1 whatsapp.ts (opt-out+campanhaId+variação) → Task 5. §4.2 pool.ts → Tasks 3–4. §4.3 worker pool → Task 6. §4.4 sms.ts → Task 7. §4.5 sms-worker → Task 8. §4.6 disparo.ts → Task 9. §4.7 opt-out inbound → Task 6. §4.8 UI+API → Tasks 11–12.
- §5 parâmetros de blindagem em `Configuracao` → `carregarParametros` (Task 4) + defaults `PARAMS_PADRAO` (Task 3). §9 `.env` → Task 10. §10 impacto (launch, redirect) → Tasks 10 e 12.

**Placeholders:** nenhum "TBD/TODO"; todo passo de código traz o código completo. Passos de descoberta (Task 6 Step 1, Task 12 Step 1) usam `grep`/`sed` reais para confirmar nomes antes de editar — não são placeholders, são verificações.

**Consistência de tipos:** `NumeroPool`/`ParametrosPool` definidos na Task 3 e consumidos igual nas Tasks 4 e 6. `escolherNumero(numeros, agora, params)` mesma assinatura em teste e uso. `enfileirarBroadcast(mensagem, tipo, referencia, campanhaId)` estendida na Task 5 e chamada assim na Task 9. `montarRequisicaoGateway(telefone, texto, cfg)` idem entre Task 7 e testes. `dispararCampanha` retorna `{disparoId, whatsapp, sms, totalAlvo}` — consumido igual na API (Task 11) e UI (Task 12).

**Riscos conhecidos / verificação embutida:** worker de WhatsApp e SMS não têm unit test (padrão do projeto — dependem de Baileys/gateway reais); mitigado extraindo toda a lógica decisória para funções puras testadas e adicionando passos de typecheck + integração manual. Nome de `enviarTelegram` confirmado por `grep` na Task 6 Step 1 antes do uso.
