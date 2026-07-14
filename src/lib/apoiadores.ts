import { prisma } from './db'
import { normUser } from './filtros'

// Lista de APOIADORES atuais — fonte da verdade: Pessoa (tipo='apoiador', campo instagram).
// Alimentada pela lista que o dono manda no bot do Telegram (documento csv/txt ou texto
// colado com @s); consumida pelo filtro "Apoiadores" da aba Interações.

export type RegistroApoiador = { nome: string; instagram: string }

// Handle normalizado: sem @, sem barra final, último segmento (se vier URL), minúsculo.
// (Mesma regra do vincularPessoa em src/lib/bond.ts.)
export function normHandle(h: string | null | undefined): string {
  return (h ?? '').replace(/^@/, '').replace(/\/+$/, '').split('/').pop()!.trim().toLowerCase()
}

const RE_HANDLE = /@([A-Za-z0-9](?:[A-Za-z0-9._]{0,28}[A-Za-z0-9_])?)/g
// Célula que é um handle "puro" (sem @): letras/números/ponto/underscore, sem espaço.
const RE_HANDLE_PURO = /^[A-Za-z0-9][A-Za-z0-9._]{1,29}$/

// Extrai {nome, instagram} de uma lista em texto livre, CSV/TSV ou linhas com @.
// Tolerante de propósito: a lista vem do dono em qualquer formato (export de planilha,
// texto do WhatsApp, colunas variadas). Dedup por handle.
export function parseApoiadores(texto: string): RegistroApoiador[] {
  const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!linhas.length) return []

  // Delimitador dominante da 1ª linha não-vazia com separador
  const delim = [';', '\t', ','].find((d) => linhas.some((l) => l.includes(d))) ?? null

  // Cabeçalho? (linha 1 nomeia colunas — ex.: "nome;instagram")
  let igCol = -1, nomeCol = -1, inicio = 0
  if (delim) {
    const head = linhas[0].split(delim).map((c) => c.trim().toLowerCase())
    igCol = head.findIndex((c) => /insta|arroba|usuario|user|@|perfil|handle/.test(c))
    nomeCol = head.findIndex((c) => /nome|name/.test(c))
    if (igCol >= 0 || nomeCol >= 0) inicio = 1
  }

  const porHandle = new Map<string, RegistroApoiador>()
  const add = (handle: string, nome: string) => {
    const h = normHandle(handle)
    if (!h || /^\d+$/.test(h)) return // só dígitos = telefone/ID, não handle
    const limpo = nome.replace(RE_HANDLE, '').replace(/[;,\t]+/g, ' ').replace(/\s+/g, ' ').trim()
    const atual = porHandle.get(h)
    if (!atual || (!atual.nome && limpo)) porHandle.set(h, { nome: limpo || atual?.nome || h, instagram: h })
  }

  for (const linha of linhas.slice(inicio)) {
    const cells = delim ? linha.split(delim).map((c) => c.trim()) : [linha]
    // 1) coluna de instagram declarada no cabeçalho
    if (igCol >= 0 && cells[igCol]) {
      add(cells[igCol], nomeCol >= 0 ? cells[nomeCol] ?? '' : cells.filter((_, i) => i !== igCol).join(' '))
      continue
    }
    // 2) @handle explícito ou URL do Instagram em qualquer lugar da linha
    const m = linha.match(RE_HANDLE)
    if (m?.length) { add(m[0], linha); continue }
    const url = linha.match(/instagram\.com\/([A-Za-z0-9._]+)/)
    if (url) { add(url[1], linha.replace(/https?:\/\/\S+/g, ' ')); continue }
    // 3) CSV sem cabeçalho: célula que parece handle puro (a última que casar, p/ "Nome,handle")
    if (delim && cells.length >= 2) {
      const idx = cells.map((c, i) => (RE_HANDLE_PURO.test(c) ? i : -1)).filter((i) => i >= 0).pop()
      if (idx !== undefined) add(cells[idx], cells.filter((_, i) => i !== idx).join(' '))
    }
  }
  return Array.from(porHandle.values())
}

// Importa a lista para Pessoa (tipo='apoiador') e vincula BondFa pelo username do IG.
// Idempotente: reimportar a mesma lista não duplica (match por handle normalizado).
export async function importarApoiadores(registros: RegistroApoiador[]) {
  const existentes = await prisma.pessoa.findMany({ where: { instagram: { not: null } } })
  const porHandle = new Map(existentes.map((p) => [normHandle(p.instagram), p]))
  let criados = 0, atualizados = 0, vinculados = 0

  for (const r of registros) {
    const h = normHandle(r.instagram)
    if (!h) continue
    const p = porHandle.get(h)
    if (p) {
      await prisma.pessoa.update({
        where: { id: p.id },
        data: { tipo: 'apoiador', ativo: true, ...(r.nome && r.nome !== h && (!p.nome || p.nome === h) ? { nome: r.nome } : {}) },
      })
      atualizados++
    } else {
      const nova = await prisma.pessoa.create({ data: { nome: r.nome || h, tipo: 'apoiador', instagram: h } })
      porHandle.set(h, nova)
      criados++
    }
    const pessoaId = porHandle.get(h)!.id
    const v = await prisma.bondFa.updateMany({ where: { username: h, pessoaId: null }, data: { pessoaId } })
    vinculados += v.count
  }
  return { criados, atualizados, vinculados, total: registros.length }
}

// Handles (normalizados via normUser, o mesmo do ranking) dos apoiadores cadastrados —
// usado pelo filtro "Apoiadores" da aba Interações.
export async function handlesApoiadores(): Promise<Set<string>> {
  const ps = await prisma.pessoa.findMany({ where: { tipo: 'apoiador', ativo: true, instagram: { not: null } }, select: { instagram: true } })
  return new Set(ps.map((p) => normUser(normHandle(p.instagram))).filter(Boolean))
}
