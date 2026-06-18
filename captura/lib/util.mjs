// Utilidades compartilhadas da captura HUMANA de curtidores.
// Filosofia (validada por pesquisa 2026 — ver docs/CAPTURA-HUMANA-RUNBOOK.md):
//   - A Meta distingue toque humano de "script injetando código" e bane na hora.
//   - Por isso: SÓ input de usuário real (mouse move/click/wheel + teclado) e
//     SÓ leitura por SCREENSHOT. NUNCA fetch injetado, NUNCA scrollTop=, e o
//     mínimo possível de leitura de DOM (e quando há, via CDP DOM domain, que
//     não executa JS da página — não via page.evaluate).
//   - Os usernames são extraídos DEPOIS, FORA do Instagram (parse/parse_likers.py).
import fs from 'fs'
import path from 'path'

export const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)))
export const rand = (a, b) => a + Math.random() * (b - a)
export const randInt = (a, b) => Math.floor(rand(a, b + 1))
export const chance = (p) => Math.random() < p
export const pick = (arr) => arr[randInt(0, arr.length - 1)]

// Tempo aleatório DE VERDADE por post: entre 15s e 200s (regra do dono).
// Distribuição não-uniforme de leve (mais massa no meio) p/ não virar "ruído branco"
// perfeito — gente passa mais tempo médio que extremos. Mas o piso/teto são exatos.
export function tempoDoPostMs(minS = 15, maxS = 200) {
  const u = (Math.random() + Math.random() + Math.random()) / 3 // ~triangular, centro mais provável
  return Math.round((minS + u * (maxS - minS)) * 1000)
}

// Curva de movimento humano: pontos intermediários entre A e B com leve curvatura
// e jitter (nada de linha reta perfeita, que é assinatura de robô).
export function caminhoMouse(x0, y0, x1, y1, passos) {
  const pts = []
  const ctrlX = (x0 + x1) / 2 + rand(-40, 40)
  const ctrlY = (y0 + y1) / 2 + rand(-40, 40)
  for (let i = 1; i <= passos; i++) {
    const t = i / passos
    const mt = 1 - t
    // Bézier quadrática + jitter
    let x = mt * mt * x0 + 2 * mt * t * ctrlX + t * t * x1
    let y = mt * mt * y0 + 2 * mt * t * ctrlY + t * t * y1
    if (i < passos) { x += rand(-1.5, 1.5); y += rand(-1.5, 1.5) }
    pts.push([x, y])
  }
  return pts
}

// Plano de rolagem da roda: passos pequenos e variáveis, pausas pra "ler",
// e às vezes uma correção pra cima (overshoot humano).
export function planoDeRolagem(passos) {
  const plano = []
  for (let i = 0; i < passos; i++) {
    plano.push({ delta: Math.round(rand(90, 320)), pausa: Math.round(rand(180, 720)) })
    if (chance(0.18)) plano.push({ delta: 0, pausa: Math.round(rand(900, 2600)) })      // parou pra ler
    if (chance(0.08)) plano.push({ delta: -Math.round(rand(40, 140)), pausa: Math.round(rand(250, 700)) }) // corrigiu p/ cima
  }
  return plano
}

// ---- Saída padronizada (MESMO contrato p/ os 3 motores) ----
// <SHOTS_DIR>/<target>/<code>/ : post.png, likes_0001.png..., manifest.json
export function pastaDoPost(shotsDir, target, code) {
  const p = path.join(shotsDir, sane(target), sane(code))
  fs.mkdirSync(p, { recursive: true })
  return p
}
export function sane(s) { return String(s || 'x').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) }
export function nomeShot(prefixo, n) { return `${prefixo}_${String(n).padStart(4, '0')}.png` }

export function escreverManifest(dir, obj) {
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(obj, null, 2))
}

// Status pro pipeline da VM (mesmo formato que o importador já lê e avisa no Telegram).
export function escreverStatus(outDir, ok, erro) {
  try {
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, 'likers-status.json'),
      JSON.stringify({ ok, erro: erro || null, quando: new Date().toISOString() }))
  } catch {}
}

// TRAVA DE PAUSA (controlada pela VM via Syncthing): se existir `.pause_captura`
// em qualquer pasta candidata, NÃO toca no IG (regra #1 anti-bloqueio: rodar com
// a conta bloqueada só aprofunda). Retorna o caminho achado ou null.
export function pausado(candidatos) {
  for (const p of candidatos) { try { if (fs.existsSync(p)) return p } catch {} }
  return null
}

// Carrega .env simples (KEY="value") sem depender de dotenv no desktop.
export function carregarEnv(arquivo) {
  try {
    const txt = fs.readFileSync(arquivo, 'utf8')
    for (const linha of txt.split(/\r?\n/)) {
      const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
      if (!m) continue
      let v = m[2].trim().replace(/^["']|["']$/g, '')
      if (process.env[m[1]] === undefined) process.env[m[1]] = v
    }
  } catch {}
}

// Extrai o code do post de uma URL /p/<code>/ ou /reel/<code>/
export function codeDaUrl(url) {
  const m = String(url || '').match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/)
  return m ? m[1] : null
}
