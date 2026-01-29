import { Router } from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { success, sendError } from '../utils/response.js';
import { authenticate } from '../middlewares/auth.js';
import { validateBody } from '../middlewares/validate.js';
import { subscriptionService } from '../services/subscription.js';
import { config } from '../config/env.js';

const router = Router();

/**
 * POST /auth/register
 * Registrar nuevo usuario
 */
router.post(
  '/register',
  validateBody([
    'email',
    'password',
    { name: 'name', required: false },
  ]),
  async (req, res) => {
    try {
      const { email, password, name } = req.body;

      // Registrar en Supabase Auth
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name,
          },
        },
      });

      if (error) {
        console.error('Register error:', error);
        
        if (error.message.includes('already registered')) {
          return sendError(res, 'VALIDATION_ERROR', 'Este email ya está registrado');
        }
        
        if (error.message.includes('rate limit') || error.code === 'over_email_send_rate_limit') {
          return sendError(res, 'RATE_LIMIT', 'Demasiados intentos. Espera unos minutos e intenta de nuevo.');
        }
        
        return sendError(res, 'VALIDATION_ERROR', error.message);
      }

      // Crear perfil en tabla profiles (si no existe por trigger)
      if (data.user) {
        await supabaseAdmin.from('profiles').upsert({
          id: data.user.id,
          email: data.user.email,
          full_name: name,
        });
      }

      return success(res, {
        message: 'Usuario registrado exitosamente',
        user: {
          id: data.user?.id,
          email: data.user?.email,
          name: name,
        },
        // El usuario necesita activar suscripción
        requiresSubscription: true,
      }, 201);
    } catch (err) {
      console.error('Register error:', err);
      return sendError(res, 'INTERNAL_ERROR');
    }
  }
);

/**
 * POST /auth/login
 * Iniciar sesión
 */
router.post(
  '/login',
  validateBody(['email', 'password']),
  async (req, res) => {
    try {
      const { email, password } = req.body;

      // Autenticar con Supabase
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error('Login error:', error);
        
        // Manejar error de email no confirmado
        if (error.message.includes('Email not confirmed')) {
          return sendError(res, 'EMAIL_NOT_CONFIRMED', 'Por favor confirma tu email antes de iniciar sesión');
        }
        
        return sendError(res, 'INVALID_CREDENTIALS', 'Email o contraseña incorrectos');
      }

      const { user, session } = data;

      // Obtener perfil del usuario
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      // Verificar suscripción (en producción)
      let subscription = null;
      let hasActiveSubscription = false;

      if (!config.isDev) {
        subscription = await subscriptionService.getActive(user.id);
        hasActiveSubscription = !!subscription;

        if (!hasActiveSubscription) {
          // Retornar 403 para indicar que necesita suscripción
          return sendError(
            res,
            'SUBSCRIPTION_INACTIVE',
            'Necesitas una suscripción activa para acceder'
          );
        }
      } else {
        // En desarrollo, simular suscripción activa
        hasActiveSubscription = true;
        subscription = {
          id: 'dev-subscription',
          status: 'active',
          provider: 'development',
        };
      }

      return success(res, {
        user: {
          id: user.id,
          email: user.email,
          name: profile?.full_name || user.user_metadata?.full_name,
        },
        token: session.access_token,
        refreshToken: session.refresh_token,
        expiresAt: session.expires_at,
        subscription: {
          status: subscription?.status,
          provider: subscription?.provider,
        },
      });
    } catch (err) {
      console.error('Login error:', err);
      return sendError(res, 'INTERNAL_ERROR');
    }
  }
);

/**
 * GET /auth/me
 * Obtener datos del usuario autenticado
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // Obtener perfil
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    // Obtener suscripción
    let subscription = null;
    if (!config.isDev) {
      subscription = await subscriptionService.getActive(userId);
    } else {
      subscription = {
        id: 'dev-subscription',
        status: 'active',
        provider: 'development',
      };
    }

    return success(res, {
      user: {
        id: req.user.id,
        email: req.user.email,
        name: profile?.full_name || req.user.user_metadata?.full_name,
        createdAt: profile?.created_at,
      },
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            provider: subscription.provider,
            currentPeriodEnd: subscription.current_period_end,
          }
        : null,
    });
  } catch (err) {
    console.error('Get me error:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
});

/**
 * POST /auth/logout
 * Cerrar sesión
 */
router.post('/logout', authenticate, async (req, res) => {
  try {
    await supabase.auth.signOut();
    return success(res, { message: 'Sesión cerrada exitosamente' });
  } catch (err) {
    console.error('Logout error:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
});

/**
 * POST /auth/refresh
 * Refrescar token
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return sendError(res, 'VALIDATION_ERROR', 'Refresh token requerido');
    }

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error) {
      return sendError(res, 'UNAUTHORIZED', 'Token de refresco inválido');
    }

    return success(res, {
      token: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at,
    });
  } catch (err) {
    console.error('Refresh error:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
});

export default router;
