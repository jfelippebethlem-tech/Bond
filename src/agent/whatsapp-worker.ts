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
import { setConfig, normalizarTelefone } from '../lib/whatsapp'
import { marcarBanido } from '../lib/pool'
import { isPalavraOptOut, registrarOptOut } from '../lib/optout'
import { drenarFilaWhatsapp, interpretarInbound } from '../lib/whatsappDrain'
import qrcode from 'qrcode'
import path from 'path'

const INTERVALO_FILA = 15_000

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
        const { fromMe, texto, telefone } = interpretarInbound(msg, normalizarTelefone)
        if (fromMe || !texto || !telefone || !isPalavraOptOut(texto)) continue
        await registrarOptOut(telefone, 'whatsapp', 'SAIR via whatsapp')
        await sock.sendMessage(msg.key.remoteJid, { text: 'Pronto, você não receberá mais mensagens. 👋' })
        console.log(`[WhatsApp] opt-out registrado: ${telefone}`)
      }
    } catch (e) { console.error('[WhatsApp] erro opt-out inbound:', e) }
  })
}

let drenando = false

async function drenarFila() {
  if (drenando) return
  drenando = true
  try {
    if (conectados.size === 0) return
    await drenarFilaWhatsapp({
      conectados,
      enviar: async (numeroId, telefone, texto) => {
        const sock = socks.get(numeroId)
        if (!sock) throw new Error('socket indisponível')
        await sock.sendMessage(`${telefone}@s.whatsapp.net`, { text: texto })
        console.log(`[WhatsApp] ✓ ${telefone} via ${numeroId}`)
      },
    })
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
