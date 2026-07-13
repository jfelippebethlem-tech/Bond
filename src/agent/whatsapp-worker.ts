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
import { setConfig, personalizar, microVariacao, expandirSpintax, normalizarTelefone } from '../lib/whatsapp'
import { escolherNumero, carregarNumeros, carregarParametros, registrarEnvio, marcarBanido } from '../lib/pool'
import { isPalavraOptOut, registrarOptOut, estaOptOut } from '../lib/optout'
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
    try {
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
    } catch (e) { console.error('[WhatsApp] erro connection.update:', e) }
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

let drenando = false

async function drenarFila() {
  if (drenando) return
  drenando = true
  try {
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
      if (await estaOptOut(msg.telefone)) {
        await prisma.whatsappFila.update({ where: { id: msg.id }, data: { status: 'cancelado' } })
        continue
      }

      const pessoa = msg.pessoaId ? await prisma.pessoa.findUnique({ where: { id: msg.pessoaId }, select: { nome: true } }) : null
      const seed = Math.floor(Math.random() * 6)
      const texto = microVariacao(expandirSpintax(personalizar(msg.mensagem, pessoa?.nome), seed), seed)
      const jid = `${msg.telefone}@s.whatsapp.net`
      try {
        await sock.sendMessage(jid, { text: texto })
        await prisma.whatsappFila.update({ where: { id: msg.id }, data: { status: 'enviado', enviadoEm: new Date(), numeroId: escolhido.id, erro: null } })
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
  } finally {
    drenando = false
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
