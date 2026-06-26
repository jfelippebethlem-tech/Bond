// Avatar com iniciais e cor determinística (mesma pessoa → sempre a mesma cor).
// Sem foto: dá identidade visual e "vida" às listas sem depender de imagem externa.

const PALETA = [
  'from-rose-400 to-pink-500', 'from-amber-400 to-orange-500', 'from-emerald-400 to-teal-500',
  'from-sky-400 to-blue-500', 'from-violet-400 to-purple-500', 'from-fuchsia-400 to-pink-500',
  'from-cyan-400 to-sky-500', 'from-lime-400 to-green-500', 'from-indigo-400 to-blue-600',
  'from-red-400 to-rose-500', 'from-yellow-400 to-amber-500', 'from-teal-400 to-cyan-500',
]

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function iniciais(nome: string): string {
  const limpo = nome.replace(/^@/, '').replace(/[._-]+/g, ' ').trim()
  const partes = limpo.split(/\s+/).filter(Boolean)
  if (!partes.length) return '?'
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

export default function Avatar({ nome, size = 36, ring }: { nome: string; size?: number; ring?: string }) {
  const grad = PALETA[hash(nome) % PALETA.length]
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-gradient-to-br ${grad} text-white font-semibold shrink-0 shadow-sm ${ring ?? ''}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {iniciais(nome)}
    </span>
  )
}
