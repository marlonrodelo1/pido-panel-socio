import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )
}

// Resuelve el socio.id a partir del JWT del rider.
export async function socioFromAuth(req: Request): Promise<{ socioId: string; userId: string } | null> {
  const auth = req.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) return null

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
  )

  const { data: userRes, error: userErr } = await sb.auth.getUser()
  if (userErr || !userRes?.user) return null
  const userId = userRes.user.id

  const admin = adminClient()
  const { data: socio } = await admin
    .from('socios')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()

  if (!socio) return null
  return { socioId: socio.id, userId }
}
