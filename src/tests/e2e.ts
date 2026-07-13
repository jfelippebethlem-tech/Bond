/**
 * Teste END-TO-END "como um humano usaria" — Disparos Multicanal.
 * Roda contra a CÓPIA do banco (DATABASE_URL=file:./dev-disparos.db) e sobe um
 * gateway SMS HTTP EMULADO real (capcom6-like). Exercita: API real de disparo,
 * drain de WhatsApp (socket fake) e de SMS (gateway real), opt-out (enqueue +
 * ponto de envio + inbound), rotação/teto do pool, personalização + spintax e ban.
 *
 * Execute: DATABASE_URL="file:./dev-disparos.db" npm run test:e2e
 */
import { PrismaClient } from '@prisma/client'
import http from 'http'
import { AddressInfo } from 'net'

const prisma = new PrismaClient()

// ── mini runner ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0
const errors: string[] = []
async function test(name: string, fn: () => Promise<void> | void) {
  process.stdout.write(`  ◌ ${name}`)
  try { await fn(); process.stdout.write(`\r  ✅ ${name}\n`); passed++ }
  catch (err) { const m = err instanceof Error ? err.message : String(err); process.stdout.write(`\r  ❌ ${name}\n     → ${m}\n`); failed++; errors.push(`${name}: ${m}`) }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg) }

// ── gateway SMS EMULADO (capcom6-like: POST /message, Basic auth) ──────────────
type GwReq = { auth: string | null; body: any }
const recebidosSms: GwReq[] = []
const GW_USER = 'e2euser', GW_PASS = 'e2epass'
const gateway = http.createServer((req, res) => {
  if (req.method === 'GET') { res.writeHead(200).end('ok'); return } // ping do sms-status
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    const auth = req.headers['authorization'] || null
    // exige Basic auth correto
    const esperado = 'Basic ' + Buffer.from(`${GW_USER}:${GW_PASS}`).toString('base64')
    if (auth !== esperado) { res.writeHead(401).end('unauthorized'); return }
    let body: any = null
    try { body = JSON.parse(raw) } catch { /* ignore */ }
    recebidosSms.push({ auth, body })
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ state: 'Pending' }))
  })
})

const MARK = '__E2E__'
// A cópia dev-disparos.db é dedicada a testes. Os drains são GLOBAIS (como o worker
// real drena a fila inteira), então isolamos zerando as tabelas operacionais + os
// apoiadores de teste — garante contagens determinísticas independentemente de resíduos.
async function limpar() {
  await prisma.whatsappFila.deleteMany({})
  await prisma.smsFila.deleteMany({})
  await prisma.disparo.deleteMany({})
  await prisma.optOut.deleteMany({})
  await prisma.whatsappNumero.deleteMany({})
  await prisma.configuracao.deleteMany({ where: { chave: 'wa_rampa' } })
  await prisma.pessoa.deleteMany({ where: { OR: [{ nome: { contains: MARK } }, { tipo: { in: ['apoiador', 'coordenador'] }, telefone: { not: null } }] } })
}

