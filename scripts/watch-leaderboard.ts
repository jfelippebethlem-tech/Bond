// Vigia o método do InstagramLikesLeaderboard (a referência da nossa captura).
// Nosso script replica o MÉTODO deles (endpoints da API interna do IG, app-id,
// headers). Se o IG mudar, eles consertam no repo -> este vigia detecta a mudanca
// nos arquivos-chave e AVISA no Telegram pra revisarmos nosso script.
// Roda na VM via cron (semanal). NÃO toca no Instagram.
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'

const FILES = [
  'https://raw.githubusercontent.com/Sagargupta16/InstagramLikesLeaderboard/main/src/utils/utils.ts',
  'https://raw.githubusercontent.com/Sagargupta16/InstagramLikesLeaderboard/main/src/constants/constants.ts',
  'https://raw.githubusercontent.com/Sagargupta16/InstagramLikesLeaderboard/main/src/utils/scanner.ts',
]
const BASE = path.join(os.homedir(), '.leaderboard_baseline')

async function main() {
  let combinado = ''
  for (const u of FILES) {
    const r = await fetch(u)
    if (!r.ok) { console.log(`[${new Date().toISOString()}] fetch falhou (${r.status}) — pulo desta vez`); return }
    combinado += await r.text()
  }
  const hash = crypto.createHash('sha256').update(combinado).digest('hex')
  const ultimo = fs.existsSync(BASE) ? fs.readFileSync(BASE, 'utf8').trim() : ''

  if (!ultimo) { fs.writeFileSync(BASE, hash); console.log('baseline definido (1a vez)'); return }
  if (hash === ultimo) { console.log(`[${new Date().toISOString()}] sem mudancas no metodo do Leaderboard`); return }

  fs.writeFileSync(BASE, hash) // atualiza pra nao repetir o aviso
  const tok = process.env.TELEGRAM_BOT_TOKEN, owner = process.env.TELEGRAM_OWNER_ID
  if (tok && owner) {
    const msg = '🔧 *Atenção (manutenção):* o InstagramLikesLeaderboard — a referência do nosso método de captura de curtidores — foi *atualizado no GitHub*. Isso costuma significar que o Instagram mudou algo na API. Vale eu *revisar e atualizar nosso script* de captura pra não parar de funcionar. É só me pedir pra dar uma olhada.'
    await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: owner, parse_mode: 'Markdown', text: msg }) })
  }
  console.log(`[${new Date().toISOString()}] METODO MUDOU — alertei no Telegram.`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
