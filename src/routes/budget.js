import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { success, sendError } from '../utils/response.js';
import { authenticate } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

/**
 * Helper: ensure an expense category exists for a pocket name.
 * If one doesn't exist, create it automatically.
 */
async function ensureExpenseCategory(userId, pocketName) {
  const { data: existing } = await supabaseAdmin
    .from('categories')
    .select('id')
    .eq('user_id', userId)
    .eq('name', pocketName)
    .eq('type', 'expense')
    .maybeSingle();

  if (!existing) {
    await supabaseAdmin
      .from('categories')
      .insert({ user_id: userId, name: pocketName, type: 'expense', icon: 'tag', color: '#D4AF37' });
  }
}

// ============================================================
// BUDGET CONFIG — Meta de facturación anual
// ============================================================

/**
 * GET /budget/config?year=2026
 * Obtener configuración de presupuesto para un año
 */
router.get('/config', async (req, res) => {
  try {
    const userId = req.user.id;
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const { data, error } = await supabaseAdmin
      .from('budget_config')
      .select('*')
      .eq('user_id', userId)
      .eq('year', year)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    success(res, { config: data || null });
  } catch (err) {
    console.error('Error fetching budget config:', err);
    sendError(res, 'INTERNAL_ERROR', 'Error al obtener configuración de presupuesto');
  }
});

/**
 * PUT /budget/config
 * Crear o actualizar configuración de presupuesto
 */
router.put('/config', async (req, res) => {
  try {
    const userId = req.user.id;
    const { year, annual_revenue_target } = req.body;

    if (!year || !annual_revenue_target) {
      return sendError(res, 'VALIDATION_ERROR', 'Año y meta de facturación son requeridos');
    }
    if (annual_revenue_target <= 0) {
      return sendError(res, 'VALIDATION_ERROR', 'La meta debe ser mayor a 0');
    }

    // Upsert — crear o actualizar
    const { data: existing } = await supabaseAdmin
      .from('budget_config')
      .select('id')
      .eq('user_id', userId)
      .eq('year', year)
      .single();

    let data;
    if (existing) {
      const { data: updated, error } = await supabaseAdmin
        .from('budget_config')
        .update({ annual_revenue_target, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      data = updated;
    } else {
      const { data: created, error } = await supabaseAdmin
        .from('budget_config')
        .insert({ user_id: userId, year, annual_revenue_target })
        .select()
        .single();
      if (error) throw error;
      data = created;
    }

    success(res, { config: data });
  } catch (err) {
    console.error('Error saving budget config:', err);
    sendError(res, 'INTERNAL_ERROR', 'Error al guardar configuración');
  }
});

// ============================================================
// BUDGET POCKETS — Bolsillos de presupuesto
// ============================================================

/**
 * GET /budget/pockets
 * Listar todos los bolsillos del usuario
 */
router.get('/pockets', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('budget_pockets')
      .select('*')
      .eq('user_id', req.user.id)
      .order('sort_order', { ascending: true });

    if (error) throw error;
    success(res, { pockets: data || [] });
  } catch (err) {
    console.error('Error fetching pockets:', err);
    sendError(res, 'INTERNAL_ERROR', 'Error al obtener bolsillos');
  }
});

/**
 * PUT /budget/pockets/bulk
 * Actualizar todos los bolsillos de una vez (para reordenar o ajustar %)
 * NOTE: Must be defined BEFORE /pockets/:id to avoid Express matching "bulk" as :id
 */
