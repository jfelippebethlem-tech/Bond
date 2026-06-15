'use client'

import { useState, useEffect, useCallback } from 'react'
import { CheckSquare, Clock, Users, Heart, MessageCircle, Share2, XCircle, CheckCircle, Download, RefreshCw, AlertCircle } from 'lucide-react'

type PostItem = {
  id: string
  postId: string
  plataforma: string
  conteudo: string
  tipo: string
  url: string | null
  imagemUrl: string | null
  likes: number
  comentarios: number
  compartilhos: number
  publicadoEm: string
  horasDesdePost: number
  apoiadoresEngajados: number
  relatorioGerado: boolean
  relatorioEm: string | null
}

type ChecklistItem = {
  pessoaId: string
  nome: string
  tipo: string
  cargo: string | null
  instagram: string | null
  twitter: string | null
  facebook: string | null
  vinculado: boolean
  externalId: string | null
  tipos: string[]
  curtiu: boolean
  comentou: boolean
  compartilhou: boolean
  interagiu: boolean
}

type ChecklistData = {
  post: PostItem
  checklist: ChecklistItem[]
  totalApoiadores: number
  interagiram: number
  naoInteragiram: number
  relatorioGerado: boolean
  relatorioEm: string | null
}

const PLAT_LABEL: Record<string, string> = { instagram: '📸 Instagram', twitter: '🐦 Twitter', facebook: '👥 Facebook' }
const TIPO_BADGE: Record<string, string> = { apoiador: 'bg-blue-900 text-blue-300', coordenador: 'bg-purple-900 text-purple-300' }

function dataRelativa(iso: string) {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  if (h >= 24) return `${Math.floor(h / 24)}d atrás`
  if (h > 0) return `${h}h${m > 0 ? `${m}m` : ''} atrás`
  return `${m}min atrás`
}

