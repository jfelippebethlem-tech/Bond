/** Núcleo TESTÁVEL do drain de Telegram — separado do worker. */
import { prisma } from './db'
import { enviarTelegramMensagem } from './telegram-broadcast'

const MAX_TENTATIVAS = 3

export async function drenarFilaTelegram(deps?: {
  enviar?: (destino: string, texto: string) => Promise<{ ok: boolean; id?: string; erro?: string }>
  agora?: () => Date
  esperar?: (ms: number) => Promise<void>
}): Promise<{ enviados: number; falhas: number }> {
  const enviar = deps?.enviar ?? enviarTelegramMensagem
  const agora = deps?.agora ?? (() => new Date())
  const esperar = deps?.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)))

  const pendentes = await prisma.telegramFila.findMany({
    where: {
      status: 'pendente',
      tentativas: { lt: MAX_TENTATIVAS },
      OR: [{ agendadoPara: null }, { agendadoPara: { lte: agora() } }],
    },
    orderBy: { criadoEm: 'asc' },
    take: 30,
  })

  let enviados = 0, falhas = 0
  for (const msg of pendentes) {
    const r = await enviar(msg.destino, msg.mensagem)
    if (r.ok) {
      await prisma.telegramFila.update({ where: { id: msg.id }, data: { status: 'enviado', enviadoEm: agora(), erro: null } })
      enviados++
    } else {
      const tentativas = msg.tentativas + 1
      await prisma.telegramFila.update({ where: { id: msg.id }, data: { tentativas, status: tentativas >= MAX_TENTATIVAS ? 'erro' : 'pendente', erro: r.erro ?? 'falha no envio' } })
      falhas++
    }
    await esperar(1_500)
  }
  return { enviados, falhas }
}
