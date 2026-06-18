// ENTRYPOINT da captura HUMANA (motor Node: cdp).
// O motor nodriver é Python: capture_nodriver.py. Ambos escrevem a MESMA saída
// (screenshots + manifest). O motor Playwright foi REMOVIDO: deixava rastro de
// fingerprint que a Meta pode sondar e não dá pra eliminar — não vale o risco.
//
// Uso (desktop, dirigido pelo Hermes):
//   IG_ENGINE=cdp IG_TARGET_USER=<perfil_publico> node capture/capture.mjs
//
// Parâmetros (env) — todos documentados em captura/.env.example e no runbook.
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import { carregarEnv, pausado, escreverStatus, rand, sleep } from './lib/util.mjs'
import { rodarCaptura } from './lib/flow.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
carregarEnv(path.join(__dirname, '.env'))
carregarEnv(path.join(__dirname, '..', '.env'))

const ENGINE = (process.env.IG_ENGINE || 'cdp').toLowerCase()        // 'cdp' (nodriver = script python à parte)
const TARGET = (process.env.IG_TARGET_USER || process.env.IG_PERFIL || '').replace(/^@/, '').trim()
const SHOTS = process.env.LIKERS_SHOTS_DIR || path.join(__dirname, 'shots')
const OUT = process.env.LIKERS_OUT_DIR || path.join(__dirname, '..', 'likers-sync')
const PROFILE = process.env.IG_PROFILE_DIR || path.join(__dirname, '..', 'ig-profile')
const opts = {
  target: TARGET,
  shotsDir: SHOTS,
  numPosts: Math.max(1, parseInt(process.env.IG_NUM_POSTS || '12', 10)),
  recent: Math.max(0, parseInt(process.env.IG_RECENT || '6', 10)),
  minS: Math.max(5, parseInt(process.env.IG_TEMPO_MIN || '15', 10)),       // piso 15s (regra do dono)
  maxS: Math.max(20, parseInt(process.env.IG_TEMPO_MAX || '200', 10)),     // teto 200s
  maxShots: Math.max(3, parseInt(process.env.IG_MAX_SHOTS || '30', 10)),
  maxFalhas: Math.max(2, parseInt(process.env.IG_MAX_FALHAS || '3', 10)),
  force: process.env.IG_FORCE === 'true',
  ledgerFile: path.join(OUT, 'captura-ledger.json'),
}
const cfg = {
  cdpUrl: process.env.IG_CDP_URL || (ENGINE === 'cdp' ? 'http://127.0.0.1:9222' : ''),
  profileDir: PROFILE,
  channel: process.env.IG_CHROME_CHANNEL || 'chrome',
  width: parseInt(process.env.IG_VP_W || '1366', 10),
  height: parseInt(process.env.IG_VP_H || '768', 10),
}

async function main() {
  if (!TARGET) { console.error('⛔ Defina IG_TARGET_USER (perfil-alvo) ou IG_PERFIL.'); escreverStatus(OUT, false, 'sem_target'); process.exit(1) }
  // TRAVA DE PAUSA: não toca no IG se a VM sinalizou bloqueio.
  const trava = pausado([
    path.join(__dirname, '..', '.pause_captura'),
    path.join(OUT, '.pause_captura'),
    path.join(SHOTS, '.pause_captura'),
  ])
  if (trava) { console.log(`⏸️ PAUSADO (${trava}) — não vou tocar no IG. Apague o arquivo p/ retomar.`); escreverStatus(OUT, true, 'pausado'); process.exit(0) }

  console.log(`▶ motor=${ENGINE} alvo=@${TARGET} posts=${opts.numPosts} tempo/post=${opts.minS}-${opts.maxS}s prints/post≤${opts.maxShots}`)
  await sleep(rand(1500, 5000)) // chega devagar

  let driver
  try {
    if (ENGINE === 'cdp') {
      const { criarDriverCDP } = await import('./lib/driver-cdp.mjs')
      driver = await criarDriverCDP(cfg)
      if (driver._refreshVp) await driver._refreshVp()
    } else { throw new Error(`motor desconhecido: ${ENGINE} (use cdp; ou nodriver = python capture_nodriver.py)`) }
  } catch (e) {
    console.error('⛔ Falha ao iniciar o motor:', e.message)
    escreverStatus(OUT, false, 'motor_falhou: ' + e.message); process.exit(2)
  }

  try {
    const r = await rodarCaptura(driver, opts)
    console.log(`✅ captura: ${r.posts} posts` + (r.abortado ? ` (ABORTADO: ${r.motivo})` : ''))
    if (r.resultados) for (const x of r.resultados) console.log(`   ${x.code}: ${x.modalAbriu ? x.shots + ' prints' : 'modal NÃO abriu'}${x.tempoMs ? ' (' + Math.round(x.tempoMs / 1000) + 's)' : ''}`)
    escreverStatus(OUT, !r.abortado, r.abortado ? r.motivo : null)
    console.log(`   prints em: ${SHOTS}/${TARGET}/<code>/  → depure na VM com parse/parse_likers.py`)
  } catch (e) {
    console.error('⛔ erro na captura:', e)
    escreverStatus(OUT, false, 'erro: ' + (e.message || e))
  } finally {
    try { await driver.close() } catch {}
  }
}
main()