function exportarCSV(post: PostItem, checklist: ChecklistItem[]) {
  const rows = [['Nome', 'Tipo', 'Cargo', 'Curtiu', 'Comentou', 'Compartilhou', 'Status', 'Instagram', 'Twitter', 'Facebook']]
  for (const c of checklist) {
    rows.push([
      c.nome,
      c.tipo,
      c.cargo ?? '',
      c.curtiu ? 'Sim' : 'Não',
      c.comentou ? 'Sim' : 'Não',
      c.compartilhou ? 'Sim' : 'Não',
      c.interagiu ? 'Interagiu' : 'Pendente',
      c.instagram ?? '',
      c.twitter ?? '',
      c.facebook ?? '',
    ])
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `checklist-${post.plataforma}-${post.id.slice(0, 8)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function ChecklistPage() {
  const [posts, setPosts] = useState<PostItem[]>([])
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null)
  const [checklistData, setChecklistData] = useState<ChecklistData | null>(null)
  const [loadingPosts, setLoadingPosts] = useState(true)
  const [loadingChecklist, setLoadingChecklist] = useState(false)
  const [filtro, setFiltro] = useState<'todos' | 'interagiram' | 'pendentes'>('todos')

  const carregarPosts = useCallback(async () => {
    setLoadingPosts(true)
    try {
      const res = await fetch('/api/bond/checklist?tipo=posts')
      if (res.ok) setPosts(await res.json())
    } finally {
      setLoadingPosts(false)
    }
  }, [])

  const carregarChecklist = useCallback(async (postId: string) => {
    setLoadingChecklist(true)
    try {
      const res = await fetch(`/api/bond/checklist?postId=${postId}`)
      if (res.ok) setChecklistData(await res.json())
    } finally {
      setLoadingChecklist(false)
    }
  }, [])

  useEffect(() => { carregarPosts() }, [carregarPosts])

  useEffect(() => {
    if (selectedPostId) carregarChecklist(selectedPostId)
  }, [selectedPostId, carregarChecklist])

  const checklistFiltrado = checklistData?.checklist.filter(c => {
    if (filtro === 'interagiram') return c.interagiu
    if (filtro === 'pendentes') return !c.interagiu
    return true
  }) ?? []

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Sidebar de posts */}
      <div className="w-72 shrink-0 border-r border-slate-700 flex flex-col bg-slate-900">
        <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckSquare className="w-5 h-5 text-blue-400" />
            <span className="font-semibold text-white text-sm">Posts Recentes</span>
          </div>
          <button onClick={carregarPosts} className="text-slate-400 hover:text-white">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingPosts ? (
            <div className="p-4 text-center text-slate-500 text-sm">Carregando...</div>
          ) : posts.length === 0 ? (
            <div className="p-4 text-center text-slate-500 text-sm">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
              Nenhum post sincronizado ainda
            </div>
          ) : (
            posts.map(post => (
              <button
                key={post.id}
                onClick={() => setSelectedPostId(post.id)}
                className={`w-full text-left px-3 py-3 border-b border-slate-800 hover:bg-slate-800 transition-colors ${
                  selectedPostId === post.id ? 'bg-slate-800 border-l-2 border-l-blue-500' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-xs text-slate-400">{PLAT_LABEL[post.plataforma] ?? post.plataforma}</span>
                  {post.relatorioGerado ? (
                    <span className="text-xs text-green-400 shrink-0">✓ Rel.</span>
                  ) : post.horasDesdePost >= 6 ? (
                    <span className="text-xs text-orange-400 shrink-0">⚠ Pendente</span>
                  ) : (
                    <span className="text-xs text-slate-500 shrink-0">{post.horasDesdePost}h</span>
                  )}
                </div>
                <p className="text-xs text-slate-300 line-clamp-2 mb-1">
                  {post.conteudo || '(sem texto)'}
                </p>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>❤️ {post.likes}</span>
                  <span>💬 {post.comentarios}</span>
                  <span>🔄 {post.compartilhos}</span>
                  {post.apoiadoresEngajados > 0 && (
                    <span className="ml-auto text-blue-400 font-medium">{post.apoiadoresEngajados} apoiadores</span>
                  )}
                </div>
                <div className="text-xs text-slate-600 mt-1">{dataRelativa(post.publicadoEm)}</div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Painel principal */}
      <div className="flex-1 overflow-y-auto bg-slate-950">
        {!selectedPostId ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <CheckSquare className="w-16 h-16 mb-4 opacity-30" />
            <p className="text-lg font-medium">Selecione um post</p>
            <p className="text-sm mt-1">Veja quais apoiadores interagiram com cada publicação</p>
          </div>
        ) : loadingChecklist ? (
          <div className="flex items-center justify-center h-full text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mr-2" />
            Carregando checklist...
          </div>
        ) : checklistData ? (
          <div className="p-6">
            {/* Cabeçalho do post */}
            <div className="bg-slate-900 rounded-xl p-4 mb-6 border border-slate-700">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium text-slate-300">
                      {PLAT_LABEL[checklistData.post.plataforma] ?? checklistData.post.plataforma}
                    </span>
                    <span className="text-xs text-slate-500">•</span>
                    <span className="text-xs text-slate-500">{dataRelativa(checklistData.post.publicadoEm)}</span>
                    {checklistData.relatorioGerado && (
                      <span className="ml-auto text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded-full">
                        ✓ Relatório gerado
                      </span>
                    )}
                    {!checklistData.relatorioGerado && checklistData.post.horasDesdePost >= 6 && (
                      <span className="ml-auto text-xs bg-orange-900 text-orange-300 px-2 py-0.5 rounded-full">
                        ⚠ Relatório pendente
                      </span>
                    )}
                    {!checklistData.relatorioGerado && checklistData.post.horasDesdePost < 6 && (
                      <span className="ml-auto text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">
                        <Clock className="inline w-3 h-3 mr-1" />
                        Rel. em {6 - checklistData.post.horasDesdePost}h
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-white leading-relaxed line-clamp-3">
                    {checklistData.post.conteudo || '(publicação sem texto)'}
                  </p>
                  {checklistData.post.url && (
                    <a href={checklistData.post.url} target="_blank" rel="noreferrer"
                      className="text-xs text-blue-400 hover:underline mt-1 block">
                      Ver publicação →
                    </a>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-6 mt-3 pt-3 border-t border-slate-700">
                <div className="flex items-center gap-1.5 text-sm text-slate-300">
                  <Heart className="w-4 h-4 text-red-400" />
                  <span>{checklistData.post.likes.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-1.5 text-sm text-slate-300">
                  <MessageCircle className="w-4 h-4 text-blue-400" />
                  <span>{checklistData.post.comentarios.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-1.5 text-sm text-slate-300">
                  <Share2 className="w-4 h-4 text-green-400" />
                  <span>{checklistData.post.compartilhos.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Resumo */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-slate-900 rounded-xl p-4 border border-slate-700 text-center">
                <div className="text-2xl font-bold text-white">{checklistData.totalApoiadores}</div>
                <div className="text-xs text-slate-400 mt-1">
                  <Users className="inline w-3 h-3 mr-1" />
                  Total de apoiadores
                </div>
              </div>
              <div className="bg-green-950 rounded-xl p-4 border border-green-800 text-center">
                <div className="text-2xl font-bold text-green-400">{checklistData.interagiram}</div>
                <div className="text-xs text-green-600 mt-1">
                  <CheckCircle className="inline w-3 h-3 mr-1" />
                  Interagiram
                </div>
              </div>
              <div className="bg-red-950 rounded-xl p-4 border border-red-800 text-center">
                <div className="text-2xl font-bold text-red-400">{checklistData.naoInteragiram}</div>
                <div className="text-xs text-red-600 mt-1">
                  <XCircle className="inline w-3 h-3 mr-1" />
                  Não interagiram
                </div>
              </div>
            </div>

            {/* Barra de progresso */}
            {checklistData.totalApoiadores > 0 && (
              <div className="mb-6">
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Taxa de engajamento dos apoiadores</span>
                  <span>{Math.round((checklistData.interagiram / checklistData.totalApoiadores) * 100)}%</span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-600 to-green-500 transition-all"
                    style={{ width: `${(checklistData.interagiram / checklistData.totalApoiadores) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Filtros e exportar */}
            <div className="flex items-center gap-3 mb-4">
              <div className="flex bg-slate-800 rounded-lg p-1 gap-1">
                {(['todos', 'interagiram', 'pendentes'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setFiltro(f)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      filtro === f ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {f === 'todos' && `Todos (${checklistData.totalApoiadores})`}
                    {f === 'interagiram' && `✅ Interagiram (${checklistData.interagiram})`}
                    {f === 'pendentes' && `❌ Pendentes (${checklistData.naoInteragiram})`}
                  </button>
                ))}
              </div>
              <button
                onClick={() => exportarCSV(checklistData.post, checklistData.checklist)}
                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-xs transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Exportar CSV
              </button>
            </div>

            {/* Tabela checklist */}
            <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 text-xs text-slate-400 uppercase tracking-wide">
                    <th className="text-left px-4 py-3">Apoiador</th>
                    <th className="text-center px-3 py-3">
                      <Heart className="w-3.5 h-3.5 inline text-red-400" /> Curtiu
                    </th>
                    <th className="text-center px-3 py-3">
                      <MessageCircle className="w-3.5 h-3.5 inline text-blue-400" /> Comentou
                    </th>
                    <th className="text-center px-3 py-3">
                      <Share2 className="w-3.5 h-3.5 inline text-green-400" /> Compartilhou
                    </th>
                    <th className="text-center px-3 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {checklistFiltrado.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-slate-500 text-sm">
                        Nenhum apoiador nesta categoria
                      </td>
                    </tr>
                  ) : (
                    checklistFiltrado.map((c, i) => (
                      <tr
                        key={c.pessoaId}
                        className={`border-b border-slate-800 hover:bg-slate-800/50 transition-colors ${
                          !c.interagiu ? 'bg-red-950/20' : ''
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                                c.interagiu ? 'bg-green-900 text-green-300' : 'bg-red-900/50 text-red-400'
                              }`}
                            >
                              {c.nome.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-medium text-white text-sm">{c.nome}</div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className={`text-xs px-1.5 py-0.5 rounded-full ${TIPO_BADGE[c.tipo] ?? 'bg-slate-700 text-slate-400'}`}>
                                  {c.tipo === 'coordenador' ? 'Coord.' : 'Apoiador'}
                                </span>
                                {c.cargo && <span className="text-xs text-slate-500">{c.cargo}</span>}
                                {!c.vinculado && (
                                  <span className="text-xs text-amber-600" title="Sem conta vinculada nesta plataforma">
                                    ⚠ não vinculado
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="text-center px-3 py-3">
                          {c.curtiu ? (
                            <span className="text-green-400 text-lg">✅</span>
                          ) : (
                            <span className="text-slate-700 text-lg">—</span>
                          )}
                        </td>
                        <td className="text-center px-3 py-3">
                          {c.comentou ? (
                            <span className="text-green-400 text-lg">✅</span>
                          ) : (
                            <span className="text-slate-700 text-lg">—</span>
                          )}
                        </td>
                        <td className="text-center px-3 py-3">
                          {c.compartilhou ? (
                            <span className="text-green-400 text-lg">✅</span>
                          ) : (
                            <span className="text-slate-700 text-lg">—</span>
                          )}
                        </td>
                        <td className="text-center px-3 py-3">
                          {c.interagiu ? (
                            <span className="inline-flex items-center gap-1 text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded-full">
                              <CheckCircle className="w-3 h-3" />
                              Interagiu
                            </span>
                          ) : c.vinculado ? (
                            <span className="inline-flex items-center gap-1 text-xs bg-red-900/60 text-red-400 px-2 py-0.5 rounded-full">
                              <XCircle className="w-3 h-3" />
                              Pendente
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs bg-amber-900/40 text-amber-500 px-2 py-0.5 rounded-full">
                              Sem conta
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
