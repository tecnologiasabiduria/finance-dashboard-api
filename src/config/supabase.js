import { createClient } from '@supabase/supabase-js';
import { config } from './env.js';

// Cliente público (usa anon key - respeta RLS)
export const supabase = createClient(
  config.supabase.url,
  config.supabase.anonKey
);

// Cliente admin (usa service role key - bypass RLS)
// Solo usar para operaciones administrativas como webhooks
export const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey || config.supabase.anonKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

/**
 * Crea un cliente de Supabase autenticado con el token del usuario
 */
export function getSupabaseClient(accessToken) {
  return createClient(config.supabase.url, config.supabase.anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}
