import { PrismaClient } from '@prisma/client'

// ──────────────────────────────────────────────────────────────────────────────
// Mini test runner
// ──────────────────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
const errors: string[] = []

async function test(name: string, fn: () => Promise<void> | void) {
  process.stdout.write(`  ◌ ${name}`)
  try {
    await fn()
    process.stdout.write(`\r  ✅ ${name}\n`)
    passed++
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stdout.write(`\r  ❌ ${name}\n     → ${msg}\n`)
    failed++
    errors.push(`${name}: ${msg}`)
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg)
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient()

async function main() {
  console.log('\n🧪 PolitiMonitor — Rodando testes...\n')

  // ── 1. Database ──────────────────────────────────────────────────────────────
  console.log('📂 Banco de dados')

  await test('Conexão com SQLite', async () => {
    const r = await prisma.$queryRaw<{ ok: number | bigint }[]>`SELECT 1 as ok`
    assert(Array.isArray(r) && r.length > 0, 'Query não retornou resultados')
    const val = Number(r[0].ok)
    assert(val === 1, `Valor esperado 1, recebido ${val}`)
  })

  await test('CRUD Pessoa', async () => {
    const p = await prisma.pessoa.create({
      data: { nome: '__teste__', tipo: 'contato' },
    })
    assert(!!p.id, 'ID não gerado')
    await prisma.pessoa.delete({ where: { id: p.id } })
  })

  await test('CRUD Demanda', async () => {
    const d = await prisma.demanda.create({
      data: { titulo: '__teste__', descricao: 'desc de teste', prioridade: 'baixa' },
    })
    assert(d.status === 'aberta', `Status padrão incorreto: ${d.status}`)
    await prisma.demanda.delete({ where: { id: d.id } })
  })

  await test('CRUD Atividade', async () => {
    const a = await prisma.atividade.create({
      data: { tipo: 'reuniao', titulo: '__teste__', data: new Date() },
    })
    assert(!!a.id, 'ID não gerado')
    await prisma.atividade.delete({ where: { id: a.id } })
  })

  await test('CRUD Post monitoramento', async () => {
    const p = await prisma.post.create({
      data: { plataforma: 'twitter', conteudo: '__teste__' },
    })
    assert(p.likes === 0, `Likes padrão incorreto: ${p.likes}`)
    await prisma.post.delete({ where: { id: p.id } })
  })

  await test('CRUD PalavraChave', async () => {
    const pk = await prisma.palavraChave.create({ data: { palavra: '__teste__xyz__' } })
    assert(pk.ativa === true, 'Ativa padrão incorreto')
    await prisma.palavraChave.delete({ where: { id: pk.id } })
  })

  await test('CRUD TelegramMensagem', async () => {
    const tm = await prisma.telegramMensagem.create({
      data: { chatId: '99999', mensagem: '__teste__' },
    })
    assert(tm.respondida === false, 'Respondida padrão incorreto')
    await prisma.telegramMensagem.delete({ where: { id: tm.id } })
  })

  // ── 2. Hermes ────────────────────────────────────────────────────────────────
  console.log('\n🪽  Hermes Agent')

  await test('HermesMemoria — upsert e leitura', async () => {
    await prisma.hermesMemoria.upsert({
      where: { tipo_chave: { tipo: 'teste', chave: '__chave__' } },
      update: { conteudo: 'valor_v2' },
      create: { tipo: 'teste', chave: '__chave__', conteudo: 'valor_v1' },
    })
    // segundo upsert (deve atualizar)
    await prisma.hermesMemoria.upsert({
      where: { tipo_chave: { tipo: 'teste', chave: '__chave__' } },
      update: { conteudo: 'valor_v2' },
      create: { tipo: 'teste', chave: '__chave__', conteudo: 'valor_v1' },
    })
    const m = await prisma.hermesMemoria.findUnique({
      where: { tipo_chave: { tipo: 'teste', chave: '__chave__' } },
    })
    assert(m?.conteudo === 'valor_v2', `Conteúdo incorreto: ${m?.conteudo}`)
    await prisma.hermesMemoria.delete({
      where: { tipo_chave: { tipo: 'teste', chave: '__chave__' } },
    })
  })

  await test('HermesInsight — criar e marcar lido', async () => {
    const i = await prisma.hermesInsight.create({
      data: { titulo: '__teste__', descricao: 'desc', tipo: 'sugestao', prioridade: 'baixa' },
    })
    assert(!i.lido, 'Deve iniciar como não lido')
    await prisma.hermesInsight.update({ where: { id: i.id }, data: { lido: true } })
    const updated = await prisma.hermesInsight.findUnique({ where: { id: i.id } })
    assert(updated?.lido === true, 'Marcar como lido falhou')
    await prisma.hermesInsight.delete({ where: { id: i.id } })
  })

  await test('HermesJob — enqueue e transição de status', async () => {
    const j = await prisma.hermesJob.create({
      data: { tipo: 'analise_demanda', payload: '{"id":"test"}', status: 'pendente' },
    })
    assert(j.status === 'pendente', `Status inicial incorreto: ${j.status}`)
    await prisma.hermesJob.update({
      where: { id: j.id },
      data: { status: 'concluido', resultado: 'ok', processadoEm: new Date() },
    })
    const done = await prisma.hermesJob.findUnique({ where: { id: j.id } })
    assert(done?.status === 'concluido', `Update de status falhou: ${done?.status}`)
    await prisma.hermesJob.delete({ where: { id: j.id } })
  })

  // ── 3. Autenticação JWT ──────────────────────────────────────────────────────
  console.log('\n🔐 Autenticação')

  await test('JWT — geração e verificação', async () => {
    const { SignJWT, jwtVerify } = await import('jose')
    const secret = new TextEncoder().encode('test-secret-key-polimonitor')
    const token = await new SignJWT({ role: 'admin', ts: Date.now() })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(secret)
    assert(typeof token === 'string' && token.split('.').length === 3, 'Token JWT malformado')
    const { payload } = await jwtVerify(token, secret)
    assert(payload.role === 'admin', `Payload incorreto: ${JSON.stringify(payload)}`)
  })

  await test('JWT — token expirado é rejeitado', async () => {
    const { SignJWT, jwtVerify } = await import('jose')
    const secret = new TextEncoder().encode('test-secret-key-polimonitor')
    const token = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('-1s')
      .sign(secret)
    let rejeitou = false
    try {
      await jwtVerify(token, secret)
    } catch {
      rejeitou = true
    }
    assert(rejeitou, 'Token expirado deveria ser rejeitado')
  })

  // ── 4. Configurações ─────────────────────────────────────────────────────────
  console.log('\n⚙️  Configurações')

  await test('Salvar e recuperar configuração', async () => {
    await prisma.configuracao.upsert({
      where: { chave: '__teste__cfg__' },
      update: { valor: 'polimonitor_ok' },
      create: { chave: '__teste__cfg__', valor: 'polimonitor_ok' },
    })
    const c = await prisma.configuracao.findUnique({ where: { chave: '__teste__cfg__' } })
    assert(c?.valor === 'polimonitor_ok', `Valor incorreto: ${c?.valor}`)
    await prisma.configuracao.delete({ where: { chave: '__teste__cfg__' } })
  })

  // ── 5. Variáveis de ambiente ──────────────────────────────────────────────────
  console.log('\n🌿 Variáveis de ambiente')

  await test('DATABASE_URL configurada', () => {
    assert(!!process.env.DATABASE_URL, 'DATABASE_URL ausente no .env')
  })

  await test('AUTH_SECRET configurada', () => {
    assert(!!process.env.AUTH_SECRET, 'AUTH_SECRET ausente no .env')
  })

  await test('ADMIN_PASSWORD configurada', () => {
    assert(!!process.env.ADMIN_PASSWORD, 'ADMIN_PASSWORD ausente no .env')
  })

  await test('AI configurada (Gemini ou OpenRouter)', () => {
    const hasAI = !!process.env.GEMINI_API_KEY || !!process.env.OPENROUTER_API_KEY
    if (!hasAI) {
      console.log('\n     ⚠️  Nenhuma chave de IA configurada — IA ficará desativada')
    }
    // não falha — IA é opcional
  })

  // ── Resultado final ──────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50))
  if (failed === 0) {
    console.log(`✅ Todos os ${passed} testes passaram!\n`)
  } else {
    console.log(`❌ ${failed} falha(s) | ✅ ${passed} passou(aram)\n`)
    errors.forEach((e) => console.log('  •', e))
    console.log()
    process.exit(1)
  }

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error('\n❌ Erro fatal nos testes:', err.message ?? err)
  await prisma.$disconnect()
  process.exit(1)
})
