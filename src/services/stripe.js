import Stripe from 'stripe';
import { config } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';

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

      case 'invoice.paid':
        return this.handleInvoicePaid(data.object);

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        return this.handleSubscriptionUpdate(data.object);

      case 'customer.subscription.deleted':
        return this.handleSubscriptionDeleted(data.object);

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

    // Crear usuario y activar suscripción
    const result = await this.activateUserSubscription(email);
    
    console.log(`✅ Checkout completado para: ${email}`);
    return result;
  },

  /**
   * Manejar invoice pagado (evento principal para activar suscripción)
   */
  async handleInvoicePaid(invoice) {
    // Obtener email del cliente
    let email = invoice.customer_email;
    
    // Si no hay email directo, obtenerlo del customer
    if (!email && invoice.customer && stripe) {
      try {
        const customer = await stripe.customers.retrieve(invoice.customer);
        email = customer.email;
      } catch (err) {
        console.error('Error fetching customer:', err);
      }
    }

    if (!email) {
      console.error('No email found in invoice.paid');
      return { error: 'No email found' };
    }

    // Activar usuario y suscripción
    const result = await this.activateUserSubscription(email);

    console.log(`💰 Invoice pagado - Usuario activado: ${email}`);
    return result;
  },

  /**
   * Activar suscripción para un usuario (crear si no existe)
   */
  async activateUserSubscription(email) {
    try {
      // 1. Buscar si el usuario ya existe en auth
      const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
      let authUser = users.find((u) => u.email === email);

      // 2. Si no existe, crear usuario
      if (!authUser) {
        console.log(`📧 Creando nuevo usuario: ${email}`);
        
        const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email,
          email_confirm: true, // Marcar email como verificado
          user_metadata: {
            created_from: 'stripe_webhook',
            subscription_status: 'active'
          }
        });

        if (createError) {
          console.error('Error creating user:', createError);
          return { error: createError.message };
        }

        authUser = newUser.user;
        console.log(`✅ Usuario creado: ${authUser.id}`);
      }

      // 3. Crear/actualizar profile con subscription_status = active
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .upsert({
          id: authUser.id,
          email: authUser.email,
          subscription_status: 'active',
          updated_at: new Date().toISOString()
        });

      if (profileError) {
        console.error('Error upserting profile:', profileError);
      }

      // 4. Generar Magic Link para que el usuario acceda
      const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: {
          redirectTo: config.frontendUrl || 'http://localhost:5173/dashboard'
        }
      });

      if (linkError) {
        console.error('Error generating magic link:', linkError);
        return { 
          success: true, 
          userId: authUser.id,
          magicLinkError: linkError.message 
        };
      }

      // 5. El magic link se envía automáticamente por Supabase
      // O podemos obtener el link y enviarlo manualmente
      console.log(`🔗 Magic link generado para: ${email}`);

      return {
        success: true,
        userId: authUser.id,
        email,
        isNewUser: !users.find((u) => u.email === email),
        magicLinkSent: true
      };

    } catch (err) {
      console.error('Error in activateUserSubscription:', err);
      return { error: err.message };
    }
  },

  /**
   * Manejar actualización de suscripción
   */
  async handleSubscriptionUpdate(subscription) {
    const customerId = subscription.customer;
    
    // Obtener email del customer de Stripe
    let customerEmail;
    if (stripe) {
      try {
        const customer = await stripe.customers.retrieve(customerId);
        customerEmail = customer.email;
      } catch (err) {
        console.error('Error fetching customer:', err);
      }
    }

    if (!customerEmail) {
      console.error('No customer email found');
      return { error: 'No customer email' };
    }

    // Mapear status de Stripe a nuestro sistema
    const statusMap = {
      active: 'active',
      past_due: 'active', // Aún activo pero con pago pendiente
      canceled: 'cancelled',
      incomplete: 'none',
      incomplete_expired: 'none',
      trialing: 'active',
      unpaid: 'cancelled',
    };

    const status = statusMap[subscription.status] || 'none';

    // Actualizar profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .update({ 
        subscription_status: status,
        updated_at: new Date().toISOString() 
      })
      .eq('email', customerEmail)
      .select()
      .single();

    console.log(`✅ Suscripción actualizada para ${customerEmail}: ${status}`);
    return { success: true, profile };
  },

  /**
   * Manejar suscripción eliminada/cancelada
   */
  async handleSubscriptionDeleted(subscription) {
    const customerId = subscription.customer;
    
    let customerEmail;
    if (stripe) {
      try {
        const customer = await stripe.customers.retrieve(customerId);
        customerEmail = customer.email;
      } catch (err) {
        console.error('Error fetching customer:', err);
      }
    }

    if (customerEmail) {
      await supabaseAdmin
        .from('profiles')
        .update({ 
          subscription_status: 'cancelled',
          updated_at: new Date().toISOString() 
        })
        .eq('email', customerEmail);
    }

    console.log(`❌ Suscripción cancelada para: ${customerEmail}`);
    return { success: true };
  },

  /**
   * Manejar pago fallido
   */
  async handlePaymentFailed(invoice) {
    let email = invoice.customer_email;
    
    if (!email && invoice.customer && stripe) {
      try {
        const customer = await stripe.customers.retrieve(invoice.customer);
        email = customer.email;
      } catch (err) {
        console.error('Error fetching customer:', err);
      }
    }

    if (email) {
      // No cancelamos inmediatamente, Stripe reintentará
      console.log(`⚠️ Pago fallido para: ${email} - Stripe reintentará`);
    }

    return { success: true, paymentFailed: true };
  },
};
