import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticate } from '../middlewares/auth.js';
import { success, sendError } from '../utils/response.js';

const router = Router();

// Categorías por defecto (para usuarios nuevos o modo demo)
const DEFAULT_CATEGORIES = {
  income: [
    { name: 'Salario', icon: 'briefcase', color: '#22C55E' },
    { name: 'Freelance', icon: 'laptop', color: '#10B981' },
    { name: 'Inversiones', icon: 'trending-up', color: '#059669' },
    { name: 'Otros Ingresos', icon: 'plus-circle', color: '#047857' },
  ],
  expense: [
    { name: 'Alimentación', icon: 'utensils', color: '#EF4444' },
    { name: 'Transporte', icon: 'car', color: '#F97316' },
    { name: 'Servicios', icon: 'home', color: '#F59E0B' },
    { name: 'Entretenimiento', icon: 'film', color: '#8B5CF6' },
    { name: 'Salud', icon: 'heart', color: '#EC4899' },
    { name: 'Educación', icon: 'book', color: '#3B82F6' },
    { name: 'Otros Gastos', icon: 'more-horizontal', color: '#6B7280' },
  ],
};

// Proteger todas las rutas
router.use(authenticate);

// Obtener todas las categorías del usuario
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('categories')
      .select('*')
      .eq('user_id', req.user.id)
      .order('type')
      .order('name');

    if (error) throw error;

    // Si no tiene categorías, devolver listas vacías
    if (!data || data.length === 0) {
      return success(res, { 
        categories: [],
        grouped: { income: [], expense: [] },
        hasCustomCategories: false
      });
    }

    // Agrupar por tipo
    const grouped = {
      income: data.filter(c => c.type === 'income'),
      expense: data.filter(c => c.type === 'expense'),
    };

    success(res, { 
      categories: data, 
      grouped,
      hasCustomCategories: true 
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al obtener categorías');
  }
});

// Crear categoría
router.post('/', async (req, res) => {
  try {
    const { name, type, icon = 'tag', color = '#D4AF37' } = req.body;

    if (!name || !type) {
      return sendError(res, 'VALIDATION_ERROR', 'Nombre y tipo son requeridos');
    }

    if (!['income', 'expense'].includes(type)) {
      return sendError(res, 'VALIDATION_ERROR', 'Tipo debe ser income o expense');
    }

    // Verificar que no exista una categoría con el mismo nombre para este usuario
    const { data: existing } = await supabaseAdmin
      .from('categories')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('type', type)
      .ilike('name', name)
      .single();

    if (existing) {
      return sendError(res, 'VALIDATION_ERROR', 'Ya existe una categoría con ese nombre');
    }

    const { data, error } = await supabaseAdmin
      .from('categories')
      .insert({
        user_id: req.user.id,
        name: name.trim(),
        type,
        icon,
        color,
      })
      .select()
      .single();

    if (error) throw error;

    success(res, { category: data }, 201);
  } catch (error) {
    console.error('Error creating category:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al crear categoría');
  }
});

// Actualizar categoría
router.put('/:id', async (req, res) => {
  try {
    const { name, icon, color } = req.body;

    // Verificar que la categoría pertenece al usuario
    const { data: existing } = await supabaseAdmin
      .from('categories')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (!existing) {
      return sendError(res, 'NOT_FOUND', 'Categoría no encontrada');
    }

    const updateData = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name.trim();
    if (icon !== undefined) updateData.icon = icon;
    if (color !== undefined) updateData.color = color;

    const { data, error } = await supabaseAdmin
      .from('categories')
      .update(updateData)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error) throw error;

    success(res, { category: data });
  } catch (error) {
    console.error('Error updating category:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al actualizar categoría');
  }
});

// Eliminar categoría
router.delete('/:id', async (req, res) => {
  try {
    // Verificar que la categoría pertenece al usuario
    const { data: existing } = await supabaseAdmin
      .from('categories')
      .select('id, name')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (!existing) {
      return sendError(res, 'NOT_FOUND', 'Categoría no encontrada');
    }

    // Verificar si hay transacciones usando esta categoría
    const { count } = await supabaseAdmin
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.user.id)
      .eq('category', existing.name);

    if (count > 0) {
      return sendError(
        res, 
        'VALIDATION_ERROR', 
        `No se puede eliminar. Hay ${count} transacciones usando esta categoría.`
      );
    }

    const { error } = await supabaseAdmin
      .from('categories')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;

    success(res, { message: 'Categoría eliminada correctamente' });
  } catch (error) {
    console.error('Error deleting category:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al eliminar categoría');
  }
});

// Inicializar categorías por defecto para un usuario
router.post('/init', async (req, res) => {
  try {
    // Verificar si ya tiene categorías
    const { count } = await supabaseAdmin
      .from('categories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.user.id);

    if (count > 0) {
      return sendError(res, 'VALIDATION_ERROR', 'Ya tienes categorías configuradas');
    }

    // Crear todas las categorías por defecto
    const categoriesToInsert = [
      ...DEFAULT_CATEGORIES.income.map(c => ({ ...c, type: 'income', user_id: req.user.id })),
      ...DEFAULT_CATEGORIES.expense.map(c => ({ ...c, type: 'expense', user_id: req.user.id })),
    ];

    const { data, error } = await supabaseAdmin
      .from('categories')
      .insert(categoriesToInsert)
      .select();

    if (error) throw error;

    success(res, { 
      categories: data, 
      message: 'Categorías inicializadas correctamente' 
    }, 201);
  } catch (error) {
    console.error('Error initializing categories:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al inicializar categorías');
  }
});

export default router;
