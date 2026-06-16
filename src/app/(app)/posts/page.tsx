'use client'

import { useCallback, useEffect, useState } from 'react'
import { Heart, MessageCircle, Trophy, Video, Image as ImageIcon, ExternalLink } from 'lucide-react'

type Post = {
  id: string; plataforma: string; tipo: string; conteudo: string; url: string | null
  likes: number; comentarios: number; alcance: number; engajamento: number; publicadoEm: string
}

const fmt = (n: number) => n.toLocaleString('pt-BR')
const dataBR = (s: string) => new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
const inicio = (t: string, n = 90) => { const s = (t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : (s || '(sem legenda)') }

export default function PostsPage() {
  const [posts, setPosts] = useState<Post[]>([])
  const [ordenar, setOrdenar] = useState<'likes' | 'comentarios' | ''>('likes')
  const [periodo, setPeriodo] = useState<'semana' | 'mes' | ''>('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams({ tipo: 'posts' })
    if (ordenar) p.set('ordenar', ordenar)
    if (periodo) {
      const d = new Date(); d.setDate(d.getDate() - (periodo === 'semana' ? 7 : 30))
      p.set('de', d.toISOString().slice(0, 10))
    }
    try { const r = await fetch(`/api/bond?${p}`); setPosts(await r.json()) } catch { /* */ }
    setLoading(false)
  }, [ordenar, periodo])
  useEffect(() => { load() }, [load])

  const Btn = ({ v, set, atual, children }: { v: string; set: (x: any) => void; atual: string; children: React.ReactNode }) => (
    <button onClick={() => set(v)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${atual === v ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>{children}</button>
  )

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Trophy className="text-amber-500" /> Posts — desempenho</h1>
      <p className="text-gray-500 text-sm mb-4">Quais posts foram melhor — com a data e o começo da legenda pra você achar fácil.</p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-gray-400 mr-1">Ordenar:</span>
        <Btn v="likes" set={setOrdenar} atual={ordenar}>❤️ Mais curtidos</Btn>
        <Btn v="comentarios" set={setOrdenar} atual={ordenar}>💬 Mais comentados</Btn>
        <Btn v="" set={setOrdenar} atual={ordenar}>🕐 Recentes</Btn>
        <span className="text-xs text-gray-400 mx-1 ml-3">Período:</span>
        <Btn v="semana" set={setPeriodo} atual={periodo}>7 dias</Btn>
        <Btn v="mes" set={setPeriodo} atual={periodo}>30 dias</Btn>
        <Btn v="" set={setPeriodo} atual={periodo}>Tudo</Btn>
      </div>

      {loading ? <p className="text-gray-400 text-sm">Carregando…</p> : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b bg-gray-50">
              <th className="px-3 py-2.5 w-8">#</th>
              <th className="px-3 py-2.5 whitespace-nowrap">Data</th>
              <th className="px-3 py-2.5">Começo da legenda</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">❤️</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">💬</th>
              <th className="px-2 py-2.5"></th>
            </tr></thead>
            <tbody>
              {posts.map((p, i) => (
                <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50 align-top">
                  <td className="px-3 py-2.5 text-gray-400">{i + 1}º</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{dataBR(p.publicadoEm)}</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1 text-gray-400 mr-1">{p.tipo === 'video' ? <Video size={13} /> : <ImageIcon size={13} />}</span>
                    <span className="text-gray-800">{inicio(p.conteudo)}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-rose-600 whitespace-nowrap"><span className="inline-flex items-center gap-1 justify-end"><Heart size={12} />{fmt(p.likes)}</span></td>
                  <td className="px-3 py-2.5 text-right font-semibold text-blue-600 whitespace-nowrap"><span className="inline-flex items-center gap-1 justify-end"><MessageCircle size={12} />{fmt(p.comentarios)}</span></td>
                  <td className="px-2 py-2.5">{p.url && <a href={p.url} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-blue-600"><ExternalLink size={15} /></a>}</td>
                </tr>
              ))}
              {!posts.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">Nenhum post no período.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
