'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Heart, MessageCircle, Share2, Users, List, Search, RefreshCw, Loader2,
  Radio, Activity, Image as ImageIcon, Download,
} from 'lucide-react'

type Item = { id: string; tipo: string; plataforma: string; pessoa: string; texto: string | null; postId: string; data: string }
type Pessoa = { pessoa: string; total: number; like: number; comment: number; share: number; plataformas: string[]; nPosts: number; posts: string[]; ultima: string }
type Stats = { total: number; like: number; comment: number; share: number }

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const REDE = (p: string) => ({ instagram: 'bg-pink-100 text-pink-700', facebook: 'bg-blue-100 text-blue-700', twitter: 'bg-sky-100 text-sky-700' }[p] || 'bg-gray-100 text-gray-600')
const fmtISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function preset(key: string): [string, string] {
  const now = new Date(); const y = now.getFullYear(); const m = now.getMonth()
  const dd = (date: Date, n: number) => { const o = new Date(date); o.setDate(o.getDate() + n); return o }
  const segunda = (date: Date) => dd(date, -((date.getDay() + 6) % 7))
  switch (key) {
    case 'hoje': return [fmtISO(now), fmtISO(now)]
    case 'ontem': return [fmtISO(dd(now, -1)), fmtISO(dd(now, -1))]
    case '7dias': return [fmtISO(dd(now, -6)), fmtISO(now)]
    case '30dias': return [fmtISO(dd(now, -29)), fmtISO(now)]
    case 'semana': return [fmtISO(segunda(now)), fmtISO(now)]
    case 'semana_passada': { const ini = dd(segunda(now), -7); return [fmtISO(ini), fmtISO(dd(ini, 6))] }
    case 'mes': return [fmtISO(new Date(y, m, 1)), fmtISO(now)]
    case 'mes_passado': return [fmtISO(new Date(y, m - 1, 1)), fmtISO(new Date(y, m, 0))]
    case 'ano': return [fmtISO(new Date(y, 0, 1)), fmtISO(new Date(y, 11, 31))]
    default: return ['', '']
  }
}

const PRESETS = [
  ['hoje', 'Hoje'], ['ontem', 'Ontem'], ['7dias', '7 dias'], ['semana', 'Esta semana'],
  ['semana_passada', 'Semana passada'], ['mes', 'Este mês'], ['mes_passado', 'Mês passado'], ['ano', 'Este ano'],
]

