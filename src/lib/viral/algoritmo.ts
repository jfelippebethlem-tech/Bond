// PARÂMETROS DO ALGORITMO DO INSTAGRAM — função PURA de scoring de viralização.
//
// Codifica o que a pesquisa (declarações do Mosseri 2025 + análises de agências)
// diz sobre o que o IG pesa para distribuir/viralizar, por superfície. NÃO chama
// rede nem banco — recebe sinais e devolve um score 0-100 + diagnóstico estruturado.
//
// Desenho de 2 CAMADAS (a conta não tem read_insights hoje):
//   • Camada A (proxy): sem reach/saves/sends. Pontua por QUALIDADE DE CONTEÚDO
//     (gancho/ritmo do Gemini), engajamento normalizado por seguidores e tema em alta.
//   • Camada B (algoritmo): com insights reais — usa os pesos da pesquisa
//     (retenção > sends/reach > saves > likes). Mais preciso.
// Gates de PENALIDADE (multiplicativos) valem nas duas camadas.

export type Superficie = 'reel' | 'carrossel' | 'feed' | 'foto' | 'video' | 'story'

export type SinaisViral = {
  // ── Conteúdo (camada A — do Gemini assistindo a mídia) ──
  ganchoNota?: number | null // 0-10 (prende nos 1ºs 3s / 1ª imagem?)
  ritmoNota?: number | null // 0-10 (edição/ritmo)
  qualidadeNota?: number | null // 0-10 (visual/áudio)
  gatilhosNota?: number | null // 0-10 (checklist send-worthy: gatilhos mentais + psicologia de massas)
  // ── Engajamento público (camada A — temos hoje) ──
  likes?: number
  comentarios?: number
  compartilhos?: number
  seguidores?: number // p/ normalizar engajamento
  // ── Tendência (camada A) ──
  temaEmAlta?: boolean
  // ── Insights privados (camada B — 0/null sem read_insights) ──
  reach?: number | null
  saves?: number | null
  sends?: number | null // compartilhamentos por DM — o sinal de viral mais forte
  videoViews?: number | null
  completionPct?: number | null // 0-100 (assistiu até o fim)
  alcanceNaoSeguidores?: number | null // p/ o ratio connected vs unconnected
  // ── Gates (matam alcance) ──
  temWatermarkTiktok?: boolean
  ehRepost?: boolean
  engagementBait?: boolean
  baixaQualidade?: boolean
  duracaoSeg?: number | null // reel > 3min = inelegível a recomendação
}

export type SinalScore = { sinal: string; valor: number; peso: number }
export type ResultadoViral = {
  scoreTotal: number // 0-100
  camada: 'A' | 'B'
  breakdown: SinalScore[]
  gatesAplicados: { gate: string; fator: number }[]
  sinaisFaltando: string[] // o que a camada A não enxerga (limita o diagnóstico)
}

// ─── Pesos por superfície (camada B — tabelas da pesquisa, Mosseri 2025) ──────────
// sends/reach > retenção > saves > likes para descoberta. Soma ~1 por superfície.
const PESOS_ALGORITMO: Record<Superficie, Record<string, number>> = {
  reel: { retencao: 0.3, sendsPerReach: 0.25, completion: 0.18, savesPerReach: 0.12, likesPerReach: 0.08, comentariosNorm: 0.04, unconnected: 0.03 },
  video: { retencao: 0.3, sendsPerReach: 0.25, completion: 0.18, savesPerReach: 0.12, likesPerReach: 0.08, comentariosNorm: 0.04, unconnected: 0.03 },
  carrossel: { completion: 0.3, savesPerReach: 0.22, sendsPerReach: 0.2, likesPerReach: 0.13, comentariosNorm: 0.08, unconnected: 0.07 },
  feed: { sendsPerReach: 0.27, savesPerReach: 0.22, likesPerReach: 0.2, comentariosNorm: 0.16, unconnected: 0.15 },
  foto: { sendsPerReach: 0.27, savesPerReach: 0.22, likesPerReach: 0.2, comentariosNorm: 0.16, unconnected: 0.15 },
  story: { completion: 0.4, comentariosNorm: 0.3, likesPerReach: 0.3 }, // story não viraliza; proxy fraco
}

// ─── Pesos da camada A (proxy de conteúdo — sem insights) ─────────────────────────
// Gancho é o proxy nº1 de retenção; engajamento/seguidor é o termômetro público.
// gancho 0.35→0.42 (Loop 2); + gatilhos 0.22 (psicologia send/save: checklist send-worthy).
const PESOS_PROXY: Record<string, number> = {
  gancho: 0.3,
  gatilhos: 0.22,
  engRate: 0.18,
  ritmo: 0.1,
  qualidade: 0.05,
  temaEmAlta: 0.1,
  comentariosNorm: 0.05,
}

// satura uma razão em 0-1 (valor que já é "ótimo" vira 1).
const sat = (v: number, otimo: number) => Math.max(0, Math.min(1, v / otimo))

