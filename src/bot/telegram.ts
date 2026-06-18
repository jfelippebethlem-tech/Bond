import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'

import TelegramBot from 'node-telegram-bot-api'
import { PrismaClient } from '@prisma/client'

import { resolverTokenPermanente } from '../lib/social/token'
import { syncInstagram, syncFacebook } from '../lib/bond'

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
  '/curtidores — top de quem mais curtiu',
  '/posts — top posts (curtidas/comentários)',
  '/resumo — resumo dos últimos 7 dias',
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
    '🔗 *Conectar Facebook + Instagram (permanente)*',
    '',
    '1. Abra o *Graph API Explorer*: developers.facebook.com/tools/explorer',
    '2. App: *JFN Monitor e Ideia* (🛑 não crie outro — reuse esse)',
    '3. Marque ESTAS permissões ANTES de *Generate Access Token*:',
    '   `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`,',
    '   `business_management`, `instagram_basic`, `instagram_manage_comments`',
    '   (🛑 `business_management` é essencial — sem ela a Página não aparece)',
    '4. Clique *Generate Access Token*. No popup, *SELECIONE a Página* do mandato',
    '   (marque a caixa dela) e o Instagram, e conceda tudo.',
    '',
    '👉 *Copie esse token e cole aqui no chat.* Eu faço o resto:',
    'transformo em *PERMANENTE* (não expira mais), salvo e já sincronizo.',
    '',
    '• *Twitter/X:* developer.twitter.com → me mande o *Bearer Token*.',
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

// Grava/atualiza chaves no .env (persiste o token entre reinícios).
function upsertEnv(updates: Record<string, string>) {
  const envPath = path.join(process.cwd(), '.env')
  let txt = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  for (const [k, v] of Object.entries(updates)) {
    const linha = `${k}="${v}"`
    const re = new RegExp(`^${k}=.*$`, 'm')
    if (re.test(txt)) txt = txt.replace(re, linha)
    else txt += (txt.endsWith('\n') || txt === '' ? '' : '\n') + linha + '\n'
  }
  fs.writeFileSync(envPath, txt)
}

// O dono colou um token do Facebook → resolve p/ PERMANENTE, salva, re-sincroniza e confirma.
async function tratarTokenFacebook(chatId: string, userToken: string) {
  await bot.sendMessage(chatId, '🔄 Recebi o token. Tornando permanente e reconectando…')
  const r = await resolverTokenPermanente(userToken)
  if (!r.ok || !r.pageToken) {
    await bot.sendMessage(chatId, `❌ Não consegui validar o token.\n\nMotivo: ${r.erro}\n\nGere de novo no Graph API Explorer (app "JFN Monitor e Ideia", marque as permissões ANTES de *Generate*) e me reenvie.`, { parse_mode: 'Markdown' })
    return
  }
  // Persiste no .env + ativa no processo atual (sync lê process.env em tempo de chamada).
  const updates: Record<string, string> = { FACEBOOK_PAGE_TOKEN: r.pageToken }
  if (r.pageId) updates.FACEBOOK_PAGE_ID = r.pageId
  if (r.igId) updates.INSTAGRAM_BUSINESS_ID = r.igId
  upsertEnv(updates)
  process.env.FACEBOOK_PAGE_TOKEN = r.pageToken
  if (r.pageId) process.env.FACEBOOK_PAGE_ID = r.pageId
  if (r.igId) process.env.INSTAGRAM_BUSINESS_ID = r.igId

  const permLinha = r.permanente
    ? '🔒 *PERMANENTE* (não expira mais).'
    : '⚠️ Ainda com expiração — verifique se autorizou a permissão antes de gerar.'
  const scopeLinha = r.faltamScopes?.length
    ? `\n⚠️ Faltam permissões: \`${r.faltamScopes.join(', ')}\` (sem elas, contagem de comentários do FB e/ou IG ficam incompletas).`
    : '\n✅ Todas as permissões necessárias presentes.'
  await bot.sendMessage(
    chatId,
    `✅ *Conectado!*\n\n📄 Página: *${r.pageName}*\n📸 Instagram: ${r.igUsername ? `@${r.igUsername}` : '(não vinculado)'}\n${permLinha}${scopeLinha}\n\n🔄 Sincronizando agora…`,
    { parse_mode: 'Markdown' },
  )

  // Re-sincroniza JÁ (o worker tem o token novo no process.env).
  try {
    const ig = await syncInstagram().catch((e) => ({ synced: 0, error: String(e) }))
    const fb = await syncFacebook().catch((e) => ({ synced: 0, error: String(e) }))
    await bot.sendMessage(
      chatId,
      `📊 *Sync concluído.*\nInstagram: ${('synced' in ig ? ig.synced : 0)} posts${('error' in ig && ig.error) ? ` (${ig.error})` : ''}\nFacebook: ${('synced' in fb ? fb.synced : 0)} posts${('error' in fb && fb.error) ? ` (${fb.error})` : ''}\n\nAbra *Interações* — agora ao vivo.`,
      { parse_mode: 'Markdown' },
    )
  } catch (e) {
    await bot.sendMessage(chatId, `Sync deu erro: ${e instanceof Error ? e.message : String(e)}`)
  }
  // Reinicia o app + bond-worker p/ pegarem o .env novo (NÃO o telegram-worker, senão corta a conversa).
  exec('bash -lc "pm2 restart politimonitor bond-worker --update-env"', () => {})
}

