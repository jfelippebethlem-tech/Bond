import fs from 'fs'
import path from 'path'

import TelegramBot from 'node-telegram-bot-api'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const token = process.env.TELEGRAM_BOT_TOKEN
const OWNER_ID = (process.env.TELEGRAM_OWNER_ID ?? '').trim()
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://jfn-core:3000'

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN não configurado no .env')
  process.exit(1)
}

const bot = new TelegramBot(token, { polling: true })
console.log('Bot do Telegram iniciado...')

// ─────────────────────────── Comandos de ADMIN (ensinam a usar o app) ───────────────────────────
const HELP = [
  '🏛️ *PolitiMonitor — assistente do gabinete*',
  '',
  'Comandos para operar o painel:',
  '/acesso — como entrar no painel',
  '/painel — o que tem em cada tela',
  '/whatsapp — conectar o WhatsApp (QR)',
  '/redes — conectar Twitter / Facebook / Instagram',
  '/senha — trocar a senha de admin',
  '/status — o app está no ar? (dados ao vivo)',
  '/ajuda — esta lista',
].join('\n')

const TXT: Record<string, string> = {
  '/start': HELP,
  '/ajuda': HELP,
  '/help': HELP,
  '/acesso': [
    '🔓 *Como acessar o painel*',
    '',
    `Endereço: ${APP_URL}`,
    '',
    '• *Tailscale (seguro):* ligue o Tailscale no aparelho e abra `http://jfn-core:3000`',
    '• *Público (se a porta estiver liberada na Oracle):* `http://159.112.188.8:3000`',
    '',
    'Login: sua senha de admin (troque a temporária — veja /senha).',
  ].join('\n'),
  '/painel': [
    '🗂️ *O que tem no painel*',
    '',
    '• *Pessoas* — base de apoiadores/contatos (o CRM do gabinete)',
    '• *Demandas* — pedidos da população, com status de andamento',
    '• *Produtividade* — métricas do mandato',
    '• *Telegram* — mensagens que chegam neste bot',
    '• *WhatsApp* — conversas (depois de conectar o QR)',
    '• *NPS* — satisfação / pesquisas',
    '',
    'A IA *Hermes* analisa e ajuda a responder; o *Bond* cuida das redes sociais.',
  ].join('\n'),
  '/whatsapp': [
    '📱 *Conectar o WhatsApp*',
    '',
    '1. Entre no painel e vá em *WhatsApp*',
    '2. Vai aparecer um *QR Code*',
    '3. No celular: WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho → escaneie',
    '4. Pronto — a sessão fica salva e o gabinete passa a receber as conversas.',
  ].join('\n'),
  '/redes': [
    '🔗 *Conectar redes sociais (Bond)*',
    '',
    '• *Twitter/X:* developer.twitter.com → gere o *Bearer Token*',
    '• *Facebook + Instagram:* developers.facebook.com',
    '   🛑 REUSE *um* app (não crie vários — gera duplicados!)',
    '   No Graph API Explorer: marque as permissões `instagram_basic`, `instagram_manage_comments`, `pages_read_engagement`, `pages_show_list` ANTES de *Gerar* (senão sai só `public_profile`)',
    '   Depois pegue o token da *Página* em `me/accounts`',
    '',
    'Me mande o token (em *texto*) aqui que eu ligo e valido na hora.',
  ].join('\n'),
  '/senha': [
    '🔑 *Trocar a senha de admin*',
    '',
    'Hoje há uma senha temporária. Para trocar: me diga a nova senha aqui que eu atualizo e reinicio o painel.',
    '(Ou edite `ADMIN_PASSWORD` no `.env` da VM e rode `pm2 restart politimonitor`.)',
  ].join('\n'),
}

async function statusAoVivo(chatId: string) {
  let appUp = false
  try {
    const r = await fetch('http://127.0.0.1:3000/login', { signal: AbortSignal.timeout(5000) })
    appUp = r.status === 200
  } catch {
    /* app fora do ar */
  }
  const [pessoas, msgs, demandas] = await Promise.all([
    prisma.pessoa.count().catch(() => 0),
    prisma.telegramMensagem.count().catch(() => 0),
    prisma.demanda.count().catch(() => 0),
  ])
  await bot.sendMessage(
    chatId,
    [
      '📊 *Status ao vivo*',
      '',
      `App: ${appUp ? '✅ no ar' : '⚠️ fora do ar'}`,
      `Apoiadores cadastrados: *${pessoas}*`,
      `Mensagens no Telegram: *${msgs}*`,
      `Demandas: *${demandas}*`,
      '',
      `Painel: ${APP_URL}`,
    ].join('\n'),
    { parse_mode: 'Markdown', disable_web_page_preview: true },
  )
}

const isOwner = (msg: TelegramBot.Message) =>
  OWNER_ID !== '' && String(msg.from?.id ?? '') === OWNER_ID

