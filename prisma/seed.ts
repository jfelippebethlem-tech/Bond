import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  await prisma.configuracao.upsert({
    where: { chave: 'deputado_nome' },
    update: {},
    create: { chave: 'deputado_nome', valor: 'Deputado(a)' },
  })

  await prisma.palavraChave.createMany({
    data: [
      { palavra: 'deputado' },
      { palavra: 'gabinete' },
      { palavra: 'vereador' },
      { palavra: 'assembleia' },
    ],
    skipDuplicates: true,
  })

  console.log('Seed concluído!')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
