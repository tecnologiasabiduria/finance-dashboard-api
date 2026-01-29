import crypto from 'crypto';
import { config } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { subscriptionService } from './subscription.js';

/**
 * Servicio para manejar webhooks de GoHighLevel
 */
export const ghlService = {
  /**
   * Verificar firma del webhook
   */
  verifyWebhookSignature(payload, signature) {
    if (!config.ghl.webhookSecret) {
      console.warn('⚠️ GHL webhook secret no configurado');
      return config.isDev; // Permitir en desarrollo sin firma
    }

    const expectedSignature = crypto
      .createHmac('sha256', config.ghl.webhookSecret)
      .update(JSON.stringify(payload))
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature || ''),
      Buffer.from(expectedSignature)
    );
  },

  /**
   * Procesar evento de webhook
   */
  async handleWebhookEvent(payload) {
    const { type, data } = payload;

    console.log(`📥 GHL webhook: ${type}`);

    // GoHighLevel puede enviar diferentes tipos de eventos
    // Ajustar según la configuración real de tu GHL
    switch (type) {
      case 'order.completed':
      case 'subscription.created':
        return this.handleSubscriptionCreated(data);

      case 'subscription.updated':
        return this.handleSubscriptionUpdated(data);

      case 'subscription.cancelled':
      case 'subscription.deleted':
        return this.handleSubscriptionCancelled(data);

      case 'payment.succeeded':
        return this.handlePaymentSucceeded(data);

      case 'payment.failed':
        return this.handlePaymentFailed(data);

      default:
        console.log(`⚠️ Evento GHL no manejado: ${type}`);
        return { handled: false };
    }
  },

  /**
   * Manejar suscripción creada
   */
  async handleSubscriptionCreated(data) {
    const email = data.contact?.email || data.email;
    const subscriptionId = data.subscription_id || data.id;

    if (!email) {
      console.error('No email in GHL subscription');
      return { error: 'No email found' };
    }

    // Buscar o crear usuario
    const user = await this.findOrCreateUser(email, data.contact?.name);

    if (!user.id) {
      console.log(`⚠️ Usuario pendiente de registro: ${email}`);
      return { pending: true, email };
    }

    const result = await subscriptionService.upsertFromWebhook({
      userId: user.id,
      provider: 'gohighlevel',
      externalId: subscriptionId,
      status: 'active',
      periodStart: new Date().toISOString(),
      periodEnd: data.next_billing_date
        ? new Date(data.next_billing_date).toISOString()
        : null,
    });

    console.log(`✅ Suscripción GHL ${result.created ? 'creada' : 'actualizada'} para: ${email}`);
    return result;
  },

  /**
   * Manejar suscripción actualizada
   */
  async handleSubscriptionUpdated(data) {
    const subscriptionId = data.subscription_id || data.id;
    const status = this.mapStatus(data.status);

    const { data: updated, error } = await supabaseAdmin
      .from('subscriptions')
      .update({
        status,
        current_period_end: data.next_billing_date
          ? new Date(data.next_billing_date).toISOString()
          : null,
        updated_at: new Date().toISOString(),
      })
      .eq('external_id', subscriptionId)
      .select()
      .single();

    if (error) {
      console.error('Error actualizando suscripción GHL:', error);
      return { error };
    }

    console.log(`✅ Suscripción GHL actualizada: ${subscriptionId}`);
    return { success: true, subscription: updated };
  },

  /**
   * Manejar suscripción cancelada
   */
  async handleSubscriptionCancelled(data) {
    const subscriptionId = data.subscription_id || data.id;

    const { data: updated } = await supabaseAdmin
      .from('subscriptions')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('external_id', subscriptionId)
      .select()
      .single();

    console.log(`❌ Suscripción GHL cancelada: ${subscriptionId}`);
    return { success: true, subscription: updated };
  },

  /**
   * Manejar pago exitoso
   */
  async handlePaymentSucceeded(data) {
    const subscriptionId = data.subscription_id;

    if (subscriptionId) {
      await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('external_id', subscriptionId);

      console.log(`💰 Pago GHL exitoso: ${subscriptionId}`);
    }

    return { success: true };
  },

  /**
   * Manejar pago fallido
   */
  async handlePaymentFailed(data) {
    const subscriptionId = data.subscription_id;

    if (subscriptionId) {
      await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'past_due', updated_at: new Date().toISOString() })
        .eq('external_id', subscriptionId);

      console.log(`⚠️ Pago GHL fallido: ${subscriptionId}`);
    }

    return { success: true };
  },

  /**
   * Mapear status de GHL a nuestro sistema
   */
  mapStatus(ghlStatus) {
    const statusMap = {
      active: 'active',
      cancelled: 'cancelled',
      canceled: 'cancelled',
      past_due: 'past_due',
      unpaid: 'past_due',
      paused: 'inactive',
    };
    return statusMap[ghlStatus?.toLowerCase()] || 'inactive';
  },

  /**
   * Buscar o crear usuario por email
   */
  async findOrCreateUser(email, name) {
    // Buscar en profiles
    let { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('email', email)
      .single();

    if (profile) {
      return profile;
    }

    // Buscar en auth.users
    const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
    const authUser = users.find((u) => u.email === email);

    if (authUser) {
      // Crear profile para usuario existente
      const { data: newProfile } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: authUser.id,
          email: authUser.email,
          full_name: name || authUser.user_metadata?.full_name || null,
        })
        .select()
        .single();

      return newProfile;
    }

    return { id: null, email };
  },
};
