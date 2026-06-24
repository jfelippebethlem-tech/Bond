import { prisma } from './db'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { capturarTendencias, topTendencias } from './viral/tendencias'
import { playbookAtual } from './viral/aprendizado'
import { cerebroParaPrompt } from './cerebro'

async function campanhaAI(prompt: string, maxTokens = 1200): Promise<string> {
  if (!process.env.GEMINI_API_KEY) return 'Configure GEMINI_API_KEY.'
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: `Você é um estrategista digital especialista em campanhas eleitorais brasileiras.
Analisa dados reais de redes sociais para dar diagnósticos precisos e acionáveis.
Seja direto, use números quando disponíveis, e foque em ações práticas.
Responda SEMPRE em português do Brasil. Nunca use markdown com asteriscos.`,
    // thinkingBudget 0 → o Gemini 2.5 Flash NÃO gasta o orçamento de saída "pensando"
    // (sem isso, o thinking consumia maxOutputTokens e a resposta vinha truncada).
    generationConfig: { maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } } as { maxOutputTokens: number },
  })
  const result = await model.generateContent(prompt)
  return result.response.text() ?? ''
}

// Score de potencial viral de um post (0-100), camada-A (só métricas públicas, sem insights).
// NÃO delega ao pontuarViral canônico de propósito: aquele exige sinais camada-B (sends/saves)
// que este contexto de diagnóstico não tem — delegar zeraria todos os scores. Ver MOC-melhorias
// Fase 1.2: unificar exige primeiro um modo camada-A no scorer canônico.
function calcularPotencialViral(likes: number, comentarios: number, compartilhos: number, impressoes: number): number {
  if (!impressoes) return 0
  // Compartilhos têm peso triplo no viral — são o maior multiplicador de alcance
  const viralScore = (compartilhos * 3 + comentarios * 2 + likes) / impressoes * 100
  return Math.min(100, Math.round(viralScore * 10))
}

// Analisa qual horário/dia tende a gerar mais engajamento
export async function analisarMelhoresHorarios() {
  const posts = await prisma.bondPost.findMany({
    where: { impressoes: { gt: 0 } },
    select: { publicadoEm: true, likes: true, comentarios: true, compartilhos: true, impressoes: true, plataforma: true },
  })

  if (posts.length < 3) return null

  const porHora: Record<number, { total: number; count: number }> = {}
  const porDia: Record<number, { total: number; count: number }> = {}

  for (const p of posts) {
    const d = new Date(p.publicadoEm)
    const hora = d.getHours()
    const dia = d.getDay() // 0=Dom, 6=Sáb
    const eng = ((p.likes + p.comentarios + p.compartilhos) / p.impressoes) * 100

    porHora[hora] = porHora[hora] ?? { total: 0, count: 0 }
    porHora[hora].total += eng
    porHora[hora].count++

    porDia[dia] = porDia[dia] ?? { total: 0, count: 0 }
    porDia[dia].total += eng
    porDia[dia].count++
  }

  const topHoras = Object.entries(porHora)
    .map(([h, v]) => ({ hora: parseInt(h), mediaEng: v.total / v.count }))
    .sort((a, b) => b.mediaEng - a.mediaEng)
    .slice(0, 3)

  const diasNome = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
  const topDias = Object.entries(porDia)
    .map(([d, v]) => ({ dia: diasNome[parseInt(d)], mediaEng: v.total / v.count }))
    .sort((a, b) => b.mediaEng - a.mediaEng)
    .slice(0, 3)

  return { topHoras, topDias }
}