function aplicarGates(s: SinaisViral): { gate: string; fator: number }[] {
  const gates: { gate: string; fator: number }[] = []
  if (s.temWatermarkTiktok) gates.push({ gate: 'watermark de TikTok/outra plataforma', fator: 0.35 })
  if (s.ehRepost) gates.push({ gate: 'repost/conteúdo não-original', fator: 0.5 })
  if (s.engagementBait) gates.push({ gate: 'engagement bait ("curta/comente para...")', fator: 0.7 })
  if (s.baixaQualidade) gates.push({ gate: 'baixa qualidade / sem áudio', fator: 0 })
  if ((s.duracaoSeg ?? 0) > 180) gates.push({ gate: 'vídeo > 3min (fora da recomendação)', fator: 0.6 })
  return gates
}

// média ponderada sobre os sinais DISPONÍVEIS (renormaliza os pesos).
function ponderar(valores: Record<string, number | null>, pesos: Record<string, number>): { score: number; breakdown: SinalScore[]; faltando: string[] } {
  const breakdown: SinalScore[] = []
  const faltando: string[] = []
  let somaPeso = 0
  let somaVal = 0
  for (const [sinal, peso] of Object.entries(pesos)) {
    const v = valores[sinal]
    if (v === null || v === undefined || Number.isNaN(v)) { faltando.push(sinal); continue }
    somaPeso += peso
    somaVal += v * peso
    breakdown.push({ sinal, valor: Math.round(v * 100) / 100, peso })
  }
  const score = somaPeso > 0 ? somaVal / somaPeso : 0
  return { score, breakdown, faltando }
}

/**
 * Pontua um post. Escolhe camada B (preciso) se houver reach real; senão camada A (proxy).
 * Sempre aplica os gates de penalidade.
 */
export function pontuarViral(superficie: Superficie, s: SinaisViral): ResultadoViral {
  // camada B exige reach + ao menos UM sinal de distribuição real (não só reach, senão vira likes/reach)
  const temInsights = (s.reach ?? 0) > 0 && (s.saves != null || s.sends != null || s.completionPct != null || s.videoViews != null)
  const comentariosNorm = s.seguidores ? sat((s.comentarios ?? 0) / s.seguidores, 0.01) : null

  let camada: 'A' | 'B'
  let base: { score: number; breakdown: SinalScore[]; faltando: string[] }

  if (temInsights) {
    camada = 'B'
    const reach = s.reach as number
    const valores: Record<string, number | null> = {
      retencao: s.completionPct != null ? sat(s.completionPct / 100, 0.7) : (s.videoViews != null ? sat(s.videoViews / reach, 1) : null),
      sendsPerReach: s.sends != null ? sat(s.sends / reach, 0.02) : null, // 2% sends/reach = ótimo
      completion: s.completionPct != null ? sat(s.completionPct / 100, 0.6) : null,
      savesPerReach: s.saves != null ? sat(s.saves / reach, 0.03) : null,
      likesPerReach: sat((s.likes ?? 0) / reach, 0.1),
      comentariosNorm: s.comentarios != null ? sat(s.comentarios / reach, 0.01) : null,
      unconnected: s.alcanceNaoSeguidores != null ? sat(s.alcanceNaoSeguidores / reach, 0.5) : null,
    }
    base = ponderar(valores, PESOS_ALGORITMO[superficie])
  } else {
    camada = 'A'
    const engRate = s.seguidores ? sat(((s.likes ?? 0) + (s.comentarios ?? 0) + (s.compartilhos ?? 0)) / s.seguidores, 0.05) : null
    const valores: Record<string, number | null> = {
      gancho: s.ganchoNota != null ? s.ganchoNota / 10 : null,
      gatilhos: s.gatilhosNota != null ? s.gatilhosNota / 10 : null,
      engRate,
      ritmo: s.ritmoNota != null ? s.ritmoNota / 10 : null,
      qualidade: s.qualidadeNota != null ? s.qualidadeNota / 10 : null,
      temaEmAlta: s.temaEmAlta ? 1 : 0,
      comentariosNorm,
    }
    base = ponderar(valores, PESOS_PROXY)
  }

  const gates = aplicarGates(s)
  const fatorGate = gates.reduce((f, g) => f * g.fator, 1)
  const scoreTotal = Math.round(base.score * 100 * fatorGate)

  // o que a camada A não enxerga (alimenta o diagnóstico honesto)
  const cega = camada === 'A' ? ['reach', 'sends (DM)', 'saves', 'video_views', 'alcance de não-seguidores'] : []

  return { scoreTotal, camada, breakdown: base.breakdown, gatesAplicados: gates, sinaisFaltando: cega }
}

// mapeia o tipo do BondPost/IG (media_type) para a superfície do scorer.
export function superficieDeTipo(tipo?: string | null, mediaType?: string | null): Superficie {
  const t = (mediaType || tipo || '').toUpperCase()
  if (t === 'VIDEO' || t === 'REEL' || t === 'REELS') return 'reel'
  if (t === 'CAROUSEL_ALBUM' || t === 'CARROSSEL') return 'carrossel'
  if (t === 'STORY') return 'story'
  if (t === 'IMAGE' || t === 'FOTO') return 'foto'
  return 'feed'
}
