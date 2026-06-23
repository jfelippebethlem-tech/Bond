// INTELIGÊNCIA PROGRESSIVA — o Hermes aprende com os resultados REAIS e compõe.
//
// A cada lote, compara os posts que MAIS espalharam (sends/alcance — o sinal de viral)
// com os que menos, extrai o "playbook" específico DESTE perfil e o guarda como
// memória viva (HermesMemoria 'viral/playbook'). Esse playbook é injetado nas próximas
// análises e recomendações → cada nova decisão usa tudo que já foi aprendido.
// Inclui meta-cognição: confere se os posts que pontuou alto realmente espalharam.
import { prisma } from '../db'
import { callAI, lembrar } from '../hermes'

const MIN_N = 8

/** Playbook aprendido (algoritmo) + avaliação premium do Claude (diretor), para injetar nos prompts. */
export async function playbookAtual(): Promise<string> {
  const [m, diretor] = await Promise.all([
    prisma.hermesMemoria.findUnique({ where: { tipo_chave: { tipo: 'viral', chave: 'playbook' } } }).catch(() => null),
    prisma.hermesMemoria.findUnique({ where: { tipo_chave: { tipo: 'viral', chave: 'playbook_diretor' } } }).catch(() => null),
  ])
  return [
    diretor?.conteudo ? `AVALIAÇÃO ESTRATÉGICA (diretor — palavras/frases que funcionam e que falham neste perfil):\n${diretor.conteudo}` : '',
    m?.conteudo ? `PADRÕES APRENDIDOS DOS DADOS:\n${m.conteudo}` : '',
  ].filter(Boolean).join('\n\n')
}

type Linha = {
  tipo: string; score: number; gancho: number | null; tema: string | null
  reach: number; sends: number; sendsRate: number; saves: number; savesRate: number; viral: number
  likes: number; coments: number; hora: number; dia: number; resumo: string; conteudo: string
}