// Analisa padrões de conteúdo — o que funciona vs. o que não funciona
export async function analisarPadroesCampanha() {
  const [posts, totalFas, totalApoiadores] = await Promise.all([
    prisma.bondPost.findMany({
      orderBy: { publicadoEm: 'desc' },
      take: 30,
      include: { perfil: true },
    }),
    prisma.bondFa.count(),
    prisma.pessoa.count({ where: { tipo: { in: ['apoiador', 'cabo_eleitoral', 'coordenador'] }, ativo: true } }),
  ])

  if (!posts.length) return null

  // Calcula potencial viral de cada post
  const postsComScore = posts.map(p => ({
    ...p,
    potencialViral: calcularPotencialViral(p.likes, p.comentarios, p.compartilhos, p.impressoes),
    score: p.likes + p.comentarios * 2 + p.compartilhos * 3,
  }))

  const topPosts = [...postsComScore].sort((a, b) => b.score - a.score).slice(0, 5)
  const flopPosts = [...postsComScore].sort((a, b) => a.score - b.score).slice(0, 3)
  const viralPotential = [...postsComScore].sort((a, b) => b.potencialViral - a.potencialViral).slice(0, 3)

  const totalLikes = posts.reduce((s, p) => s + p.likes, 0)
  const totalComents = posts.reduce((s, p) => s + p.comentarios, 0)
  const totalShares = posts.reduce((s, p) => s + p.compartilhos, 0)
  const mediaEng = posts.reduce((s, p) => s + p.engajamento, 0) / posts.length

  const analise = await campanhaAI(`Você é o estrategista digital do Dep. Jorge Felippe Neto (PL/RJ, Deputado Estadual).
Analise os dados abaixo e gere um diagnóstico COMPLETO e HONESTO da campanha nas redes sociais.

DADOS DOS ÚLTIMOS 30 POSTS:
- Total de posts analisados: ${posts.length}
- Total curtidas acumuladas: ${totalLikes}
- Total comentários: ${totalComents}
- Total compartilhos: ${totalShares}
- Taxa de engajamento média: ${mediaEng.toFixed(2)}%
- Apoiadores mapeados (BondFas): ${totalFas}
- Apoiadores cadastrados: ${totalApoiadores}

TOP 5 POSTS (mais engajamento):
${topPosts.map((p, i) => `${i + 1}. [${p.plataforma}] ${p.conteudo.slice(0, 120)} | ❤${p.likes} 💬${p.comentarios} 🔁${p.compartilhos} | Potencial viral: ${p.potencialViral}/100`).join('\n')}

3 POSTS COM PIOR DESEMPENHO:
${flopPosts.map((p, i) => `${i + 1}. [${p.plataforma}] ${p.conteudo.slice(0, 100)} | ❤${p.likes} 💬${p.comentarios} 🔁${p.compartilhos}`).join('\n')}

POSTS COM MAIOR POTENCIAL VIRAL (ainda não explorados):
${viralPotential.map((p, i) => `${i + 1}. [${p.plataforma}] ${p.conteudo.slice(0, 100)} | Score viral: ${p.potencialViral}/100`).join('\n')}

RESPONDA EXATAMENTE NESTE FORMATO (sem asteriscos, sem markdown):

DIAGNÓSTICO GERAL:
[2-3 frases honestas sobre a situação atual da campanha nas redes — o que está bom e o que está ruim]

ONDE ESTÁ ERRANDO:
- Erro 1: [nome do problema] — [explicação com dados]
- Erro 2: [nome do problema] — [explicação com dados]
- Erro 3: [nome do problema] — [explicação com dados]

O QUE ESTÁ FUNCIONANDO:
- Acerto 1: [o que está gerando resultado e por quê]
- Acerto 2: [o que está gerando resultado e por quê]

PADRÃO DO CONTEÚDO VIRAL (baseado nos top posts):
[2 frases descrevendo o que os posts mais engajados têm em comum — tema, tom, formato]

AÇÕES IMEDIATAS (próximos 7 dias):
- Ação 1: [ação específica e prática]
- Ação 2: [ação específica e prática]
- Ação 3: [ação específica e prática]

META SUGERIDA PARA 30 DIAS:
[Um objetivo concreto e mensurável para melhorar o engajamento]`, 1400)

  await prisma.bondInsight.create({
    data: {
      titulo: `Análise de Campanha — ${new Date().toLocaleDateString('pt-BR')}`,
      descricao: analise,
      tipo: 'performance',
    },
  })

  return {
    analise,
    stats: { totalLikes, totalComents, totalShares, mediaEng, totalFas, totalApoiadores },
    topPosts: topPosts.map(p => ({ id: p.id, plataforma: p.plataforma, conteudo: p.conteudo.slice(0, 150), likes: p.likes, comentarios: p.comentarios, compartilhos: p.compartilhos, potencialViral: p.potencialViral, score: p.score })),
    flopPosts: flopPosts.map(p => ({ id: p.id, plataforma: p.plataforma, conteudo: p.conteudo.slice(0, 150), likes: p.likes, comentarios: p.comentarios, compartilhos: p.compartilhos })),
    viralPotential: viralPotential.map(p => ({ id: p.id, plataforma: p.plataforma, conteudo: p.conteudo.slice(0, 150), potencialViral: p.potencialViral })),
  }
}

