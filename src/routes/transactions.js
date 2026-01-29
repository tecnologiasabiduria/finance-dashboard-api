import { Router } from 'express';
import { supabaseAdmin, getSupabaseClient } from '../config/supabase.js';
import { success, sendError } from '../utils/response.js';
import { authenticate } from '../middlewares/auth.js';
import { requireSubscriptionOrDev } from '../middlewares/subscription.js';
import { validateBody, validateUUID } from '../middlewares/validate.js';

const router = Router();

// Todas las rutas requieren autenticación y suscripción
router.use(authenticate);
router.use(requireSubscriptionOrDev);

/**
 * GET /transactions
 * Listar transacciones del usuario
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      type,
      category,
      from,
      to,
      page = 1,
      limit = 20,
      sort = 'date',
      order = 'desc',
    } = req.query;

    // Construir query
    let query = supabaseAdmin
      .from('transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', userId);

    // Filtros
    if (type && ['income', 'expense'].includes(type)) {
      query = query.eq('type', type);
    }

    if (category) {
      query = query.ilike('category', `%${category}%`);
    }

    if (from) {
      query = query.gte('date', from);
    }

    if (to) {
      query = query.lte('date', to);
    }

    // Ordenamiento
    const validSorts = ['date', 'amount', 'created_at'];
    const sortField = validSorts.includes(sort) ? sort : 'date';
    const sortOrder = order === 'asc' ? true : false;
    query = query.order(sortField, { ascending: sortOrder });

    // Paginación
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;
    query = query.range(offset, offset + limitNum - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('Get transactions error:', error);
      return sendError(res, 'INTERNAL_ERROR', 'Error al obtener transacciones');
    }

    return success(res, {
      transactions: data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count,
        totalPages: Math.ceil(count / limitNum),
      },
    });
  } catch (err) {
    console.error('Get transactions error:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
});

/**
 * GET /transactions/:id
 * Obtener una transacción específica
 */
router.get('/:id', validateUUID('id'), async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return sendError(res, 'NOT_FOUND', 'Transacción no encontrada');
    }

    return success(res, { transaction: data });
  } catch (err) {
    console.error('Get transaction error:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
});

/**
 * POST /transactions
 * Crear nueva transacción
 */
router.post(
  '/',
  validateBody([
    { name: 'type', options: ['income', 'expense'] },
    { name: 'amount', type: 'number', min: 0.01 },
    'date',
    { name: 'category', required: false },
    { name: 'description', required: false },
  ]),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { type, amount, category, description, date } = req.body;

      const { data, error } = await supabaseAdmin
        .from('transactions')
        .insert({
          user_id: userId,
          type,
          amount: parseFloat(amount),
          category: category || null,
          description: description || null,
          date,
        })
        .select()
        .single();

      if (error) {
        console.error('Create transaction error:', error);
        return sendError(res, 'INTERNAL_ERROR', 'Error al crear transacción');
      }

      return success(res, { transaction: data }, 201);
    } catch (err) {
      console.error('Create transaction error:', err);
      return sendError(res, 'INTERNAL_ERROR');
    }
  }
);

/**
 * PUT /transactions/:id
 * Actualizar transacción
 */
router.put(
  '/:id',
  validateUUID('id'),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { type, amount, category, description, date } = req.body;

      // Verificar que existe y pertenece al usuario
      const { data: existing } = await supabaseAdmin
        .from('transactions')
        .select('id')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (!existing) {
        return sendError(res, 'NOT_FOUND', 'Transacción no encontrada');
      }

      // Preparar datos de actualización
      const updateData = {};
      if (type && ['income', 'expense'].includes(type)) updateData.type = type;
      if (amount !== undefined) updateData.amount = parseFloat(amount);
      if (category !== undefined) updateData.category = category;
      if (description !== undefined) updateData.description = description;
      if (date) updateData.date = date;

      if (Object.keys(updateData).length === 0) {
        return sendError(res, 'VALIDATION_ERROR', 'No hay datos para actualizar');
      }

      const { data, error } = await supabaseAdmin
        .from('transactions')
        .update(updateData)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        console.error('Update transaction error:', error);
        return sendError(res, 'INTERNAL_ERROR', 'Error al actualizar transacción');
      }

      return success(res, { transaction: data });
    } catch (err) {
      console.error('Update transaction error:', err);
      return sendError(res, 'INTERNAL_ERROR');
    }
  }
);

/**
 * DELETE /transactions/:id
 * Eliminar transacción
 */
router.delete('/:id', validateUUID('id'), async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from('transactions')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !data) {
      return sendError(res, 'NOT_FOUND', 'Transacción no encontrada');
    }

    return success(res, { message: 'Transacción eliminada', transaction: data });
  } catch (err) {
    console.error('Delete transaction error:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
});

export default router;
