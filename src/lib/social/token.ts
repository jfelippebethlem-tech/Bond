// Resolvedor de TOKEN PERMANENTE do Facebook/Instagram (Graph API).
//
// Por que o token expirava: um Page token derivado de um User token SHORT-LIVED
// herda a expiração curta. O caminho correto p/ permanência:
//   user token (curto)  --fb_exchange_token-->  user token LONG-LIVED (60d)
//                        --me/accounts-->        PAGE token  (expires_at: 0 = NUNCA expira)
// Um Page token derivado de um user token long-lived é PERMANENTE (só cai se o dono
// trocar a senha, remover o app ou revogar a permissão).

const GRAPH = 'https://graph.facebook.com/v21.0'

export type ResolveResult = {
  ok: boolean
  pageToken?: string
  pageId?: string
  pageName?: string
  igId?: string
  igUsername?: string
  permanente?: boolean
  expiraEm?: number // epoch segundos; 0 = nunca
  scopes?: string[]
  faltamScopes?: string[]
  erro?: string
}

// Scopes necessários p/ o monitor funcionar 100% (inclui quem curtiu no FB + conteúdo de comentários).
const SCOPES_NECESSARIOS = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content', // p/ ler comentários do FB e contar
  'instagram_basic',
  'instagram_manage_comments',
]

async function jget(url: string): Promise<any> {
  const r = await fetch(url)
  return r.json().catch(() => ({}))
}

/**
 * Recebe QUALQUER user token (curto ou longo) e devolve o PAGE token permanente.
 * Não lança — sempre retorna ResolveResult (ok=false com erro em caso de falha).
 */
export async function resolverTokenPermanente(
  userToken: string,
  appId = process.env.FACEBOOK_APP_ID,
  appSecret = process.env.FACEBOOK_APP_SECRET,
): Promise<ResolveResult> {
  if (!userToken) return { ok: false, erro: 'user token vazio' }
  if (!appId || !appSecret) return { ok: false, erro: 'FACEBOOK_APP_ID / FACEBOOK_APP_SECRET ausentes no .env' }

  // 1) Troca por user token LONG-LIVED (60 dias). Idempotente: se já for longo, devolve outro longo.
  const ex = await jget(
    `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(userToken)}`,
  )
  if (ex.error) return { ok: false, erro: `troca long-lived falhou: ${ex.error.message}` }
  const longUserToken: string = ex.access_token || userToken

  // 2) Deriva o PAGE token (permanente, pois vem de um user token long-lived).
  const accs = await jget(`${GRAPH}/me/accounts?fields=id,name,access_token&access_token=${longUserToken}`)
  if (accs.error) return { ok: false, erro: `me/accounts falhou: ${accs.error.message}` }
  const pages: { id: string; name: string; access_token: string }[] = accs.data ?? []
  if (!pages.length) return { ok: false, erro: 'nenhuma Página retornada (o token tem pages_show_list e o dono administra a Página?)' }

  // Preferir a Página configurada, senão a primeira.
  const alvo = process.env.FACEBOOK_PAGE_ID
    ? pages.find((p) => p.id === process.env.FACEBOOK_PAGE_ID) ?? pages[0]
    : pages[0]
  const pageToken = alvo.access_token

  // 3) Verifica permanência + scopes via debug_token (com app token).
  const dbg = await jget(
    `${GRAPH}/debug_token?input_token=${pageToken}&access_token=${appId}|${appSecret}`,
  )
  const d = dbg.data ?? {}
  const expiraEm: number = typeof d.expires_at === 'number' ? d.expires_at : -1
  const permanente = expiraEm === 0
  const scopes: string[] = d.scopes ?? []
  const faltamScopes = SCOPES_NECESSARIOS.filter((s) => !scopes.includes(s))

  // 4) Descobre a conta Instagram Business vinculada à Página.
  const ig = await jget(`${GRAPH}/${alvo.id}?fields=instagram_business_account{id,username}&access_token=${pageToken}`)
  const igId: string | undefined = ig?.instagram_business_account?.id
  const igUsername: string | undefined = ig?.instagram_business_account?.username

  return {
    ok: true,
    pageToken,
    pageId: alvo.id,
    pageName: alvo.name,
    igId,
    igUsername,
    permanente,
    expiraEm,
    scopes,
    faltamScopes,
  }
}
