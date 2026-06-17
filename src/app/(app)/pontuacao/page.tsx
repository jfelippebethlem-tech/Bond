import { NIVEIS } from '@/lib/gamificacao'

export const metadata = { title: 'Como a pontuação funciona' }

function Card({ children }: { children: React.ReactNode }) {
  return <div className="card p-5">{children}</div>
}

export default function PontuacaoPage() {
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Como a pontuação funciona</h1>
        <p className="text-gray-500 text-sm mt-1">
          Cada apoiador acumula pontos pelo engajamento real nos posts. Quanto mais valioso o tipo de
          interação, mais pesa. Tudo é transparente — sem caixa-preta.
        </p>
      </div>

      {/* Fórmula principal */}
      <Card>
        <h2 className="font-semibold text-gray-900 mb-3">1. Pontuação (Score)</h2>
        <div className="rounded-lg bg-gray-900 text-white px-4 py-3 font-mono text-sm">
          score = curtidas × 1 &nbsp;+&nbsp; comentários × 2 &nbsp;+&nbsp; compartilhamentos × 3 &nbsp;+&nbsp; stories × 3
        </div>
        <ul className="text-sm text-gray-600 mt-3 space-y-1.5">
          <li>❤️ <b>Curtida = 1 ponto</b> — o engajamento mais leve.</li>
          <li>💬 <b>Comentário = 2 pontos</b> — exige mais esforço e gera conversa.</li>
          <li>🔁 <b>Compartilhamento = 3 pontos</b> — expõe o post à rede do apoiador (maior alcance).</li>
          <li>📲 <b>Reshare em Story = 3 pontos</b> — também amplifica para os seguidores do apoiador.</li>
        </ul>
        <p className="text-xs text-gray-400 mt-3">
          A soma é por pessoa, juntando todas as contas vinculadas (Instagram, Facebook, Twitter/X).
        </p>
      </Card>

      {/* Níveis */}
      <Card>
        <h2 className="font-semibold text-gray-900 mb-3">2. Níveis</h2>
        <p className="text-sm text-gray-600 mb-3">O nível sobe conforme o score acumulado:</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-200">
                <th className="py-1.5 pr-4">Nível</th><th className="py-1.5 pr-4">Nome</th><th className="py-1.5">Pontos</th>
              </tr>
            </thead>
            <tbody>
              {NIVEIS.map((n) => (
                <tr key={n.nivel} className="border-b border-gray-50">
                  <td className="py-1.5 pr-4 font-medium text-gray-700">{n.nivel}</td>
                  <td className="py-1.5 pr-4">{n.nome}</td>
                  <td className="py-1.5 text-gray-500">
                    {n.minPts}{n.maxPts === Infinity ? '+' : ` – ${n.maxPts}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Métricas avançadas */}
      <Card>
        <h2 className="font-semibold text-gray-900 mb-3">3. Métricas avançadas</h2>
        <ul className="text-sm text-gray-600 space-y-2">
          <li>
            <b>Influencer Score</b> — alcance potencial gerado pelo apoiador (em centenas de impressões):<br />
            <span className="font-mono text-xs text-gray-500">(compart.×seguidores + coment.×seguidores×0,2 + curtidas×seguidores×0,05) ÷ 100</span>
          </li>
          <li><b>Consistência</b> — % dos posts (últimos 30 dias) em que a pessoa engajou.</li>
          <li><b>Velocidade</b> — tempo médio (minutos) entre o post sair e a pessoa engajar.</li>
          <li><b>Streak</b> — quantos posts mais recentes seguidos a pessoa engajou (sequência).</li>
        </ul>
      </Card>

      {/* Nota honesta sobre plataformas */}
      <Card>
        <h2 className="font-semibold text-gray-900 mb-3">4. O que cada rede entrega (honestidade)</h2>
        <ul className="text-sm text-gray-600 space-y-2">
          <li>📸 <b>Instagram</b> — <b>curtidas</b> (coletor do desktop, conta principal) e <b>comentários</b> (API).
            <b> Compartilhamentos não entram</b>: a Meta não revela quem compartilhou (só o número total).
            <b> Reshares em Story</b> são experimentais — entram quando o coletor consegue capturá-los.</li>
          <li>📘 <b>Facebook</b> e 🐦 <b>Twitter/X</b> — curtidas, comentários e compartilhamentos por pessoa, quando conectados.</li>
        </ul>
        <p className="text-xs text-gray-400 mt-3">
          Princípio: indício de engajamento, sempre rastreável à fonte — nada é inventado.
        </p>
      </Card>
    </div>
  )
}
