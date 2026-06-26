import { prisma } from '@/lib/db'

// Filtro de PERÍODO honesto para interações/comentários.
//
// Regra: bucketa pela data REAL (publicadoEm = created_time FB / timestamp IG / data do
// post para curtidores). Para linhas SEM data real (publicadoEm null), bucketa pela data
// do POST a que pertencem — que é conhecida p/ ~100% dos casos — e NUNCA pela hora do
// ingest (criadoEm).
//
// Por quê: o fallback antigo (criadoEm) jogava todo lote importado num dia para dentro
// daquela semana. Ex.: 5.814 comentários sem timestamp importados em 16/06 apareciam
// inteiros no filtro "semana 15–21/06" como se tivessem sido feitos ali — o bug
// "comentários de toda a vida aparecem na busca da semana". Pela data do post, cada
// comentário cai no período do post em que foi feito.
//
// O fragmento serve igual a BondComentario e BondInteracao (ambos têm publicadoEm + postId).
type Where = { OR: ({ publicadoEm: { gte?: Date; lte?: Date } } | { publicadoEm: null; postId: { in: string[] } })[] }

export async function filtroPeriodo(de?: string | null, ate?: string | null): Promise<Where | null> {
  if (!de && !ate) return null
  const dateW: { gte?: Date; lte?: Date } = {}
  if (de) dateW.gte = new Date(de + 'T00:00:00')
  if (ate) dateW.lte = new Date(ate + 'T23:59:59')
  const posts = await prisma.bondPost.findMany({ where: { publicadoEm: dateW }, select: { postId: true } })
  const codes = posts.map((p) => p.postId)
  return { OR: [{ publicadoEm: dateW }, { publicadoEm: null, postId: { in: codes } }] }
}