bot.on('message', async (msg) => {
  const chatId = String(msg.chat.id)

  // Foto do dono → baixa p/ o assistente poder analisar (salva em data/telegram_fotos/)
  if (msg.photo && isOwner(msg)) {
    try {
      const ph = msg.photo[msg.photo.length - 1] // maior resolução
      const dir = path.join(process.cwd(), 'data', 'telegram_fotos')
      fs.mkdirSync(dir, { recursive: true })
      const fpath = await bot.downloadFile(ph.file_id, dir)
      console.log(`[FOTO do dono] ${fpath} | legenda: ${msg.caption ?? '(sem)'}`)
      await bot.sendMessage(chatId, '📷 Foto recebida — vou analisar.')
    } catch (err) {
      console.error('Erro ao baixar foto:', err)
    }
    return
  }

  if (!msg.text) return
  const text = msg.text.trim()

  // ── Comandos de admin (só o dono): ensinam/operam o app ──
  if (text.startsWith('/') && isOwner(msg)) {
    const cmd = text.split(/\s+/)[0].toLowerCase()
    try {
      if (cmd === '/status') {
        await statusAoVivo(chatId)
        return
      }
      const reply = TXT[cmd] ?? 'Comando não reconhecido. Use /ajuda para ver a lista.'
      await bot.sendMessage(chatId, reply, { parse_mode: 'Markdown', disable_web_page_preview: true })
    } catch (err) {
      console.error('Erro no comando admin:', err)
    }
    return
  }

  // Mensagens do próprio dono que NÃO são comando: não viram "contato do gabinete"
  if (isOwner(msg)) return

  // ── Mensagem de cidadão → entra na caixa do gabinete ──
  const userId = msg.from?.id ? String(msg.from.id) : null
  const username = msg.from?.username ?? null
  const nome = msg.from
    ? [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ')
    : null
  try {
    await prisma.telegramMensagem.create({
      data: { chatId, userId, username, nome, mensagem: msg.text },
    })
    await bot.sendMessage(
      chatId,
      '✅ Sua mensagem foi recebida pelo gabinete!\n\nRespondemos em breve. Obrigado pelo contato.',
    )
    console.log(`[${new Date().toISOString()}] Mensagem de ${nome ?? username ?? chatId}: ${msg.text}`)
  } catch (err) {
    console.error('Erro ao salvar mensagem:', err)
    await bot.sendMessage(chatId, 'Ocorreu um erro. Por favor, tente novamente mais tarde.')
  }
})

bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message ?? err)
})

// Registra os comandos no menu "/" do Telegram (escopo: o chat do dono)
async function registrarComandos() {
  if (!OWNER_ID) return
  try {
    await bot.setMyCommands(
      [
        { command: 'acesso', description: 'Como entrar no painel' },
        { command: 'painel', description: 'O que tem em cada tela' },
        { command: 'whatsapp', description: 'Conectar o WhatsApp (QR)' },
        { command: 'redes', description: 'Conectar Twitter/Facebook/Instagram' },
        { command: 'senha', description: 'Trocar a senha de admin' },
        { command: 'status', description: 'O app está no ar? (ao vivo)' },
        { command: 'ajuda', description: 'Lista de comandos' },
      ],
      { scope: { type: 'chat', chat_id: Number(OWNER_ID) } },
    )
    console.log('Comandos do Telegram registrados (escopo dono).')
  } catch (err) {
    console.error('Erro ao registrar comandos:', err)
  }
}
void registrarComandos()

// Alerta proativo: avisa o dono quando o token do Facebook/IG expira (monitor para de receber dados).
let ultimoAvisoToken = 0
async function verificarToken() {
  if (!OWNER_ID || !process.env.FACEBOOK_PAGE_TOKEN) return
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/me?fields=name&access_token=${process.env.FACEBOOK_PAGE_TOKEN}`)
    if (r.ok) return // token válido — nada a fazer
    const agora = Date.now()
    if (agora - ultimoAvisoToken < 12 * 3600_000) return // no máx 1 aviso a cada 12h
    ultimoAvisoToken = agora
    await bot.sendMessage(
      Number(OWNER_ID),
      '⚠️ *Token do Facebook/Instagram expirou.*\n\nO monitor (Interações/Análise) parou de receber dados novos. Gere um token novo no Graph API Explorer (app "JFN Monitor e Ideia", Generate + autorizar) e me mande — eu reconecto e deixo permanente.',
      { parse_mode: 'Markdown' },
    )
    console.log('[token] alerta de expiração enviado ao dono.')
  } catch {
    /* rede — ignora */
  }
}
setInterval(verificarToken, 6 * 3600_000) // a cada 6h
setTimeout(() => void verificarToken(), 60_000) // 1 check 1min após subir