// ─────────── Comandos de DADOS (controlar o monitor pelo Telegram) ───────────
async function cmdCurtidores(chatId: string) {
  const top = await prisma.bondFa.findMany({ where: { plataforma: 'instagram', totalLikes: { gt: 0 } }, orderBy: { totalLikes: 'desc' }, take: 15 })
  if (!top.length) { await bot.sendMessage(chatId, '❤️ Ainda não importei curtidores. Rode a captura no desktop (bond-likers.ps1).'); return }
  const linhas = top.map((f, i) => `${i + 1}. *${f.username ?? f.nome}* — ${f.totalLikes}`).join('\n')
  await bot.sendMessage(chatId, `❤️ *Top curtidores*\n\n${linhas}\n\nRanking completo: /curtidores no painel.`, { parse_mode: 'Markdown' })
}
async function cmdPosts(chatId: string) {
  const posts = await prisma.bondPost.findMany({ where: { plataforma: 'instagram' }, orderBy: { likes: 'desc' }, take: 8 })
  if (!posts.length) { await bot.sendMessage(chatId, 'Nenhum post sincronizado ainda.'); return }
  const ini = (t: string) => { const s = (t || '').replace(/\s+/g, ' ').trim(); return s.length > 55 ? s.slice(0, 55) + '…' : (s || '(sem legenda)') }
  const d = (x: Date) => new Date(x).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  const linhas = posts.map((p, i) => `${i + 1}. *${p.likes}❤️ ${p.comentarios}💬* (${d(p.publicadoEm)})\n   _${ini(p.conteudo)}_`).join('\n')
  await bot.sendMessage(chatId, `🏆 *Top posts*\n\n${linhas}`, { parse_mode: 'Markdown' })
}
async function cmdResumo(chatId: string) {
  const desde = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const posts = await prisma.bondPost.findMany({ where: { publicadoEm: { gte: desde } }, orderBy: { likes: 'desc' } })
  const tl = posts.reduce((s, p) => s + (p.likes || 0), 0), tc = posts.reduce((s, p) => s + (p.comentarios || 0), 0)
  const ini = (t: string) => { const s = (t || '').replace(/\s+/g, ' ').trim(); return s.length > 50 ? s.slice(0, 50) + '…' : s }
  const top = posts.slice(0, 5).map((p, i) => `${i + 1}. ${p.likes}❤️ ${p.comentarios}💬 — _${ini(p.conteudo)}_`).join('\n')
  await bot.sendMessage(chatId, `📊 *Resumo (7 dias)*\nPosts: *${posts.length}* · ❤️ *${tl.toLocaleString('pt-BR')}* · 💬 *${tc.toLocaleString('pt-BR')}*\n\n🏆 Top:\n${top || '(sem posts novos)'}`, { parse_mode: 'Markdown' })
}

