'use client'

import { useState, useEffect, useRef } from 'react'
import {
  Brain,
  Loader2,
  Send,
  Lightbulb,
  AlertTriangle,
  BarChart2,
  RefreshCw,
  CheckCheck,
  ChevronRight,
  Database,
  Clock,
  Zap,
} from 'lucide-react'

type Insight = {
  id: string
  titulo: string
  descricao: string
  tipo: string
  prioridade: string
  lido: boolean
  criadoEm: string
}

type Job = {
  id: string
  tipo: string
  status: string
  criadoEm: string
  processadoEm?: string
}

type Memoria = {
  id: string
  tipo: string
  chave: string
  conteudo: string
  relevancia: number
}

type Msg = { role: 'user' | 'assistant'; content: string }

const TIPO_ICON: Record<string, React.ReactNode> = {
  alerta: <AlertTriangle className="w-4 h-4 text-red-500" />,
  sugestao: <Lightbulb className="w-4 h-4 text-yellow-500" />,
  resumo: <BarChart2 className="w-4 h-4 text-blue-500" />,
  padrao: <Brain className="w-4 h-4 text-purple-500" />,
  acao: <Zap className="w-4 h-4 text-green-500" />,
}

const STATUS_COLOR: Record<string, string> = {
  pendente: 'bg-yellow-100 text-yellow-700',
  processando: 'bg-blue-100 text-blue-700',
  concluido: 'bg-green-100 text-green-700',
  erro: 'bg-red-100 text-red-700',
}

