import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticate } from '../middlewares/auth.js';
import { success, sendError } from '../utils/response.js';

const router = Router();

router.use(authenticate);

/**
 * GET /subcategories?category_id=xxx
 */
router.get('/', async (req, res) => {
  try {
    const { category_id } = req.query;

    let query = supabaseAdmin
      .from('subcategories')
      .select('*')
      .eq('user_id', req.user.id)
      .order('name');

    if (category_id) {
      query = query.eq('category_id', category_id);
    }

    const { data, error } = await query;

    if (error) throw error;

    success(res, { subcategories: data || [] });
  } catch (error) {
    console.error('Error fetching subcategories:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al obtener subcategorías');
  }
});

/**
 * POST /subcategories
 */
router.post('/', async (req, res) => {
  try {
    const {
      category_id, name,
      provider_name, provider_document, payment_method,
      client_name, client_document, client_email, client_phone, client_address,
    } = req.body;

    if (!category_id || !name) {
      return sendError(res, 'VALIDATION_ERROR', 'category_id y nombre son requeridos');
    }

    const { data: cat } = await supabaseAdmin
      .from('categories')
      .select('id')
      .eq('id', category_id)
      .eq('user_id', req.user.id)
      .single();

    if (!cat) {
      return sendError(res, 'NOT_FOUND', 'Categoría no encontrada');
    }

    const { data: existing } = await supabaseAdmin
      .from('subcategories')
      .select('id')
      .eq('category_id', category_id)
      .eq('user_id', req.user.id)
      .ilike('name', name)
      .single();

    if (existing) {
      return sendError(res, 'VALIDATION_ERROR', 'Ya existe una subcategoría con ese nombre en esta categoría');
    }

    const insertData = {
      category_id,
      user_id: req.user.id,
      name: name.trim(),
    };

    if (provider_name !== undefined) insertData.provider_name = provider_name || null;
    if (provider_document !== undefined) insertData.provider_document = provider_document || null;
    if (payment_method !== undefined) insertData.payment_method = payment_method || null;
    if (client_name !== undefined) insertData.client_name = client_name || null;
    if (client_document !== undefined) insertData.client_document = client_document || null;
    if (client_email !== undefined) insertData.client_email = client_email || null;
    if (client_phone !== undefined) insertData.client_phone = client_phone || null;
    if (client_address !== undefined) insertData.client_address = client_address || null;

    const { data, error } = await supabaseAdmin
      .from('subcategories')
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;

    success(res, { subcategory: data }, 201);
  } catch (error) {
    console.error('Error creating subcategory:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al crear subcategoría');
  }
});

/**
 * PUT /subcategories/:id
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      provider_name, provider_document, payment_method,
      client_name, client_document, client_email, client_phone, client_address,
    } = req.body;

    const { data: existing } = await supabaseAdmin
      .from('subcategories')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();

    if (!existing) {
      return sendError(res, 'NOT_FOUND', 'Subcategoría no encontrada');
    }

    const updateData = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name.trim();
    if (provider_name !== undefined) updateData.provider_name = provider_name || null;
    if (provider_document !== undefined) updateData.provider_document = provider_document || null;
    if (payment_method !== undefined) updateData.payment_method = payment_method || null;
    if (client_name !== undefined) updateData.client_name = client_name || null;
    if (client_document !== undefined) updateData.client_document = client_document || null;
    if (client_email !== undefined) updateData.client_email = client_email || null;
    if (client_phone !== undefined) updateData.client_phone = client_phone || null;
    if (client_address !== undefined) updateData.client_address = client_address || null;

    const { data, error } = await supabaseAdmin
      .from('subcategories')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error) throw error;

    success(res, { subcategory: data });
  } catch (error) {
    console.error('Error updating subcategory:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al actualizar subcategoría');
  }
});

/**
 * DELETE /subcategories/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: existing } = await supabaseAdmin
      .from('subcategories')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();

    if (!existing) {
      return sendError(res, 'NOT_FOUND', 'Subcategoría no encontrada');
    }

    const { error } = await supabaseAdmin
      .from('subcategories')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id);

    if (error) throw error;

    success(res, { message: 'Subcategoría eliminada correctamente' });
  } catch (error) {
    console.error('Error deleting subcategory:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al eliminar subcategoría');
  }
});

export default router;