async function main() {
  console.log('\n🧪 E2E — Disparos Multicanal (fluxo humano)\n')

  // sobe o gateway emulado em porta livre
  await new Promise<void>((r) => gateway.listen(0, '127.0.0.1', () => r()))
  const port = (gateway.address() as AddressInfo).port
  process.env.SMS_GATEWAY_URL = `http://127.0.0.1:${port}`
  process.env.SMS_GATEWAY_USER = GW_USER
  process.env.SMS_GATEWAY_PASS = GW_PASS
  console.log(`   gateway SMS emulado em ${process.env.SMS_GATEWAY_URL}\n`)

  await limpar()

  // ── Cenário: base de apoiadores + coordenador + chips ────────────────────────
  // telefones dedicados (faixa de teste) para não colidir
  const ana = await prisma.pessoa.create({ data: { nome: `Ana ${MARK}`, tipo: 'apoiador', telefone: '21970000001', ativo: true } })
  const bruno = await prisma.pessoa.create({ data: { nome: `Bruno ${MARK}`, tipo: 'apoiador', telefone: '21970000002', ativo: true } })
  const carla = await prisma.pessoa.create({ data: { nome: `Carla ${MARK}`, tipo: 'apoiador', telefone: '21970000003', ativo: true } })
  const diego = await prisma.pessoa.create({ data: { nome: `Diego ${MARK}`, tipo: 'coordenador', telefone: '21970000004', ativo: true } })
  const fora = await prisma.pessoa.create({ data: { nome: `Fora ${MARK}`, tipo: 'contato', telefone: '21970000009', ativo: true } })

  // Carla optou por sair ANTES do disparo (deve ser excluída no enqueue)
  const { registrarOptOut } = await import('@/lib/optout')
  await registrarOptOut('5521970000003', 'todos', MARK)

  // rampa custom pequena para forçar rotação e teste de teto: nível 1 → 2/chip
  await prisma.configuracao.upsert({ where: { chave: 'wa_rampa' }, update: { valor: '2,4,8' }, create: { chave: 'wa_rampa', valor: '2,4,8' } })
  // 2 chips conectados
  const chip1 = await prisma.whatsappNumero.create({ data: { rotulo: `chip1 ${MARK}`, sessionPath: `.whatsapp-auth/${MARK}1`, status: 'ativo', nivelAquecimento: 1 } })
  const chip2 = await prisma.whatsappNumero.create({ data: { rotulo: `chip2 ${MARK}`, sessionPath: `.whatsapp-auth/${MARK}2`, status: 'ativo', nivelAquecimento: 1 } })

  const MENSAGEM = `{Oi|Olá|E aí} {nome}, novidade do mandato! ${MARK}`

  // ── 1. API: validação rejeita corpo ruim ─────────────────────────────────────
  const rota = await import('@/app/api/disparos/route')
  await test('API POST /disparos rejeita corpo inválido (sem canal) com 400', async () => {
    const req = new Request('http://x/api/disparos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ titulo: 't', mensagem: 'm', canais: [] }) })
    const res = await rota.POST(req)
    assert(res.status === 400, `esperado 400, veio ${res.status}`)
  })

  // ── 2. API: dispara campanha real (whatsapp+sms) ─────────────────────────────
  let disparoId = ''
  await test('API POST /disparos enfileira nos 2 canais, exclui opt-out, respeita audiência', async () => {
    const req = new Request('http://x/api/disparos', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ titulo: `Campanha ${MARK}`, mensagem: MENSAGEM, canais: ['whatsapp', 'sms'], audiencia: ['apoiador', 'coordenador'] }),
    })
    const res = await rota.POST(req)
    const j: any = await res.json()
    disparoId = j.disparoId
    // audiência apoiador+coordenador = Ana, Bruno, Carla, Diego; Carla(opt-out) e Fora(contato) fora
    assert(j.totalAlvo === 4, `totalAlvo esperado 4 (Ana,Bruno,Carla,Diego), veio ${j.totalAlvo}`)
    assert(j.whatsapp === 3, `WhatsApp enfileirados esperado 3 (sem Carla opt-out), veio ${j.whatsapp}`)
    assert(j.sms === 3, `SMS enfileirados esperado 3, veio ${j.sms}`)
    // Carla NÃO pode estar em nenhuma fila
    const carlaWa = await prisma.whatsappFila.count({ where: { telefone: '5521970000003' } })
    const carlaSms = await prisma.smsFila.count({ where: { telefone: '5521970000003' } })
    assert(carlaWa === 0 && carlaSms === 0, `Carla (opt-out) vazou: wa=${carlaWa} sms=${carlaSms}`)
    // Fora (contato) não está na audiência
    const foraWa = await prisma.whatsappFila.count({ where: { telefone: '5521970000009' } })
    assert(foraWa === 0, `Fora (contato) não deveria ser enfileirado`)
  })

  // ── 3. API: GET lista campanhas + pool; /numero cadastra; sms-status online ───
  await test('API GET /disparos devolve a campanha e os 2 chips', async () => {
    const res = await rota.GET()
    const j: any = await res.json()
    assert(j.campanhas.some((c: any) => c.id === disparoId), 'campanha criada não apareceu no GET')
    assert(j.numeros.filter((n: any) => String(n.rotulo).includes(MARK)).length === 2, 'os 2 chips E2E deveriam aparecer')
  })

  await test('API POST /disparos/numero cadastra chip com sessionPath derivado do id', async () => {
    const numRota = await import('@/app/api/disparos/numero/route')
    const req = new Request('http://x/api/disparos/numero', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rotulo: `chip3 ${MARK}` }) })
    const res = await numRota.POST(req)
    const j: any = await res.json()
    const n = await prisma.whatsappNumero.findUnique({ where: { id: j.id } })
    assert(n?.sessionPath === `.whatsapp-auth/${j.id}`, `sessionPath incorreto: ${n?.sessionPath}`)
  })

  await test('API GET /sms-status reporta gateway ONLINE (ping real)', async () => {
    const stRota = await import('@/app/api/disparos/sms-status/route')
    const res = await stRota.GET()
    const j: any = await res.json()
    assert(j.configurado === true && j.online === true, `status inesperado: ${JSON.stringify(j)}`)
  })

  // ── 4. Opt-out no PONTO DE ENVIO: Bruno opta por sair APÓS enfileirar ─────────
  await registrarOptOut('5521970000002', 'todos', MARK)

  // ── 5. Drain WhatsApp com socket FAKE (sem Baileys) ──────────────────────────
  const enviados: { numeroId: string; telefone: string; texto: string }[] = []
  await test('Drain WhatsApp: envia, personaliza+spintax, cancela opt-out, rotaciona chips no teto', async () => {
    const { drenarFilaWhatsapp } = await import('@/lib/whatsappDrain')
    const meioDia = new Date(2026, 6, 13, 12, 0, 0) // dentro da janela 9-20
    const r = await drenarFilaWhatsapp({
      conectados: new Set([chip1.id, chip2.id]),
      enviar: async (numeroId, telefone, texto) => { enviados.push({ numeroId, telefone, texto }) },
      agora: () => meioDia,
      esperar: async () => {}, // sem jitter no teste
    })
    // 3 na fila: Ana, Bruno(agora opt-out), Diego → Bruno cancelado, Ana+Diego enviados
    assert(r.enviados === 2, `esperado 2 enviados (Ana,Diego), veio ${r.enviados}`)
    assert(r.cancelados === 1, `esperado 1 cancelado (Bruno opt-out no envio), veio ${r.cancelados}`)
    // Bruno virou 'cancelado' na fila
    const brunoRow = await prisma.whatsappFila.findFirst({ where: { telefone: '5521970000002' } })
    assert(brunoRow?.status === 'cancelado', `Bruno deveria estar cancelado, veio ${brunoRow?.status}`)
    // texto: sem {nome} literal, sem spintax literal, com o primeiro nome
    const paraAna = enviados.find((e) => e.telefone === '5521970000001')
    assert(!!paraAna, 'Ana não recebeu')
    assert(!paraAna!.texto.includes('{nome}'), `{nome} não foi personalizado: ${paraAna!.texto}`)
    assert(!/\{[^}]*\|/.test(paraAna!.texto), `spintax não expandiu: ${paraAna!.texto}`)
    assert(paraAna!.texto.includes('Ana'), `texto não personalizou o nome: ${paraAna!.texto}`)
    // rotação: os 2 envios usaram chips diferentes (teto 2/chip, mas escolhe maior orçamento)
    const chipsUsados = new Set(enviados.map((e) => e.numeroId))
    assert(chipsUsados.size === 2, `esperava rotação entre 2 chips, usou ${chipsUsados.size}`)
    // contadores subiram
    const c1 = await prisma.whatsappNumero.findUnique({ where: { id: chip1.id } })
    const c2 = await prisma.whatsappNumero.findUnique({ where: { id: chip2.id } })
    assert((c1!.enviadosHoje + c2!.enviadosHoje) === 2, `enviadosHoje somados deveria ser 2, veio ${c1!.enviadosHoje}+${c2!.enviadosHoje}`)
  })

  // ── 6. Drain SMS contra o GATEWAY REAL emulado ───────────────────────────────
  await test('Drain SMS: POST real no gateway com Basic auth + E.164 + texto personalizado; opt-out cancela', async () => {
    recebidosSms.length = 0
    const { drenarFilaSms } = await import('@/lib/smsDrain')
    const r = await drenarFilaSms({ esperar: async () => {} })
    // Bruno(opt-out) cancelado; Ana + Diego enviados de verdade pelo gateway
    assert(r.enviados === 2, `esperado 2 SMS enviados, veio ${r.enviados}`)
    assert(r.cancelados === 1, `esperado 1 SMS cancelado (Bruno), veio ${r.cancelados}`)
    assert(recebidosSms.length === 2, `gateway deveria ter recebido 2 POSTs, recebeu ${recebidosSms.length}`)
    // Basic auth correto foi exigido e passou; E.164 com +55; texto personalizado/spintax
    const paraAna = recebidosSms.find((x) => x.body?.phoneNumbers?.[0] === '+5521970000001')
    assert(!!paraAna, `gateway não recebeu SMS de Ana com E.164; recebidos: ${JSON.stringify(recebidosSms.map((x) => x.body?.phoneNumbers))}`)
    const txt = paraAna!.body.textMessage.text
    assert(!txt.includes('{nome}') && !/\{[^}]*\|/.test(txt) && txt.includes('Ana'), `texto SMS não personalizou/expandiu: ${txt}`)
  })

  // ── 7. Opt-out INBOUND (SAIR/PARAR chegando no WhatsApp) ──────────────────────
  await test('Inbound "PARAR" registra opt-out (interpretarInbound + isPalavraOptOut)', async () => {
    const { interpretarInbound } = await import('@/lib/whatsappDrain')
    const { isPalavraOptOut, registrarOptOut, estaOptOut } = await import('@/lib/optout')
    const { normalizarTelefone } = await import('@/lib/whatsapp')
    // mensagem inbound estilo Baileys
    const msg = { key: { remoteJid: '5521970000004@s.whatsapp.net', fromMe: false }, message: { conversation: ' Parar ' } }
    const { fromMe, texto, telefone } = interpretarInbound(msg, normalizarTelefone)
    assert(!fromMe && telefone === '5521970000004', `interpretação inbound errada: ${telefone}`)
    if (!fromMe && texto && telefone && isPalavraOptOut(texto)) await registrarOptOut(telefone, 'whatsapp', MARK)
    assert(await estaOptOut('5521970000004'), 'Diego deveria estar opt-out após PARAR inbound')
  })

  // ── 8. Detecção de ban tira o chip do pool ───────────────────────────────────
  await test('marcarBanido tira o chip do pool (escolherNumero ignora)', async () => {
    const { marcarBanido, escolherNumero, carregarNumeros, PARAMS_PADRAO } = await import('@/lib/pool')
    await marcarBanido(chip1.id)
    const banido = await prisma.whatsappNumero.findUnique({ where: { id: chip1.id } })
    assert(banido?.status === 'banido', 'chip1 deveria estar banido')
    const numeros = (await carregarNumeros()).filter((n) => n.id === chip1.id)
    const escolhido = escolherNumero(numeros, new Date(2026, 6, 13, 12, 0, 0), PARAMS_PADRAO)
    assert(escolhido === null, 'chip banido não pode ser escolhido')
  })

  // ── resultado ────────────────────────────────────────────────────────────────
  await limpar()
  await new Promise<void>((r) => gateway.close(() => r()))
  await prisma.$disconnect()

  console.log('\n' + '─'.repeat(52))
  if (failed === 0) { console.log(`✅ E2E: todos os ${passed} cenários passaram!\n`) }
  else { console.log(`❌ E2E: ${failed} falha(s) | ✅ ${passed} ok\n`); errors.forEach((e) => console.log('  •', e)); process.exit(1) }
}

main().catch(async (err) => { console.error('\n❌ Erro fatal no E2E:', err); try { await limpar() } catch {}; gateway.close(); await prisma.$disconnect(); process.exit(1) })
