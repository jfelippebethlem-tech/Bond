import { prisma } from '@/lib/db'

// Contas-sistema do Instagram que o coletor às vezes captura como "curtidor"/"autor"
// (ex.: "notifications" aparece quando o IG agrega "fulano e outros curtiram").
// Não são pessoas reais — não entram em ranking de engajamento.
const SISTEMA = ['notifications', 'instagram', 'meta', 'threads', 'explore', 'reels', 'shop', 'liked_by', 'accountscenter', 'igtv']

export function normUser(u?: string | null): string {
  return (u || '').toLowerCase().replace(/^@/, '').trim()
}

// Conjunto de handles a excluir de rankings: contas-sistema + os perfis do PRÓPRIO mandato
// (o deputado não é "curtidor" dos próprios posts).
export async function handlesExcluidos(): Promise<Set<string>> {
  const perfis = await prisma.bondPerfil.findMany({ select: { handle: true } })
  const s = new Set(SISTEMA)
  for (const p of perfis) {
    const h = normUser(p.handle)
    if (h) s.add(h)
  }
  return s
}
