// RELATÓRIOS DE ANÁLISE — semanal, mensal e por post.
//
// Junta os posts do período com seus BondViralScore (diagnóstico + o que a IA viu +
// métricas reais) e gera um relatório em PROSA (sumário, post a post, acertos, erros,
// conclusões e recomendações). Persiste em BondRelatorio. Texto via callAI (grátis).
import { prisma } from '../db'
import { callAI } from '../hermes'
import { playbookAtual } from './aprendizado'

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const fmtData = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`

function janela(tipo: 'semana' | 'mes') {
  const ate = new Date()
  const de = new Date(ate)
  de.setDate(de.getDate() - (tipo === 'semana' ? 7 : 30))
  return { de, ate, rotulo: `${fmtData(de)} a ${fmtData(ate)}` }
}

type PostScore = {
  postId: string; conteudo: string; tipo: string; url: string | null; publicadoEm: Date
  likes: number; comentarios: number; compartilhos: number; alcance: number
  score: number | null; camada: string | null; gancho: number | null; tema: string | null
  diagnostico: string | null; resumo: string | null
}

async function coletar(de: Date, ate: Date): Promise<PostScore[]> {
  const posts = await prisma.bondPost.findMany({
    where: { plataforma: 'instagram', publicadoEm: { gte: de, lte: ate } },
    orderBy: { publicadoEm: 'desc' },
  })
  const scores = await prisma.bondViralScore.findMany({ where: { postId: { in: posts.map((p) => p.postId) } } })
  const sBy = new Map(scores.map((s) => [s.postId, s]))
  return posts.map((p) => {
    const s = sBy.get(p.postId)
    return {
      postId: p.postId, conteudo: p.conteudo, tipo: p.tipo, url: p.url, publicadoEm: p.publicadoEm,
      likes: p.likes, comentarios: p.comentarios, compartilhos: p.compartilhos, alcance: p.alcance,
      score: s?.scoreTotal ?? null, camada: s?.camada ?? null, gancho: s?.ganchoNota ?? null,
      tema: s?.temaCasado ?? null, diagnostico: s?.diagnostico ?? null, resumo: s?.conteudoResumo ?? null,
    }
  })
}

function estatisticas(ps: PostScore[]) {
  const comScore = ps.filter((p) => p.score != null)
  const n = ps.length
  const media = comScore.length ? Math.round(comScore.reduce((s, p) => s + (p.score || 0), 0) / comScore.length) : 0
  const ordenados = [...comScore].sort((a, b) => (b.score || 0) - (a.score || 0))
  const formatos: Record<string, number> = {}
  ps.forEach((p) => { formatos[p.tipo] = (formatos[p.tipo] || 0) + 1 })
  return {
    n, media, camadaB: comScore.filter((p) => p.camada === 'B').length,
    melhores: ordenados.slice(0, 3), piores: ordenados.slice(-3).reverse(),
    totalLikes: ps.reduce((s, p) => s + p.likes, 0),
    totalComents: ps.reduce((s, p) => s + p.comentarios, 0),
    totalSends: ps.reduce((s, p) => s + p.compartilhos, 0),
    alcanceTotal: ps.reduce((s, p) => s + p.alcance, 0),
    formatos, comTema: ps.filter((p) => p.tema).length,
  }
}

const linhaPost = (p: PostScore) =>
  `• [${p.tipo} ${p.score ?? '—'}/100${p.camada ? ' cam' + p.camada : ''}] ${fmtData(p.publicadoEm)} ${DIAS[p.publicadoEm.getDay()]} | ❤${p.likes} 💬${p.comentarios} 🔁${p.compartilhos}${p.alcance ? ' alc' + p.alcance : ''}${p.tema ? ' 🔥' + p.tema : ''}\n  legenda: ${(p.conteudo || '').slice(0, 90)}\n  diagnóstico: ${(p.diagnostico || '—').slice(0, 220)}`

/** Gera relatório de período (semana|mes) ou de um post. Persiste e retorna BondRelatorio. */
export async function gerarRelatorio(tipo: 'semana' | 'mes' | 'post', ref?: string) {
  if (tipo === 'post') return gerarRelatorioPost(ref || '')

  const { de, ate, rotulo } = janela(tipo)
  const ps = await coletar(de, ate)
  if (!ps.length) return { ok: false, erro: `Sem posts no período (${rotulo}).` }
  const st = estatisticas(ps)

  const corpo = ps.map(linhaPost).join('\n')
  const prompt = `Você é o estrategista de conteúdo do Dep. Jorge Felippe Neto (PL/RJ, Deputado Estadual — pauta de fiscalização/controle externo). Escreva um RELATÓRIO DE ANÁLISE ${tipo === 'semana' ? 'SEMANAL' : 'MENSAL'} dos posts do Instagram (período ${rotulo}), completo e em prosa profissional, honesto e específico.

NÚMEROS DO PERÍODO:
- Posts: ${st.n} | analisados: ${st.camadaB} em camada B (insights reais), demais em camada A
- Score médio de viralização: ${st.media}/100
- Totais: ❤${st.totalLikes} curtidas · 💬${st.totalComents} comentários · 🔁${st.totalSends} compartilhamentos${st.alcanceTotal ? ` · alcance ${st.alcanceTotal}` : ''}
- Formatos: ${Object.entries(st.formatos).map(([k, v]) => `${k}:${v}`).join(', ')} | posts no tema do momento: ${st.comTema}

