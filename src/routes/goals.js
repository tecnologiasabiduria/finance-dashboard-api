import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authenticate } from '../middlewares/auth.js';
import { success, sendError } from '../utils/response.js';

const router = Router();

router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('goals')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    success(res, { goals: data });
  } catch (error) {
    console.error('Error fetching goals:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al obtener metas');
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('goals')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return sendError(res, 'NOT_FOUND', 'Meta no encontrada');
      throw error;
    }
    success(res, { goal: data });
  } catch (error) {
    console.error('Error fetching goal:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al obtener meta');
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, target, current = 0, color = '#D4AF37' } = req.body;
    if (!name || !target) return sendError(res, 'VALIDATION_ERROR', 'Nombre y objetivo son requeridos');
    if (target <= 0) return sendError(res, 'VALIDATION_ERROR', 'El objetivo debe ser mayor a 0');
    const { data, error } = await supabase
      .from('goals')
      .insert({ user_id: req.user.id, name, target, current: Math.max(0, current), color })
      .select()
      .single();
    if (error) throw error;
    success(res, { goal: data }, 201);
  } catch (error) {
    console.error('Error creating goal:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al crear meta');
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, target, current, color } = req.body;
    const { data: existing } = await supabase
      .from('goals')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (!existing) return sendError(res, 'NOT_FOUND', 'Meta no encontrada');
    const updateData = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (target !== undefined) updateData.target = target;
    if (current !== undefined) updateData.current = Math.max(0, current);
    if (color !== undefined) updateData.color = color;
    const { data, error } = await supabase
      .from('goals')
      .update(updateData)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();
    if (error) throw error;
    success(res, { goal: data });
  } catch (error) {
    console.error('Error updating goal:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al actualizar meta');
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('goals')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    if (error) throw error;
    success(res, { message: 'Meta eliminada correctamente' });
  } catch (error) {
    console.error('Error deleting goal:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al eliminar meta');
  }
});

export default router;
