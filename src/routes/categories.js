import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticate } from '../middlewares/auth.js';
import { success, sendError } from '../utils/response.js';

const router = Router();

// Categorías por defecto para perfil empresarial colombiano
const DEFAULT_CATEGORIES = {
  income: [
    { name: 'Ventas', icon: 'shopping-cart', color: '#22C55E', subcategories: ['Ventas de Contado', 'Ventas a Crédito', 'Ventas por Mayor', 'Ventas Online'] },
    { name: 'Servicios Prestados', icon: 'briefcase', color: '#10B981', subcategories: ['Consultoría', 'Asesoría', 'Mantenimiento', 'Soporte Técnico', 'Implementación'] },
    { name: 'Consultoría y Formación', icon: 'graduation-cap', color: '#8B5CF6', subcategories: ['Consultoría Empresarial', 'Mentoría', 'Talleres', 'Cursos', 'Conferencias', 'Coaching'] },
    { name: 'Eventos e Ingresos Especiales', icon: 'calendar', color: '#F97316', subcategories: ['Organización de Eventos', 'Patrocinios Recibidos', 'Stands y Ferias', 'Entradas y Boletería', 'Webinars Pagos'] },
    { name: 'Cartera Recuperada', icon: 'wallet', color: '#059669', subcategories: ['Cobro de Cartera', 'Pagos Pendientes', 'Acuerdos de Pago'] },
    { name: 'Inversiones', icon: 'trending-up', color: '#0EA5E9', subcategories: ['Rendimientos CDT', 'Dividendos', 'Intereses Ganados'] },
    { name: 'Otros Ingresos', icon: 'plus-circle', color: '#047857', subcategories: ['Arriendos', 'Comisiones', 'Reembolsos', 'Afiliaciones'] },
  ],
  expense: [
    { name: 'Nómina y Personal', icon: 'users', color: '#EF4444', subcategories: ['Salarios', 'Prima de Servicios', 'Cesantías', 'Seguridad Social', 'ARL', 'Caja de Compensación', 'Vacaciones'] },
    { name: 'Arriendo y Local', icon: 'building-2', color: '#F97316', subcategories: ['Arriendo Local', 'Arriendo Bodega', 'Administración', 'Arriendo Oficina', 'Coworking'] },
    { name: 'Servicios Públicos', icon: 'zap', color: '#F59E0B', subcategories: ['Energía Eléctrica', 'Agua', 'Gas', 'Internet', 'Telefonía Fija', 'Telefonía Móvil'] },
    { name: 'Impuestos y Obligaciones', icon: 'landmark', color: '#DC2626', subcategories: ['IVA', 'Retención en la Fuente', 'ICA', 'Renta', 'Cámara de Comercio', 'DIAN', 'Predial'] },
    { name: 'Proveedores y Materia Prima', icon: 'package', color: '#8B5CF6', subcategories: ['Materia Prima', 'Insumos', 'Mercancía', 'Inventario'] },
    { name: 'Transporte y Logística', icon: 'truck', color: '#3B82F6', subcategories: ['Combustible', 'Envíos', 'Peajes', 'Mantenimiento Vehículos', 'SOAT', 'Tecnomecánica'] },
    { name: 'Marketing y Publicidad', icon: 'megaphone', color: '#EC4899', subcategories: ['Redes Sociales', 'Google Ads', 'Material Impreso', 'Eventos Promocionales', 'Diseño Gráfico', 'Email Marketing', 'Influencers'] },
    { name: 'Plataformas Digitales', icon: 'globe', color: '#6366F1', subcategories: ['Zoom', 'Google Workspace', 'Microsoft 365', 'CRM (HubSpot/Salesforce)', 'Slack', 'Canva', 'ChatGPT / IA', 'Notion', 'Trello / Asana', 'Mailchimp', 'WhatsApp Business', 'Contabilidad Online'] },
    { name: 'Tecnología y Equipos', icon: 'monitor', color: '#06B6D4', subcategories: ['Equipos de Cómputo', 'Hosting y Servidores', 'Dominio Web', 'Desarrollo de Software', 'Licencias', 'Mantenimiento TI'] },
    { name: 'Eventos y Capacitación', icon: 'calendar', color: '#0EA5E9', subcategories: ['Conferencias', 'Seminarios', 'Ferias Comerciales', 'Capacitación de Personal', 'Networking', 'Material de Eventos', 'Viáticos de Eventos', 'Inscripciones y Membresías'] },
    { name: 'Aseo y Mantenimiento', icon: 'sparkles', color: '#14B8A6', subcategories: ['Aseo Oficina', 'Mantenimiento General', 'Fumigación', 'Insumos de Aseo'] },
    { name: 'Seguros', icon: 'shield', color: '#7C3AED', subcategories: ['Seguro de Local', 'Seguro de Vehículos', 'Póliza de Cumplimiento', 'Seguro Todo Riesgo'] },
    { name: 'Honorarios Profesionales', icon: 'graduation-cap', color: '#A855F7', subcategories: ['Contador', 'Abogado', 'Consultoría Externa', 'Revisor Fiscal', 'Coaching Empresarial'] },
    { name: 'Gastos Bancarios', icon: 'credit-card', color: '#64748B', subcategories: ['Comisiones Bancarias', '4x1000 (GMF)', 'Intereses Crédito', 'Cuota de Manejo', 'Pasarelas de Pago'] },
    { name: 'Otros Gastos', icon: 'more-horizontal', color: '#6B7280', subcategories: ['Papelería', 'Cafetería', 'Representación', 'Imprevistos'] },
  ],
};

