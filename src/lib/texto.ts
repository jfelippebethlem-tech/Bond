// Busca textual tolerante: minúsculas + sem acentos (NFD/strip diacríticos).
// O SQLite (via Prisma) não tem `mode: 'insensitive'` nem unaccent — `contains` é
// case-insensitive só p/ ASCII e sensível a acento. Então "Jose" não achava "José".
// Como as tabelas de busca (Pessoa, Demanda, BondFa) não paginam no banco, normalizamos
// e filtramos em memória após o findMany.

const DIACRITICOS = /[̀-ͯ]/g

export function normalizar(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(DIACRITICOS, '').toLowerCase().trim()
}

// Match parcial insensível a acento e caixa. termo vazio = casa tudo.
export function casaBusca(texto: string | null | undefined, termo: string): boolean {
  const t = normalizar(termo)
  if (!t) return true
  return normalizar(texto).includes(t)
}