// Gerador de ATIVAÇÕES DE RUA virais — criativo, colado no que o RJ/BR fala AGORA
// (Google Trends + Notícias ao vivo) e na lei de viralização do próprio perfil.
export async function sugerirConteudoViral(tema?: string) {
  // 1) tendências FRESCAS do Google (RJ + BR) — o que está mais falado agora, por métrica de busca
  await capturarTendencias().catch(() => {})
  const [trends, playbook, topPosts, horarios, arquetipos, formatos, atomos] = await Promise.all([
    topTendencias(22, 72),
    playbookAtual(),
    prisma.bondPost.findMany({ where: { plataforma: 'instagram' }, orderBy: { compartilhos: 'desc' }, take: 5 }),
    analisarMelhoresHorarios(),
    cerebroParaPrompt('gancho', 2), // arquétipos de gancho do segundo cérebro (curado pelo Claude)
    cerebroParaPrompt('formato', 1), // matriz de 8 formatos — varia o ângulo das 4 ideias
    cerebroParaPrompt('átomo', 1), // content-atoms: 1 fato → N peças (carrossel/Reel/thread)
  ])

  const trendsTxt = trends.length
    ? trends.map((t) => `- ${t.termo}${t.rankOuScore ? ` (~${t.rankOuScore} buscas)` : ''} [${t.fonte === 'google_trends' ? 'Trends' : 'Notícia'}/${t.geo}]`).join('\n')
    : '(sem tendências capturadas — rode o sensor)'

  const prompt = `Você é o DIRETOR DE CRIAÇÃO e estrategista de RUA do Dep. Jorge Felippe Neto (PL/RJ — fiscalização/controle externo, base na Zona Oeste do Rio). Crie 4 IDEIAS DE CONTEÚDO VIRAL ousadas, ORIGINAIS e ACIONÁVEIS${tema ? ` sobre "${tema}"` : ''} — cada uma ancorada numa AÇÃO/ATIVAÇÃO NA RUA concreta (algo que ele FAZ no mundo real e vira vídeo), pegando carona no que o Rio e o Brasil estão falando AGORA.

O QUE ESTÁ MAIS FALADO AGORA (Google Trends + Notícias, RJ e BR — use de verdade):
${trendsTxt}

A LEI DE VIRALIZAÇÃO DESTE PERFIL (o que comprovadamente ESPALHA aqui — respeite):
${playbook ? playbook.slice(0, 1500) : 'send = dor econômica + indignação com vilão nomeado + identidade da Zona Oeste. NÃO currículo de entregas, NÃO intimidade/família. Abertura = 1 emoji + manchete em CAIXA.'}

POSTS QUE MAIS ESPALHARAM (tom de referência):
${topPosts.map((p) => `- 🔁${p.compartilhos} "${(p.conteudo || '').slice(0, 90)}"`).join('\n') || '(sem histórico)'}
MELHOR HORÁRIO: ${horarios ? `${horarios.topHoras.map((h) => h.hora + 'h').join(', ')} | ${horarios.topDias.map((d) => d.dia).join(', ')}` : 'terça a quinta, 12h e 19h'}
${arquetipos ? '\n' + arquetipos + '\n' : ''}${formatos ? '\n' + formatos + '\n' : ''}${atomos ? '\n' + atomos + '\n' : ''}

Regras de criação:
- A AÇÃO DE RUA é o coração. Seja CRIATIVO e CORAJOSO: stunts, provas visuais, confronto com o problema real (preço da cesta no mercado, fila do hospital, buraco/abandono na ZO, transporte). Nada de "grave um vídeo falando sobre" — proponha um GESTO concreto, num LOCAL concreto.
- Conecte SEMPRE a ação com uma das tendências/notícias da lista (cite qual).
- Otimize para SEND (compartilhamento): a ideia tem que dar ao eleitor uma arma de expressão (identificação/indignação), não ser autoelogio.

Responda em português do Brasil, sem markdown com asteriscos, repetindo 4 vezes:

IDEIA 1: [título curto e forte]
AÇÃO/ATIVAÇÃO NA RUA: [o gesto concreto + local específico no RJ/Zona Oeste]
PEGA CARONA EM: [qual tendência/notícia atual da lista, e por quê]
FORMATO: [Reel / Carrossel]
GANCHO (3s): [a frase/imagem de abertura exata]
LEGENDA: [texto pronto para postar, no tom que espalha]
HORÁRIO: [dia + hora]
POR QUE VIRALIZA: [1 frase ligando à lei do perfil — por que vão COMPARTILHAR]

IDEIA 2:
[mesmo formato]

IDEIA 3:
[mesmo formato]

IDEIA 4:
[mesmo formato]`

  return campanhaAI(prompt, 2000)
}