router.put('/pockets/bulk', async (req, res) => {
  try {
    const { pockets } = req.body;
    if (!Array.isArray(pockets)) {
      return sendError(res, 'VALIDATION_ERROR', 'Se requiere un array de bolsillos');
    }

    const results = [];
    for (const pocket of pockets) {
      if (pocket.id) {
        // Update existing
        const { data, error } = await supabaseAdmin
          .from('budget_pockets')
          .update({
            name: pocket.name,
            percentage: pocket.percentage,
            sort_order: pocket.sort_order,
            updated_at: new Date().toISOString(),
          })
          .eq('id', pocket.id)
          .eq('user_id', req.user.id)
          .select()
          .single();
        if (!error && data) results.push(data);
      } else {
        // Create new
        const { data, error } = await supabaseAdmin
          .from('budget_pockets')
          .insert({
            user_id: req.user.id,
            name: pocket.name,
            percentage: pocket.percentage,
            sort_order: pocket.sort_order || 0,
          })
          .select()
          .single();
        if (!error && data) results.push(data);
      }
    }

    // Auto-create matching expense categories for each pocket
    for (const pocket of results) {
      await ensureExpenseCategory(req.user.id, pocket.name);
    }

    success(res, { pockets: results });
  } catch (err) {
    console.error('Error bulk updating pockets:', err);
    sendError(res, 'INTERNAL_ERROR', 'Error al actualizar bolsillos');
  }
});

/**
 * POST /budget/pockets
 * Crear un bolsillo
 */
router.post('/pockets', async (req, res) => {
  try {
    const { name, percentage, sort_order = 0 } = req.body;
    if (!name || percentage === undefined) {
      return sendError(res, 'VALIDATION_ERROR', 'Nombre y porcentaje son requeridos');
    }

    const { data, error } = await supabaseAdmin
      .from('budget_pockets')
      .insert({ user_id: req.user.id, name, percentage, sort_order })
      .select()
      .single();

    if (error) throw error;

    // Auto-create matching expense category
    await ensureExpenseCategory(req.user.id, name);

    success(res, { pocket: data }, 201);
  } catch (err) {
    console.error('Error creating pocket:', err);
    sendError(res, 'INTERNAL_ERROR', 'Error al crear bolsillo');
  }
});

/**
 * PUT /budget/pockets/:id
 * Actualizar un bolsillo
 */
router.put('/pockets/:id', async (req, res) => {
  try {
    const { name, percentage, sort_order } = req.body;
    const updateData = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (percentage !== undefined) updateData.percentage = percentage;
    if (sort_order !== undefined) updateData.sort_order = sort_order;

    const { data, error } = await supabaseAdmin
      .from('budget_pockets')
      .update(updateData)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return sendError(res, 'NOT_FOUND', 'Bolsillo no encontrado');
    success(res, { pocket: data });
  } catch (err) {
    console.error('Error updating pocket:', err);
    sendError(res, 'INTERNAL_ERROR', 'Error al actualizar bolsillo');
  }
});

/**
 * DELETE /budget/pockets/:id
 */
router.delete('/pockets/:id', async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('budget_pockets')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    success(res, { message: 'Bolsillo eliminado' });
  } catch (err) {
    console.error('Error deleting pocket:', err);
    sendError(res, 'INTERNAL_ERROR', 'Error al eliminar bolsillo');
  }
});

// ============================================================
// BUDGET OVERVIEW — Vista calculada con cruce de transacciones
// ============================================================

/**
 * GET /budget/overview?year=2026&month=2
 * Vista completa del presupuesto con datos reales de transacciones
 */