// ─── Canal de comando p/ o DESKTOP (Hermes) via pasta sincronizada (Syncthing) ───
const CMD_FILE = '/home/ubuntu/likers-sync/comando.json'
function escreverComando(obj: Record<string, unknown>) {
  try { fs.mkdirSync(path.dirname(CMD_FILE), { recursive: true }); fs.writeFileSync(CMD_FILE, JSON.stringify({ ...obj, ts: Date.now() })) } catch (e) { console.error('cmd write:', e) }
}
function lerComando(): Record<string, unknown> { try { return JSON.parse(fs.readFileSync(CMD_FILE, 'utf8')) } catch { return {} } }

// Menu de botões "vivos" (tappáveis) no Telegram.
const MENU_KB = {
  inline_keyboard: [
    [{ text: '📝 Demandas', callback_data: 'demandas' }, { text: '💬 Interações', callback_data: 'interacoes' }],
    [{ text: '🏆 Posts', callback_data: 'posts' }, { text: '📊 Resumo 7d', callback_data: 'resumo' }],
    [{ text: '📡 Status', callback_data: 'status' }, { text: '🔗 Conectar redes', callback_data: 'redes' }],
    [{ text: '⚙️ Mais funções', callback_data: 'mais' }, { text: '📖 Ajuda', callback_data: 'ajuda' }],
  ],
}
// Submenu vivo: ver e CONTROLAR o PolitiMonitor pelo chat.
const MENU_MAIS_KB = {
  inline_keyboard: [
    [{ text: '🔄 Sincronizar agora', callback_data: 'sync' }, { text: '❤️ Curtidores', callback_data: 'curtidores' }],
    [{ text: '🕷️ Capturar (desktop)', callback_data: 'capturar' }, { text: '🔑 Login IG', callback_data: 'login' }],
    [{ text: '🧠 Análise de conteúdo', callback_data: 'analise' }, { text: '📈 Painel (números)', callback_data: 'painel' }],
    [{ text: '🔓 Acesso', callback_data: 'acesso' }, { text: '◂ Voltar', callback_data: 'voltar' }],
  ],
}
async function enviarMenu(chatId: string) {
  await bot.sendMessage(chatId, '🎛️ *Menu do Bond* — toque numa opção:', { parse_mode: 'Markdown', reply_markup: MENU_KB })
}
async function enviarMais(chatId: string) {
  await bot.sendMessage(chatId, '⚙️ *Mais funções* — ver e controlar o PolitiMonitor:', { parse_mode: 'Markdown', reply_markup: MENU_MAIS_KB })
}
// TOP 20 por INTERAÇÕES (curtidas do coletor + comentários), igual ao /interacoes do painel.
async function cmdInteracoes(chatId: string) {
  const [fas, coms, perfis] = await Promise.all([
    prisma.bondFa.findMany({ where: { plataforma: 'instagram', totalLikes: { gt: 0 } }, select: { username: true, nome: true, totalLikes: true } }),
    prisma.bondComentario.groupBy({ by: ['autor'], where: { plataforma: 'instagram', autor: { not: null } }, _count: { _all: true } }),
    prisma.bondPerfil.findMany({ select: { handle: true } }),
  ])
  const dono = new Set(perfis.map((p) => (p.handle || '').toLowerCase()).filter(Boolean))
  const byP = new Map<string, { pessoa: string; like: number; comment: number }>()
  for (const f of fas) { const n = (f.nome || f.username || '').trim(); if (!n || dono.has(n.toLowerCase())) continue; const e = byP.get(n) || { pessoa: n, like: 0, comment: 0 }; e.like += f.totalLikes; byP.set(n, e) }
  for (const c of coms) { const n = (c.autor || '').trim(); if (!n || dono.has(n.toLowerCase())) continue; const e = byP.get(n) || { pessoa: n, like: 0, comment: 0 }; e.comment += c._count._all; byP.set(n, e) }
  const top = Array.from(byP.values()).map((e) => ({ ...e, total: e.like + e.comment })).sort((a, b) => b.total - a.total).slice(0, 20)
  if (!top.length) { await bot.sendMessage(chatId, '💬 Sem interações ainda. Sincronize/capture primeiro.'); return }
  const linhas = top.map((e, i) => `${i + 1}. ${e.pessoa} — ${e.total} (❤️ ${e.like} · 💬 ${e.comment})`).join('\n')
  await bot.sendMessage(chatId, `💬 Top 20 — quem mais interage\n\n${linhas}\n\nDetalhe e filtros: /interacoes no painel.`)  // texto puro (usernames têm _/. que quebram Markdown)
}
async function cmdSync(chatId: string) {
  await bot.sendMessage(chatId, '🔄 Sincronizando redes… (alguns segundos)')
  const [ig, fb] = await Promise.all([
    syncInstagram().catch((e) => ({ error: String(e instanceof Error ? e.message : e) })),
    syncFacebook().catch((e) => ({ error: String(e instanceof Error ? e.message : e) })),
  ])
  const n = (x: unknown) => (x && typeof x === 'object' && 'synced' in x ? (x as { synced: number }).synced : 0)
  await bot.sendMessage(chatId, `✅ Sync concluído.\nInstagram: ${n(ig)} posts\nFacebook: ${n(fb)} posts${(fb as { error?: string }).error ? ` (${(fb as { error?: string }).error})` : ''}`)
}
async function cmdPainel(chatId: string) {
  const [fas, posts, coms, dem] = await Promise.all([
    prisma.bondFa.count({ where: { plataforma: 'instagram' } }),
    prisma.bondPost.count(),
    prisma.bondComentario.count(),
    prisma.demanda.count().catch(() => 0),
  ])
  await bot.sendMessage(chatId, `📈 Painel PolitiMonitor\n\n👥 Pessoas (IG): ${fas}\n🏆 Posts: ${posts}\n💬 Comentários: ${coms}\n📝 Demandas: ${dem}\n\nAbra http://159.112.188.8:3000 pro painel completo.`)
}

