'use client'

import { useEffect, useState } from 'react'
import { FileText, Plus, Search, Edit2, Trash2, Loader2, X, Bot, ChevronDown, ChevronRight, CheckCircle2, Circle, ListChecks, UserRound, CalendarClock } from 'lucide-react'

type Pessoa = { id: string; nome: string }

type Passo = {
  id: string
  descricao: string
  feito: boolean
  responsavel: string | null
  ordem: number
}

type Demanda = {
  id: string
  titulo: string
  descricao: string
  status: string
  prioridade: string
  origem: string | null
  responsavel: string | null
  prazo: string | null
  pessoaId: string | null
  pessoa: Pessoa | null
  resposta: string | null
  resolvidoEm: string | null
  passos: Passo[]
  criadoEm: string
}

const statusLabel: Record<string, string> = { aberta: 'Aberta', em_andamento: 'Em andamento', andamento: 'Em andamento', resolvida: 'Resolvida' }
const statusColor: Record<string, string> = {
  aberta: 'bg-red-100 text-red-700',
  em_andamento: 'bg-amber-100 text-amber-700',
  andamento: 'bg-amber-100 text-amber-700',
  resolvida: 'bg-green-100 text-green-700',
}
const prioridadeColor: Record<string, string> = {
  alta: 'bg-red-100 text-red-700',
  media: 'bg-amber-100 text-amber-700',
  baixa: 'bg-blue-100 text-blue-700',
}

// Faixa de prazo por IDADE da demanda aberta (igual ao Telegram):
// 🟢 ≤1 dia · 🟡 >1 dia · 🔴 >1 semana · ✅ resolvida.
function faixa(d: Demanda) {
  if (d.status === 'resolvida') return { emoji: '✅', label: 'Resolvida', dias: 0, barra: 'border-green-400', chip: 'bg-green-100 text-green-700' }
  const dias = Math.floor((Date.now() - new Date(d.criadoEm).getTime()) / 86400000)
  if (dias > 7) return { emoji: '🔴', label: `Vencida · ${dias} dias`, dias, barra: 'border-red-500', chip: 'bg-red-100 text-red-700' }
  if (dias >= 1) return { emoji: '🟡', label: `${dias} dia(s) aberta`, dias, barra: 'border-amber-400', chip: 'bg-amber-100 text-amber-700' }
  return { emoji: '🟢', label: 'Nova (≤ 1 dia)', dias, barra: 'border-green-400', chip: 'bg-green-100 text-green-700' }
}

const emptyForm = { titulo: '', descricao: '', status: 'aberta', prioridade: 'media', origem: '', responsavel: '', prazo: '', pessoaId: '', resposta: '' }