router.get('/overview', async (req, res) => {
  try {
    const userId = req.user.id;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;

    // 1. Get budget config
    const { data: config } = await supabaseAdmin
      .from('budget_config')
      .select('*')
      .eq('user_id', userId)
      .eq('year', year)
      .single();

    const annualTarget = config?.annual_revenue_target || 0;
    const monthlyEstimate = annualTarget / 12;

    // 2. Get pockets
    const { data: pockets } = await supabaseAdmin
      .from('budget_pockets')
      .select('*')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true });

    // 3. Get transactions for the month
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0).toISOString().split('T')[0];

    const { data: transactions } = await supabaseAdmin
      .from('transactions')
      .select('type, amount, category, date')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate);

    // 4. Calculate actual sales (income)
    const actualSales = (transactions || [])
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + parseFloat(t.amount), 0);

    // 5. Calculate actual expenses by category (mapped to pocket names)
    const expensesByCategory = {};
    (transactions || [])
      .filter((t) => t.type === 'expense')
      .forEach((t) => {
        const cat = t.category || 'Sin categoría';
        expensesByCategory[cat] = (expensesByCategory[cat] || 0) + parseFloat(t.amount);
      });

    // 6. Build pocket overview with calculations
    const pocketOverview = (pockets || []).map((pocket) => {
      const budgetValue = Math.round((monthlyEstimate * pocket.percentage) / 100 * 100) / 100;
      const actualValue = expensesByCategory[pocket.name] || 0;
      const percentageReal = budgetValue > 0 ? Math.round((actualValue / budgetValue) * 100 * 100) / 100 : 0;
      const deviationAmount = Math.round((actualValue - budgetValue) * 100) / 100;
      const deviationPercent = budgetValue > 0
        ? Math.round(((actualValue - budgetValue) / budgetValue) * 100 * 100) / 100
        : 0;

      return {
        id: pocket.id,
        name: pocket.name,
        percentage: pocket.percentage,
        budget_value: budgetValue,
        actual_value: Math.round(actualValue * 100) / 100,
        percentage_real: percentageReal,
        deviation_amount: deviationAmount,
        deviation_percent: deviationPercent,
        // Alert status
        status: deviationAmount > 0 ? 'over' : deviationAmount < 0 ? 'under' : 'on_track',
      };
    });

    // 7. Get ALL months data for annual view
    const annualData = [];
    for (let m = 1; m <= 12; m++) {
      const mStart = `${year}-${String(m).padStart(2, '0')}-01`;
      const mEnd = new Date(year, m, 0).toISOString().split('T')[0];

      const { data: mTx } = await supabaseAdmin
        .from('transactions')
        .select('type, amount')
        .eq('user_id', userId)
        .gte('date', mStart)
        .lte('date', mEnd);

      const mIncome = (mTx || [])
        .filter((t) => t.type === 'income')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);

      const mExpense = (mTx || [])
        .filter((t) => t.type === 'expense')
        .reduce((sum, t) => sum + parseFloat(t.amount), 0);

      annualData.push({
        month: m,
        estimated_sales: Math.round(monthlyEstimate * 100) / 100,
        actual_sales: Math.round(mIncome * 100) / 100,
        actual_expenses: Math.round(mExpense * 100) / 100,
      });
    }

    // Sales alert
    const salesDeviation = actualSales - monthlyEstimate;
    const salesAlert = salesDeviation < 0 ? {
      type: 'warning',
      message: `Ventas por debajo del estimado: ${Math.abs(Math.round(salesDeviation)).toLocaleString('es-CO')} COP menos`,
    } : null;

    // Pocket alerts
    const pocketAlerts = pocketOverview
      .filter((p) => p.status === 'over')
      .map((p) => ({
        type: 'danger',
        pocket: p.name,
        message: `${p.name} se pasó del presupuesto: +${Math.round(p.deviation_amount).toLocaleString('es-CO')} COP (${p.deviation_percent}%)`,
      }));

    success(res, {
      year,
      month,
      annual_revenue_target: annualTarget,
      monthly_estimate: Math.round(monthlyEstimate * 100) / 100,
      actual_sales: Math.round(actualSales * 100) / 100,
      sales_deviation: Math.round(salesDeviation * 100) / 100,
      total_budget: Math.round((pockets || []).reduce((s, p) => s + (monthlyEstimate * p.percentage / 100), 0) * 100) / 100,
      total_actual_expenses: Math.round(Object.values(expensesByCategory).reduce((s, v) => s + v, 0) * 100) / 100,
      pockets: pocketOverview,
      annual_data: annualData,
      alerts: [salesAlert, ...pocketAlerts].filter(Boolean),
    });
  } catch (err) {
    console.error('Error fetching budget overview:', err);
    sendError(res, 'INTERNAL_ERROR', 'Error al obtener resumen de presupuesto');
  }
});

export default router;
