/**
 * Núcleo TESTÁVEL do drain de SMS — separado do worker. Por padrão usa o
 * `enviarViaGateway` real (que faz o POST HTTP no Android Gateway), então pode ser
 * testado ponta-a-ponta contra um gateway HTTP emulado, sem chip.
 */
import { prisma } from './db'
import { enviarViaGateway } from './sms'
import { estaOptOut } from './optout'
import { personalizar, expandirSpintax } from './whatsapp'

const MAX_TENTATIVAS = 3

export async function drenarFilaSms(deps?: {
  enviar?: (telefone: string, texto: string) => Promise<boolean>
  agora?: () => Date
  esperar?: (ms: number) => Promise<void>
  jitterMs?: () => number
}): Promise<{ enviados: number; cancelados: number; falhas: number }> {
  const enviar = deps?.enviar ?? enviarViaGateway
  const agora = deps?.agora ?? (() => new Date())
  const esperar = deps?.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const jitter = deps?.jitterMs ?? (() => 3_000 + Math.floor(Math.random() * 7_000))
  let enviados = 0, cancelados = 0, falhas = 0

  const pendentes = await prisma.smsFila.findMany({
    where: {
      status: 'pendente',
      tentativas: { lt: MAX_TENTATIVAS },
      OR: [{ agendadoPara: null }, { agendadoPara: { lte: agora() } }],
    },
    orderBy: { criadoEm: 'asc' },
    take: 50,
  })

  for (const msg of pendentes) {
    if (await estaOptOut(msg.telefone)) {
      await prisma.smsFila.update({ where: { id: msg.id }, data: { status: 'cancelado' } })
      cancelados++
      continue
    }
    // SMS: personaliza {nome} e expande spintax; NÃO usa caractere invisível (ruim p/ SMS).
    const pessoa = msg.pessoaId ? await prisma.pessoa.findUnique({ where: { id: msg.pessoaId }, select: { nome: true } }) : null
    const texto = expandirSpintax(personalizar(msg.mensagem, pessoa?.nome), Math.floor(Math.random() * 6))
    const ok = await enviar(msg.telefone, texto)
    if (ok) {
      await prisma.smsFila.update({ where: { id: msg.id }, data: { status: 'enviado', enviadoEm: agora(), erro: null } })
      enviados++
    } else {
      const tentativas = msg.tentativas + 1
      await prisma.smsFila.update({ where: { id: msg.id }, data: { tentativas, status: tentativas >= MAX_TENTATIVAS ? 'erro' : 'pendente', erro: 'falha no gateway' } })
      falhas++
    }
    await esperar(jitter())
  }
  return { enviados, cancelados, falhas }
}
