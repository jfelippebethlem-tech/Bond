'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Heart, Upload, Loader2, Search, Sparkles } from 'lucide-react'
import Avatar from '@/components/ui/Avatar'

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
  if (txt.startsWith('[') || txt.startsWith('{')) {
    try {
      const j = JSON.parse(txt)
      let arr: Record<string, unknown>[] = []
      if (Array.isArray(j)) arr = j
      else if (j.likerMap && typeof j.likerMap === 'object') arr = Object.values(j.likerMap)
      else if (Array.isArray(j.followingLeaderboard) || Array.isArray(j.notFollowingLeaderboard)) arr = [...(j.followingLeaderboard || []), ...(j.notFollowingLeaderboard || [])]
      else if (Array.isArray(j.data)) arr = j.data
      else if (Array.isArray(j.leaderboard)) arr = j.leaderboard
      const map = new Map<string, number>()
      for (const o of arr) {
        const u = o.user as Record<string, unknown> | undefined
        const username = String((u && u.username) ?? o.username ?? o.handle ?? o.name ?? o.usuario ?? '').replace(/^@/, '').trim()
        if (!username) continue
        const curtidas = parseCount(o.likesCount ?? o.likes ?? o.likeCount ?? o.count ?? o.total ?? o.curtidas ?? o.liked ?? o.score)
        map.set(username, Math.max(map.get(username) ?? 0, curtidas))
      }
      return Array.from(map.entries()).map(([username, curtidas]) => ({ username, curtidas }))
    } catch { /* cai pro CSV */ }
  }
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
  const [busca, setBusca] = useState('')
  const [showImport, setShowImport] = useState(false)

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
      setTexto(''); setShowImport(false)
      await carregar()
    } catch { setMsg('Erro ao importar.') }
    setImportando(false)
  }

  const nomeDe = (c: Curtidor) => c.nome || c.username || '—'
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return q ? lista.filter((c) => nomeDe(c).toLowerCase().includes(q)) : lista
  }, [lista, busca])

  const maxLikes = lista[0]?.totalLikes || 1
  const totalCurtidas = useMemo(() => lista.reduce((s, c) => s + c.totalLikes, 0), [lista])
  const podio = filtrados.slice(0, 3)
  const resto = filtrados.slice(3)
  const MEDAL = ['ring-amber-300', 'ring-slate-300', 'ring-orange-300']
  const MEDAL_BG = ['from-amber-50 to-amber-100/40 border-amber-200', 'from-slate-50 to-slate-100/40 border-slate-200', 'from-orange-50 to-orange-100/40 border-orange-200']
  const MEDAL_EMOJI = ['🥇', '🥈', '🥉']

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-md shadow-rose-200">
            <Heart className="w-6 h-6 text-white" fill="white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 leading-tight">Quem curtiu</h1>
            <p className="text-gray-500 text-sm">Ranking de quem mais curte seus posts · {lista.length.toLocaleString('pt-BR')} pessoas · {totalCurtidas.toLocaleString('pt-BR')} curtidas</p>
          </div>
        </div>
        <button onClick={() => setShowImport((v) => !v)} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium bg-rose-600 text-white hover:bg-rose-700 shadow-sm transition">
          <Upload size={15} /> Importar curtidas
        </button>
      </div>

      {/* Importação (recolhível) */}
      {showImport && (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4 text-sm text-amber-900">
          <b className="flex items-center gap-1.5"><Sparkles size={15} className="text-amber-500" /> Como capturar (no seu computador, navegador logado no Instagram):</b>
          <ol className="list-decimal ml-5 mt-1.5 space-y-0.5 text-amber-800">
            <li>Use o <b>InstagramLikesLeaderboard</b> (bookmarklet de console)</li>
            <li>Rode na instagram.com, espere terminar e clique em <b>Exportar (JSON ou CSV)</b></li>
            <li>Cole abaixo e clique <b>Importar</b></li>
          </ol>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Cole aqui o JSON ou CSV exportado..." className="mt-3 w-full h-28 border border-amber-200 rounded-xl p-3 text-sm font-mono bg-white text-gray-700" />
          <div className="flex items-center gap-3 mt-2">
            <button onClick={importar} disabled={importando} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
              {importando ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Importar
            </button>
            {msg && <span className="text-sm text-gray-600">{msg}</span>}
          </div>
        </div>
      )}
      {!showImport && msg && <p className="text-sm text-emerald-600 mt-2">{msg}</p>}

      {lista.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-gray-200 bg-white text-center py-16">
          <Heart className="w-12 h-12 text-rose-100 mx-auto mb-3" fill="currentColor" />
          <p className="text-gray-400 font-medium">Nenhum curtidor importado ainda</p>
          <p className="text-gray-300 text-xs mt-1">Clique em “Importar curtidas” e cole o export do Instagram</p>
        </div>
      ) : (
        <>
          {/* Pódio Top 3 */}
          {!busca && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6">
              {podio.map((c, i) => (
                <div key={c.username ?? i} className={`relative rounded-2xl border bg-gradient-to-br ${MEDAL_BG[i]} p-4 flex flex-col items-center text-center ${i === 0 ? 'sm:-translate-y-2 shadow-md' : 'shadow-sm'}`}>
                  <span className="absolute top-2 right-3 text-xl">{MEDAL_EMOJI[i]}</span>
                  <Avatar nome={nomeDe(c)} size={i === 0 ? 64 : 52} ring={`ring-2 ${MEDAL[i]} ring-offset-2`} />
                  <p className="mt-2.5 font-semibold text-gray-900 truncate max-w-full">{nomeDe(c)}</p>
                  <p className="text-rose-600 font-bold text-lg tabular-nums flex items-center gap-1"><Heart size={14} fill="currentColor" /> {c.totalLikes.toLocaleString('pt-BR')}</p>
                  {c.totalComents > 0 && <p className="text-xs text-gray-400">{c.totalComents} comentários</p>}
                </div>
              ))}
            </div>
          )}

          {/* Busca */}
          <div className="relative mt-6 mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar curtidor…" className="w-full border border-gray-300 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent" />
          </div>

          {/* Ranking (resto, ou todos quando há busca) */}
          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden divide-y divide-gray-50">
            {(busca ? filtrados : resto).map((c, idx) => {
              const pos = busca ? lista.indexOf(c) + 1 : idx + 4
              const pct = Math.max(4, Math.round((c.totalLikes / maxLikes) * 100))
              return (
                <div key={c.username ?? idx} className="flex items-center gap-3 px-3 sm:px-4 py-2.5 hover:bg-rose-50/40 transition group">
                  <span className="w-7 text-center text-xs font-semibold text-gray-400 tabular-nums shrink-0">{pos}</span>
                  <Avatar nome={nomeDe(c)} size={34} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{nomeDe(c)}</p>
                    <div className="h-1.5 mt-1 rounded-full bg-gray-100 overflow-hidden max-w-[220px]">
                      <div className="h-full rounded-full bg-gradient-to-r from-rose-300 to-pink-500 group-hover:from-rose-400 group-hover:to-pink-600 transition-colors" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className="flex items-center gap-1 text-sm font-bold text-rose-600 tabular-nums shrink-0"><Heart size={13} fill="currentColor" /> {c.totalLikes.toLocaleString('pt-BR')}</span>
                </div>
              )
            })}
            {busca && filtrados.length === 0 && <p className="text-center text-gray-400 text-sm py-8">Nenhum curtidor com “{busca}”.</p>}
          </div>
        </>
      )}
    </div>
  )
}
