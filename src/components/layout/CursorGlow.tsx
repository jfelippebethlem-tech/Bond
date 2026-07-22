'use client'

import { useEffect } from 'react'

/**
 * Alimenta as variáveis --mx/--my do card sob o cursor, para o especular de
 * vidro líquido seguir o ponteiro (o toque "vivo" do design ÍON). UM listener
 * delegado no documento — não 100 listeners por card. Progressive enhancement:
 * se não rodar, os cards apenas ficam estáticos; nada quebra. Desliga sob
 * prefers-reduced-motion.
 */
export default function CursorGlow() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (window.matchMedia('(pointer: coarse)').matches) return // toque: sem cursor

    let cur: HTMLElement | null = null
    const clear = () => {
      if (cur) {
        cur.style.removeProperty('--mx')
        cur.style.removeProperty('--my')
        cur = null
      }
    }
    const onMove = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null
      const card = t?.closest?.('.card') as HTMLElement | null
      if (card !== cur) clear()
      if (!card) return
      cur = card
      const r = card.getBoundingClientRect()
      if (!r.width || !r.height) return
      card.style.setProperty('--mx', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`)
      card.style.setProperty('--my', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('blur', clear)
    }
  }, [])

  return null
}
