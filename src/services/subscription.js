import { supabaseAdmin } from '../config/supabase.js';

/**
 * Servicio para gestionar suscripciones
 */
export const subscriptionService = {
  /**
   * Obtener suscripción activa de un usuario
   * 
   * Primero verifica profiles.subscription_status (fuente de verdad del webhook GHL)
   * Si no, busca en tabla subscriptions (legacy / Stripe directo)
   */
  async getActive(userId) {
    // 1. Verificar en profiles.subscription_status (webhook GHL pone 'active' aquí)
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, email, subscription_status')
      .eq('id', userId)
      .single();

    if (profileError && profileError.code !== 'PGRST116') {
      console.error('Error checking profile subscription:', profileError);
    }

    if (profile?.subscription_status === 'active') {
      // Retornar un objeto con formato compatible
      return {
        id: `profile-${profile.id}`,
        user_id: userId,
        status: 'active',
        provider: 'ghl_webhook',
        current_period_start: null,
        current_period_end: null,
      };
    }

    // 2. Fallback: buscar en tabla subscriptions (Stripe directo)
    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    return data;
  },

  /**
   * Obtener todas las suscripciones de un usuario
   */
  async getAll(userId) {
    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  },

  /**
   * Crear o actualizar suscripción desde webhook
   */
  async upsertFromWebhook({ userId, provider, externalId, status, periodStart, periodEnd }) {
    // Buscar suscripción existente por external_id
    const { data: existing } = await supabaseAdmin
      .from('subscriptions')
      .select('id')
      .eq('external_id', externalId)
      .single();

    if (existing) {
      // Actualizar existente
      const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .update({
          status,
          current_period_start: periodStart,
          current_period_end: periodEnd,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      return { subscription: data, created: false };
    }

    // Crear nueva
    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .insert({
        user_id: userId,
        provider,
        external_id: externalId,
        status,
        current_period_start: periodStart,
        current_period_end: periodEnd,
      })
      .select()
      .single();

    if (error) throw error;
    return { subscription: data, created: true };
  },

  /**
   * Activar suscripción
   */
  async activate(subscriptionId) {
    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .update({
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', subscriptionId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Cancelar suscripción
   */
  async cancel(subscriptionId) {
    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', subscriptionId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Marcar suscripción como vencida
   */
  async markPastDue(subscriptionId) {
    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .update({
        status: 'past_due',
        updated_at: new Date().toISOString(),
      })
      .eq('id', subscriptionId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },
};
