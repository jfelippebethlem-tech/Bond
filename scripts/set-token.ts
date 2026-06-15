/**
 * Resolve um USER token do Facebook em PAGE token PERMANENTE e grava no .env.
 *
 * Uso:
 *   npx tsx scripts/set-token.ts "<USER_TOKEN>"
 *   USER_TOKEN=<...> npx tsx scripts/set-token.ts
 *
 * Faz: fb_exchange_token (long-lived) -> me/accounts (page token permanente) ->
 * verifica expires_at==0 -> grava FACEBOOK_PAGE_TOKEN/PAGE_ID/INSTAGRAM_BUSINESS_ID no .env.
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { resolverTokenPermanente } from '../src/lib/social/token'

function upsertEnv(envPath: string, updates: Record<string, string>) {
  let txt = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  for (const [k, v] of Object.entries(updates)) {
    const linha = `${k}="${v}"`
    const re = new RegExp(`^${k}=.*$`, 'm')
    if (re.test(txt)) txt = txt.replace(re, linha)
    else txt += (txt.endsWith('\n') || txt === '' ? '' : '\n') + linha + '\n'
  }
  fs.writeFileSync(envPath, txt)
}

async function main() {
  const userToken = (process.argv[2] || process.env.USER_TOKEN || '').trim()
  if (!userToken) {
    console.error('ERRO: passe o user token: npx tsx scripts/set-token.ts "<TOKEN>"')
    process.exit(1)
  }
  const r = await resolverTokenPermanente(userToken)
  if (!r.ok || !r.pageToken) {
    console.error('❌ Falhou:', r.erro)
    process.exit(1)
  }
  const envPath = path.join(process.cwd(), '.env')
  const updates: Record<string, string> = { FACEBOOK_PAGE_TOKEN: r.pageToken }
  if (r.pageId) updates.FACEBOOK_PAGE_ID = r.pageId
  if (r.igId) updates.INSTAGRAM_BUSINESS_ID = r.igId
  upsertEnv(envPath, updates)

  console.log('✅ Token gravado no .env')
  console.log('   Página:', r.pageName, `(${r.pageId})`)
  console.log('   Instagram:', r.igUsername ? `@${r.igUsername} (${r.igId})` : '(não vinculado)')
  console.log('   PERMANENTE:', r.permanente ? 'SIM (expires_at: 0) ✅' : `NÃO — expira em ${r.expiraEm} (epoch). Gere de novo a partir de um user token com a permissao concedida.`)
  if (r.faltamScopes?.length) {
    console.log('   ⚠️ Faltam scopes:', r.faltamScopes.join(', '))
    console.log('      (Sem pages_read_user_content o nº de comentários do FB fica 0; sem os de IG, o IG não lê.)')
  } else {
    console.log('   Scopes: todos os necessários presentes ✅')
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