// Función reutilizable para inicializar categorías y subcategorías de un usuario
// Agrega solo las categorías por defecto que el usuario aún no tiene (evita duplicados)
export async function initDefaultCategories(userId) {
  const { data: existingCats } = await supabaseAdmin
    .from('categories')
    .select('name, type')
    .eq('user_id', userId);

  const existingSet = new Set(
    (existingCats || []).map(c => `${c.type}::${c.name.toLowerCase()}`)
  );

  const allDefaults = [
    ...DEFAULT_CATEGORIES.income.map(c => ({ ...c, type: 'income' })),
    ...DEFAULT_CATEGORIES.expense.map(c => ({ ...c, type: 'expense' })),
  ];

  const categoriesToInsert = allDefaults
    .filter(c => !existingSet.has(`${c.type}::${c.name.toLowerCase()}`))
    .map(c => ({ name: c.name, icon: c.icon, color: c.color, type: c.type, user_id: userId }));

  if (categoriesToInsert.length === 0) return null;

  const { data: createdCats, error: catError } = await supabaseAdmin
    .from('categories')
    .insert(categoriesToInsert)
    .select();

  if (catError) throw catError;

  const subsToInsert = [];
  for (const cat of createdCats) {
    const defaultDef = allDefaults.find(d => d.name === cat.name && d.type === cat.type);
    if (defaultDef?.subcategories) {
      for (const subName of defaultDef.subcategories) {
        subsToInsert.push({ category_id: cat.id, user_id: userId, name: subName });
      }
    }
  }

  if (subsToInsert.length > 0) {
    const { error: subError } = await supabaseAdmin
      .from('subcategories')
      .insert(subsToInsert);
    if (subError) throw subError;
  }

  return createdCats;
}

// Proteger todas las rutas
router.use(authenticate);

// Obtener todas las categorías del usuario
router.get('/', async (req, res) => {
  try {
    let { data, error } = await supabaseAdmin
      .from('categories')
      .select('*')
      .eq('user_id', req.user.id)
      .order('type')
      .order('name');

    if (error) throw error;

    // Siempre verificar y agregar categorías por defecto faltantes
    try {
      const added = await initDefaultCategories(req.user.id);
      if (added) {
        const refetch = await supabaseAdmin
          .from('categories')
          .select('*')
          .eq('user_id', req.user.id)
          .order('type')
          .order('name');
        data = refetch.data || data;
      }
    } catch (initErr) {
      console.error('Error syncing default categories:', initErr);
    }

    // Obtener subcategorías del usuario
    const { data: subs } = await supabaseAdmin
      .from('subcategories')
      .select('*')
      .eq('user_id', req.user.id)
      .order('name');

    // Anidar subcategorías en cada categoría
    const categoriesWithSubs = data.map(cat => ({
      ...cat,
      subcategories: (subs || []).filter(s => s.category_id === cat.id)
    }));

    // Agrupar por tipo
    const grouped = {
      income: categoriesWithSubs.filter(c => c.type === 'income'),
      expense: categoriesWithSubs.filter(c => c.type === 'expense'),
    };

    success(res, { 
      categories: categoriesWithSubs, 
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
    const result = await initDefaultCategories(req.user.id);

    if (result === null) {
      return success(res, { 
        categories: [], 
        message: 'Ya tienes todas las categorías por defecto' 
      });
    }

    success(res, { 
      categories: result, 
      message: `Se agregaron ${result.length} categorías por defecto correctamente` 
    }, 201);
  } catch (error) {
    console.error('Error initializing categories:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al inicializar categorías');
  }
});

export default router;