POSTS DO PERÍODO (com diagnóstico individual):
${corpo.slice(0, 6000)}

Escreva em português do Brasil, sem markdown com asteriscos, nesta estrutura:

SUMÁRIO EXECUTIVO
[3-4 frases: como foi o período em viralização e engajamento, o veredito geral honesto]

ANÁLISE POST A POST
[para cada post relevante do período, 1-2 frases de consideração: o que funcionou ou não e por quê — cite a métrica/o que a IA viu]

ONDE VOCÊ ESTÁ ACERTANDO
[padrões concretos dos posts que performaram melhor — formato, tema, gancho, horário]

ONDE VOCÊ ESTÁ ERRANDO
[padrões dos posts fracos — erros recorrentes, com a causa]

CONCLUSÕES E PRÓXIMOS PASSOS
[conclusão em prosa + 3-4 recomendações práticas e específicas para o próximo período]`

  const prosa = await callAI([{ role: 'user', content: prompt }], 2600)

  const rel = await prisma.bondRelatorio.create({
    data: {
      tipo, periodo: rotulo,
      titulo: `Relatório ${tipo === 'semana' ? 'semanal' : 'mensal'} — ${rotulo}`,
      prosa,
      dados: JSON.stringify({ stats: { ...st, melhores: undefined, piores: undefined }, posts: ps.map((p) => ({ postId: p.postId, tipo: p.tipo, score: p.score, camada: p.camada, likes: p.likes, comentarios: p.comentarios, compartilhos: p.compartilhos, alcance: p.alcance, tema: p.tema, conteudo: (p.conteudo || '').slice(0, 120), url: p.url, diagnostico: p.diagnostico, data: p.publicadoEm })) }),
    },
  })
  return { ok: true, id: rel.id, titulo: rel.titulo }
}

/** Relatório completo de UM post (deep-dive com o que a IA viu + conclusão em prosa). */
async function gerarRelatorioPost(postId: string) {
  const post = await prisma.bondPost.findFirst({ where: { postId } })
  if (!post) return { ok: false, erro: 'post não encontrado' }
  const s = await prisma.bondViralScore.findUnique({ where: { postId } })

  const playbook = await playbookAtual()
  const sr = post.alcance ? ((post.compartilhos / post.alcance) * 100).toFixed(2) : null
  const prompt = `Você é o DIRETOR de conteúdo do Dep. Jorge Felippe Neto (PL/RJ, pauta de fiscalização/controle externo). Faça uma AUTÓPSIA PROFUNDA E ESPECÍFICA deste post — encontre EXATAMENTE onde ele acerta e onde erra, dimensão por dimensão. Nada genérico: CITE palavras e frases reais da legenda e do que a IA viu. Português do Brasil, sem markdown com asteriscos.

DADOS:
- Formato ${post.tipo} | publicado ${post.publicadoEm.toLocaleString('pt-BR')} (${DIAS[post.publicadoEm.getDay()]})
- Métricas: ❤${post.likes} 💬${post.comentarios} 🔁${post.compartilhos}${post.alcance ? ` | alcance ${post.alcance}${sr ? ` | sends/alcance ${sr}% (o sinal real de viral)` : ''}` : ''}
- Score ${s?.scoreTotal ?? '—'}/100 (camada ${s?.camada ?? '—'}) | gancho ${s?.ganchoNota ?? '—'}/10${s?.temaCasado ? ` | tema em alta: ${s.temaCasado}` : ''}
- LEGENDA COMPLETA: "${(post.conteudo || '').slice(0, 700)}"

O QUE A IA VIU NA MÍDIA (frame a frame + áudio):
${(s?.conteudoResumo || '(sem análise de mídia)').slice(0, 1800)}
${playbook ? `\nRÉGUA — O QUE JÁ SABEMOS QUE FUNCIONA NESTE PERFIL:\n${playbook.slice(0, 1500)}\n` : ''}
Responda EXATAMENTE nesta estrutura. Em CADA dimensão: VEREDITO + o ERRO específico (citando a palavra/frase) + a CORREÇÃO concreta.

GANCHO (primeiros 3 segundos / 1a imagem)
COPY E LEGENDA — PALAVRAS E FRASES
[liste as frases que AJUDARAM e as que ATRAPALHARAM, citando-as; a abertura é "send-worthy" ou só "like-bait"? reescreva a 1a linha]
VISUAL E QUALIDADE
RITMO, EDICAO E DURACAO
CTA E CONVITE AO COMPARTILHAMENTO
TEMA E TIMING
FIT COM O PUBLICO
[a lei do perfil: send = identificação (dor/indignação/identidade), NÃO currículo nem intimidade. Este post é compartilhável? por quê (não)?]
DRIVERS DO SCORE
[o que puxou e o que derrubou o score]
VEREDITO E 3 ACOES PARA O PROXIMO
[conclusão direta + 3 ações específicas e aplicáveis]`

  const prosa = await callAI([{ role: 'user', content: prompt }], 2300)
  const rel = await prisma.bondRelatorio.create({
    data: {
      tipo: 'post', periodo: postId,
      titulo: `Relatório do post — ${post.tipo} de ${fmtData(post.publicadoEm)}`,
      prosa,
      dados: JSON.stringify({ postId, score: s?.scoreTotal, camada: s?.camada, url: post.url }),
    },
  })
  return { ok: true, id: rel.id, titulo: rel.titulo }
}
