// SENSOR DE TENDÊNCIAS — 100% gratuito e keyless (Node fetch + RSS).
//
// Fontes: Google Trends RSS (o que o Brasil BUSCA agora) + Google News RSS
// (top BR + foco "Rio de Janeiro"). Persiste em BondTendencia. Sem chave, sem
// scraping frágil, sem custo. Rio entra via busca de notícias (o Trends RSS é nacional).
import { prisma } from '../db'

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

type Item = { termo: string; rankOuScore?: number | null; contexto?: string }

async function buscarRss(url: string, timeoutMs = 12000): Promise<string> {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml' }, signal: ctrl.signal })
    if (!r.ok) throw new Error(`RSS ${r.status}`)
    return await r.text()
  } finally {
    clearTimeout(id)
  }
}

// extrai <item> de um RSS de forma tolerante (CDATA ou texto puro).
function extrairItens(xml: string): { title: string; traffic?: string }[] {
  return xml
    .split(/<item>/i)
    .slice(1)
    .map((bloco) => {
      const title = (bloco.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1] || '').trim()
      const traffic = bloco.match(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/i)?.[1]?.trim()
      return { title, traffic }
    })
    .filter((i) => i.title)
}

const parseTraffic = (t?: string): number | null => {
  if (!t) return null
  const m = t.replace(/\./g, '').match(/(\d+)\s*([KkMm]?)/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return m[2]?.toLowerCase() === 'm' ? n * 1_000_000 : m[2]?.toLowerCase() === 'k' ? n * 1000 : n
}

async function googleTrends(): Promise<Item[]> {
  try {
    const xml = await buscarRss('https://trends.google.com/trending/rss?geo=BR')
    return extrairItens(xml).map((i) => ({ termo: i.title, rankOuScore: parseTraffic(i.traffic), contexto: i.traffic ? `~${i.traffic} buscas` : undefined }))
  } catch {
    return []
  }
}

async function googleNews(query?: string): Promise<Item[]> {
  const base = 'https://news.google.com/rss'
  const url = query
    ? `${base}/search?q=${encodeURIComponent(query)}&hl=pt-BR&gl=BR&ceid=BR:pt`
    : `${base}?hl=pt-BR&gl=BR&ceid=BR:pt`
  try {
    const xml = await buscarRss(url)
    return extrairItens(xml)
      .slice(0, 20)
      .map((i) => {
        // "Manchete - Fonte" → termo = manchete
        const corte = i.title.lastIndexOf(' - ')
        const termo = corte > 20 ? i.title.slice(0, corte) : i.title
        return { termo, contexto: i.title }
      })
  } catch {
    return []
  }
}

/**
 * Captura tendências de todas as fontes grátis e persiste em BondTendencia.
 * Retorna o que capturou. Idempotência não é exigida (snapshots datados).
 */
export async function capturarTendencias(): Promise<{ fonte: string; geo: string; n: number }[]> {
  const [trendsBR, newsBR, newsRJ] = await Promise.all([
    googleTrends(),
    googleNews(),
    googleNews('Rio de Janeiro'),
  ])

  const lotes: { fonte: string; geo: string; itens: Item[] }[] = [
    { fonte: 'google_trends', geo: 'BR', itens: trendsBR },
    { fonte: 'google_news', geo: 'BR', itens: newsBR },
    { fonte: 'google_news', geo: 'BR-RJ', itens: newsRJ },
  ]

  const resumo: { fonte: string; geo: string; n: number }[] = []
  for (const lote of lotes) {
    const vistos = new Set<string>()
    const dados = lote.itens
      .filter((i) => i.termo && !vistos.has(i.termo.toLowerCase()) && vistos.add(i.termo.toLowerCase()))
      .slice(0, 25)
      .map((i) => ({ termo: i.termo.slice(0, 300), fonte: lote.fonte, geo: lote.geo, rankOuScore: i.rankOuScore ?? null, contexto: i.contexto?.slice(0, 500) ?? null }))
    if (dados.length) await prisma.bondTendencia.createMany({ data: dados })
    resumo.push({ fonte: lote.fonte, geo: lote.geo, n: dados.length })
  }
  return resumo
}

/** Tendências capturadas nas últimas N horas (default 48h) — para o analista/recomendador. */
export async function tendenciasRecentes(horas = 48) {
  const desde = new Date(Date.now() - horas * 3600_000)
  return prisma.bondTendencia.findMany({ where: { capturadoEm: { gte: desde } }, orderBy: { capturadoEm: 'desc' }, take: 120 })
}

/** Texto compacto das tendências p/ injetar em prompt (economia de token). */
export async function tendenciasParaPrompt(horas = 48): Promise<string> {
  const t = await tendenciasRecentes(horas)
  if (!t.length) return '(sem tendências capturadas)'
  const porFonte: Record<string, string[]> = {}
  for (const x of t) {
    const k = `${x.fonte}/${x.geo}`
    ;(porFonte[k] = porFonte[k] || []).push(x.termo)
  }
  return Object.entries(porFonte)
    .map(([k, termos]) => `${k}: ${Array.from(new Set(termos)).slice(0, 12).join('; ')}`)
    .join('\n')
}
