'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  Radio,
  FileText,
  BarChart3,
  Send,
  Bot,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Landmark,
  Brain,
  Link2,
  TrendingUp,
  UserCheck,
  ClipboardCheck,
  MessageSquare,
  Sparkles,
  Heart,
  Trophy,
  Activity,
  Calculator,
  Cpu,
} from 'lucide-react'
import { useState, useEffect } from 'react'
import clsx from 'clsx'

const nav = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/pessoas', icon: Users, label: 'Pessoas' },
  { href: '/apoiadores', icon: UserCheck, label: 'Apoiadores' },
  { href: '/checklist', icon: ClipboardCheck, label: 'Checklist Posts' },
  { href: '/inteligencia', icon: Sparkles, label: 'Inteligência' },
  { href: '/disparos', icon: MessageSquare, label: 'Disparos' },
  { href: '/campanha', icon: TrendingUp, label: 'Campanha' },
  { href: '/bond', icon: Link2, label: 'Bond — Social' },
  { href: '/interacoes', icon: Activity, label: 'Interações' },
  { href: '/posts', icon: Trophy, label: 'Posts' },
  { href: '/curtidores', icon: Heart, label: 'Quem curtiu' },
  { href: '/pontuacao', icon: Calculator, label: 'Como pontua' },
  { href: '/analise', icon: Brain, label: 'Análise de Conteúdo' },
  { href: '/monitoramento', icon: Radio, label: 'Monitoramento' },
  { href: '/demandas', icon: FileText, label: 'Demandas' },
  { href: '/produtividade', icon: BarChart3, label: 'Produtividade' },
  { href: '/telegram', icon: Send, label: 'Telegram' },
  { href: '/ia', icon: Bot, label: 'Assistente IA' },
  { href: '/hermes', icon: Cpu, label: 'Hermes Agent' },
  { href: '/configuracoes', icon: Settings, label: 'Configurações' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  // No celular (<768px) recolhe ao montar — senão a w-64 come 2/3 da tela.
  // useEffect (não no initializer) p/ não dar hydration mismatch (SSR não tem window).
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) setCollapsed(true)
  }, [])

  return (
    <aside
      className={clsx(
        'pm-side relative flex flex-col text-slate-300 transition-all duration-300 min-h-screen',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      <div className="pm-side-head flex items-center gap-3 px-4 py-5">
        <span className="pm-reactor shrink-0" aria-hidden>
          <Landmark className="w-4 h-4" />
        </span>
        {!collapsed && (
          <span className="font-bold text-white text-sm leading-tight tracking-tight">
            Politi<span style={{ color: 'oklch(0.82 0.15 60)' }}>Monitor</span>
          </span>
        )}
      </div>

      <nav className="flex-1 py-4 space-y-1 px-2">
        {nav.map(({ href, icon: Icon, label }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              title={label}
              aria-label={label}
              className={clsx('pm-nav', active && 'on')}
            >
              <Icon className="w-5 h-5 shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          )
        })}
      </nav>

      <div className="px-2 pb-4 pt-3" style={{ borderTop: '1px solid oklch(0.34 0.05 262 / 0.5)' }}>
        <form action="/api/auth/logout" method="POST">
          <button type="submit" className="pm-nav w-full">
            <LogOut className="w-5 h-5 shrink-0" />
            {!collapsed && <span>Sair</span>}
          </button>
        </form>
      </div>

      <button
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
        className="pm-collapse absolute -right-3 top-6"
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>
    </aside>
  )
}
