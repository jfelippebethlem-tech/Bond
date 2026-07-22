'use client'
import { useEffect, useState } from 'react'

type Numero = { id: string; rotulo: string; status: string; enviadosHoje: number; tetoDiario: number; nivelAquecimento: number; conexao: string; qr: string | null }
type Campanha = { id: string; titulo: string; canais: string; totalAlvo: number; enfileirados: number; criadoEm: string }

export default function DisparosPage() {
  const [numeros, setNumeros] = useState<Numero[]>([])
  const [campanhas, setCampanhas] = useState<Campanha[]>([])
  const [smsOnline, setSmsOnline] = useState<boolean | null>(null)
  const [titulo, setTitulo] = useState('')
  const [assunto, setAssunto] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [canais, setCanais] = useState<string[]>(['whatsapp'])
  const [novoRotulo, setNovoRotulo] = useState('')
  const [msg, setMsg] = useState('')

  async function carregar() {
    try {
      const r = await fetch('/api/disparos').then((x) => x.json())
      setNumeros(r.numeros || [])
      setCampanhas(r.campanhas || [])
      const s = await fetch('/api/disparos/sms-status').then((x) => x.json())
      setSmsOnline(s.online)
    } catch {
      setMsg('Erro ao carregar dados (rede/servidor).')
    }
  }
  // Polling: o QR do Baileys rotaciona (~20s) e a conexão muda ao escanear.
  useEffect(() => {
    carregar()
    const t = setInterval(carregar, 15000)
    return () => clearInterval(t)
  }, [])

  // Se o gateway SMS estiver offline, não deixa o canal SMS selecionado.
  useEffect(() => { if (smsOnline === false) setCanais((cur) => cur.filter((c) => c !== 'sms')) }, [smsOnline])

  function toggleCanal(c: string) {
    setCanais((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))
  }

  async function disparar() {
    setMsg('Enviando...')
    try {
      const r = await fetch('/api/disparos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titulo, mensagem, assunto: assunto || undefined, canais, audiencia: ['apoiador', 'coordenador'] }),
      }).then((x) => x.json())
      if (r.erro) setMsg('Erro: ' + r.erro)
      else { setMsg(`Enfileirado: ${r.whatsapp} WhatsApp + ${r.sms} SMS + ${r.email} Email (alvo: ${r.totalAlvo})`); setTitulo(''); setAssunto(''); setMensagem(''); carregar() }
    } catch {
      setMsg('Erro ao disparar (rede/servidor). Nada foi enviado.')
    }
  }

  async function addChip() {
    if (!novoRotulo.trim()) return
    try {
      await fetch('/api/disparos/numero', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rotulo: novoRotulo }) })
      setNovoRotulo(''); carregar()
    } catch {
      setMsg('Erro ao cadastrar chip (rede/servidor).')
    }
  }

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-bold">Disparos</h1>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Compor disparo</h2>
        <input className="w-full border rounded p-2" placeholder="Título da campanha" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        {canais.includes('email') && (
          <input className="w-full border rounded p-2" placeholder="Assunto do email (vazio = usa o título)" value={assunto} onChange={(e) => setAssunto(e.target.value)} />
        )}
        <textarea className="w-full border rounded p-2 h-28" placeholder="Mensagem (use {nome} para personalizar)" value={mensagem} onChange={(e) => setMensagem(e.target.value)} />
        <div className="flex gap-4 flex-wrap">
          <label className="flex items-center gap-2"><input type="checkbox" checked={canais.includes('whatsapp')} onChange={() => toggleCanal('whatsapp')} /> WhatsApp</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={canais.includes('sms')} disabled={smsOnline === false} onChange={() => toggleCanal('sms')} /> SMS {smsOnline === false && <span className="text-red-500 text-xs">(gateway offline)</span>}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={canais.includes('email')} onChange={() => toggleCanal('email')} /> 📧 Email <span className="text-xs text-gray-400">(grátis · 300/dia)</span></label>
        </div>
        <button className="bg-blue-600 text-white rounded px-4 py-2" onClick={disparar}>Disparar</button>
        {msg && <p className="text-sm">{msg}</p>}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Pool de chips (WhatsApp)</h2>
        <div className="flex gap-2">
          <input className="border rounded p-2 flex-1" placeholder="Rótulo do novo chip (ex: chip-1 / Vivo)" value={novoRotulo} onChange={(e) => setNovoRotulo(e.target.value)} />
          <button className="bg-green-600 text-white rounded px-4" onClick={addChip}>Adicionar chip</button>
        </div>
        <table className="w-full text-sm border">
          <thead><tr className="bg-gray-100"><th className="text-left p-2">Rótulo</th><th className="p-2">Status</th><th className="p-2">Conexão</th><th className="p-2">Hoje/Teto</th><th className="p-2">Aquecimento</th></tr></thead>
          <tbody>
            {numeros.map((n) => (
              <tr key={n.id} className="border-t">
                <td className="p-2">{n.rotulo}</td>
                <td className="p-2 text-center">{n.status}</td>
                <td className={`p-2 text-center ${n.conexao === 'conectado' ? 'text-green-600' : 'text-amber-600'}`}>{n.conexao}</td>
                <td className="p-2 text-center">{n.enviadosHoje}/{n.tetoDiario}</td>
                <td className="p-2 text-center">nível {n.nivelAquecimento}</td>
              </tr>
            ))}
            {numeros.length === 0 && <tr><td colSpan={5} className="p-3 text-center text-gray-500">Nenhum chip. Adicione acima — o QR de pareamento aparece aqui em até 1 minuto.</td></tr>}
          </tbody>
        </table>
        {numeros.filter((n) => n.qr).map((n) => (
          <div key={n.id} className="border rounded p-4 inline-block text-center mr-4">
            <p className="font-semibold mb-2">Parear “{n.rotulo}”</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={n.qr!} alt={`QR do chip ${n.rotulo}`} className="w-48 h-48" />
            <p className="text-xs text-gray-500 mt-2 max-w-[12rem]">WhatsApp → Aparelhos conectados → Conectar aparelho. O QR renova sozinho.</p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="text-lg font-semibold">Últimas campanhas</h2>
        <table className="w-full text-sm border mt-2">
          <thead><tr className="bg-gray-100"><th className="text-left p-2">Título</th><th className="p-2">Canais</th><th className="p-2">Enfileirados/Alvo</th></tr></thead>
          <tbody>
            {campanhas.map((c) => (
              <tr key={c.id} className="border-t"><td className="p-2">{c.titulo}</td><td className="p-2 text-center">{c.canais}</td><td className="p-2 text-center">{c.enfileirados}/{c.totalAlvo}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
