/**
 * Núcleo TESTÁVEL do drain de WhatsApp — separado do worker para poder ser
 * exercitado com um "enviador" injetado (sem Baileys/celular real).
 * O worker (src/agent/whatsapp-worker.ts) chama isto passando o envio real via socket.
 */
import { prisma } from './db'
import { personalizar, microVariacao, expandirSpintax } from './whatsapp'
import { escolherNumero, carregarNumeros, carregarParametros, registrarEnvio } from './pool'
import { estaOptOut } from './optout'

const MAX_TENTATIVAS = 3

export type EnviarWhatsapp = (numeroId: string, telefone: string, texto: string) => Promise<void>

export async function drenarFilaWhatsapp(deps: {
  conectados: Set<string>
  enviar: EnviarWhatsapp
  agora?: () => Date
  esperar?: (ms: number) => Promise<void>
  jitterMs?: () => number
}): Promise<{ enviados: number; cancelados: number; falhas: number }> {
  const agora = deps.agora ?? (() => new Date())
  const esperar = deps.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const jitter = deps.jitterMs ?? (() => 8_000 + Math.floor(Math.random() * 32_000))
  let enviados = 0, cancelados = 0, falhas = 0

  if (deps.conectados.size === 0) return { enviados, cancelados, falhas }
  const params = await carregarParametros()
  const pendentes = await prisma.whatsappFila.findMany({
    where: {
      status: 'pendente',
      tentativas: { lt: MAX_TENTATIVAS },
      OR: [{ agendadoPara: null }, { agendadoPara: { lte: agora() } }],
    },
    orderBy: { criadoEm: 'asc' },
    take: 50,
  })

  for (const msg of pendentes) {
    const numeros = (await carregarNumeros()).filter((n) => deps.conectados.has(n.id))
    const escolhido = escolherNumero(numeros, agora(), params)
    if (!escolhido) break // sem chip elegível (teto/janela) — próximo ciclo
    if (await estaOptOut(msg.telefone)) {
      await prisma.whatsappFila.update({ where: { id: msg.id }, data: { status: 'cancelado' } })
      cancelados++
      continue
    }
    const pessoa = msg.pessoaId ? await prisma.pessoa.findUnique({ where: { id: msg.pessoaId }, select: { nome: true } }) : null
    const seed = Math.floor(Math.random() * 6)
    const texto = microVariacao(expandirSpintax(personalizar(msg.mensagem, pessoa?.nome), seed), seed)
    try {
      await deps.enviar(escolhido.id, msg.telefone, texto)
      await prisma.whatsappFila.update({ where: { id: msg.id }, data: { status: 'enviado', enviadoEm: agora(), numeroId: escolhido.id, erro: null } })
      await registrarEnvio(escolhido.id, agora())
      enviados++
    } catch (e) {
      const tentativas = msg.tentativas + 1
      await prisma.whatsappFila.update({
        where: { id: msg.id },
        data: { tentativas, status: tentativas >= MAX_TENTATIVAS ? 'erro' : 'pendente', erro: String(e) },
      })
      falhas++
    }
    await esperar(jitter())
  }
  return { enviados, cancelados, falhas }
}

/** Interpreta uma mensagem inbound do Baileys → texto + telefone normalizado (para opt-out). */
export function interpretarInbound(msg: {
  key?: { remoteJid?: string; fromMe?: boolean }
  message?: { conversation?: string; extendedTextMessage?: { text?: string } }
}, normalizar: (t?: string | null) => string | null): { fromMe: boolean; texto: string; telefone: string | null } {
  const fromMe = !!msg.key?.fromMe
  const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text || ''
  const jid = msg.key?.remoteJid || ''
  const telefone = normalizar(jid.split('@')[0])
  return { fromMe, texto, telefone }
}