export default function InteracoesPage() {
  const [modo, setModo] = useState<'lista' | 'pessoa'>('pessoa')
  const [tipoInteracao, setTipo] = useState('')
  const [plataforma, setPlat] = useState('')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [presetAtivo, setPresetAtivo] = useState('')
  const [pessoa, setPessoa] = useState('')
  const [lista, setLista] = useState<Item[]>([])
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [stats, setStats] = useState<Stats>({ total: 0, like: 0, comment: 0, share: 0 })
  const [loading, setLoading] = useState(false)
  const [aoVivo, setAoVivo] = useState(false)
  const [sincronizando, setSync] = useState(false)
  const [token, setToken] = useState<{ facebook?: { status: string; detail?: string }; ultimaSync?: string | null } | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const anoAtual = new Date().getFullYear()

  useEffect(() => { fetch('/api/bond?tipo=token_status').then((r) => r.json()).then(setToken).catch(() => {}) }, [])

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const p = new URLSearchParams({ tipo: 'interacoes' })
    if (tipoInteracao) p.set('tipoInteracao', tipoInteracao)
    if (plataforma) p.set('plataforma', plataforma)
    if (de) p.set('de', de)
    if (ate) p.set('ate', ate)
    if (pessoa) p.set('pessoa', pessoa)
    if (modo === 'pessoa') p.set('agrupar', 'pessoa')
    try {
      const res = await fetch(`/api/bond?${p}`)
      const d = await res.json()
      setStats(d.stats || { total: 0, like: 0, comment: 0, share: 0 })
      if (modo === 'pessoa') setPessoas(Array.isArray(d.data) ? d.data : [])
      else setLista(Array.isArray(d.data) ? d.data : [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [modo, tipoInteracao, plataforma, de, ate, pessoa])

  useEffect(() => { load() }, [load])

  // Exporta o que está na tela (mesmos filtros + modo) como CSV — abre o download direto.
  const exportarCSV = useCallback(() => {
    const p = new URLSearchParams({ tipo: 'interacoes', formato: 'csv' })
    if (tipoInteracao) p.set('tipoInteracao', tipoInteracao)
    if (plataforma) p.set('plataforma', plataforma)
    if (de) p.set('de', de)
    if (ate) p.set('ate', ate)
    if (pessoa) p.set('pessoa', pessoa)
    if (modo === 'pessoa') p.set('agrupar', 'pessoa')
    window.open(`/api/bond?${p}`, '_blank')
  }, [modo, tipoInteracao, plataforma, de, ate, pessoa])

  // Ao vivo: re-busca a cada 20s
  useEffect(() => {
    if (timer.current) clearInterval(timer.current)
    if (aoVivo) timer.current = setInterval(() => load(true), 20000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [aoVivo, load])

  function aplicarPreset(key: string) { const [d, a] = preset(key); setDe(d); setAte(a); setPresetAtivo(key) }
  function aplicarMes(mIdx: number) { const d = new Date(anoAtual, mIdx, 1); setDe(fmtISO(d)); setAte(fmtISO(new Date(anoAtual, mIdx + 1, 0))); setPresetAtivo(`mes-${mIdx}`) }
  function aplicarAno(ano: number) { setDe(`${ano}-01-01`); setAte(`${ano}-12-31`); setPresetAtivo(`ano-${ano}`) }
  function limparData() { setDe(''); setAte(''); setPresetAtivo('') }

  async function sincronizar() {
    setSync(true)
    try { await fetch('/api/bond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'sync' }) }) } catch { /* */ }
    await load(); setSync(false)
  }

  const Card = ({ icon, label, valor, cor }: { icon: React.ReactNode; label: string; valor: number; cor: string }) => (
    <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${cor}`}>{icon}</div>
      <div><div className="text-xl font-bold text-gray-900 leading-none">{valor.toLocaleString('pt-BR')}</div><div className="text-xs text-gray-500 mt-0.5">{label}</div></div>
    </div>
  )

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h1 className="text-2xl font-bold text-gray-900">Interações</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setAoVivo((v) => !v)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${aoVivo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
            <Radio size={15} className={aoVivo ? 'animate-pulse' : ''} /> {aoVivo ? 'Ao vivo' : 'Ao vivo'}
          </button>
          <button onClick={exportarCSV} title="Baixar o que está na tela (mesmos filtros) em CSV" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200">
            <Download size={15} /> CSV
          </button>
          <button onClick={sincronizar} disabled={sincronizando} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {sincronizando ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Sincronizar
          </button>
        </div>
      </div>
      <p className="text-gray-500 text-sm mb-4">Quem curtiu, comentou e compartilhou — monitorado por data, rede e pessoa.</p>

      {token && token.facebook?.status !== 'valid' && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="text-base leading-none">⚠️</span>
          <span><b>Token do Facebook/Instagram {token.facebook?.status === 'expired' ? 'EXPIRADO' : token.facebook?.status === 'none' ? 'não configurado' : 'com erro'}.</b> Os dados podem estar desatualizados{token.ultimaSync ? ` (último sync: ${new Date(token.ultimaSync).toLocaleString('pt-BR')})` : ''}. Gere um token novo no Graph API Explorer e envie para reconectar — os dados voltam a ser ao vivo.</span>
        </div>
      )}
      {token && token.facebook?.status === 'valid' && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2 text-xs text-green-700">
          <Radio size={13} /> <span>Conectado ao Facebook/Instagram — dados ao vivo{token.ultimaSync ? ` · último sync ${new Date(token.ultimaSync).toLocaleString('pt-BR')}` : ''}.</span>
        </div>
      )}

      {/* Cards de totais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Card icon={<Activity size={18} className="text-indigo-600" />} cor="bg-indigo-50" label="Total" valor={stats.total} />
        <Card icon={<Heart size={18} className="text-rose-500" />} cor="bg-rose-50" label="Curtidas" valor={stats.like} />
        <Card icon={<MessageCircle size={18} className="text-blue-500" />} cor="bg-blue-50" label="Comentários" valor={stats.comment} />
        <Card icon={<Share2 size={18} className="text-green-600" />} cor="bg-green-50" label="Compartilhamentos" valor={stats.share} />
      </div>

      {/* Nota de honestidade: limitação da API do Instagram p/ curtidas/compart. individuais */}
      {(stats.like === 0 && stats.share === 0 && stats.comment > 0) && (
        <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-5">
          <Activity size={14} className="text-gray-400 mt-0.5 shrink-0" />
          <span>No <b>Instagram</b>, a API só identifica <b>quem comentou</b> — a plataforma não revela <b>quem curtiu ou compartilhou</b> cada post (só o número total, visível na aba Posts). Curtidas/compartilhamentos por pessoa aparecem aqui quando o <b>Facebook</b> e o <b>Twitter/X</b> estiverem conectados.</span>
        </div>
      )}

      {/* Presets de data */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {PRESETS.map(([k, l]) => (
          <button key={k} onClick={() => aplicarPreset(k)} className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${presetAtivo === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>{l}</button>
        ))}
        <select onChange={(e) => e.target.value !== '' && aplicarMes(Number(e.target.value))} value={presetAtivo.startsWith('mes-') ? presetAtivo.split('-')[1] : ''} className="px-2 py-1 rounded-full text-xs border border-gray-200 bg-white text-gray-600">
          <option value="">Mês de…</option>
          {MESES.map((m, i) => <option key={m} value={i}>{m}/{anoAtual}</option>)}
        </select>
        <select onChange={(e) => e.target.value !== '' && aplicarAno(Number(e.target.value))} value={presetAtivo.startsWith('ano-') ? presetAtivo.split('-')[1] : ''} className="px-2 py-1 rounded-full text-xs border border-gray-200 bg-white text-gray-600">
          <option value="">Ano…</option>
          {[anoAtual, anoAtual - 1, anoAtual - 2].map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-5 bg-gray-50 border border-gray-200 rounded-xl p-3">
        <div className="flex rounded-lg overflow-hidden border border-gray-200">
          <button onClick={() => setModo('pessoa')} className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${modo === 'pessoa' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}><Users size={15} /> Por pessoa</button>
          <button onClick={() => setModo('lista')} className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${modo === 'lista' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}><List size={15} /> Lista</button>
        </div>
        <select value={tipoInteracao} onChange={(e) => setTipo(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
          <option value="">Todos os tipos</option><option value="like">❤️ Curtidas</option><option value="comment">💬 Comentários</option><option value="share">🔁 Compartilhamentos</option>
        </select>
        <select value={plataforma} onChange={(e) => setPlat(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
          <option value="">Todas as redes</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="twitter">Twitter/X</option>
        </select>
        <div className="flex items-center gap-1 text-sm text-gray-600">
          <input type="date" value={de} onChange={(e) => { setDe(e.target.value); setPresetAtivo('') }} className="border border-gray-300 rounded-lg px-2 py-1.5" />
          <span>→</span>
          <input type="date" value={ate} onChange={(e) => { setAte(e.target.value); setPresetAtivo('') }} className="border border-gray-300 rounded-lg px-2 py-1.5" />
          {(de || ate) && <button onClick={limparData} className="text-xs text-gray-400 hover:text-gray-700 ml-1">limpar</button>}
        </div>
        <div className="flex items-center gap-1 flex-1 min-w-[160px]">
          <Search size={15} className="text-gray-400" />
          <input value={pessoa} onChange={(e) => setPessoa(e.target.value)} placeholder="Buscar pessoa…" className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1" />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 py-12 justify-center"><Loader2 className="animate-spin" size={18} /> Carregando…</div>
      ) : modo === 'pessoa' ? (
        <div className="overflow-x-auto border border-gray-200 rounded-xl bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-left text-xs uppercase tracking-wide">
              <tr><th className="px-3 py-3 text-center w-12">#</th><th className="px-4 py-3">Pessoa</th><th className="px-3 py-3 text-center">❤️</th><th className="px-3 py-3 text-center">💬</th><th className="px-3 py-3 text-center">🔁</th><th className="px-3 py-3 text-center">Total</th><th className="px-3 py-3 text-center">Posts</th><th className="px-3 py-3">Redes</th><th className="px-3 py-3"></th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pessoas.map((p, i) => (
                <tr key={p.pessoa} className="hover:bg-gray-50">
                  <td className={`px-3 py-2.5 text-center font-bold ${i < 3 ? 'text-amber-500' : 'text-gray-400'}`}>{i + 1}º</td>
                  <td className="px-4 py-2.5 font-medium text-gray-900">{p.pessoa}</td>
                  <td className="px-3 py-2.5 text-center text-rose-600 font-medium">{p.like || '—'}</td>
                  <td className="px-3 py-2.5 text-center text-blue-600 font-medium">{p.comment || '—'}</td>
                  <td className="px-3 py-2.5 text-center text-green-600 font-medium">{p.share || '—'}</td>
                  <td className="px-3 py-2.5 text-center font-bold text-gray-900">{p.total}</td>
                  <td className="px-3 py-2.5 text-center text-gray-500">{p.nPosts}</td>
                  <td className="px-3 py-2.5">{p.plataformas.map((r) => <span key={r} className={`inline-block text-xs px-2 py-0.5 rounded mr-1 ${REDE(r)}`}>{r}</span>)}</td>
                  <td className="px-3 py-2.5 text-right">{p.comment > 0 && <button onClick={() => { setPessoa(p.pessoa); setTipo('comment'); setModo('lista') }} className="text-blue-600 hover:underline text-xs whitespace-nowrap">ver comentários →</button>}</td>
                </tr>
              ))}
              {pessoas.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">Nenhuma interação no período/filtros.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-xl bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-left text-xs uppercase tracking-wide">
              <tr><th className="px-4 py-3">Data</th><th className="px-3 py-3">Tipo</th><th className="px-3 py-3">Rede</th><th className="px-3 py-3">Pessoa</th><th className="px-4 py-3">Conteúdo</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lista.map((it) => (
                <tr key={it.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{new Date(it.data).toLocaleDateString('pt-BR')}</td>
                  <td className="px-3 py-2.5">{it.tipo === 'like' ? <Heart size={15} className="text-rose-500" /> : it.tipo === 'comment' ? <MessageCircle size={15} className="text-blue-500" /> : <Share2 size={15} className="text-green-600" />}</td>
                  <td className="px-3 py-2.5"><span className={`text-xs px-2 py-0.5 rounded ${REDE(it.plataforma)}`}>{it.plataforma}</span></td>
                  <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap">{it.pessoa}</td>
                  <td className="px-4 py-2.5 text-gray-600">{it.texto ? it.texto : <span className="inline-flex items-center gap-1 text-gray-400 text-xs"><ImageIcon size={13} /> post {it.postId.slice(0, 8)}…</span>}</td>
                </tr>
              ))}
              {lista.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">Nenhuma interação no período/filtros.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
