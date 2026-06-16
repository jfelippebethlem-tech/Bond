'use client'

import { useCallback, useEffect, useState } from 'react'
import { Heart, Upload, Loader2, Trophy } from 'lucide-react'

type Curtidor = { username: string | null; nome: string | null; totalLikes: number; totalComents: number }

// Extrai o numerador de "45/80" ou número puro.
function parseCount(v: unknown): number {
  if (typeof v === 'number') return v
  const s = String(v ?? '')
  const m = s.match(/\d+/)
  return m ? parseInt(m[0], 10) : 0
}

// Aceita JSON (array de objetos) OU CSV. Detecta o campo de usuário e o de curtidas.
function parseExport(txt: string): { username: string; curtidas: number }[] {
  txt = txt.trim()
  if (!txt) return []
  // tenta JSON
  if (txt.startsWith('[') || txt.startsWith('{')) {
    try {
      const j = JSON.parse(txt)
      const arr = Array.isArray(j) ? j : Array.isArray(j.data) ? j.data : Array.isArray(j.leaderboard) ? j.leaderboard : []
      return arr.map((o: Record<string, unknown>) => {
        const username = String(o.username ?? o.user ?? o.handle ?? o.name ?? o.usuario ?? '').replace(/^@/, '').trim()
        const curtidas = parseCount(o.likes ?? o.likeCount ?? o.count ?? o.total ?? o.curtidas ?? o.liked ?? o.score)
        return { username, curtidas }
      }).filter((x: { username: string }) => x.username)
    } catch { /* cai pro CSV */ }
  }
  // CSV
  const linhas = txt.split(/\r?\n/).filter(Boolean)
  if (linhas.length < 2) return []
  const head = linhas[0].split(/[,;]/).map((h) => h.trim().toLowerCase())
  const iUser = head.findIndex((h) => /user|handle|usuario|name|perfil/.test(h))
  const iCount = head.findIndex((h) => /like|curtid|count|total|score/.test(h))
  if (iUser < 0) return []
  return linhas.slice(1).map((l) => {
    const cols = l.split(/[,;]/)
    return { username: String(cols[iUser] ?? '').replace(/^@/, '').trim(), curtidas: parseCount(cols[iCount] ?? 0) }
  }).filter((x) => x.username)
}

export default function CurtidoresPage() {
  const [texto, setTexto] = useState('')
  const [lista, setLista] = useState<Curtidor[]>([])
  const [importando, setImportando] = useState(false)
  const [msg, setMsg] = useState('')

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/bond?tipo=curtidores')
      const d = await r.json()
      setLista(Array.isArray(d.data) ? d.data : [])
    } catch { /* */ }
  }, [])
  useEffect(() => { carregar() }, [carregar])

  const importar = async () => {
    const itens = parseExport(texto)
    if (!itens.length) { setMsg('Não consegui ler nenhum curtidor. Cole o JSON ou CSV do export.'); return }
    setImportando(true); setMsg('')
    try {
      const r = await fetch('/api/bond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'importar_curtidores', itens }) })
      const d = await r.json()
      setMsg(`✅ ${d.ok} curtidores importados.`)
      setTexto('')
      await carregar()
    } catch { setMsg('Erro ao importar.') }
    setImportando(false)
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Heart className="text-rose-500" /> Quem curtiu</h1>
      <p className="text-gray-500 text-sm mb-4">Ranking de quem mais curtiu seus posts — capturado no seu navegador (desktop) e importado aqui. O Bond <b>não</b> raspa o Instagram.</p>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 mb-5">
        <b>Como capturar (no seu computador, navegador logado no Instagram):</b>
        <ol className="list-decimal ml-5 mt-1 space-y-0.5">
          <li>Use o <b>InstagramLikesLeaderboard</b> (bookmarklet de console)</li>
          <li>Rode na instagram.com, espere terminar e clique em <b>Exportar (JSON ou CSV)</b></li>
          <li>Cole o conteúdo exportado no campo abaixo e clique <b>Importar</b></li>
        </ol>
      </div>

      <textarea value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Cole aqui o JSON ou CSV exportado..." className="w-full h-32 border border-gray-300 rounded-lg p-3 text-sm font-mono mb-2" />
      <div className="flex items-center gap-3 mb-6">
        <button onClick={importar} disabled={importando} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
          {importando ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Importar
        </button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>

      {lista.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b font-semibold text-gray-800 flex items-center gap-2"><Trophy size={16} className="text-amber-500" /> Top curtidores ({lista.length})</div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b"><th className="px-4 py-2">#</th><th className="px-3 py-2">Pessoa</th><th className="px-3 py-2 text-right">Curtidas</th></tr></thead>
            <tbody>
              {lista.map((c, i) => (
                <tr key={c.username ?? i} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-400">{i + 1}º</td>
                  <td className="px-3 py-2 font-medium text-gray-800">{c.username ?? c.nome}</td>
                  <td className="px-3 py-2 text-right font-semibold text-rose-600">{c.totalLikes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
