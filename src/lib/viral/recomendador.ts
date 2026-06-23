// RECOMENDADOR SEMANAL — fecha o loop de viralização.
//
// Junta: padrão dos posts próprios (melhores × piores, por BondViralScore) +
// tendências atuais + último benchmark de referências → recomenda os próximos
// posts. Grava BondRascunho (rascunho) + BondInsight e dá um ping no Telegram.
import { prisma } from '../db'
import { callAI } from '../hermes'
import { tendenciasParaPrompt } from './tendencias'
import { playbookAtual } from './aprendizado'

// Ping best-effort ao dono (não lança se falhar).
async function pingTelegram(texto: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chat = process.env.TELEGRAM_OWNER_ID
  if (!token || !chat) return
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: texto.slice(0, 3500) }),
    })
  } catch { /* best-effort */ }
}

/** Gera a recomendação da semana e a persiste. Roda no script semanal (após benchmark). */
export async function gerarRecomendacaoSemanal() {
  // posts próprios já pontuados, melhores e piores
  const scores = await prisma.bondViralScore.findMany({ orderBy: { scoreTotal: 'desc' }, take: 50 })
  const byId = new Map(scores.map((s) => [s.postId, s]))
  const posts = await prisma.bondPost.findMany({ where: { postId: { in: Array.from(byId.keys()) } }, select: { postId: true, conteudo: true, tipo: true } })
  const join = posts.map((p) => ({ ...p, score: byId.get(p.postId)! }))
  const melhores = join.filter((j) => j.score.scoreTotal > 0).sort((a, b) => b.score.scoreTotal - a.score.scoreTotal).slice(0, 5)
  const piores = [...join].sort((a, b) => a.score.scoreTotal - b.score.scoreTotal).slice(0, 5)

  const tendencias = await tendenciasParaPrompt(72)
  const benchmark = await prisma.bondInsight.findFirst({ where: { titulo: { startsWith: '🎯 Benchmark' } }, orderBy: { criadoEm: 'desc' } })
  const playbook = await playbookAtual()

  const fmt = (arr: typeof melhores) => arr.map((j) => `[${j.tipo} ${j.score.scoreTotal}/100] ${(j.conteudo || '').slice(0, 90)}${j.score.temaCasado ? ` (tema: ${j.score.temaCasado})` : ''}`).join('\n') || '(sem dados)'

  const prompt = `Você é o estrategista digital do Dep. Jorge Felippe Neto (PL/RJ). Use os dados REAIS abaixo para recomendar os PRÓXIMOS 3 posts que têm mais chance de viralizar, ligando viral à pauta de fiscalização/controle externo.

POSTS QUE MAIS PONTUARAM (camada A — conteúdo+engajamento):
${fmt(melhores)}

POSTS QUE MENOS PONTUARAM (evitar o padrão):
${fmt(piores)}

TENDÊNCIAS ATUAIS (BR/RJ — aproveite o que casar com a pauta):
${tendencias.slice(0, 1000)}

PADRÕES DE REFERÊNCIA (benchmark):
${(benchmark?.descricao || '(sem benchmark recente)').slice(0, 900)}
${playbook ? `\nPLAYBOOK APRENDIDO DESTE PERFIL (o que comprovadamente espalha aqui — priorize):\n${playbook.slice(0, 1100)}\n` : ''}

Responda em português, sem markdown com asteriscos, repetindo 3 vezes:

POST 1:
FORMATO: [Reel / Carrossel / Foto]
TEMA: [tema, casando com tendência quando possível]
GANCHO (1ºs 3s): [frase/abertura concreta]
TEXTO/LEGENDA: [pronto para usar]
HORÁRIO SUGERIDO: [dia + hora, Brasília]
POR QUE VAI VIRALIZAR: [1 frase ligando viral à pauta]

POST 2:
[mesmo formato]

POST 3:
[mesmo formato]

TÁTICA DE CRESCIMENTO DA SEMANA:
[escolha 1 tática de DISTRIBUIÇÃO/aquisição do playbook externo (ex.: Trial Reels para testar no não-seguidor, news-jacking factual no mesmo dia, colab/aparição em perfil maior, série recorrente nomeada) e diga EXATAMENTE como aplicar esta semana]`

  const recomendacao = await callAI([{ role: 'user', content: prompt }], 1400)

  await prisma.bondRascunho.create({
    data: {
      titulo: `Recomendações virais da semana — ${new Date().toLocaleDateString('pt-BR')}`,
      texto: recomendacao,
      plataformas: 'instagram',
      tipo: 'post',
      status: 'rascunho',
    },
  })
  await prisma.bondInsight.create({
    data: {
      titulo: `🚀 Recomendação da semana (${melhores.length} refs próprias)`,
      descricao: recomendacao.slice(0, 2000),
      tipo: 'sugestao',
      plataforma: 'instagram',
    },
  })
  await pingTelegram(`🚀 Hermes — Recomendações virais da semana prontas (3 posts no rascunho do PolitiMonitor):\n\n${recomendacao.slice(0, 1500)}`)

  return { ok: true, melhores: melhores.length, piores: piores.length }
}
