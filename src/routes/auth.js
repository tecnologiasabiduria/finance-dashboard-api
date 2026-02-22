import { Router } from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { success, sendError } from '../utils/response.js';
import { authenticate } from '../middlewares/auth.js';
import { validateBody } from '../middlewares/validate.js';
import { subscriptionService } from '../services/subscription.js';
import { config } from '../config/env.js';
import { initDefaultCategories } from './categories.js';

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

        // Inicializar categorías y subcategorías por defecto (solo se ejecuta una vez)
        try {
          await initDefaultCategories(data.user.id);
        } catch (catErr) {
          console.error('Error initializing default categories for new user:', catErr);
        }
      }

      // Si no hay session, significa que requiere confirmación de email
      const requiresEmailConfirmation = data.session === null;
      return success(res, {
        message: 'Usuario registrado exitosamente',
        user: {
          id: data.user?.id,
          email: data.user?.email,
          name: name,
        },
        // El usuario necesita activar suscripción
        requiresEmailConfirmation,
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


/**
 * POST /auth/forgot-password
 * Enviar email de recuperación de contraseña
 */
router.post(
  '/forgot-password',
  validateBody(['email']),
  async (req, res) => {
    try {
      const { email } = req.body;

      const redirectTo = `${config.frontendUrl}/auth/callback`;

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });

      if (error) {
        console.error('Forgot password error:', error);

        if (error.message.includes('rate limit') || error.code === 'over_email_send_rate_limit') {
          return sendError(res, 'RATE_LIMIT', 'Demasiados intentos. Espera unos minutos e intenta de nuevo.');
        }

        return sendError(res, 'INTERNAL_ERROR', 'Error al enviar el email de recuperación');
      }

      return success(res, {
        message: 'Si el email está registrado, recibirás un enlace para restablecer tu contraseña.',
      });
    } catch (err) {
      console.error('Forgot password error:', err);
      return sendError(res, 'INTERNAL_ERROR');
    }
  }
);

/**
 * PUT /auth/profile
 * Actualizar perfil del usuario
 */
router.put('/profile', authenticate, async (req, res) => {
  try {
    const { name } = req.body;
    const userId = req.user.id;

    if (!name || !name.trim()) {
      return sendError(res, 'VALIDATION_ERROR', 'El nombre es requerido');
    }

    // Actualizar en tabla profiles
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .upsert({ id: userId, full_name: name.trim(), updated_at: new Date().toISOString() })
      .select()
      .single();

    if (error) {
      console.error('Update profile error:', error);
      return sendError(res, 'INTERNAL_ERROR', 'Error al actualizar perfil');
    }

    // Actualizar metadata en Supabase Auth
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: { full_name: name.trim() }
    });

    return success(res, {
      message: 'Perfil actualizado correctamente',
      user: {
        id: userId,
        email: req.user.email,
        name: data.full_name,
      }
    });
  } catch (err) {
    console.error('Update profile error:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
});

/**
 * PUT /auth/password
 * Cambiar contraseña
 */
router.put('/password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword) {
      return sendError(res, 'VALIDATION_ERROR', 'Contraseña actual y nueva son requeridas');
    }

    if (newPassword.length < 8) {
      return sendError(res, 'VALIDATION_ERROR', 'La nueva contraseña debe tener al menos 8 caracteres');
    }

    // Verificar contraseña actual intentando login
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: req.user.email,
      password: currentPassword,
    });

    if (verifyError) {
      return sendError(res, 'INVALID_CREDENTIALS', 'La contraseña actual es incorrecta');
    }

    // Actualizar contraseña
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: newPassword
    });

    if (updateError) {
      console.error('Update password error:', updateError);
      return sendError(res, 'INTERNAL_ERROR', 'Error al cambiar contraseña');
    }

    return success(res, { message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error('Update password error:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
});

export default router;
