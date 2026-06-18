// ANÁLISE DE MÍDIA — o PolitiMonitor "assiste" vídeos/reels e "vê" carrosséis do Instagram
// para avaliar o conteúdo em profundidade (gancho, ritmo, mensagem, CTA, qualidade).
// Usa o Gemini 2.5 multimodal: VÍDEO via File API (gemini entende vídeo nativamente),
// CARROSSEL/IMAGEM inline. Sob demanda (1 post por clique) + custo só no uso (cota Gemini).
//
// Pré-req: GEMINI_API_KEY (free tier serve) + FACEBOOK_PAGE_TOKEN (mesma do IG business).
import { GoogleGenerativeAI } from '@google/generative-ai'
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'

const IG_BASE = 'https://graph.facebook.com/v19.0'
const MODEL = 'gemini-2.5-flash'

type Media = { id: string; media_type?: string; media_url?: string; thumbnail_url?: string; caption?: string; permalink?: string; children?: { data: { media_type?: string; media_url?: string }[] } }

// Busca a mídia FRESCA do IG (a media_url é assinada/temporária — a do DB pode ter expirado).
// Inclui children para carrossel (CAROUSEL_ALBUM).
export async function getInstagramMedia(mediaId: string): Promise<Media | null> {
  const tk = process.env.FACEBOOK_PAGE_TOKEN
  if (!tk) return null
  const fields = 'id,media_type,media_url,thumbnail_url,caption,permalink,children{media_type,media_url}'
  const res = await fetch(`${IG_BASE}/${mediaId}?fields=${fields}&access_token=${tk}`)
  if (!res.ok) return null
  return res.json()
}

async function baixar(url: string): Promise<Buffer> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`download ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

const PROMPT = (tipo: string, legenda: string) =>
  `Você é um estrategista de conteúdo para redes sociais de um deputado estadual (RJ). ` +
  `Analise este ${tipo} do Instagram de forma PROFUNDA e HONESTA — avalie e dê nota (0-10) para: ` +
  `(1) GANCHO dos primeiros 3 segundos / 1ª imagem (prende?); (2) RITMO/edição; ` +
  `(3) CLAREZA da mensagem; (4) CTA (chamada para ação); (5) QUALIDADE visual/áudio; ` +
  `(6) ALINHAMENTO com pauta de mandato/fiscalização. Diga o que FUNCIONA, o que PERDE engajamento, ` +
  `e 2-3 melhorias CONCRETAS para o próximo. Seja específico (cite o que viu). ` +
  `Legenda do post: "${(legenda || '').slice(0, 400)}". Responda em português, direto, sem preâmbulo.`

// Analisa a mídia de UM post. Retorna a análise textual (ou um erro honesto).
export async function analisarMidiaPost(media: Media): Promise<{ ok: boolean; analise?: string; tipo?: string; erro?: string }> {
  if (!process.env.GEMINI_API_KEY) return { ok: false, erro: 'GEMINI_API_KEY ausente' }
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({ model: MODEL })
  const tipo = media.media_type || 'IMAGE'
  try {
    // VÍDEO/REEL: baixa o .mp4 e sobe pela File API (gemini assiste o vídeo).
    if (tipo === 'VIDEO' && media.media_url) {
      const fm = new GoogleAIFileManager(process.env.GEMINI_API_KEY)
      const buf = await baixar(media.media_url)
      const tmp = path.join(tmpdir(), `ig-${media.id}.mp4`)
      await writeFile(tmp, buf)
      let file = await fm.uploadFile(tmp, { mimeType: 'video/mp4', displayName: media.id })
      // espera processar (ACTIVE) — vídeo precisa ser transcodificado pelo Google
      for (let i = 0; i < 30 && file.file.state === FileState.PROCESSING; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        file = { file: await fm.getFile(file.file.name) }
      }
      await unlink(tmp).catch(() => {})
      if (file.file.state !== FileState.ACTIVE) {
        // fallback honesto: analisa o thumbnail (imagem) se o vídeo não processou
        if (media.thumbnail_url) return analisarImagens([media.thumbnail_url], 'vídeo (só a capa — o vídeo não processou a tempo)', media.caption || '')
        return { ok: false, erro: 'vídeo não processou no Gemini', tipo }
      }
      const res = await model.generateContent([
        { fileData: { mimeType: file.file.mimeType, fileUri: file.file.uri } },
        PROMPT('vídeo/reel', media.caption || ''),
      ])
      return { ok: true, tipo, analise: res.response.text() }
    }
    // CARROSSEL: junta as imagens dos children (ignora vídeos-filho na v1 → usa media_url deles se imagem).
    if (tipo === 'CAROUSEL_ALBUM' && media.children?.data?.length) {
      const urls = media.children.data.filter((c) => c.media_url && c.media_type !== 'VIDEO').map((c) => c.media_url!)
      if (urls.length) return analisarImagens(urls.slice(0, 8), `carrossel (${urls.length} imagens, em ordem)`, media.caption || '')
    }
    // IMAGEM única.
    const img = media.media_url || media.thumbnail_url
    if (img) return analisarImagens([img], 'imagem', media.caption || '')
    return { ok: false, erro: 'sem mídia analisável', tipo }
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e), tipo }
  }
}

async function analisarImagens(urls: string[], tipo: string, legenda: string) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const model = genAI.getGenerativeModel({ model: MODEL })
  const parts: ({ inlineData: { mimeType: string; data: string } } | string)[] = []
  for (const u of urls) {
    try { parts.push({ inlineData: { mimeType: 'image/jpeg', data: (await baixar(u)).toString('base64') } }) } catch { /* pula imagem que falhou */ }
  }
  if (!parts.length) return { ok: false, erro: 'nenhuma imagem baixou', tipo }
  parts.push(PROMPT(tipo, legenda))
  const res = await model.generateContent(parts)
  return { ok: true, tipo, analise: res.response.text() }
}
