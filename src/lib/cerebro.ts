// SEGUNDO CÉREBRO do Hermes — conhecimento CURADO pelo Claude, READ-ONLY para o Hermes.
//
// Regra de ouro: o Hermes CONSULTA (e não esquece), mas NUNCA escreve nem sobrescreve nada do Claude.
// - Hermes lê: consultarCerebro() / cerebroParaPrompt() / ação 'consultar_cerebro'.
// - Só o Claude escreve: curarCerebro() (chamado por scripts/supervisão, contorna a guarda de lembrar()).
// - A guarda em hermes.ts:lembrar() bloqueia qualquer escrita do Hermes em tipo='cerebro'.
// Liga o aprendizado do Hermes (memória 'viral') com o conhecimento supervisionado do Claude.
import { prisma } from './db'

export type CartaoCerebro = { topico: string; conteudo: string; relevancia: number }

/** Consulta o segundo cérebro (READ-ONLY). Opcional: filtra por palavra no tópico/conteúdo. */
export async function consultarCerebro(busca?: string): Promise<CartaoCerebro[]> {
  const cards = await prisma.hermesMemoria.findMany({ where: { tipo: 'cerebro' }, orderBy: [{ relevancia: 'desc' }, { atualizadoEm: 'desc' }] })
  const f = (busca || '').toLowerCase().trim()
  const filtrados = f ? cards.filter((c) => c.chave.toLowerCase().includes(f) || c.conteudo.toLowerCase().includes(f)) : cards
  return filtrados.map((c) => ({ topico: c.chave, conteudo: c.conteudo, relevancia: c.relevancia }))
}

/** Texto compacto do cérebro para injetar em prompt (economia de token). */
export async function cerebroParaPrompt(busca?: string, max = 8): Promise<string> {
  const cards = (await consultarCerebro(busca)).slice(0, max)
  if (!cards.length) return ''
  return cards.map((c) => `[${c.topico}]\n${c.conteudo}`).join('\n\n')
}

/** CURADORIA SUPERVISIONADA (só Claude/scripts) — escreve qualquer chave, contornando a guarda do lembrar().
 *  É o canal pelo qual o Claude revisa o que o Hermes aprendeu e PROMOVE ao conhecimento permanente. */
export async function curar(tipo: string, chave: string, conteudo: string, relevancia = 1.0) {
  await prisma.hermesMemoria.upsert({
    where: { tipo_chave: { tipo, chave } },
    update: { conteudo, relevancia, atualizadoEm: new Date() },
    create: { tipo, chave, conteudo, relevancia },
  })
}

/** Atalho: cura um cartão do segundo cérebro (tipo='cerebro'). */
export const curarCerebro = (topico: string, conteudo: string, relevancia = 1.0) => curar('cerebro', topico, conteudo, relevancia)
