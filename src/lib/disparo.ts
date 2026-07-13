import { prisma } from './db'
import { enfileirarBroadcast } from './whatsapp'
import { enfileirarBroadcastSms } from './sms'

export async function dispararCampanha(opts: {
  titulo: string
  mensagem: string
  audiencia: string[]
  canais: Array<'whatsapp' | 'sms'>
}): Promise<{ disparoId: string; whatsapp: number; sms: number; totalAlvo: number }> {
  const totalAlvo = await prisma.pessoa.count({
    where: { tipo: { in: opts.audiencia }, ativo: true, telefone: { not: null } },
  })
  const disparo = await prisma.disparo.create({
    data: { titulo: opts.titulo, mensagem: opts.mensagem, canais: opts.canais.join(','), audiencia: opts.audiencia.join(','), totalAlvo },
  })

  let whatsapp = 0
  let sms = 0
  if (opts.canais.includes('whatsapp')) {
    const r = await enfileirarBroadcast(opts.mensagem, 'broadcast', undefined, disparo.id)
    whatsapp = r.enfileirados
  }
  if (opts.canais.includes('sms')) {
    const r = await enfileirarBroadcastSms(opts.mensagem, 'broadcast', disparo.id)
    sms = r.enfileirados
  }
  await prisma.disparo.update({ where: { id: disparo.id }, data: { enfileirados: whatsapp + sms } })
  return { disparoId: disparo.id, whatsapp, sms, totalAlvo }
}
