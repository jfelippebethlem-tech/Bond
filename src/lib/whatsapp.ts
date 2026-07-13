/**
 * WhatsApp GRATUITO via Baileys (WhatsApp Web, sem custo de API).
 * Este módulo só lida com a FILA (enfileirar/consultar). O envio real é feito
 * pelo processo `whatsapp-worker.ts`, que mantém a conexão Baileys.
 *
 * Arquitetura desacoplada: app web e workers apenas escrevem na tabela
 * WhatsappFila; o worker drena a fila e envia. Status da conexão fica em
 * Configuracao (chave: "whatsapp_status" e "whatsapp_qr").
 */
import { prisma } from './db'
import { estaOptOut } from './optout'

const INVISIVEL = '​' // zero-width space — varia o conteúdo sem alterar o texto visível

// Normaliza telefone brasileiro para o formato do WhatsApp (DDI 55 + DDD + número)
export function normalizarTelefone(tel?: string | null): string | null {
  if (!tel) return null
  let n = tel.replace(/\D/g, '')
  if (n.length < 10) return null
  // Remove zeros à esquerda
  n = n.replace(/^0+/, '')
  // Adiciona DDI 55 se não tiver
  if (!n.startsWith('55')) n = '55' + n
  // Esperado: 55 (2) + DDD (2) + número (8 ou 9) => 12 ou 13 dígitos
  if (n.length < 12 || n.length > 13) return null
  return n
}

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

/**
 * Expande spintax `{a|b|c}` escolhendo UMA variante por seed — variação de texto VISÍVEL
 * (anti-ban muito mais forte que caractere invisível). Grupos sem `|` (ex.: `{nome}`) não são tocados.
 * Ex.: expandirSpintax('{Oi|Olá} {nome}', 1) → 'Olá {nome}'.
 */
export function expandirSpintax(texto: string, seed: number): string {
  return texto.replace(/\{([^{}]*\|[^{}]*)\}/g, (_m, grupo: string) => {
    const opcoes = grupo.split('|')
    return opcoes[(((seed % opcoes.length) + opcoes.length) % opcoes.length)]
  })
}

export type TipoMensagem = 'notificacao' | 'cobranca' | 'nps' | 'conquista' | 'broadcast' | 'alerta'

// Enfileira uma mensagem para um telefone
export async function enfileirarWhatsapp(opts: {
  telefone: string
  mensagem: string
  tipo?: TipoMensagem
  pessoaId?: string
  referencia?: string
  agendadoPara?: Date
}) {
  const tel = normalizarTelefone(opts.telefone)
  if (!tel) return { ok: false, motivo: 'telefone inválido' }
  if (await estaOptOut(tel)) return { ok: false, motivo: 'opt-out' }
  await prisma.whatsappFila.create({
    data: {
      telefone: tel,
      mensagem: opts.mensagem,
      tipo: opts.tipo ?? 'notificacao',
      pessoaId: opts.pessoaId,
      referencia: opts.referencia,
      agendadoPara: opts.agendadoPara,
    },
  })
  return { ok: true, telefone: tel }
}

// Envia em massa para todos os apoiadores com telefone (broadcast)
export async function enfileirarBroadcast(
  mensagem: string,
  tipo: TipoMensagem = 'broadcast',
  referencia?: string,
  campanhaId?: string,
  audiencia: string[] = ['apoiador', 'coordenador'],
) {
  const apoiadores = await prisma.pessoa.findMany({
    where: { tipo: { in: audiencia }, ativo: true, telefone: { not: null } },
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

// Status da conexão (lido da Configuracao, escrito pelo worker)
export async function statusWhatsapp(): Promise<{ status: string; qr: string | null; atualizadoEm: string | null }> {
  const [st, qr, at] = await Promise.all([
    prisma.configuracao.findUnique({ where: { chave: 'whatsapp_status' } }),
    prisma.configuracao.findUnique({ where: { chave: 'whatsapp_qr' } }),
    prisma.configuracao.findUnique({ where: { chave: 'whatsapp_status_em' } }),
  ])
  return {
    status: st?.valor ?? 'desconectado', // "desconectado"|"aguardando_qr"|"conectado"
    qr: qr?.valor || null,
    atualizadoEm: at?.valor ?? null,
  }
}

// Helper usado pelo worker para salvar status/QR
export async function setConfig(chave: string, valor: string) {
  await prisma.configuracao.upsert({
    where: { chave },
    update: { valor },
    create: { chave, valor },
  })
}

// Estatísticas da fila
export async function estatisticasFila() {
  const [pendente, enviado, erro] = await Promise.all([
    prisma.whatsappFila.count({ where: { status: 'pendente' } }),
    prisma.whatsappFila.count({ where: { status: 'enviado' } }),
    prisma.whatsappFila.count({ where: { status: 'erro' } }),
  ])
  return { pendente, enviado, erro }
}
