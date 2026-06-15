const FB_BASE = 'https://graph.facebook.com/v19.0'

function fbUrl(path: string, extra = '') {
  const token = process.env.FACEBOOK_PAGE_TOKEN
  return `${FB_BASE}${path}?access_token=${token}${extra ? '&' + extra : ''}`
}

export async function getFacebookPageInfo() {
  if (!process.env.FACEBOOK_PAGE_TOKEN) return null
  const res = await fetch(
    fbUrl('/me', 'fields=id,name,fan_count,followers_count,about,picture')
  )
  if (!res.ok) return null
  return res.json()
}

// Status do token (p/ o monitor avisar quando os dados estão stale)
export async function checkFacebookToken(): Promise<{ status: 'valid' | 'expired' | 'none' | 'error'; detail?: string }> {
  if (!process.env.FACEBOOK_PAGE_TOKEN) return { status: 'none' }
  try {
    const res = await fetch(fbUrl('/me', 'fields=name'))
    if (res.ok) return { status: 'valid' }
    const data = await res.json().catch(() => ({}))
    const code = data?.error?.code
    return { status: code === 190 ? 'expired' : 'error', detail: data?.error?.message }
  } catch (e) {
    return { status: 'error', detail: e instanceof Error ? e.message : String(e) }
  }
}

export async function getFacebookPosts(limit = 20) {
  if (!process.env.FACEBOOK_PAGE_TOKEN) return []
  const base = 'id,message,story,created_time,full_picture,permalink_url,likes.summary(true),shares'
  // comments.summary(true) exige pages_read_user_content; se o token nao tiver, a request inteira falha (#200).
  // Tenta COM comentarios; se falhar, cai p/ SEM (posts ainda sincronizam, so o nº de comentarios fica 0).
  for (const fields of [`${base},comments.summary(true)`, base]) {
    const res = await fetch(fbUrl('/me/posts', `fields=${fields}&limit=${limit}`))
    if (res.ok) {
      const data = await res.json()
      return data.data ?? []
    }
  }
  return []
}

export async function getFacebookPostInsights(postId: string) {
  if (!process.env.FACEBOOK_PAGE_TOKEN) return null
  const metrics = 'post_impressions,post_impressions_unique,post_engaged_users,post_clicks'
  const res = await fetch(fbUrl(`/${postId}/insights`, `metric=${metrics}`))
  if (!res.ok) return null
  return res.json()
}

export async function getFacebookPostLikers(postId: string) {
  if (!process.env.FACEBOOK_PAGE_TOKEN) return []
  const res = await fetch(fbUrl(`/${postId}/likes`, 'fields=id,name,pic_square&limit=100'))
  if (!res.ok) return []
  const data = await res.json()
  return data.data ?? []
}

export async function getFacebookPostComments(postId: string) {
  if (!process.env.FACEBOOK_PAGE_TOKEN) return []
  const res = await fetch(fbUrl(`/${postId}/comments`, 'fields=id,from,message,created_time&limit=100'))
  if (!res.ok) return []
  const data = await res.json()
  return data.data ?? []
}
