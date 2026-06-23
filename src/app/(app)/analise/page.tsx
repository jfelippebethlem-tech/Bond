'use client'

import { useEffect, useState } from 'react'
import { Brain, Loader2, Sparkles, TrendingUp, TrendingDown, Zap, Target, BarChart3, Rocket, FileText, X, CalendarDays, CalendarRange } from 'lucide-react'

type Insight = { id: string; titulo: string; descricao: string; tipo: string; criadoEm: string }
type ViralScore = {
  id: string; postId: string; superficie: string; scoreTotal: number; diagnostico: string
  camada: string; temaCasado: string | null; ganchoNota: number | null; conteudoResumo: string | null
  sinais: string | null
  post: { conteudo: string; url: string | null; publicadoEm: string; likes: number; comentarios: number } | null
}

// extrai sendWorthy + gatilhos do JSON de sinais (gravado pelo analista)
function parseSinais(s: string | null): { sendWorthy?: number | null; gatilhos?: string[] } {
  try { return s ? JSON.parse(s) : {} } catch { return {} }
}

const corScore = (s: number) => (s >= 60 ? 'bg-green-100 text-green-700' : s >= 35 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700')

// renderiza a prosa do relatório: linhas EM MAIÚSCULAS curtas viram cabeçalho de seção
function ProsaRelatorio({ texto }: { texto: string }) {
  const linhas = texto.split('\n')
  return (
    <div className="space-y-1.5">
      {linhas.map((l, i) => {
        const t = l.trim()
        if (!t) return <div key={i} className="h-1" />
        const ehTitulo = t.length < 60 && /^[A-ZÀ-Ú0-9][A-ZÀ-Ú0-9\s,À-Ýºª—-]+$/.test(t) && t === t.toUpperCase()
        if (ehTitulo) return <h4 key={i} className="text-sm font-bold text-indigo-700 uppercase tracking-wide mt-4 first:mt-0">{t}</h4>
        return <p key={i} className="text-sm text-gray-700 leading-relaxed">{t}</p>
      })}
    </div>
  )
}

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
  const [viral, setViral] = useState<ViralScore[]>([])
  const [analisando, setAnalisando] = useState(false)
  const [ordem, setOrdem] = useState<'melhores' | 'piores'>('melhores')
  const [formato, setFormato] = useState<string>('todos')
  const [relatorios, setRelatorios] = useState<{ id: string; tipo: string; titulo: string; periodo: string | null; criadoEm: string }[]>([])
  const [relAtivo, setRelAtivo] = useState<{ titulo: string; prosa: string; dados: { posts?: { conteudo: string; tipo: string; score: number | null; url: string | null }[] } | null } | null>(null)
  const [gerandoRel, setGerandoRel] = useState<string>('')
  const [playbook, setPlaybook] = useState<{ playbook: string; meta: { n: number; calibracao: number; atualizadoEm: string } | null } | null>(null)
  const [aprendendo, setAprendendo] = useState(false)

  async function carregarInsights() {
    try { const r = await fetch('/api/bond?tipo=insights'); const d = await r.json(); setInsights(Array.isArray(d) ? d : []) } catch { /* */ }
  }
  async function carregarViral() {
    try { const r = await fetch('/api/bond?tipo=viral'); const d = await r.json(); setViral(Array.isArray(d) ? d : []) } catch { /* */ }
  }
  async function carregarRelatorios() {
    try { const r = await fetch('/api/bond?tipo=relatorios'); const d = await r.json(); setRelatorios(Array.isArray(d) ? d : []) } catch { /* */ }
  }
  async function abrirRelatorio(id: string) {
    try { const r = await fetch('/api/bond?tipo=relatorio&id=' + id); setRelAtivo(await r.json()) } catch { /* */ }
  }
  async function gerarRel(periodoTipo: 'semana' | 'mes' | 'post', ref?: string) {
    setGerandoRel(ref || periodoTipo)
    try {
      const r = await fetch('/api/bond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'gerar_relatorio', periodoTipo, ref }) })
      const d = await r.json()
      await carregarRelatorios()
      if (d.id) await abrirRelatorio(d.id)
    } catch { /* */ }
    setGerandoRel('')
  }
  async function carregarPlaybook() {
    try { const r = await fetch('/api/bond?tipo=playbook'); setPlaybook(await r.json()) } catch { /* */ }
  }
  async function aprender() {
    setAprendendo(true)
    try { await fetch('/api/bond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'aprender_viral' }) }); await carregarPlaybook() } catch { /* */ }
    setAprendendo(false)
  }
  useEffect(() => { carregarInsights(); carregarViral(); carregarRelatorios(); carregarPlaybook() }, [])
  useEffect(() => {
    if (!relAtivo) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setRelAtivo(null) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [relAtivo])

  async function analisarPosts() {
    setAnalisando(true)
    try {
      await fetch('/api/bond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'analisar_viral', limite: 100 }) })
      await carregarViral(); await carregarInsights()
    } catch { /* */ }
    setAnalisando(false)
  }

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

  // estatísticas e lista do analista viral
  const vstats = viral.length
    ? {
        total: viral.length,
        media: Math.round(viral.reduce((s, v) => s + v.scoreTotal, 0) / viral.length),
        reels: viral.filter((v) => v.superficie === 'reel').length,
        comTema: viral.filter((v) => v.temaCasado).length,
        camadaB: viral.filter((v) => v.camada === 'B').length,
      }
    : null
  const formatos = Array.from(new Set(viral.map((v) => v.superficie)))
  const viralView = viral
    .filter((v) => formato === 'todos' || v.superficie === formato)
    .sort((a, b) => (ordem === 'melhores' ? b.scoreTotal - a.scoreTotal : a.scoreTotal - b.scoreTotal))

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between mb-1 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Brain className="text-indigo-600" size={24} /> Análise de Conteúdo</h1>
          <p className="text-gray-500 text-sm mt-1">Análise profunda de viralização — o que engaja, benchmark com a direita viral e como o algoritmo espalha.</p>
        </div>
        <button onClick={gerar} disabled={loading} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap shadow-sm">
          {loading ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />} {loading ? 'Analisando…' : 'Gerar análise profunda'}
        </button>
      </div>

      {/* RELATÓRIOS */}
      <div className="mt-5 rounded-2xl border border-gray-200 bg-gradient-to-br from-indigo-50/60 to-white p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2"><FileText size={18} className="text-indigo-600" /> Relatórios de análise</h2>
          <div className="flex gap-2">
            <button onClick={() => gerarRel('semana')} disabled={!!gerandoRel} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50">
              {gerandoRel === 'semana' ? <Loader2 size={13} className="animate-spin" /> : <CalendarDays size={13} />} Semanal
            </button>
            <button onClick={() => gerarRel('mes')} disabled={!!gerandoRel} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50">
              {gerandoRel === 'mes' ? <Loader2 size={13} className="animate-spin" /> : <CalendarRange size={13} />} Mensal
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 mb-3">Relatório completo em prosa — post a post, com onde você está acertando, onde está errando e conclusões. Por post: abra um post abaixo e clique "Gerar relatório".</p>
        {relatorios.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {relatorios.map((r) => (
              <button key={r.id} onClick={() => abrirRelatorio(r.id)} className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 bg-white hover:border-indigo-300 hover:text-indigo-700 text-gray-600">
                {r.tipo === 'post' ? '📄' : r.tipo === 'mes' ? '🗓️' : '📅'} {r.titulo}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400">Nenhum relatório ainda — gere o primeiro acima.</p>
        )}
      </div>

      {/* INTELIGÊNCIA PROGRESSIVA */}
      <div className="mt-5 rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50/60 to-white p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2"><Brain size={18} className="text-violet-600" /> O que o Hermes aprendeu <span className="text-xs font-normal text-violet-500">· inteligência progressiva</span></h2>
          <button onClick={aprender} disabled={aprendendo} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 disabled:opacity-50">
            {aprendendo ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Aprender agora
          </button>
        </div>
        {playbook?.playbook ? (
          <>
            {playbook.meta && (
              <div className="flex items-center gap-4 text-xs text-gray-500 mb-3 flex-wrap">
                <span>📚 <b className="text-gray-700">{playbook.meta.n}</b> posts aprendidos</span>
                <span>🎯 calibração do score: <b className={playbook.meta.calibracao >= 0.5 ? 'text-green-600' : playbook.meta.calibracao >= 0.2 ? 'text-amber-600' : 'text-rose-600'}>{playbook.meta.calibracao}</b></span>
                {playbook.meta.atualizadoEm && <span className="text-gray-400">atualizado {new Date(playbook.meta.atualizadoEm).toLocaleDateString('pt-BR')}</span>}
              </div>
            )}
            <details>
              <summary className="text-sm text-violet-700 cursor-pointer font-medium">Ver o playbook aprendido deste perfil</summary>
              <div className="mt-2"><ProsaRelatorio texto={playbook.playbook} /></div>
            </details>
          </>
        ) : (
          <p className="text-xs text-gray-500">O Hermes aprende com os resultados reais (sends/alcance) o que faz <b>este</b> perfil viralizar, refina o playbook e calibra o próprio score — ficando mais esperto a cada lote. Clique "Aprender agora" (precisa de posts em camada B) ou deixe rodar no ciclo semanal.</p>
        )}
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

      <div className="mt-10">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Análise viral por post — a IA assiste cada mídia</h2>
          <button onClick={analisarPosts} disabled={analisando} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-medium hover:bg-gray-800 disabled:opacity-50">
            {analisando ? <Loader2 size={13} className="animate-spin" /> : <BarChart3 size={13} />} {analisando ? 'Analisando…' : 'Analisar posts pendentes'}
          </button>
        </div>

        {vstats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="rounded-xl border border-gray-200 bg-white p-3"><div className="text-2xl font-bold text-gray-900">{vstats.total}</div><div className="text-xs text-gray-500">posts analisados</div></div>
            <div className="rounded-xl border border-gray-200 bg-white p-3"><div className={`text-2xl font-bold ${vstats.media >= 60 ? 'text-green-600' : vstats.media >= 35 ? 'text-amber-600' : 'text-rose-600'}`}>{vstats.media}</div><div className="text-xs text-gray-500">score médio /100</div></div>
            <div className="rounded-xl border border-gray-200 bg-white p-3"><div className="text-2xl font-bold text-gray-900">{vstats.comTema}</div><div className="text-xs text-gray-500">no tema do momento</div></div>
            <div className="rounded-xl border border-gray-200 bg-white p-3"><div className="text-2xl font-bold text-gray-900">{vstats.reels}<span className="text-sm text-gray-400">/{vstats.total}</span></div><div className="text-xs text-gray-500">são Reels</div></div>
          </div>
        )}

        {viral.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
            Nenhum post analisado ainda. Clique em "Analisar posts pendentes" — a IA assiste cada reel/carrossel e pontua contra o algoritmo do Instagram.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2 text-xs flex-wrap">
              <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                <button onClick={() => setOrdem('melhores')} className={`px-2.5 py-1 ${ordem === 'melhores' ? 'bg-gray-900 text-white' : 'text-gray-600'}`}>Melhores</button>
                <button onClick={() => setOrdem('piores')} className={`px-2.5 py-1 ${ordem === 'piores' ? 'bg-gray-900 text-white' : 'text-gray-600'}`}>Piores (corrigir)</button>
              </div>
              <select value={formato} onChange={(e) => setFormato(e.target.value)} className="px-2 py-1 rounded-lg border border-gray-200 text-gray-600 bg-white">
                <option value="todos">Todos os formatos</option>
                {formatos.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              {viralView.map((v) => { const sin = parseSinais(v.sinais); return (
                <details key={v.id} className="rounded-lg border border-gray-200 bg-white">
                  <summary className="px-4 py-2.5 cursor-pointer text-sm flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={`px-2 py-0.5 rounded-md text-xs font-bold ${corScore(v.scoreTotal)}`}>{v.scoreTotal}</span>
                      <span className="text-xs text-gray-400 uppercase">{v.superficie}</span>
                      <span className="truncate text-gray-700">{v.post?.conteudo?.slice(0, 70) || v.postId}</span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      {sin.sendWorthy != null && <span className={`text-[10px] rounded px-1 border ${sin.sendWorthy >= 7 ? 'text-purple-700 border-purple-300 bg-purple-50' : 'text-gray-400 border-gray-200'}`} title="checklist send-worthy (psicologia do compartilhamento)">send {sin.sendWorthy}/10</span>}
                      {v.temaCasado && <span className="text-xs text-green-600 hidden sm:inline">🔥 {v.temaCasado.slice(0, 20)}</span>}
                      <span className="text-[10px] text-gray-400 border border-gray-200 rounded px-1">cam {v.camada}</span>
                    </span>
                  </summary>
                  <div className="px-4 pb-3 border-t border-gray-100 pt-3 space-y-3">
                    <div>
                      <div className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-1">Diagnóstico — por que (não) viralizou</div>
                      <div className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{v.diagnostico}</div>
                    </div>
                    {v.conteudoResumo && (
                      <details className="bg-gray-50 rounded-lg px-3 py-2">
                        <summary className="text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer">O que a IA viu na mídia</summary>
                        <div className="text-sm text-gray-600 whitespace-pre-line leading-relaxed mt-2">{v.conteudoResumo}</div>
                      </details>
                    )}
                    {sin.gatilhos && sin.gatilhos.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] text-gray-400 uppercase tracking-wide">gatilhos:</span>
                        {sin.gatilhos.slice(0, 6).map((g, i) => <span key={i} className="text-[11px] bg-purple-50 text-purple-700 border border-purple-100 rounded-full px-2 py-0.5">{g}</span>)}
                      </div>
                    )}
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      {v.ganchoNota != null && <span>Gancho: <b className="text-gray-700">{v.ganchoNota}/10</b></span>}
                      {sin.sendWorthy != null && <span>Send-worthy: <b className={sin.sendWorthy >= 7 ? 'text-purple-700' : 'text-gray-700'}>{sin.sendWorthy}/10</b></span>}
                      {v.post && <span>❤ {v.post.likes} · 💬 {v.post.comentarios}</span>}
                      <button onClick={() => gerarRel('post', v.postId)} disabled={!!gerandoRel} className="flex items-center gap-1 text-indigo-600 hover:underline disabled:opacity-50 ml-auto">
                        {gerandoRel === v.postId ? <Loader2 size={11} className="animate-spin" /> : <FileText size={11} />} Gerar relatório
                      </button>
                      {v.post?.url && <a href={v.post.url} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-indigo-600">ver no IG →</a>}
                    </div>
                  </div>
                </details>
              ) })}
            </div>
          </>
        )}
      </div>

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

      {relAtivo && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setRelAtivo(null)}>
          <div role="dialog" aria-modal="true" aria-label={relAtivo.titulo} className="bg-white rounded-2xl max-w-3xl w-full my-8 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
              <h3 className="font-bold text-gray-900 flex items-center gap-2"><FileText size={18} className="text-indigo-600" />{relAtivo.titulo}</h3>
              <div className="flex items-center gap-3">
                <button onClick={() => window.print()} className="text-xs text-gray-500 hover:text-indigo-600">Imprimir / PDF</button>
                <button onClick={() => setRelAtivo(null)} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
              </div>
            </div>
            <div className="px-6 py-5">
              <ProsaRelatorio texto={relAtivo.prosa} />
              {relAtivo.dados?.posts && relAtivo.dados.posts.length > 0 && (
                <div className="mt-6 pt-4 border-t border-gray-100">
                  <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-2">Posts do período</h4>
                  <div className="space-y-1">
                    {relAtivo.dados.posts.map((p, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-gray-600 py-1 border-b border-gray-50">
                        {p.score != null && <span className={`px-1.5 rounded font-bold ${corScore(p.score)}`}>{p.score}</span>}
                        <span className="text-gray-400 uppercase">{p.tipo}</span>
                        <span className="truncate flex-1">{p.conteudo}</span>
                        {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="text-indigo-600 shrink-0">ver →</a>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
