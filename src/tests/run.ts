import { PrismaClient } from '@prisma/client'
import { pontuarViral, interacoesPonderadas } from '../lib/viral/algoritmo'

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

  // ── 2.5 Interações — filtro de período (anti-vazamento) ──────────────────────
  console.log('\n📅 Interações — filtro por data')

  await test('filtroPeriodo bucketa por data real/post, nunca pelo ingest', async () => {
    const { filtroPeriodo } = await import('@/lib/interacoes')
    const de = '2026-06-15', ate = '2026-06-21'
    const gte = new Date(de + 'T00:00:00'), lte = new Date(ate + 'T23:59:59')
    const f = await filtroPeriodo(de, ate)
    if (f === null) return // base sem dados Bond → nada a checar
    // Posts publicados na janela (universo do fallback honesto)
    const postsJanela = new Set((await prisma.bondPost.findMany({ where: { publicadoEm: { gte, lte } }, select: { postId: true } })).map((p) => p.postId))
    // Todo comentário retornado deve ter data real na janela OU (sem data) pertencer a post da janela.
    const got = await prisma.bondComentario.findMany({ where: f, select: { publicadoEm: true, postId: true } })
    for (const c of got) {
      const real = c.publicadoEm && c.publicadoEm >= gte && c.publicadoEm <= lte
      const viaPost = !c.publicadoEm && postsJanela.has(c.postId)
      assert(!!(real || viaPost), `Comentário fora da janela vazou (pub=${c.publicadoEm?.toISOString()}, post=${c.postId})`)
    }
    // Regressão: o fallback antigo (criadoEm) NÃO pode mais inflar a contagem.
    const leakAntigo = await prisma.bondComentario.count({ where: { OR: [{ publicadoEm: { gte, lte } }, { publicadoEm: null, criadoEm: { gte, lte } }] } })
    assert(got.length <= leakAntigo, `Filtro novo (${got.length}) deveria ser ≤ ao antigo (${leakAntigo})`)
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

  // ── Pool — wrappers de DB ────────────────────────────────────────────────────
  console.log('\n🔗 Pool — wrappers de DB')

  await test('registrarEnvio incrementa contador e reseta na virada de dia', async () => {
    const { registrarEnvio } = await import('@/lib/pool')
    const sessionPath = `.whatsapp-auth/__t_reg_${Date.now()}__`
    const n = await prisma.whatsappNumero.create({
      data: { rotulo: '__t__', sessionPath, enviadosHoje: 5, zeradoEm: new Date(2020, 0, 1) },
    })
    await registrarEnvio(n.id) // zeradoEm antigo → deve resetar p/ 1
    const depois = await prisma.whatsappNumero.findUnique({ where: { id: n.id } })
    assert(depois?.enviadosHoje === 1, `Esperado 1 após reset+envio, veio ${depois?.enviadosHoje}`)
    assert(!!depois?.ultimoEnvioEm, 'ultimoEnvioEm devia ser setado')
    await prisma.whatsappNumero.delete({ where: { id: n.id } })
  })

  await test('registrarEnvio avança nivelAquecimento no reset diário, com teto na rampa', async () => {
    const { registrarEnvio } = await import('@/lib/pool')
    const { PARAMS_PADRAO } = await import('@/lib/pool')
    const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const n1 = await prisma.whatsappNumero.create({
      data: { rotulo: '__t_ramp1__', sessionPath: `.whatsapp-auth/__t_ramp1_${Date.now()}__`, nivelAquecimento: 2, zeradoEm: ontem },
    })
    await registrarEnvio(n1.id)
    const d1 = await prisma.whatsappNumero.findUnique({ where: { id: n1.id } })
    assert(d1?.nivelAquecimento === 3, `Esperado nivelAquecimento 3, veio ${d1?.nivelAquecimento}`)
    assert(d1?.enviadosHoje === 1, `Esperado enviadosHoje 1, veio ${d1?.enviadosHoje}`)
    await prisma.whatsappNumero.delete({ where: { id: n1.id } })

    const n2 = await prisma.whatsappNumero.create({
      data: { rotulo: '__t_ramp2__', sessionPath: `.whatsapp-auth/__t_ramp2_${Date.now()}__`, nivelAquecimento: PARAMS_PADRAO.rampa.length, zeradoEm: ontem },
    })
    await registrarEnvio(n2.id)
    const d2 = await prisma.whatsappNumero.findUnique({ where: { id: n2.id } })
    assert(d2?.nivelAquecimento === PARAMS_PADRAO.rampa.length, `Não deveria passar do teto (${PARAMS_PADRAO.rampa.length}), veio ${d2?.nivelAquecimento}`)
    await prisma.whatsappNumero.delete({ where: { id: n2.id } })
  })

  await test('marcarBanido muda status', async () => {
    const { marcarBanido } = await import('@/lib/pool')
    const sessionPath = `.whatsapp-auth/__t_ban_${Date.now()}__`
    const n = await prisma.whatsappNumero.create({ data: { rotulo: '__t__', sessionPath, status: 'ativo' } })
    await marcarBanido(n.id)
    const depois = await prisma.whatsappNumero.findUnique({ where: { id: n.id } })
    assert(depois?.status === 'banido', `Status esperado banido, veio ${depois?.status}`)
    await prisma.whatsappNumero.delete({ where: { id: n.id } })
  })

  // ── Scorer viral (algoritmo puro — fonte única, Fase 1.2) ───────────────────
  console.log('\n📈 Scorer viral (algoritmo.ts)')

  await test('interacoesPonderadas — pesos 1/2/3 (like/comentário/compartilho)', () => {
    assert(interacoesPonderadas({ likes: 1, comentarios: 1, compartilhos: 1 }) === 6, 'Soma ponderada incorreta')
    assert(interacoesPonderadas({ likes: null, comentarios: undefined, compartilhos: 2 }) === 6, 'Null/undefined deviam contar 0')
  })

  await test('Camada A por impressões — paridade com a fórmula antiga da campanha', () => {
    // wi = 100 + 20*2 + 10*3 = 170; 170/2000 = 8,5% de 10% ótimo → 85
    const r = pontuarViral('feed', { likes: 100, comentarios: 20, compartilhos: 10, impressoes: 2000 })
    assert(r.camada === 'A', `Camada esperada A, veio ${r.camada}`)
    assert(r.scoreTotal === 85, `Score esperado 85, veio ${r.scoreTotal}`)
  })

  await test('Camada A por impressões — satura em 100', () => {
    const r = pontuarViral('feed', { likes: 500, comentarios: 100, compartilhos: 100, impressoes: 1000 })
    assert(r.scoreTotal === 100, `Score esperado 100, veio ${r.scoreTotal}`)
  })

  await test('Sem nenhum sinal disponível — score 0 (não NaN)', () => {
    const r = pontuarViral('feed', {})
    assert(r.scoreTotal === 0, `Score esperado 0, veio ${r.scoreTotal}`)
  })

  await test('temaEmAlta tri-state — desconhecido não dilui o score', () => {
    const base = { likes: 100, comentarios: 20, compartilhos: 10, impressoes: 2000 }
    const desconhecido = pontuarViral('feed', base)
    const falso = pontuarViral('feed', { ...base, temaEmAlta: false })
    assert(desconhecido.scoreTotal > falso.scoreTotal, `Desconhecido (${desconhecido.scoreTotal}) devia > falso explícito (${falso.scoreTotal})`)
  })

  await test('Camada B — selecionada quando há reach + sinal de distribuição', () => {
    const r = pontuarViral('reel', { reach: 10000, saves: 300, sends: 200, likes: 500, completionPct: 60 })
    assert(r.camada === 'B', `Camada esperada B, veio ${r.camada}`)
    assert(r.scoreTotal > 0, 'Score camada B devia ser > 0')
  })

  await test('Gate baixaQualidade — zera o score', () => {
    const r = pontuarViral('feed', { likes: 100, comentarios: 20, compartilhos: 10, impressoes: 2000, baixaQualidade: true })
    assert(r.scoreTotal === 0, `Score esperado 0 com gate, veio ${r.scoreTotal}`)
  })

  // ── WhatsApp — conteúdo ──────────────────────────────────────────────────────
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
    // Controle positivo: SEM opt-out, o telefone É enfileirado
    await enfileirarBroadcast('msg teste', 'broadcast', undefined, '__camp_pre__')
    const semOptOut = await prisma.whatsappFila.count({ where: { telefone: '5521955551234' } })
    assert(semOptOut >= 1, `Sem opt-out o telefone deveria ser enfileirado (veio ${semOptOut})`)
    await prisma.whatsappFila.deleteMany({ where: { campanhaId: '__camp_pre__' } })
    // Com opt-out, o telefone é excluído
    await registrarOptOut('5521955551234', 'todos', '__teste__')
    const r = await enfileirarBroadcast('msg teste', 'broadcast', undefined, '__camp__')
    const naFila = await prisma.whatsappFila.count({ where: { telefone: '5521955551234' } })
    assert(naFila === 0, 'Telefone em opt-out não deveria ser enfileirado')
    // limpeza
    await prisma.whatsappFila.deleteMany({ where: { campanhaId: '__camp__' } })
    await prisma.whatsappFila.deleteMany({ where: { campanhaId: '__camp_pre__' } })
    await prisma.optOut.deleteMany({ where: { telefone: '5521955551234' } })
    await prisma.pessoa.delete({ where: { id: p.id } })
  })

  await test('enfileirarWhatsapp não enfileira telefone em opt-out', async () => {
    const { enfileirarWhatsapp } = await import('@/lib/whatsapp')
    const { registrarOptOut } = await import('@/lib/optout')
    const p = await prisma.pessoa.create({ data: { nome: '__optoutenq__', tipo: 'apoiador', telefone: '21955552222', ativo: true } })
    await registrarOptOut('5521955552222', 'todos', '__teste__')
    const r = await enfileirarWhatsapp({ telefone: '21955552222', mensagem: 'oi' })
    assert(!r.ok && r.motivo === 'opt-out', `Deveria recusar opt-out, veio ${JSON.stringify(r)}`)
    const naFila = await prisma.whatsappFila.count({ where: { telefone: '5521955552222' } })
    assert(naFila === 0, 'Não deveria ter criado linha na fila')
    await prisma.optOut.deleteMany({ where: { telefone: '5521955552222' } })
    await prisma.pessoa.delete({ where: { id: p.id } })
  })

  // ── Disparos multicanal — orquestração ──────────────────────────────────────
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

  await test('dispararCampanha respeita a audiencia escolhida (não vaza para outros tipos)', async () => {
    const { dispararCampanha } = await import('@/lib/disparo')
    const apoiador = await prisma.pessoa.create({ data: { nome: '__audApoiador__', tipo: 'apoiador', telefone: '21977776666', ativo: true } })
    const coordenador = await prisma.pessoa.create({ data: { nome: '__audCoord__', tipo: 'coordenador', telefone: '21966665555', ativo: true } })
    const r = await dispararCampanha({ titulo: '__audcamp__', mensagem: 'Olá', audiencia: ['apoiador'], canais: ['whatsapp'] })
    assert(r.whatsapp === 1, `Deveria enfileirar só 1 (apoiador), veio ${r.whatsapp}`)
    const naFilaApoiador = await prisma.whatsappFila.count({ where: { telefone: '5521977776666' } })
    const naFilaCoord = await prisma.whatsappFila.count({ where: { telefone: '5521966665555' } })
    assert(naFilaApoiador === 1, `Apoiador deveria estar na fila, veio ${naFilaApoiador}`)
    assert(naFilaCoord === 0, `Coordenador NÃO deveria estar na fila, veio ${naFilaCoord}`)
    // limpeza
    await prisma.whatsappFila.deleteMany({ where: { campanhaId: r.disparoId } })
    await prisma.disparo.delete({ where: { id: r.disparoId } })
    await prisma.pessoa.delete({ where: { id: apoiador.id } })
    await prisma.pessoa.delete({ where: { id: coordenador.id } })
  })

  // ── SMS ──────────────────────────────────────────────────────────────────────
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

  console.log('\n🌐 API disparos — validação')

  await test('validarCorpoDisparo exige titulo, mensagem e ao menos 1 canal', async () => {
    const { validarCorpoDisparo } = await import('@/lib/disparo')
    assert(!validarCorpoDisparo({}).ok, 'Vazio deveria falhar')
    assert(!validarCorpoDisparo({ titulo: 't', mensagem: 'm', canais: [] }).ok, 'Sem canal deveria falhar')
    assert(!validarCorpoDisparo({ titulo: 't', mensagem: 'm', canais: ['x'] }).ok, 'Canal inválido deveria falhar')
    const bom = validarCorpoDisparo({ titulo: 't', mensagem: 'm', canais: ['whatsapp'], audiencia: ['apoiador'] })
    assert(bom.ok && bom.valor?.canais[0] === 'whatsapp', 'Corpo válido deveria passar')
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
