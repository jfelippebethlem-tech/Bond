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