/** Aprende (ou refina) o playbook a partir dos posts em camada B com resultado real. */
export async function aprenderPadroesVirais() {
  const scores = await prisma.bondViralScore.findMany({ where: { camada: 'B' } })
  if (scores.length < MIN_N) return { ok: false, erro: `Dados insuficientes para aprender (${scores.length}/${MIN_N} em camada B).` }

  const posts = await prisma.bondPost.findMany({ where: { postId: { in: scores.map((s) => s.postId) } } })
  const pBy = new Map(posts.map((p) => [p.postId, p]))
  const linhas: Linha[] = scores.flatMap((s) => {
    const p = pBy.get(s.postId)
    if (!p || !p.alcance) return []
    const sendsRate = +((p.compartilhos / p.alcance) * 100).toFixed(2)
    const savesRate = +((p.saves / p.alcance) * 100).toFixed(2)
    return [{
      tipo: p.tipo, score: s.scoreTotal, gancho: s.ganchoNota, tema: s.temaCasado,
      reach: p.alcance, sends: p.compartilhos, sendsRate, saves: p.saves, savesRate,
      viral: +(sendsRate * 0.6 + savesRate * 0.4).toFixed(2), // espelha os pesos do scorer (sends>saves)
      likes: p.likes, coments: p.comentarios,
      hora: new Date(p.publicadoEm).getHours(), dia: new Date(p.publicadoEm).getDay(),
      resumo: (s.conteudoResumo || '').replace(/\s+/g, ' ').slice(0, 220), conteudo: (p.conteudo || '').replace(/\s+/g, ' ').slice(0, 220),
    }]
  })
  if (linhas.length < MIN_N) return { ok: false, erro: `Poucos posts com alcance real (${linhas.length}). Rode o sync do Instagram.` }

  // sinal de viral = sends+saves por alcance (espelha o scorer). Ordena pelos que REALMENTE espalharam.
  const ord = [...linhas].sort((a, b) => b.viral - a.viral)
  const top = ord.slice(0, Math.min(8, Math.floor(ord.length / 2)))
  const baixo = ord.slice(-Math.min(8, Math.floor(ord.length / 2)))

  // meta-cognição: o score que demos prediz a viralidade real (sends+saves)?
  const calibr = correlacaoRank(linhas.map((l) => l.score), linhas.map((l) => l.viral))

  const fmt = (arr: Linha[]) => arr.map((l) => `• ${l.tipo} | viral=${l.viral}% (🔁${l.sends} 💾${l.saves} /alc${l.reach}) | score que demos=${l.score} | gancho=${l.gancho ?? '—'} | ${l.dia === 0 ? 'Dom' : ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][l.dia]} ${l.hora}h${l.tema ? ' | tema:' + l.tema : ''} | "${l.conteudo}" | IA viu: ${l.resumo}`).join('\n')

  const prompt = `Você é o cientista de dados de conteúdo do Dep. Jorge Felippe Neto (PL/RJ). Aprenda os PADRÕES REAIS DE VIRALIZAÇÃO DESTE PERFIL a partir dos dados abaixo. O sinal de viral é SENDS+SAVES por alcance (🔁 compartilhamentos + 💾 salvamentos, ponderados) — é o que faz o Instagram distribuir para não-seguidores.

POSTS QUE MAIS ESPALHARAM (alta viralidade real):
${fmt(top)}

POSTS QUE MENOS ESPALHARAM:
${fmt(baixo)}

CALIBRAÇÃO DO NOSSO SCORE: correlação (rank) entre o score que atribuímos e o sends/alcance real = ${calibr.toFixed(2)} (1=perfeito, 0=nenhuma, negativo=invertido). Base: ${linhas.length} posts.

Seja MINUCIOSO e ESPECÍFICO — sempre que possível CITE a palavra/frase/local real dos exemplos. Nada genérico. Responda em português do Brasil, sem markdown com asteriscos, EXATAMENTE neste formato:

GANCHOS E ABERTURAS QUE ESPALHAM
[padrões de abertura dos campeões — cite os ganchos reais; e os ganchos fracos dos que não espalharam]

PALAVRAS E FRASES QUE ESPALHAM vs QUE MATAM O SHARE
[liste palavras/expressões concretas dos campeões e dos fracos, citando-as]

TEMAS QUE CONVERTEM (e os que não)
[quais assuntos viram sends/saves neste perfil, e quais só dão like]

FORMATOS E HORÁRIOS
[reel vs carrossel vs foto: qual converte mais aqui; e os horários/dias que performam]

TIPOS DE CONTEÚDO/AÇÃO QUE GERAM SEND
[o "modo" que espalha — denúncia, dado, escuta de rua, identidade — com exemplo]

O QUE TRAVA A DIFUSÃO
[erros recorrentes dos fracos, com a causa]

AJUSTE DO MODELO (meta-cognição)
[com base na calibração ${calibr.toFixed(2)} sobre ${linhas.length} posts: o nosso score está super ou subestimando o quê? que sinal pesar mais/menos?]

REGRAS APRENDIDAS (8-10 regras diretas, específicas deste perfil, prontas para o próximo post)`

  const playbook = await callAI([{ role: 'user', content: prompt }], 2600)

  await lembrar('viral', 'playbook', playbook, 1.0)
  await lembrar('viral', 'playbook_meta', JSON.stringify({ n: linhas.length, calibracao: +calibr.toFixed(2), atualizadoEm: new Date().toISOString() }))
  await prisma.bondInsight.create({
    data: { titulo: `🧠 Hermes aprendeu com ${linhas.length} posts (calibração ${calibr.toFixed(2)})`, descricao: playbook, tipo: 'conteudo', plataforma: 'instagram' },
  })

  return { ok: true, n: linhas.length, calibracao: +calibr.toFixed(2), playbook }
}

// correlação de Spearman com tratamento de empates (Pearson sobre ranks médios).
function correlacaoRank(a: number[], b: number[]): number {
  const n = a.length
  if (n < 2) return 0
  const rank = (xs: number[]) => {
    const idx = xs.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v)
    const r = new Array<number>(xs.length)
    let k = 0
    while (k < idx.length) {
      let j = k
      while (j + 1 < idx.length && idx[j + 1].v === idx[k].v) j++
      const media = (k + j) / 2 + 1 // posições k..j (0-based) → rank médio 1-based
      for (let t = k; t <= j; t++) r[idx[t].i] = media
      k = j + 1
    }
    return r
  }
  const ra = rank(a), rb = rank(b)
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  const ma = mean(ra), mb = mean(rb)
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) { const x = ra[i] - ma, y = rb[i] - mb; num += x * y; da += x * x; db += y * y }
  return da && db ? num / Math.sqrt(da * db) : 0
}
