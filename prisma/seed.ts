import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Iniciando seed do PolitiMonitor...\n')

  // ── Configurações do Deputado ─────────────────────────────────────────────

  const configs = [
    { chave: 'deputado_nome',      valor: 'Jorge Felippe Neto' },
    { chave: 'deputado_partido',   valor: 'PL' },
    { chave: 'deputado_estado',    valor: 'RJ' },
    { chave: 'deputado_mandato',   valor: 'Deputado Estadual — ALERJ' },
    { chave: 'deputado_instagram', valor: 'depjorgefelippeneto' },
    { chave: 'deputado_facebook',  valor: 'jfelippeneto' },
    { chave: 'deputado_website',   valor: 'jorgefelippeneto.com.br' },
  ]

  for (const c of configs) {
    await prisma.configuracao.upsert({
      where: { chave: c.chave },
      update: { valor: c.valor },
      create: c,
    })
  }
  console.log('✅ Configurações do deputado salvas')

  // ── Palavras-chave para monitoramento ─────────────────────────────────────

  const palavras = [
    'Jorge Felippe Neto',
    'depjorgefelippeneto',
    'ALERJ',
    'Zona Oeste',
    'Padre Miguel',
    'PL Rio de Janeiro',
    'deputado estadual RJ',
    'meio ambiente Rio',
    'regularização fundiária',
    'saúde pública RJ',
    'direitos humanos ALERJ',
    'defesa animal',
    'Jorge Felippe vereador',
  ]

  for (const palavra of palavras) {
    await prisma.palavraChave.upsert({
      where: { palavra },
      update: {},
      create: { palavra },
    })
  }
  console.log('✅ Palavras-chave salvas')

  // ── Memória do Hermes — Perfil Completo do Deputado ───────────────────────

  const memorias = [
    {
      tipo: 'padrao',
      chave: 'deputado_identidade',
      conteudo: `O deputado se chama Jorge Felippe Neto. É Deputado Estadual pelo Rio de Janeiro (ALERJ), filiado ao Partido Liberal (PL). Está em seu terceiro mandato consecutivo, eleito desde 2014. Nasceu em 8 de janeiro de 1992, em Padre Miguel, Zona Oeste do Rio de Janeiro. Tem 33 anos. É advogado de formação.`,
      relevancia: 1.0,
    },
    {
      tipo: 'padrao',
      chave: 'deputado_familia',
      conteudo: `Jorge Felippe Neto é pai de dois filhos: Jorginho e Helena. É filho de Vanessa Felippe. Seu avô é o vereador Jorge Felippe, presidente da Câmara Municipal do Rio de Janeiro — uma das figuras políticas mais influentes da Zona Oeste. Jorge Felippe Neto cresceu acompanhando o trabalho político do avô desde criança.`,
      relevancia: 1.0,
    },
    {
      tipo: 'padrao',
      chave: 'deputado_trajetoria',
      conteudo: `Primeira eleição em 2014 pelo PSD com 32.066 votos. Reeleito em 2018 e 2022. Passou pelos partidos PSD, Avante e hoje está no PL. Representa fortemente a Zona Oeste do Rio de Janeiro, região onde nasceu e cresceu (Padre Miguel). Seu eleitorado é predominantemente da Zona Oeste carioca.`,
      relevancia: 1.0,
    },
    {
      tipo: 'padrao',
      chave: 'deputado_comissoes',
      conteudo: `Jorge Felippe Neto é presidente da Comissão de Defesa do Meio Ambiente na ALERJ. Também integra as comissões de: Saúde, Regularização Fundiária, Defesa Animal, e Defesa dos Direitos Humanos e Cidadania. Tem atuação destacada nas pautas ambientais e de saúde pública.`,
      relevancia: 1.0,
    },
    {
      tipo: 'padrao',
      chave: 'deputado_redes_sociais',
      conteudo: `Perfis sociais do deputado: Instagram @depjorgefelippeneto (conta oficial, ~24 mil seguidores), Facebook: facebook.com/jfelippeneto, Site: jorgefelippeneto.com.br. O usuário também mencionou o handle @jorgefelippeneto como seu Instagram pessoal.`,
      relevancia: 1.0,
    },
    {
      tipo: 'padrao',
      chave: 'deputado_estilo_comunicacao',
      conteudo: `Jorge Felippe Neto tem uma comunicação próxima do cidadão comum, especialmente voltada para a Zona Oeste. Fala sobre temas do cotidiano da comunidade: segurança, saúde, meio ambiente, animais, regularização de terrenos. Tom pessoal — frequentemente posta sobre a família (filhos Jorginho e Helena). Usa linguagem acessível, não burocrática.`,
      relevancia: 1.0,
    },
    {
      tipo: 'contexto',
      chave: 'zona_oeste_rio',
      conteudo: `A Zona Oeste do Rio de Janeiro inclui bairros como Padre Miguel (origem do deputado), Campo Grande, Bangu, Realengo, Santa Cruz, Guaratiba, entre outros. É a área mais populosa e com maior carência de serviços públicos da cidade. O eleitorado de Jorge Felippe Neto é fortemente desta região.`,
      relevancia: 0.8,
    },
    {
      tipo: 'contexto',
      chave: 'avos_jorge_felippe',
      conteudo: `O vereador Jorge Felippe é o avô paterno de Jorge Felippe Neto. Foi presidente da Câmara Municipal do Rio de Janeiro e é uma figura política histórica da Zona Oeste. A família Felippe tem forte base eleitoral na região. O avô foi vereador por múltiplos mandatos e é referência política para o neto.`,
      relevancia: 0.8,
    },
  ]

  for (const m of memorias) {
    await prisma.hermesMemoria.upsert({
      where: { tipo_chave: { tipo: m.tipo, chave: m.chave } },
      update: { conteudo: m.conteudo, relevancia: m.relevancia },
      create: m,
    })
  }
  console.log('✅ Memória do Hermes carregada com perfil do deputado')

  // ── Bond — Perfil Instagram pré-carregado ─────────────────────────────────

  await prisma.bondPerfil.upsert({
    where: { plataforma_handle: { plataforma: 'instagram', handle: 'depjorgefelippeneto' } },
    update: {
      nomeCompleto: 'Jorge Felippe Neto',
      seguidores: 24000,
      bio: 'Deputado Estadual RJ 🏛️ | PL | Zona Oeste 💚 | Pai do Jorginho e da Helena ❤️ | Advogado',
      ativo: true,
    },
    create: {
      plataforma: 'instagram',
      handle: 'depjorgefelippeneto',
      nomeCompleto: 'Jorge Felippe Neto',
      seguidores: 24000,
      bio: 'Deputado Estadual RJ 🏛️ | PL | Zona Oeste 💚 | Pai do Jorginho e da Helena ❤️ | Advogado',
      ativo: true,
    },
  })

  await prisma.bondPerfil.upsert({
    where: { plataforma_handle: { plataforma: 'facebook', handle: 'jfelippeneto' } },
    update: {
      nomeCompleto: 'Jorge Felippe Neto',
      bio: 'Deputado Estadual Rio de Janeiro — PL — Zona Oeste',
      ativo: true,
    },
    create: {
      plataforma: 'facebook',
      handle: 'jfelippeneto',
      nomeCompleto: 'Jorge Felippe Neto',
      bio: 'Deputado Estadual Rio de Janeiro — PL — Zona Oeste',
      ativo: true,
    },
  })

  console.log('✅ Perfis do Bond (Instagram + Facebook) pré-configurados')

  // ── Insight inicial do Bond ───────────────────────────────────────────────

  await prisma.bondInsight.upsert({
    where: { id: 'seed-insight-perfil' },
    update: {},
    create: {
      id: 'seed-insight-perfil',
      titulo: 'Perfil do Deputado Configurado',
      descricao: `Jorge Felippe Neto, Deputado Estadual pelo PL/RJ, 3º mandato. Nascido em Padre Miguel/Zona Oeste. Neto do vereador Jorge Felippe. Pai de Jorginho e Helena. Presidente da Comissão de Meio Ambiente da ALERJ. Instagram: @depjorgefelippeneto (~24k seguidores). Para sincronizar posts reais, configure FACEBOOK_PAGE_TOKEN no .env (a conta Instagram Business precisa estar vinculada à Página do Facebook).`,
      tipo: 'sugestao',
      lido: false,
    },
  }).catch(() => {/* already seeded */})

  console.log('✅ Insight inicial criado\n')
  console.log('═══════════════════════════════════════════')
  console.log('✅ Seed completo! Sistema configurado para:')
  console.log('   Deputado: Jorge Felippe Neto')
  console.log('   Partido:  PL — Rio de Janeiro')
  console.log('   Instagram: @depjorgefelippeneto')
  console.log('   Facebook:  facebook.com/jfelippeneto')
  console.log('═══════════════════════════════════════════')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
