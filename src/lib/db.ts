import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function makePrisma() {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })
  // WAL mode: required for PM2 cluster (multiple workers, single SQLite file).
  // PRAGMA journal_mode/busy_timeout RETORNAM linha -> usar queryRaw (executeRaw falha
  // com "Execute returned results, which is not allowed in SQLite" e o WAL nem ativava).
  client.$queryRawUnsafe('PRAGMA journal_mode = WAL').catch(() => {})
  client.$queryRawUnsafe('PRAGMA synchronous = NORMAL').catch(() => {})
  client.$queryRawUnsafe('PRAGMA busy_timeout = 5000').catch(() => {})
  return client
}

export const prisma = globalForPrisma.prisma ?? makePrisma()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
