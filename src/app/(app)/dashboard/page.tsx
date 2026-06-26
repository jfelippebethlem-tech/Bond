import { prisma } from '@/lib/db'
import Link from 'next/link'
import {
  Users,
  FileText,
  Radio,
  Send,
  AlertCircle,
  CheckCircle,
  Heart,
  MessageCircle,
  Activity,
  UserCheck,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

async function getDashboardData() {
  // Janela de 7 dias bucketada pela data REAL/post (mesmo padrão de src/lib/interacoes.ts):
  // o dashboard reflete a atividade da semana, não o que foi sincronizado.
  const seteDias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const codes7 = (await prisma.bondPost.findMany({ where: { publicadoEm: { gte: seteDias } }, select: { postId: true } })).map((p) => p.postId)
  const filtro7 = { OR: [{ publicadoEm: { gte: seteDias } }, { publicadoEm: null, postId: { in: codes7 } }] }

  const [
    totalPessoas,
    totalFuncionarios,
    totalApoiadores,
    demandasAbertas,
    demandasAlta,
    demandasResolvidas,
    recentedemandas,
    recenteTelegram,
    bondPlataformas,
    bondFaCount,
    interSemana,
    comentSemana,
    comentPendentes,
    interacoes7,
  ] = await Promise.all([
    prisma.pessoa.count({ where: { ativo: true } }),
    prisma.pessoa.count({ where: { tipo: 'funcionario', ativo: true } }),
    prisma.pessoa.count({ where: { tipo: 'apoiador', ativo: true } }),
    prisma.demanda.count({ where: { status: 'aberta' } }),
    prisma.demanda.count({ where: { status: 'aberta', prioridade: 'alta' } }),
    prisma.demanda.count({ where: { status: 'resolvida' } }),
    prisma.demanda.findMany({ take: 5, orderBy: { criadoEm: 'desc' }, include: { pessoa: true } }),
    prisma.telegramMensagem.findMany({ take: 5, orderBy: { criadoEm: 'desc' } }),
    prisma.bondPost.groupBy({ by: ['plataforma'], _count: { _all: true } }),
    prisma.bondFa.count(),
    prisma.bondInteracao.count({ where: filtro7 }),
    prisma.bondComentario.count({ where: filtro7 }),
    prisma.bondComentario.count({ where: { respondido: false } }),
    prisma.bondInteracao.findMany({ where: filtro7, select: { externalId: true, tipo: true } }),
  ])

  // Top engajadores da semana (lê os nomes em 1 query extra)
  const porFa = new Map<string, number>()
  for (const i of interacoes7) porFa.set(i.externalId, (porFa.get(i.externalId) ?? 0) + (i.tipo === 'comment' ? 2 : i.tipo === 'share' ? 3 : 1))
  const topIds = Array.from(porFa.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const fas = topIds.length ? await prisma.bondFa.findMany({ where: { externalId: { in: topIds.map(([id]) => id) } }, select: { externalId: true, nome: true, username: true } }) : []
  const nomeDe = new Map(fas.map((f) => [f.externalId, f.nome || f.username || f.externalId]))
  const topEngajadores = topIds.map(([id, score]) => ({ nome: String(nomeDe.get(id) || id), score }))

  return {
    totalPessoas, totalFuncionarios, totalApoiadores,
    demandasAbertas, demandasAlta, demandasResolvidas,
    recentedemandas, recenteTelegram, bondPlataformas,
    bondFaCount, interSemana, comentSemana, comentPendentes, topEngajadores,
  }
}

export default async function DashboardPage() {
  const data = await getDashboardData()

  // Cards VIVOS (audiência/engajamento Bond) — o coração da operação de redes.
  const bondStats = [
    { label: 'Engajadores mapeados', value: data.bondFaCount, sub: 'pessoas que já interagiram', icon: UserCheck, color: 'bg-indigo-500', href: '/interacoes' },
    { label: 'Interações na semana', value: data.interSemana, sub: 'curtidas + comentários (7 dias)', icon: Activity, color: 'bg-rose-500', href: '/interacoes' },
    { label: 'Comentários na semana', value: data.comentSemana, sub: 'em posts dos últimos 7 dias', icon: MessageCircle, color: 'bg-blue-500', href: '/interacoes' },
    { label: 'Comentários a responder', value: data.comentPendentes, sub: 'aguardando resposta', icon: Heart, color: 'bg-amber-500', href: '/bond' },
  ]
  // Cards do gabinete (cadastro interno).
  const gabinete = [
    { label: 'Pessoas cadastradas', value: data.totalPessoas, sub: `${data.totalFuncionarios} func. · ${data.totalApoiadores} apoia.`, icon: Users, color: 'bg-slate-500', href: '/pessoas' },
    { label: 'Demandas abertas', value: data.demandasAbertas, sub: `${data.demandasAlta} de alta prioridade`, icon: AlertCircle, color: 'bg-red-500', href: '/demandas' },
    { label: 'Demandas resolvidas', value: data.demandasResolvidas, sub: 'total histórico', icon: CheckCircle, color: 'bg-green-500', href: '/demandas' },
  ]

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Visão geral do gabinete e da audiência nas redes</p>
      </div>

      {/* Audiência / engajamento (dados vivos) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        {bondStats.map((stat) => (
          <Link key={stat.label} href={stat.href} className="card group transition hover:shadow-md hover:-translate-y-0.5">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <p className="text-sm text-gray-500">{stat.label}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1 tabular-nums">{stat.value.toLocaleString('pt-BR')}</p>
                <p className="text-xs text-gray-400 mt-1">{stat.sub}</p>
              </div>
              <div className={`${stat.color} p-3 rounded-xl shrink-0 shadow-sm`}>
                <stat.icon className="w-5 h-5 text-white" />
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Gabinete */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
        {gabinete.map((stat) => (
          <Link key={stat.label} href={stat.href} className="card flex items-center gap-4 transition hover:shadow-md">
            <div className={`${stat.color} p-2.5 rounded-xl shrink-0`}>
              <stat.icon className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-gray-900 leading-none tabular-nums">{stat.value.toLocaleString('pt-BR')}</p>
              <p className="text-sm text-gray-600 mt-1">{stat.label}</p>
              <p className="text-xs text-gray-400">{stat.sub}</p>
            </div>
          </Link>
        ))}
      </div>

      <div className="card mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Radio className="w-5 h-5 text-gray-400" />
          <h2 className="font-semibold text-gray-900">Redes Sociais Conectadas</h2>
        </div>
        <div className="flex flex-wrap gap-4">
          {([
            { key: 'instagram', label: 'Instagram', color: 'bg-pink-500' },
            { key: 'facebook', label: 'Facebook', color: 'bg-blue-600' },
            { key: 'twitter', label: 'Twitter/X', color: 'bg-gray-800' },
          ] as const).map((rede) => {
            const n = data.bondPlataformas.find((p) => p.plataforma === rede.key)?._count._all ?? 0
            return (
              <div key={rede.key} className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${n > 0 ? rede.color : 'bg-gray-300'}`} />
                <span className="text-sm text-gray-700">{rede.label}</span>
                <span className="text-sm font-semibold text-gray-900">{n}</span>
                <span className="text-xs text-gray-400">posts</span>
                {n === 0 && <span className="text-xs text-gray-400">(não conectado)</span>}
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-5 h-5 text-gray-400" />
            <h2 className="font-semibold text-gray-900">Demandas Recentes</h2>
          </div>
          {data.recentedemandas.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Nenhuma demanda ainda</p>
          ) : (
            <div className="space-y-3">
              {data.recentedemandas.map((d) => (
                <div key={d.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <div
                    className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                      d.prioridade === 'alta'
                        ? 'bg-red-500'
                        : d.prioridade === 'media'
                        ? 'bg-yellow-500'
                        : 'bg-blue-500'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{d.titulo}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {d.pessoa?.nome ?? 'Anônimo'} ·{' '}
                      {formatDistanceToNow(new Date(d.criadoEm), {
                        addSuffix: true,
                        locale: ptBR,
                      })}
                    </p>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      d.status === 'aberta'
                        ? 'bg-red-100 text-red-700'
                        : d.status === 'em_andamento'
                        ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-green-100 text-green-700'
                    }`}
                  >
                    {d.status === 'aberta'
                      ? 'Aberta'
                      : d.status === 'em_andamento'
                      ? 'Em andamento'
                      : 'Resolvida'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Send className="w-5 h-5 text-gray-400" />
            <h2 className="font-semibold text-gray-900">Telegram Recente</h2>
          </div>
          {data.recenteTelegram.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Nenhuma mensagem ainda</p>
          ) : (
            <div className="space-y-3">
              {data.recenteTelegram.map((msg) => (
                <div key={msg.id} className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-700">
                      {msg.nome ?? msg.username ?? msg.chatId}
                    </span>
                    {!msg.respondida && (
                      <span className="w-2 h-2 rounded-full bg-blue-500" />
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate">{msg.mensagem}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {data.topEngajadores.length > 0 && (
        <div className="card mt-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Heart className="w-5 h-5 text-rose-400" />
              <h2 className="font-semibold text-gray-900">Top engajadores da semana</h2>
            </div>
            <Link href="/interacoes" className="text-xs text-blue-600 hover:underline">ver todos →</Link>
          </div>
          <div className="space-y-2">
            {data.topEngajadores.map((e, i) => (
              <div key={e.nome} className="flex items-center gap-3 p-2.5 bg-gray-50 rounded-lg">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${i < 3 ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 text-gray-500'}`}>{i + 1}</span>
                <span className="text-sm font-medium text-gray-800 flex-1 truncate">{e.nome}</span>
                <span className="text-sm font-semibold text-gray-900 tabular-nums">{e.score.toLocaleString('pt-BR')}</span>
                <span className="text-xs text-gray-400">pts</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