// Calendário da SEMANA (7 dias × 3 ativações de rua prontas), colado nos trends ao vivo.
// Gera DIA A DIA (uma chamada por dia) para sair completo e detalhado — sem truncar.
const DIAS_SEMANA = [
  { dia: 'SEGUNDA', angulo: 'DOR ECONÔMICA — custo de vida pesando no bolso da Zona Oeste' },
  { dia: 'TERÇA', angulo: 'IDENTIDADE ZONA OESTE — pertencimento e abandono do poder público' },
  { dia: 'QUARTA', angulo: 'INDIGNAÇÃO COM VILÃO NOMEADO + DADO — segurança/fiscalização (seu melhor dia)' },
  { dia: 'QUINTA', angulo: 'FUI ÀS RUAS / OUVI O POVO — escuta real com moradores' },
  { dia: 'SEXTA', angulo: 'ENTREGA REEMBALADA COMO BRIGA — conquista + próximo alvo (nunca currículo)' },
  { dia: 'SÁBADO', angulo: 'NEWS-JACKING — o assunto que mais bombou na semana cruzado com sua pauta' },
  { dia: 'DOMINGO', angulo: 'RESUMO DA SEMANA — o que está em jogo no Rio, chamada de comunidade' },
]

export async function gerarCalendarioSemanal() {
  await capturarTendencias().catch(() => {})
  const [trends, playbook, topPosts, horarios] = await Promise.all([
    topTendencias(22, 72),
    playbookAtual(),
    prisma.bondPost.findMany({ where: { plataforma: 'instagram' }, orderBy: { compartilhos: 'desc' }, take: 5 }),
    analisarMelhoresHorarios(),
  ])
  const trendsTxt = trends.length
    ? trends.map((t) => `- ${t.termo}${t.rankOuScore ? ` (~${t.rankOuScore} buscas)` : ''} [${t.fonte === 'google_trends' ? 'Trends' : 'Notícia'}/${t.geo}]`).join('\n')
    : '(sem tendências capturadas)'
  const horarioTxt = horarios ? `${horarios.topHoras.map((h) => h.hora + 'h').join(', ')} (melhores: ${horarios.topDias.map((d) => d.dia).join(', ')})` : 'ter-qui, 12h e 19h'
  const tomTxt = topPosts.map((p) => `🔁${p.compartilhos} "${(p.conteudo || '').slice(0, 80)}"`).join(' | ') || '(sem histórico)'

  const contexto = `CONTEXTO (use de verdade):
TENDÊNCIAS AGORA (Google Trends + Notícias RJ/BR):
${trendsTxt}
LEI DE VIRALIZAÇÃO DESTE PERFIL (otimize p/ SEND, não like):
${playbook ? playbook.slice(0, 1300) : 'send = dor econômica + indignação com vilão nomeado + identidade Zona Oeste. NÃO currículo, NÃO família. Abertura = emoji + manchete em CAIXA.'}
TOM (posts que mais espalharam): ${tomTxt}
HORÁRIOS BONS: ${horarioTxt}`

  const dias = await Promise.all(
    DIAS_SEMANA.map(async ({ dia, angulo }) => {
      const prompt = `Você é o DIRETOR DE CRIAÇÃO e estrategista de RUA do Dep. Jorge Felippe Neto (PL/RJ — fiscalização, base na Zona Oeste do Rio).
${contexto}

Monte os 3 CONTEÚDOS PRONTOS de ${dia} desta semana de campanha. Ângulo-âncora do dia: ${angulo}.
Cada conteúdo é ancorado numa AÇÃO/ATIVAÇÃO NA RUA concreta, original e específica (local real do RJ/Zona Oeste), pegando carona numa tendência da lista. Otimize para SEND (dar ao eleitor uma arma de expressão), nunca autoelogio. Varie os 3 ganchos.

Responda em português, sem markdown com asteriscos, EXATAMENTE neste formato:
=== ${dia} — [tema-âncora curto] ===
1) FORMATO: [Reel/Carrossel] | HORÁRIO: [hora]
   AÇÃO DE RUA: [gesto concreto + local específico no RJ/ZO]
   PEGA CARONA EM: [qual tendência/notícia da lista]
   GANCHO (3s): [abertura exata, emoji + CAIXA]
   LEGENDA: [pronta para postar]
   POR QUE VIRALIZA: [1 frase — por que vão COMPARTILHAR]
2) [mesmo formato]
3) [mesmo formato]`
      return campanhaAI(prompt, 1500)
    })
  )
  return dias.join('\n\n')
}

// Busca últimos insights de campanha
export async function buscarInsightsCampanha() {
  return prisma.bondInsight.findMany({
    where: { tipo: 'performance' },
    orderBy: { criadoEm: 'desc' },
    take: 10,
  })
}
