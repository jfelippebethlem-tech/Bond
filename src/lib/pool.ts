export type NumeroPool = {
  id: string
  status: string
  tetoDiario: number
  nivelAquecimento: number
  enviadosHoje: number
  ultimoEnvioEm: Date | null
  zeradoEm: Date | null
}

export type ParametrosPool = {
  rampa: number[]
  tetoMax: number
  janelaInicio: number
  janelaFim: number
}

export const PARAMS_PADRAO: ParametrosPool = {
  rampa: [20, 40, 80, 120, 160, 200],
  tetoMax: 200,
  janelaInicio: 9,
  janelaFim: 20,
}

function mesmoDia(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function tetoEfetivo(n: NumeroPool, p: ParametrosPool): number {
  const idx = Math.min(Math.max(n.nivelAquecimento, 1), p.rampa.length) - 1
  return Math.min(p.rampa[idx], p.tetoMax)
}

export function dentroDaJanela(agora: Date, p: ParametrosPool): boolean {
  const h = agora.getHours()
  return h >= p.janelaInicio && h < p.janelaFim
}

export function precisaResetDiario(n: NumeroPool, agora: Date): boolean {
  return !n.zeradoEm || !mesmoDia(n.zeradoEm, agora)
}

/** Round-robin ponderado: maior orçamento restante; empate → menos recente. */
export function escolherNumero(numeros: NumeroPool[], agora: Date, p: ParametrosPool): NumeroPool | null {
  if (!dentroDaJanela(agora, p)) return null
  const elegiveis = numeros
    .filter((n) => n.status === 'ativo' || n.status === 'aquecendo')
    .map((n) => {
      const usados = precisaResetDiario(n, agora) ? 0 : n.enviadosHoje
      return { n, orcamento: tetoEfetivo(n, p) - usados }
    })
    .filter((x) => x.orcamento > 0)
  if (elegiveis.length === 0) return null
  elegiveis.sort((a, b) => {
    if (b.orcamento !== a.orcamento) return b.orcamento - a.orcamento
    const ta = a.n.ultimoEnvioEm ? a.n.ultimoEnvioEm.getTime() : 0
    const tb = b.n.ultimoEnvioEm ? b.n.ultimoEnvioEm.getTime() : 0
    return ta - tb
  })
  return elegiveis[0].n
}

// ──────────────────────────────────────────────────────────────────────────────
// Wrappers de DB — tarefa Task 4
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from './db'

export async function carregarNumeros(): Promise<NumeroPool[]> {
  return prisma.whatsappNumero.findMany({
    select: { id: true, status: true, tetoDiario: true, nivelAquecimento: true, enviadosHoje: true, ultimoEnvioEm: true, zeradoEm: true },
  })
}

export async function registrarEnvio(id: string, agora: Date = new Date()): Promise<void> {
  const n = await prisma.whatsappNumero.findUnique({ where: { id } })
  if (!n) return
  const zerar = precisaResetDiario(
    { ...n, ultimoEnvioEm: n.ultimoEnvioEm, zeradoEm: n.zeradoEm } as NumeroPool,
    agora,
  )
  // A rampa só AVANÇA numa virada de dia REAL (já havia um `zeradoEm` de um dia
  // anterior). No 1º envio de um chip novo (`zeradoEm` null) o contador zera mas
  // o nível fica no dia 1 — senão o chip pularia o aquecimento do primeiro dia.
  // O teto é o tamanho da rampa EFETIVA (custom em Configuracao, se houver).
  const subiuDeDia = !!n.zeradoEm && zerar
  let nivelAquecimento = n.nivelAquecimento
  if (subiuDeDia) {
    const { rampa } = await carregarParametros()
    nivelAquecimento = Math.min(n.nivelAquecimento + 1, rampa.length)
  }
  await prisma.whatsappNumero.update({
    where: { id },
    data: {
      enviadosHoje: zerar ? 1 : n.enviadosHoje + 1,
      zeradoEm: zerar ? agora : n.zeradoEm,
      ultimoEnvioEm: agora,
      nivelAquecimento,
    },
  })
}

export async function marcarBanido(id: string): Promise<void> {
  await prisma.whatsappNumero.update({ where: { id }, data: { status: 'banido' } })
}

export async function carregarParametros(): Promise<ParametrosPool> {
  const rows = await prisma.configuracao.findMany({
    where: { chave: { in: ['wa_janela_inicio', 'wa_janela_fim', 'wa_teto_max', 'wa_rampa'] } },
  })
  const cfg = Object.fromEntries(rows.map((r) => [r.chave, r.valor]))
  return {
    rampa: cfg['wa_rampa'] ? cfg['wa_rampa'].split(',').map((x) => parseInt(x.trim(), 10)) : PARAMS_PADRAO.rampa,
    tetoMax: cfg['wa_teto_max'] ? parseInt(cfg['wa_teto_max'], 10) : PARAMS_PADRAO.tetoMax,
    janelaInicio: cfg['wa_janela_inicio'] ? parseInt(cfg['wa_janela_inicio'], 10) : PARAMS_PADRAO.janelaInicio,
    janelaFim: cfg['wa_janela_fim'] ? parseInt(cfg['wa_janela_fim'], 10) : PARAMS_PADRAO.janelaFim,
  }
}