export default function DemandasPage() {
  const [demandas, setDemandas] = useState<Demanda[]>([])
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [prioridadeFilter, setPrioridadeFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Demanda | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aberto, setAberto] = useState<Record<string, boolean>>({})           // cards expandidos (passos)
  const [novoPasso, setNovoPasso] = useState<Record<string, { d: string; r: string }>>({})

  async function load() {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (statusFilter) params.set('status', statusFilter)
    if (prioridadeFilter) params.set('prioridade', prioridadeFilter)
    const res = await fetch(`/api/demandas?${params}`)
    setDemandas(await res.json())
    setLoading(false)
  }
  async function loadPessoas() {
    const res = await fetch('/api/pessoas')
    setPessoas(await res.json())
  }
  useEffect(() => {
    load(); loadPessoas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, prioridadeFilter])

  function openCreate() { setEditing(null); setForm(emptyForm); setShowModal(true) }
  function openEdit(d: Demanda) {
    setEditing(d)
    setForm({
      titulo: d.titulo, descricao: d.descricao, status: d.status, prioridade: d.prioridade,
      origem: d.origem ?? '', responsavel: d.responsavel ?? '', prazo: d.prazo ? d.prazo.slice(0, 10) : '',
      pessoaId: d.pessoaId ?? '', resposta: d.resposta ?? '',
    })
    setShowModal(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const method = editing ? 'PUT' : 'POST'
    const url = editing ? `/api/demandas/${editing.id}` : '/api/demandas'
    await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    setSaving(false); setShowModal(false); load()
  }
  async function handleDelete(id: string) {
    if (!confirm('Deseja excluir esta demanda?')) return
    await fetch(`/api/demandas/${id}`, { method: 'DELETE' }); load()
  }
  async function mudarStatus(d: Demanda, status: string) {
    await fetch(`/api/demandas/${d.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); load()
  }

  // ── Passos colaborativos ──
  async function addPasso(demandaId: string) {
    const np = novoPasso[demandaId]
    if (!np?.d?.trim()) return
    await fetch('/api/demandas/passos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ demandaId, descricao: np.d, responsavel: np.r }) })
    setNovoPasso({ ...novoPasso, [demandaId]: { d: '', r: '' } }); load()
  }
  async function togglePasso(p: Passo) {
    await fetch('/api/demandas/passos', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passoId: p.id, feito: !p.feito }) }); load()
  }
  async function delPasso(id: string) {
    await fetch(`/api/demandas/passos?passoId=${id}`, { method: 'DELETE' }); load()
  }
  async function gerarRespostaIA() {
    if (!form.descricao) return
    setAiLoading(true)
    const res = await fetch('/api/ia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'resposta', demanda: form.titulo + ': ' + form.descricao }) })
    const data = await res.json()
    if (data.texto) setForm({ ...form, resposta: data.texto })
    setAiLoading(false)
  }

  const abertasVencidas = demandas.filter((d) => faixa(d).emoji === '🔴').length

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FileText className="text-blue-600" /> Demandas</h1>
          <p className="text-gray-500 text-sm mt-1">Solicitações do gabinete — execução colaborativa (passos + responsáveis).</p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" /> Nova Demanda</button>
      </div>

      {/* Legenda das faixas de prazo */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 mb-4">
        <span className="font-medium text-gray-600">Faixa de prazo:</span>
        <span className="inline-flex items-center gap-1">🟢 ≤ 1 dia</span>
        <span className="inline-flex items-center gap-1">🟡 mais de 1 dia</span>
        <span className="inline-flex items-center gap-1">🔴 mais de 1 semana</span>
        {abertasVencidas > 0 && <span className="ml-auto text-red-600 font-medium">⚠️ {abertasVencidas} vencida(s) — alerta diário no Telegram até resolver.</span>}
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Buscar demandas..." value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-9" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input w-40">
          <option value="">Todos os status</option>
          <option value="aberta">Aberta</option>
          <option value="em_andamento">Em andamento</option>
          <option value="resolvida">Resolvida</option>
        </select>
        <select value={prioridadeFilter} onChange={(e) => setPrioridadeFilter(e.target.value)} className="input w-40">
          <option value="">Todas as prioridades</option>
          <option value="alta">Alta</option>
          <option value="media">Média</option>
          <option value="baixa">Baixa</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : demandas.length === 0 ? (
        <div className="card text-center py-12"><FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" /><p className="text-gray-500">Nenhuma demanda encontrada</p></div>
      ) : (
        <div className="space-y-3">
          {demandas.map((d) => {
            const f = faixa(d)
            const feitos = d.passos.filter((p) => p.feito).length
            const pct = d.passos.length ? Math.round((feitos / d.passos.length) * 100) : 0
            const exp = aberto[d.id]
            const np = novoPasso[d.id] ?? { d: '', r: '' }
            return (
              <div key={d.id} className={`card p-4 border-l-4 ${f.barra}`}>
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${f.chip}`}>{f.emoji} {f.label}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[d.status] ?? 'bg-gray-100 text-gray-600'}`}>{statusLabel[d.status] ?? d.status}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${prioridadeColor[d.prioridade] ?? ''}`}>{d.prioridade === 'alta' ? 'Alta' : d.prioridade === 'media' ? 'Média' : 'Baixa'}</span>
                      {d.origem && <span className="text-xs text-gray-400">via {d.origem}</span>}
                      {d.prazo && <span className="text-xs text-gray-400 inline-flex items-center gap-1"><CalendarClock size={12} /> prazo {new Date(d.prazo).toLocaleDateString('pt-BR')}</span>}
                    </div>
                    <h3 className="font-medium text-gray-900">{d.titulo}</h3>
                    <p className="text-sm text-gray-500 mt-1 line-clamp-2">{d.descricao}</p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5">
                      {d.responsavel && <span className="text-xs text-purple-700 inline-flex items-center gap-1"><UserRound size={12} /> {d.responsavel}</span>}
                      {d.pessoa && <span className="text-xs text-blue-600">Solicitante: {d.pessoa.nome}</span>}
                      {d.passos.length > 0 && <span className="text-xs text-gray-500 inline-flex items-center gap-1"><ListChecks size={12} /> {feitos}/{d.passos.length} passos</span>}
                    </div>
                    {d.resposta && (
                      <div className="mt-2 p-2 bg-green-50 rounded-lg border border-green-100">
                        <p className="text-xs text-green-700 font-medium">Resposta:</p>
                        <p className="text-xs text-green-600 mt-0.5 line-clamp-2">{d.resposta}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {d.status !== 'resolvida' && (
                      <button onClick={() => mudarStatus(d, 'resolvida')} title="Marcar resolvida" className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"><CheckCircle2 className="w-4 h-4" /></button>
                    )}
                    <button onClick={() => openEdit(d)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => handleDelete(d.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>

                {/* barra de progresso dos passos */}
                {d.passos.length > 0 && (
                  <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                )}

                {/* execução colaborativa */}
                <button onClick={() => setAberto({ ...aberto, [d.id]: !exp })} className="mt-2 text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1">
                  {exp ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Execução — passos e responsáveis ({d.passos.length})
                </button>
                {exp && (
                  <div className="mt-2 space-y-1.5">
                    {d.passos.map((p) => (
                      <div key={p.id} className="flex items-center gap-2 text-sm group">
                        <button onClick={() => togglePasso(p)} className="shrink-0">
                          {p.feito ? <CheckCircle2 size={16} className="text-green-600" /> : <Circle size={16} className="text-gray-300 hover:text-gray-500" />}
                        </button>
                        <span className={`flex-1 ${p.feito ? 'line-through text-gray-400' : 'text-gray-700'}`}>{p.descricao}</span>
                        {p.responsavel && <span className="text-xs text-purple-600 inline-flex items-center gap-1"><UserRound size={11} /> {p.responsavel}</span>}
                        <button onClick={() => delPasso(p.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500"><X size={13} /></button>
                      </div>
                    ))}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <input value={np.d} onChange={(e) => setNovoPasso({ ...novoPasso, [d.id]: { ...np, d: e.target.value } })} placeholder="Novo passo de execução…" className="input flex-1 min-w-[160px] !py-1.5 text-sm" onKeyDown={(e) => { if (e.key === 'Enter') addPasso(d.id) }} />
                      <input value={np.r} onChange={(e) => setNovoPasso({ ...novoPasso, [d.id]: { ...np, r: e.target.value } })} placeholder="Responsável" className="input w-36 !py-1.5 text-sm" onKeyDown={(e) => { if (e.key === 'Enter') addPasso(d.id) }} />
                      <button onClick={() => addPasso(d.id)} className="btn-secondary !py-1.5 text-sm inline-flex items-center gap-1"><Plus size={14} /> Add</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white">
              <h2 className="font-semibold text-gray-900">{editing ? 'Editar Demanda' : 'Nova Demanda'}</h2>
              <button onClick={() => setShowModal(false)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Título *</label>
                <input required value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} className="input" placeholder="Resumo da demanda" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descrição *</label>
                <textarea required value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} className="input" rows={3} placeholder="Detalhes da demanda..." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="input">
                    <option value="aberta">Aberta</option>
                    <option value="em_andamento">Em andamento</option>
                    <option value="resolvida">Resolvida</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prioridade</label>
                  <select value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value })} className="input">
                    <option value="alta">Alta</option>
                    <option value="media">Média</option>
                    <option value="baixa">Baixa</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Responsável</label>
                  <input value={form.responsavel} onChange={(e) => setForm({ ...form, responsavel: e.target.value })} className="input" placeholder="Quem toca esta demanda" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prazo (opcional)</label>
                  <input type="date" value={form.prazo} onChange={(e) => setForm({ ...form, prazo: e.target.value })} className="input" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Origem</label>
                  <input value={form.origem} onChange={(e) => setForm({ ...form, origem: e.target.value })} className="input" placeholder="Ex: WhatsApp, Telegram..." />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Solicitante</label>
                  <select value={form.pessoaId} onChange={(e) => setForm({ ...form, pessoaId: e.target.value })} className="input">
                    <option value="">Anônimo</option>
                    {pessoas.map((p) => (<option key={p.id} value={p.id}>{p.nome}</option>))}
                  </select>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">Resposta</label>
                  <button type="button" onClick={gerarRespostaIA} disabled={aiLoading || !form.descricao} className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 disabled:opacity-40">
                    {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bot className="w-3 h-3" />} Gerar com IA
                  </button>
                </div>
                <textarea value={form.resposta} onChange={(e) => setForm({ ...form, resposta: e.target.value })} className="input" rows={4} placeholder="Resposta ao cidadão..." />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1">Cancelar</button>
                <button type="submit" className="btn-primary flex-1 flex items-center justify-center gap-2">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{editing ? 'Salvar' : 'Criar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