// ── DEMANDAS (tarefas do gabinete) ──
// Faixa de prazo por IDADE da demanda aberta: 🟢 ≤1 dia · 🟡 >1 dia · 🔴 >1 semana · ✅ resolvida.
function faixaDemanda(criadoEm: Date, status: string, nowMs: number): { cor: string; dias: number } {
  if (status === 'resolvida') return { cor: '✅', dias: 0 }
  const dias = Math.floor((nowMs - new Date(criadoEm).getTime()) / 86400000)
  if (dias > 7) return { cor: '🔴', dias }
  if (dias >= 1) return { cor: '🟡', dias }
  return { cor: '🟢', dias }
}
async function cmdNovaDemanda(chatId: string, texto: string) {
  const t = texto.trim()
  if (!t) { await bot.sendMessage(chatId, 'Use assim: /demanda Trocar lâmpada da praça X — pedido do morador Y'); return }
  const [titulo, ...resto] = t.split('\n')
  const d = await prisma.demanda.create({
    data: { titulo: titulo.slice(0, 160), descricao: resto.join('\n').trim() || titulo, origem: 'telegram', status: 'aberta', prioridade: 'media' },
  })
  await bot.sendMessage(chatId, `📝 Demanda criada: ${d.titulo}\n\nAcompanhe e adicione passos/responsáveis no painel: http://159.112.188.8:3000/demandas`, {
    reply_markup: { inline_keyboard: [[{ text: '✅ Resolver', callback_data: `resolver:${d.id}` }, { text: '📋 Ver demandas', callback_data: 'demandas' }]] },
  })
}
async function cmdDemandas(chatId: string) {
  const nowMs = Date.now()
  const abertas = await prisma.demanda.findMany({ where: { status: { not: 'resolvida' } }, orderBy: { criadoEm: 'asc' }, take: 20, include: { passos: true } })
  if (!abertas.length) { await bot.sendMessage(chatId, '📝 Nenhuma demanda aberta. Crie com: /demanda <texto>'); return }
  const linhas = abertas.map((d) => {
    const f = faixaDemanda(d.criadoEm, d.status, nowMs)
    const feitos = d.passos.filter((p) => p.feito).length
    const passos = d.passos.length ? ` · ${feitos}/${d.passos.length} passos` : ''
    const resp = d.responsavel ? ` · 👤 ${d.responsavel}` : ''
    return `${f.cor} ${d.titulo} (${f.dias}d${resp}${passos})`
  }).join('\n')
  const vermelhas = abertas.filter((d) => faixaDemanda(d.criadoEm, d.status, nowMs).cor === '🔴').length
  const alerta = vermelhas ? `\n\n⚠️ ${vermelhas} vencida(s) há +1 semana — alerto todo dia até resolver.` : ''
  // botões "resolver" das 5 mais antigas (as mais urgentes)
  const kb: { text: string; callback_data?: string; url?: string }[][] = abertas.slice(0, 5).map((d) => [{ text: `✅ Resolver: ${d.titulo.slice(0, 30)}`, callback_data: `resolver:${d.id}` }])
  kb.push([{ text: '🖥️ Abrir painel colaborativo', url: 'http://159.112.188.8:3000/demandas' }])
  await bot.sendMessage(chatId, `📝 Demandas abertas (${abertas.length})\n🟢 ≤1 dia · 🟡 >1 dia · 🔴 >1 semana\n\n${linhas}${alerta}`, { reply_markup: { inline_keyboard: kb } })
}
async function resolverDemanda(chatId: string, id: string) {
  try {
    const d = await prisma.demanda.update({ where: { id }, data: { status: 'resolvida', resolvidoEm: new Date() } })
    await bot.sendMessage(chatId, `✅ Resolvida: ${d.titulo}`)
  } catch { await bot.sendMessage(chatId, 'Não encontrei essa demanda (talvez já resolvida).') }
}
// Cliques nos botões do menu
bot.on('callback_query', async (q) => {
  const chatId = String(q.message?.chat.id ?? '')
  try { await bot.answerCallbackQuery(q.id) } catch {}
  if (OWNER_ID === '' || String(q.from.id) !== OWNER_ID) return
  try {
    const d = q.data
    if (d && d.startsWith('resolver:')) await resolverDemanda(chatId, d.slice('resolver:'.length))
    else if (d === 'demandas') await cmdDemandas(chatId)
    else if (d === 'curtidores') await cmdCurtidores(chatId)
    else if (d === 'interacoes') await cmdInteracoes(chatId)
    else if (d === 'mais') await enviarMais(chatId)
    else if (d === 'voltar') await enviarMenu(chatId)
    else if (d === 'sync') await cmdSync(chatId)
    else if (d === 'painel') await cmdPainel(chatId)
    else if (d === 'capturar') { escreverComando({ acao: 'capturar', feito: false }); await bot.sendMessage(chatId, '📡 Captura pedida ao desktop (o Hermes pega em ~15s).') }
    else if (d === 'login') { escreverComando({ acao: 'login_instagram', feito: false }); await bot.sendMessage(chatId, '🔑 Login no IG pedido. Mande o código do authenticator com /codigo 123456 — ele já loga e usa o código de uma vez.') }
    else if (d === 'analise') await bot.sendMessage(chatId, '🧠 Análise por IA: abra /analise no painel. Para avaliar UM vídeo/carrossel, use o botão "Analisar" em /posts.')
    else if (d === 'posts') await cmdPosts(chatId)
    else if (d === 'resumo') await cmdResumo(chatId)
    else if (d === 'status') await statusAoVivo(chatId)
    else if (d && TXT['/' + d]) await bot.sendMessage(chatId, TXT['/' + d], { parse_mode: 'Markdown', disable_web_page_preview: true })
  } catch (err) { console.error('Erro no menu:', err) }
})

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

  // ── O dono colou um token do Facebook (mesmo dentro de uma URL de redirect) → resolve permanente ──
  if (isOwner(msg)) {
    // Extrai o token de qualquer lugar: texto puro OU URL tipo ...#access_token=EAA...&...
    const m = text.replace(/\s+/g, '').match(/EA[A-Za-z0-9_-]{60,}/)
    if (m) {
      try {
        await tratarTokenFacebook(chatId, m[0])
      } catch (err) {
        console.error('Erro ao tratar token:', err)
        await bot.sendMessage(chatId, 'Erro ao processar o token. Veja os logs.')
      }
      return
    }
  }

  // ── Comandos de admin (só o dono): ensinam/operam o app ──
  if (text.startsWith('/') && isOwner(msg)) {
    const cmd = text.split(/\s+/)[0].toLowerCase()
    try {
      if (cmd === '/menu' || cmd === '/start') { await enviarMenu(chatId); return }
      if (cmd === '/status') { await statusAoVivo(chatId); return }
      if (cmd === '/curtidores') { await cmdCurtidores(chatId); return }
      if (cmd === '/interacoes') { await cmdInteracoes(chatId); return }
      if (cmd === '/posts') { await cmdPosts(chatId); return }
      if (cmd === '/resumo') { await cmdResumo(chatId); return }
      if (cmd === '/sync') { await cmdSync(chatId); return }
      // ── Demandas ──
      if (cmd === '/demanda') { await cmdNovaDemanda(chatId, text.slice(text.indexOf(' ') + 1) === text ? '' : text.slice(text.indexOf(' ') + 1)); return }
      if (cmd === '/demandas') { await cmdDemandas(chatId); return }
      if (cmd === '/resolver') { const id = (text.split(/\s+/)[1] || '').trim(); if (!id) { await bot.sendMessage(chatId, 'Use /demandas e toque em "Resolver", ou /resolver <id>'); } else { await resolverDemanda(chatId, id); } return }
      // ── Controle do DESKTOP (Hermes) ──
      if (cmd === '/capturar') { escreverComando({ acao: 'capturar', feito: false }); await bot.sendMessage(chatId, '📡 Comando enviado ao desktop: *capturar curtidores*. O Hermes pega em até 15s e roda.', { parse_mode: 'Markdown' }); return }
      if (cmd === '/login') { escreverComando({ acao: 'login_instagram', feito: false }); await bot.sendMessage(chatId, '🔑 Pedido de *login no Instagram* enviado ao desktop.\n\nQuando ele chegar na tela do código (2FA), eu te aviso — aí você manda rápido:\n`/codigo 123456`', { parse_mode: 'Markdown' }); return }
      if (cmd === '/codigo') {
        const code = (text.split(/\s+/)[1] || '').replace(/\D/g, '')
        if (!code) { await bot.sendMessage(chatId, 'Use assim: /codigo 123456 (o código do Google Authenticator)'); return }
        // LOGIN + CÓDIGO JUNTOS: o código do authenticator expira em ~30s, então /codigo já dispara o
        // login E entrega o código de uma vez — não precisa /login antes. O desktop loga com esse código.
        escreverComando({ acao: 'login_instagram', codigo_2fa: code, feito: false })
        await bot.sendMessage(chatId, `🔐 Login + código ${code} enviados juntos ao desktop. Ele já está tentando logar com esse código — é rápido!`); return
      }
      const reply = TXT[cmd] ?? 'Comando não reconhecido. Use /ajuda para ver a lista.'
      await bot.sendMessage(chatId, reply, { parse_mode: 'Markdown', disable_web_page_preview: true })
    } catch (err) {
      console.error('Erro no comando admin:', err)
    }
    return
  }

  // Mensagens do próprio dono que NÃO são comando: registra (p/ o assistente VER as respostas
  // do dono — antes eram descartadas em silêncio) e NÃO viram "contato do gabinete".
  if (isOwner(msg)) {
    try {
      const dir = path.join(process.cwd(), 'data')
      fs.mkdirSync(dir, { recursive: true })
      fs.appendFileSync(path.join(dir, 'owner_messages.jsonl'), JSON.stringify({ at: new Date().toISOString(), text }) + '\n')
    } catch { /* sem persistência não é fatal */ }
    console.log(`[DONO] ${text}`)
    return
  }

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
        { command: 'menu', description: '🎛️ Menu com botões' },
        { command: 'acesso', description: 'Como entrar no painel' },
        { command: 'painel', description: 'O que tem em cada tela' },
        { command: 'whatsapp', description: 'Conectar o WhatsApp (QR)' },
        { command: 'redes', description: 'Conectar Twitter/Facebook/Instagram' },
        { command: 'senha', description: 'Trocar a senha de admin' },
        { command: 'status', description: 'O app está no ar? (ao vivo)' },
        { command: 'interacoes', description: '💬 Top 20 — quem mais interage' },
        { command: 'curtidores', description: 'Top de quem mais curtiu' },
        { command: 'posts', description: 'Top posts' },
        { command: 'resumo', description: 'Resumo dos últimos 7 dias' },
        { command: 'sync', description: '🔄 Sincronizar redes agora' },
        { command: 'capturar', description: '🕷️ Capturar curtidores (desktop)' },
        { command: 'login', description: '🔑 Relogar no Instagram (desktop)' },
        { command: 'codigo', description: '🔐 Logar + código 2FA juntos' },
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

