// PUXADOR DE META ADS (Marketing API) — ESQUELETO, DESLIGADO por padrão.
//
// Liga sozinho quando você ativar verba. Pré-requisitos para ligar:
//   1) META_AD_ACCOUNT_ID no .env (o id da conta de anúncios, ex.: 1234567890 — com ou sem "act_")
//   2) FACEBOOK_PAGE_TOKEN com escopo `ads_read` (regere o token marcando ads_read; o atual NÃO tem)
// Enquanto não configurado, todas as funções retornam { ativo: false } sem fazer nenhuma chamada.
// Tudo grátis (API nativa da Meta) — é o substituto do Windsor.ai sem mensalidade.
const GRAPH = 'https://graph.facebook.com/v21.0'

/** True só quando há conta de anúncios + token configurados. */
export function adsConfigurado(): boolean {
  return !!(process.env.META_AD_ACCOUNT_ID && process.env.FACEBOOK_PAGE_TOKEN)
}

const contaId = () => (process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '')

// extrai um action_type de seguidor/like da lista de actions/cost_per_action_type
const acharFollow = (arr?: { action_type: string; value: string }[]) =>
  arr?.find((a) => /follow|like|page_engagement/i.test(a.action_type))?.value

type ResumoAds =
  | { ok: true; ativo: false; motivo: string }
  | { ok: false; ativo: true; erro: string }
  | { ok: true; ativo: true; vazio: true; mensagem: string }
  | {
      ok: true; ativo: true; periodo: string; gasto: number; alcance: number; impressoes: number
      cliques: number; cpc: number; ctr: number; seguidores: number | null; custoPorSeguidor: number | null
    }

/** Resumo agregado da conta de anúncios no período (gasto, alcance, custo por seguidor). */
export async function resumoMetaAds(datePreset = 'last_30d'): Promise<ResumoAds> {
  if (!adsConfigurado()) return { ok: true, ativo: false, motivo: 'Meta Ads não configurado — defina META_AD_ACCOUNT_ID e use um token com escopo ads_read.' }
  const fields = 'spend,reach,impressions,clicks,cpc,ctr,actions,cost_per_action_type'
  const url = `${GRAPH}/act_${contaId()}/insights?fields=${fields}&date_preset=${datePreset}&access_token=${process.env.FACEBOOK_PAGE_TOKEN}`
  try {
    const res = await fetch(url)
    const data = await res.json()
    if (data.error) return { ok: false, ativo: true, erro: data.error.message }
    const r = data.data?.[0]
    if (!r) return { ok: true, ativo: true, vazio: true, mensagem: 'Sem dados de anúncios no período.' }
    const seguidores = acharFollow(r.actions)
    const custoSeg = acharFollow(r.cost_per_action_type)
    return {
      ok: true, ativo: true, periodo: datePreset,
      gasto: +r.spend || 0, alcance: +r.reach || 0, impressoes: +r.impressions || 0,
      cliques: +r.clicks || 0, cpc: +r.cpc || 0, ctr: +r.ctr || 0,
      seguidores: seguidores ? +seguidores : null, custoPorSeguidor: custoSeg ? +custoSeg : null,
    }
  } catch (e) {
    return { ok: false, ativo: true, erro: e instanceof Error ? e.message : String(e) }
  }
}

/** Desempenho por anúncio (qual reel impulsionado converteu) — para decidir onde botar verba. */
export async function metaAdsPorAnuncio(datePreset = 'last_30d', limit = 25) {
  if (!adsConfigurado()) return { ok: true as const, ativo: false as const }
  const fields = 'ad_name,spend,reach,impressions,clicks,ctr,actions,cost_per_action_type'
  const url = `${GRAPH}/act_${contaId()}/insights?level=ad&fields=${fields}&date_preset=${datePreset}&limit=${limit}&access_token=${process.env.FACEBOOK_PAGE_TOKEN}`
  try {
    const res = await fetch(url)
    const data = await res.json()
    if (data.error) return { ok: false as const, ativo: true as const, erro: data.error.message }
    const anuncios = (data.data ?? []).map((r: { ad_name?: string; spend?: string; reach?: string; clicks?: string; ctr?: string; actions?: { action_type: string; value: string }[]; cost_per_action_type?: { action_type: string; value: string }[] }) => ({
      nome: r.ad_name, gasto: +(r.spend || 0), alcance: +(r.reach || 0), cliques: +(r.clicks || 0), ctr: +(r.ctr || 0),
      seguidores: acharFollow(r.actions) ? +acharFollow(r.actions)! : null,
      custoPorSeguidor: acharFollow(r.cost_per_action_type) ? +acharFollow(r.cost_per_action_type)! : null,
    }))
    return { ok: true as const, ativo: true as const, periodo: datePreset, anuncios }
  } catch (e) {
    return { ok: false as const, ativo: true as const, erro: e instanceof Error ? e.message : String(e) }
  }
}
