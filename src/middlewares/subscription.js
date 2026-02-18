import { supabaseAdmin } from '../config/supabase.js';
import { sendError } from '../utils/response.js';
import { config } from '../config/env.js';

/**
 * Middleware de verificación de suscripción
 * Debe usarse después del middleware de autenticación
 * Verifica que el usuario tenga una suscripción activa
 */
export async function requireSubscription(req, res, next) {
  try {
    // Verificar que el usuario esté autenticado
    if (!req.user) {
      return sendError(res, 'UNAUTHORIZED', 'Debes estar autenticado');
    }

    const userId = req.user.id;

    // 1. Verificar en profiles.subscription_status (fuente de verdad del webhook GHL)
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, subscription_status')
      .eq('id', userId)
      .single();

    if (profileError && profileError.code !== 'PGRST116') {
      console.error('Profile subscription check error:', profileError);
    }

    if (profile?.subscription_status === 'active') {
      req.subscription = {
        id: `profile-${profile.id}`,
        status: 'active',
        provider: 'ghl_webhook',
      };
      return next();
    }

    // 2. Fallback: buscar en tabla subscriptions (Stripe directo)
    const { data: subscription, error } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Subscription check error:', error);
      return sendError(res, 'INTERNAL_ERROR', 'Error al verificar suscripción');
    }

    if (!subscription) {
      return sendError(
        res,
        'SUBSCRIPTION_INACTIVE',
        'Necesitas una suscripción activa para acceder a esta función'
      );
    }

    // Verificar que la suscripción no haya expirado
    if (subscription.current_period_end) {
      const endDate = new Date(subscription.current_period_end);
      if (endDate < new Date()) {
        return sendError(
          res,
          'SUBSCRIPTION_INACTIVE',
          'Tu suscripción ha expirado'
        );
      }
    }

    // Añadir suscripción a la request
    req.subscription = subscription;

    next();
  } catch (err) {
    console.error('Subscription middleware error:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
}

/**
 * Middleware opcional de suscripción
 * En modo desarrollo, permite acceso sin suscripción
 */
export async function requireSubscriptionOrDev(req, res, next) {
  // En desarrollo, permitir acceso sin suscripción
  if (config.isDev) {
    req.subscription = {
      id: 'dev-subscription',
      status: 'active',
      provider: 'development',
    };
    return next();
  }

  // En producción, requerir suscripción real
  return requireSubscription(req, res, next);
}
