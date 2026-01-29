import Stripe from 'stripe';
import { config } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { subscriptionService } from './subscription.js';

// Inicializar Stripe (solo si hay key configurada)
const stripe = config.stripe.secretKey
  ? new Stripe(config.stripe.secretKey)
  : null;

/**
 * Servicio para manejar webhooks de Stripe
 */
export const stripeService = {
  /**
   * Verificar firma del webhook
   */
  verifyWebhookSignature(payload, signature) {
    if (!stripe || !config.stripe.webhookSecret) {
      throw new Error('Stripe no configurado');
    }

    return stripe.webhooks.constructEvent(
      payload,
      signature,
      config.stripe.webhookSecret
    );
  },

  /**
   * Procesar evento de webhook
   */
  async handleWebhookEvent(event) {
    const { type, data } = event;

    console.log(`📥 Stripe webhook: ${type}`);

    switch (type) {
      case 'checkout.session.completed':
        return this.handleCheckoutComplete(data.object);

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        return this.handleSubscriptionUpdate(data.object);

      case 'customer.subscription.deleted':
        return this.handleSubscriptionDeleted(data.object);

      case 'invoice.payment_succeeded':
        return this.handlePaymentSucceeded(data.object);

      case 'invoice.payment_failed':
        return this.handlePaymentFailed(data.object);

      default:
        console.log(`⚠️ Evento no manejado: ${type}`);
        return { handled: false };
    }
  },

  /**
   * Manejar checkout completado
   */
  async handleCheckoutComplete(session) {
    const email = session.customer_email || session.customer_details?.email;
    
    if (!email) {
      console.error('No email in checkout session');
      return { error: 'No email found' };
    }

    // Buscar o crear usuario
    const user = await this.findOrCreateUser(email);

    console.log(`✅ Checkout completado para: ${email}`);
    return { success: true, userId: user.id };
  },

  /**
   * Manejar actualización de suscripción
   */
  async handleSubscriptionUpdate(subscription) {
    const customerId = subscription.customer;
    
    // Obtener email del customer de Stripe
    let customerEmail;
    if (stripe) {
      const customer = await stripe.customers.retrieve(customerId);
      customerEmail = customer.email;
    }

    if (!customerEmail) {
      console.error('No customer email found');
      return { error: 'No customer email' };
    }

    // Buscar usuario por email
    const user = await this.findOrCreateUser(customerEmail);

    // Mapear status de Stripe a nuestro sistema
    const statusMap = {
      active: 'active',
      past_due: 'past_due',
      canceled: 'cancelled',
      incomplete: 'inactive',
      incomplete_expired: 'inactive',
      trialing: 'active',
      unpaid: 'past_due',
    };

    const result = await subscriptionService.upsertFromWebhook({
      userId: user.id,
      provider: 'stripe',
      externalId: subscription.id,
      status: statusMap[subscription.status] || 'inactive',
      periodStart: new Date(subscription.current_period_start * 1000).toISOString(),
      periodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
    });

    console.log(`✅ Suscripción ${result.created ? 'creada' : 'actualizada'} para: ${customerEmail}`);
    return result;
  },

  /**
   * Manejar suscripción eliminada
   */
  async handleSubscriptionDeleted(subscription) {
    const { data } = await supabaseAdmin
      .from('subscriptions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('external_id', subscription.id)
      .select()
      .single();

    console.log(`❌ Suscripción cancelada: ${subscription.id}`);
    return { success: true, subscription: data };
  },

  /**
   * Manejar pago exitoso
   */
  async handlePaymentSucceeded(invoice) {
    if (invoice.subscription) {
      const { data } = await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('external_id', invoice.subscription)
        .select()
        .single();

      console.log(`💰 Pago exitoso para suscripción: ${invoice.subscription}`);
      return { success: true, subscription: data };
    }
    return { success: true };
  },

  /**
   * Manejar pago fallido
   */
  async handlePaymentFailed(invoice) {
    if (invoice.subscription) {
      const { data } = await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'past_due', updated_at: new Date().toISOString() })
        .eq('external_id', invoice.subscription)
        .select()
        .single();

      console.log(`⚠️ Pago fallido para suscripción: ${invoice.subscription}`);
      return { success: true, subscription: data };
    }
    return { success: true };
  },

  /**
   * Buscar o crear usuario por email
   */
  async findOrCreateUser(email) {
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
          full_name: authUser.user_metadata?.full_name || null,
        })
        .select()
        .single();

      return newProfile;
    }

    // Usuario no existe - lo crearemos cuando se registre
    console.log(`⚠️ Usuario ${email} no encontrado, se creará en el registro`);
    return { id: null, email };
  },
};
