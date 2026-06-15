'use client'

import { useEffect, useState } from 'react'
import { Brain, Loader2, Sparkles, TrendingUp, TrendingDown, Zap, Target, BarChart3, Rocket } from 'lucide-react'

type Insight = { id: string; titulo: string; descricao: string; tipo: string; criadoEm: string }

const SECOES = [
  { match: '1.', icon: <TrendingUp size={18} className="text-green-600" />, cor: 'border-green-200 bg-green-50/40' },
  { match: '2.', icon: <TrendingDown size={18} className="text-rose-500" />, cor: 'border-rose-200 bg-rose-50/40' },
  { match: '3.', icon: <Sparkles size={18} className="text-amber-500" />, cor: 'border-amber-200 bg-amber-50/40' },
  { match: '4.', icon: <Target size={18} className="text-purple-600" />, cor: 'border-purple-200 bg-purple-50/40' },
  { match: '5.', icon: <Zap size={18} className="text-blue-600" />, cor: 'border-blue-200 bg-blue-50/40' },
  { match: '6.', icon: <Rocket size={18} className="text-indigo-600" />, cor: 'border-indigo-200 bg-indigo-50/40' },
]

function parseSecoes(txt: string) {
  // Divide por "N. TITULO:" mantendo o cabeçalho
  const partes = txt.split(/\n(?=\d\.\s)/).map((s) => s.trim()).filter(Boolean)
  return partes.map((p) => {
    const nl = p.indexOf('\n')
    const titulo = (nl === -1 ? p : p.slice(0, nl)).replace(/:$/, '')
    const corpo = nl === -1 ? '' : p.slice(nl + 1).trim()
    const sec = SECOES.find((s) => titulo.startsWith(s.match)) || { icon: <BarChart3 size={18} className="text-gray-500" />, cor: 'border-gray-200 bg-gray-50/40' }
    return { titulo, corpo, ...sec }
  })
}

export default function AnalisePage() {
  const [analise, setAnalise] = useState('')
  const [loading, setLoading] = useState(false)
  const [insights, setInsights] = useState<Insight[]>([])

  async function carregarInsights() {
    try { const r = await fetch('/api/bond?tipo=insights'); const d = await r.json(); setInsights(Array.isArray(d) ? d : []) } catch { /* */ }
  }
  useEffect(() => { carregarInsights() }, [])

  async function gerar() {
    setLoading(true); setAnalise('')
    try {
      const r = await fetch('/api/bond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'analise_profunda' }) })
      const d = await r.json()
      setAnalise(d.analise || 'Sem dados suficientes para a análise (sincronize as redes primeiro).')
      carregarInsights()
    } catch { setAnalise('Erro ao gerar a análise.') }
    setLoading(false)
  }

  const secoes = analise ? parseSecoes(analise) : []

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between mb-1 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Brain className="text-indigo-600" size={24} /> Inteligência de Conteúdo</h1>
          <p className="text-gray-500 text-sm mt-1">Análise profunda de viralização — o que engaja, benchmark com a direita viral e como o algoritmo espalha.</p>
        </div>
        <button onClick={gerar} disabled={loading} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap shadow-sm">
          {loading ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />} {loading ? 'Analisando…' : 'Gerar análise profunda'}
        </button>
      </div>

      {loading && (
        <div className="mt-8 flex flex-col items-center gap-3 text-gray-500 py-12">
          <Loader2 className="animate-spin text-indigo-500" size={28} />
          <p className="text-sm">A IA está analisando seus posts, comparando com perfis virais da direita e os métodos do algoritmo…</p>
        </div>
      )}

      {!loading && secoes.length > 0 && (
        <div className="mt-6 space-y-3">
          {secoes.map((s, i) => (
            <div key={i} className={`rounded-xl border p-4 ${s.cor}`}>
              <div className="flex items-center gap-2 font-semibold text-gray-900 mb-2">{s.icon}<span>{s.titulo}</span></div>
              <div className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{s.corpo}</div>
            </div>
          ))}
        </div>
      )}

      {!loading && !analise && (
        <div className="mt-8 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
          <Brain size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-600 font-medium">Clique em "Gerar análise profunda"</p>
          <p className="text-gray-400 text-sm mt-1">A IA cruza seus posts reais com estratégias de viralização e o algoritmo das redes.</p>
        </div>
      )}

      {insights.length > 0 && (
        <div className="mt-10">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Análises anteriores</h2>
          <div className="space-y-2">
            {insights.slice(0, 6).map((it) => (
              <details key={it.id} className="rounded-lg border border-gray-200 bg-white">
                <summary className="px-4 py-2.5 cursor-pointer text-sm font-medium text-gray-800 flex items-center justify-between">
                  <span>{it.titulo}</span>
                  <span className="text-xs text-gray-400">{new Date(it.criadoEm).toLocaleDateString('pt-BR')}</span>
                </summary>
                <div className="px-4 pb-3 text-sm text-gray-600 whitespace-pre-line leading-relaxed border-t border-gray-100 pt-2">{it.descricao}</div>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