// Relay rápido: vigia a resposta do desktop (Hermes) e repassa ao dono no Telegram.
// Importante p/ o 2FA: avisa na hora que o desktop chegou na tela do código.
const RESP_FILE = '/home/ubuntu/likers-sync/resposta.json'
let ultimaResp = ''
function watchResposta() {
  if (!OWNER_ID) return
  try {
    const raw = fs.readFileSync(RESP_FILE, 'utf8')
    if (raw === ultimaResp) return
    ultimaResp = raw
    const r = JSON.parse(raw)
    const txt = r.aguardando_2fa
      ? '🔑 O desktop chegou na tela do *código (2FA)*. Mande AGORA um código fresco do autenticador:\n`/codigo 123456`'
      : `🖥️ *Desktop:* ${r.ok === false ? '⚠️ ' : '✅ '}${r.msg ?? JSON.stringify(r)}`
    void bot.sendMessage(Number(OWNER_ID), txt, { parse_mode: 'Markdown' }).catch(() => {})
  } catch { /* sem arquivo ainda */ }
}
setInterval(watchResposta, 5000)

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

// Alerta diário: demandas abertas há +1 semana (faixa vermelha) batem 1x por dia até resolver.
async function alertarDemandasVencidas() {
  if (!OWNER_ID) return
  try {
    const nowMs = Date.now()
    const limite = new Date(nowMs - 7 * 86400_000) // criadas há mais de 7 dias
    const hoje = new Date(nowMs - 20 * 3600_000)   // alertou nas últimas ~20h? então pula (1x/dia)
    const vencidas = await prisma.demanda.findMany({
      where: { status: { not: 'resolvida' }, criadoEm: { lt: limite }, OR: [{ alertadoEm: null }, { alertadoEm: { lt: hoje } }] },
      orderBy: { criadoEm: 'asc' },
    })
    if (!vencidas.length) return
    const linhas = vencidas.map((d) => {
      const dias = Math.floor((nowMs - new Date(d.criadoEm).getTime()) / 86400000)
      return `🔴 ${d.titulo} — ${dias} dias aberta${d.responsavel ? ` · 👤 ${d.responsavel}` : ''}`
    }).join('\n')
    await bot.sendMessage(Number(OWNER_ID), `🚨 Demandas vencidas (+1 semana sem resolver):\n\n${linhas}\n\nResolva ou delegue: /demandas`)
    await prisma.demanda.updateMany({ where: { id: { in: vencidas.map((d) => d.id) } }, data: { alertadoEm: new Date() } })
    console.log(`[demandas] alerta diário enviado: ${vencidas.length} vencida(s).`)
  } catch (e) {
    console.error('[demandas] erro no alerta diário:', e)
  }
}
setInterval(alertarDemandasVencidas, 3 * 3600_000) // checa a cada 3h (dispara no máx 1x/dia por demanda)
setTimeout(() => void alertarDemandasVencidas(), 90_000) // 1 check ~1,5min após subir
