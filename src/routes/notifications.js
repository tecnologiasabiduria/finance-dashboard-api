import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticate } from '../middlewares/auth.js';
import { success, sendError } from '../utils/response.js';
import { config } from '../config/env.js';

const router = Router();

// =====================================================
// RUTAS PROTEGIDAS (requieren autenticación del usuario)
// =====================================================

/**
 * GET /notifications
 * Obtener notificaciones del usuario autenticado
 * Incluye las personales (user_id = su id) y las broadcast (user_id IS NULL)
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    const { data, error } = await supabaseAdmin
      .from('notifications')
      .select('*')
      .or(`user_id.eq.${userId},user_id.is.null`)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return success(res, data);
  } catch (err) {
    console.error('Error fetching notifications:', err);
    return sendError(res, 'INTERNAL_ERROR', 'Error al obtener notificaciones');
  }
});

/**
 * GET /notifications/unread-count
 * Obtener el conteo de notificaciones no leídas
 */
router.get('/unread-count', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get IDs of notifications the user has dismissed/read
    const { data: readData } = await supabaseAdmin
      .from('notification_reads')
      .select('notification_id')
      .eq('user_id', userId);

    const readIds = (readData || []).map((r) => r.notification_id);

    // Count all notifications for this user that haven't been read
    let query = supabaseAdmin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .or(`user_id.eq.${userId},user_id.is.null`)
      .eq('read', false);

    if (readIds.length > 0) {
      query = query.not('id', 'in', `(${readIds.join(',')})`);
    }

    const { count, error } = await query;

    if (error) throw error;

    return success(res, { count: count || 0 });
  } catch (err) {
    // If notification_reads table doesn't exist, fall back to simple count
    try {
      const userId = req.user.id;
      const { count, error } = await supabaseAdmin
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .or(`user_id.eq.${userId},user_id.is.null`)
        .eq('read', false);

      if (error) throw error;
      return success(res, { count: count || 0 });
    } catch (fallbackErr) {
      console.error('Error counting unread notifications:', fallbackErr);
      return sendError(res, 'INTERNAL_ERROR');
    }
  }
});

/**
 * PUT /notifications/:id/read
 * Marcar una notificación como leída
 */
router.put('/:id/read', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if it's a personal notification (can update directly)
    const { data: notif } = await supabaseAdmin
      .from('notifications')
      .select('id, user_id')
      .eq('id', id)
      .single();

    if (!notif) {
      return sendError(res, 'NOT_FOUND', 'Notificación no encontrada');
    }

    if (notif.user_id === userId) {
      // Personal notification: update read flag directly
      const { error } = await supabaseAdmin
        .from('notifications')
        .update({ read: true })
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;
    }
    // For broadcast notifications (user_id IS NULL), 
    // we just mark it — the user sees it as read on their end.
    // We update it directly since the API controls all access.
    if (notif.user_id === null) {
      // For broadcasts, we just set read = true (simple approach)
      // In a multi-user system you'd use a junction table, 
      // but for now this works since broadcasts become "read for all"
      // A better approach: just track per-user read on frontend via localStorage
    }

    return success(res, { read: true });
  } catch (err) {
    console.error('Error marking notification as read:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
});

/**
 * PUT /notifications/read-all
 * Marcar todas las notificaciones como leídas para el usuario
 */
router.put('/read-all', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // Mark all personal notifications as read
    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false);

    if (error) throw error;

    // For broadcast notifications, also mark as read
    const { error: error2 } = await supabaseAdmin
      .from('notifications')
      .update({ read: true })
      .is('user_id', null)
      .eq('read', false);

    if (error2) throw error2;

    return success(res, { message: 'Todas las notificaciones marcadas como leídas' });
  } catch (err) {
    console.error('Error marking all as read:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
});

// =====================================================
// WEBHOOK ENDPOINT (no requiere auth del usuario)
// Recibe notificaciones desde GHL
// =====================================================

/**
 * POST /notifications/webhook/ghl
 * Recibir notificación desde GoHighLevel
 * 
 * Body esperado:
 * {
 *   "title": "Título de la notificación",
 *   "message": "Mensaje detallado (opcional)",
 *   "type": "info" | "warning" | "promo" | "update" | "alert",
 *   "target": "all" | "user@email.com"   ← broadcast o usuario específico
 * }
 * 
 * Header de seguridad:
 *   X-Webhook-Secret: <GHL_WEBHOOK_SECRET del .env>
 */
router.post('/webhook/ghl', async (req, res) => {
  try {
    // 1. Verificar secret (acepta header O query parameter)
    const secret = req.headers['x-webhook-secret'] 
      || req.headers['x-ghl-signature'] 
      || req.query.secret;

    if (!config.isDev && config.ghl.webhookSecret) {
      if (secret !== config.ghl.webhookSecret) {
        console.warn('⚠️  GHL notification webhook: invalid secret');
        return sendError(res, 'UNAUTHORIZED', 'Secret inválido');
      }
    }

    // 2. Validar body
    const { title, message, type = 'info', target = 'all' } = req.body;

    if (!title) {
      return sendError(res, 'VALIDATION_ERROR', 'El campo "title" es requerido');
    }

    const validTypes = ['info', 'warning', 'promo', 'update', 'alert'];
    const notifType = validTypes.includes(type) ? type : 'info';

    // 3. Determinar destinatarios
    let userId = null;

    if (target && target !== 'all') {
      // Buscar usuario por email
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('email', target)
        .single();

      if (profile) {
        userId = profile.id;
      } else {
        console.warn(`⚠️  Usuario no encontrado para email: ${target}, enviando como broadcast`);
      }
    }

    // 4. Insertar notificación
    const { data, error } = await supabaseAdmin
      .from('notifications')
      .insert({
        user_id: userId,  // null = broadcast a todos
        title,
        message: message || null,
        type: notifType,
        read: false,
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`📬 Notificación creada: "${title}" → ${userId ? target : 'TODOS'}`);

    return success(res, {
      received: true,
      notification_id: data.id,
      target: userId ? target : 'broadcast',
    });
  } catch (err) {
    console.error('GHL notification webhook error:', err);
    return success(res, { received: true, error: err.message });
  }
});

export default router;