export default function HermesPage() {
  const [tab, setTab] = useState<'insights' | 'chat' | 'memoria' | 'jobs'>('insights')
  const [insights, setInsights] = useState<Insight[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [memorias, setMemorias] = useState<Memoria[]>([])
  const [loading, setLoading] = useState(true)
  const [chatMsgs, setChatMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [solicitandoResumo, setSolicitandoResumo] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  async function carregar() {
    setLoading(true)
    const res = await fetch('/api/hermes')
    const data = await res.json()
    setInsights(data.insights ?? [])
    setJobs(data.jobs ?? [])
    setMemorias(data.memorias ?? [])
    setLoading(false)
  }

  useEffect(() => {
    carregar()
    const iv = setInterval(carregar, 15000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMsgs])

  async function enviarMensagem(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || sending) return
    const msg = input.trim()
    setInput('')
    setChatMsgs((prev) => [...prev, { role: 'user', content: msg }])
    setSending(true)

    const res = await fetch('/api/hermes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        acao: 'chat',
        mensagem: msg,
        historico: chatMsgs.slice(-10),
      }),
    })
    const data = await res.json()
    setChatMsgs((prev) => [
      ...prev,
      { role: 'assistant', content: data.resposta ?? 'Erro ao obter resposta.' },
    ])
    setSending(false)
  }

  async function marcarTodosLidos() {
    await fetch('/api/hermes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: 'marcar_todos_lidos' }),
    })
    setInsights((prev) => prev.map((i) => ({ ...i, lido: true })))
  }

  async function solicitarResumo() {
    setSolicitandoResumo(true)
    await fetch('/api/hermes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: 'resumo' }),
    })
    setTimeout(() => {
      carregar()
      setSolicitandoResumo(false)
    }, 3000)
  }

  const naoLidos = insights.filter((i) => !i.lido).length

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center">
              <Brain className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Hermes</h1>
            <span className="flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
              Aprendendo
            </span>
          </div>
          <p className="text-gray-500 text-sm mt-1 ml-10">
            Agente autônomo paralelo — analisa, aprende e sugere ações
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={solicitarResumo}
            disabled={solicitandoResumo}
            className="btn-secondary flex items-center gap-1.5 text-xs"
          >
            {solicitandoResumo ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <BarChart2 className="w-3.5 h-3.5" />
            )}
            Resumo Agora
          </button>
          <button onClick={carregar} className="btn-secondary flex items-center gap-1.5 text-xs">
            <RefreshCw className="w-3.5 h-3.5" />
            Atualizar
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1">
        {[
          { id: 'insights', label: `Insights${naoLidos > 0 ? ` (${naoLidos})` : ''}`, icon: Lightbulb },
          { id: 'chat', label: 'Chat com Hermes', icon: Brain },
          { id: 'memoria', label: `Memória (${memorias.length})`, icon: Database },
          { id: 'jobs', label: 'Jobs', icon: Clock },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id as typeof tab)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium flex-1 justify-center transition-colors ${
              tab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {/* INSIGHTS */}
          {tab === 'insights' && (
            <div>
              {naoLidos > 0 && (
                <div className="flex justify-end mb-3">
                  <button
                    onClick={marcarTodosLidos}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    Marcar todos como lidos
                  </button>
                </div>
              )}
              {insights.length === 0 ? (
                <div className="card text-center py-12">
                  <Brain className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-400 text-sm">
                    Hermes ainda está aprendendo. Insights aparecerão aqui.
                  </p>
                  <p className="text-gray-300 text-xs mt-1">
                    Execute o worker: <code>npm run hermes</code>
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {insights.map((insight) => (
                    <div
                      key={insight.id}
                      className={`card p-4 border-l-4 ${
                        insight.prioridade === 'alta'
                          ? 'border-red-400'
                          : insight.prioridade === 'media'
                          ? 'border-yellow-400'
                          : 'border-blue-400'
                      } ${insight.lido ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5">{TIPO_ICON[insight.tipo] ?? <Lightbulb className="w-4 h-4 text-gray-400" />}</div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <p className="text-sm font-semibold text-gray-900">{insight.titulo}</p>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 badge-${insight.prioridade}`}>
                              {insight.prioridade}
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 whitespace-pre-line line-clamp-4">
                            {insight.descricao}
                          </p>
                          <p className="text-xs text-gray-400 mt-2">
                            {new Date(insight.criadoEm).toLocaleString('pt-BR')}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* CHAT */}
          {tab === 'chat' && (
            <div className="card flex flex-col" style={{ height: '520px' }}>
              <div className="flex-1 overflow-y-auto space-y-4 pb-4">
                {chatMsgs.length === 0 && (
                  <div className="text-center py-12">
                    <Brain className="w-10 h-10 text-purple-200 mx-auto mb-3" />
                    <p className="text-gray-400 text-sm">
                      Olá! Sou o Hermes. Pergunte sobre demandas, tendências, estratégia política...
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2 justify-center">
                      {[
                        'Qual o status do gabinete hoje?',
                        'Quais demandas são mais urgentes?',
                        'Que assuntos estão em alta nas redes?',
                      ].map((s) => (
                        <button
                          key={s}
                          onClick={() => setInput(s)}
                          className="text-xs bg-purple-50 text-purple-600 px-3 py-1.5 rounded-full hover:bg-purple-100 flex items-center gap-1"
                        >
                          <ChevronRight className="w-3 h-3" />
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {chatMsgs.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {msg.role === 'assistant' && (
                      <div className="w-6 h-6 bg-purple-600 rounded-full flex items-center justify-center mr-2 shrink-0 mt-1">
                        <Brain className="w-3 h-3 text-white" />
                      </div>
                    )}
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                        msg.role === 'user'
                          ? 'bg-blue-600 text-white rounded-tr-sm'
                          : 'bg-gray-100 text-gray-800 rounded-tl-sm'
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
                {sending && (
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-purple-600 rounded-full flex items-center justify-center shrink-0">
                      <Brain className="w-3 h-3 text-white" />
                    </div>
                    <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-2.5">
                      <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <form onSubmit={enviarMensagem} className="flex gap-2 pt-3 border-t border-gray-100">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="input flex-1"
                  placeholder="Pergunte ao Hermes..."
                  disabled={sending}
                />
                <button
                  type="submit"
                  disabled={sending || !input.trim()}
                  className="btn-primary px-3 disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          )}

          {/* MEMÓRIA */}
          {tab === 'memoria' && (
            <div>
              {memorias.length === 0 ? (
                <div className="card text-center py-12">
                  <Database className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-400 text-sm">Nenhuma memória ainda. Execute o worker para começar.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {['contexto', 'padrao', 'estatistica', 'preferencia', 'cidadao', 'assunto'].map(
                    (tipo) => {
                      const items = memorias.filter((m) => m.tipo === tipo)
                      if (!items.length) return null
                      return (
                        <div key={tipo} className="card p-4">
                          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                            {tipo}
                          </h3>
                          <div className="space-y-1.5">
                            {items.map((m) => (
                              <div key={m.id} className="flex gap-3 text-sm">
                                <span className="text-gray-400 min-w-[180px] truncate font-mono text-xs">
                                  {m.chave}
                                </span>
                                <span className="text-gray-700 flex-1">{m.conteudo}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    }
                  )}
                </div>
              )}
            </div>
          )}

          {/* JOBS */}
          {tab === 'jobs' && (
            <div className="card">
              {jobs.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-8">Nenhum job ainda</p>
              ) : (
                <div className="space-y-2">
                  {jobs.map((job) => (
                    <div key={job.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[job.status] ?? 'bg-gray-100 text-gray-700'}`}>
                        {job.status}
                      </span>
                      <span className="text-sm text-gray-700 font-mono flex-1">{job.tipo}</span>
                      <span className="text-xs text-gray-400">
                        {new Date(job.criadoEm).toLocaleTimeString('pt-BR')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                <p className="text-xs text-blue-700">
                  <strong>Para o Hermes trabalhar em paralelo:</strong> execute em outro terminal:
                </p>
                <code className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded mt-1 block">
                  npm run hermes
                </code>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
