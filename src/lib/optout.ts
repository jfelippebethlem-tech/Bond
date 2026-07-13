import { prisma } from './db'

const PALAVRAS = ['sair', 'parar', 'pare', 'stop', 'descadastrar', 'cancelar']

/** Normaliza (sem acento, minúsculo, trim) e testa se é um comando de opt-out. */
export function isPalavraOptOut(texto: string): boolean {
  const t = (texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
  return PALAVRAS.includes(t)
}

export async function estaOptOut(telefone: string): Promise<boolean> {
  const o = await prisma.optOut.findUnique({ where: { telefone } })
  return !!o
}

export async function registrarOptOut(telefone: string, canal = 'todos', origem?: string): Promise<void> {
  await prisma.optOut.upsert({
    where: { telefone },
    update: { canal, origem },
    create: { telefone, canal, origem },
  })
}
