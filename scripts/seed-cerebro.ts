// Semeia/cura o SEGUNDO CÉREBRO do Hermes (conhecimento supervisionado pelo Claude, read-only p/ Hermes).
// Idempotente (upsert por tópico). Rode quando quiser atualizar a curadoria: npx tsx scripts/seed-cerebro.ts
import { curarCerebro } from '../src/lib/cerebro'
import { prisma } from '../src/lib/db'

const CARDS: [string, string, number][] = [
  ['honestidade', 'Indício não é acusação. INDISPONÍVEL ≠ 0. Nunca inventar número. CPF mascarado. Toda afirmação forte precisa de fonte verificável. Vale para conteúdo, denúncia e análise.', 1.0],
  ['viral-lei-do-perfil', 'SEND = "isto sou EU, meu grupo precisa ver" (identidade + emoção de alta ativação). SAVE = "vou precisar depois" (valor prático). Like é morto. NESTE perfil: saturados (muito uso, pouco retorno) = unidade/tribo, frase-bandeira, indignação genérica. SUBUSADOS de alto potencial = INIMIGO COMUM institucional (+67% share), AWE/número de choque, URGÊNCIA. Combo-ouro: custo de vida + desperdício/corrupção do dinheiro público.', 1.0],
  ['guarda-etica-viral', 'Indignação SEMPRE ancorada em fato verificável (documento/processo/dado público). Inimigo = conduta/sistema/abuso, NUNCA grupo identitário vulnerável. Nunca afirmar o não-checado: desinformação explora a indignação e expõe o mandato. Dosar: indignação p/ send, valor prático p/ save, awe p/ arejar.', 1.0],
  ['ecossistema-jedi', 'PolitiMonitor (Hermes viral: analisa/aprende/recomenda posts IG) + JFN (fiscalização: Yoda, Lex=pareceres, compliance, sweeps SEI/SIAFE, RAG Lei 14.133) + vault Obsidian (segundo cérebro do Claude). Hermes roda em modelo grátis na VM (2 vCPU — não crashar).', 0.8],
  ['como-operamos-juntos', 'Claude e Hermes operam em conjunto, um dando inteligência ao outro. Hermes APRENDE dos dados reais (sends/saves) e escreve só a memória dele (viral/playbook). Claude SUPERVISIONA: revisa o que o Hermes aprendeu e PROMOVE o validado ao segundo cérebro (curar). Hermes CONSULTA o cérebro (read-only) e nunca o sobrescreve. A guarda em lembrar() bloqueia escrita do Hermes em conhecimento supervisionado.', 0.9],
]

;(async () => {
  for (const [topico, conteudo, rel] of CARDS) await curarCerebro(topico, conteudo, rel)
  const n = await prisma.hermesMemoria.count({ where: { tipo: 'cerebro' } })
  console.log(`[seed-cerebro] ${CARDS.length} cartões curados. Total no cérebro: ${n}`)
  await prisma.$disconnect()
  process.exit(0)
})().catch((e) => { console.error('erro:', e instanceof Error ? e.message : e); process.exit(1) })
