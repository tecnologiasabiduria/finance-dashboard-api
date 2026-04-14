import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticate } from '../middlewares/auth.js';
import { success, sendError } from '../utils/response.js';
import { config } from '../config/env.js';

const router = Router();

const DEFAULT_SHARED_DATA = {
  transactions: true,
  goals: true,
  budget: true,
  cartera: false,
};

// =====================================================
// Helper: verify n8n webhook secret
// =====================================================
function verifyAgentSecret(req, res) {
  if (config.isDev) return true;

  const secret = req.headers['x-agent-secret'];
  if (!secret || secret !== config.ghl.webhookSecret) {
    sendError(res, 'UNAUTHORIZED', 'Secret inválido');
    return false;
  }
  return true;
}

// =====================================================
// PROTECTED ROUTES (user authenticated)
// =====================================================

/**
 * GET /agent
 * Get the current user's agent config
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('agent_config')
      .select('*')
      .eq('user_id', req.user.id)
      .single();

    if (error && error.code === 'PGRST116') {
      // No row found — return defaults
      return success(res, {
        enabled: false,
        shared_data: DEFAULT_SHARED_DATA,
      });
    }

    if (error) throw error;

    return success(res, data);
  } catch (err) {
    console.error('Error fetching agent config:', err);
    return sendError(res, 'INTERNAL_ERROR', 'Error al obtener configuración del agente');
  }
});

/**
 * PUT /agent
 * Update agent config (upsert)
 */
router.put('/', authenticate, async (req, res) => {
  try {
    const { enabled, shared_data } = req.body;

    const upsertData = {
      user_id: req.user.id,
      enabled: enabled ?? false,
      shared_data: shared_data ?? DEFAULT_SHARED_DATA,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from('agent_config')
      .upsert(upsertData, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) throw error;

    return success(res, data);
  } catch (err) {
    console.error('Error updating agent config:', err);
    return sendError(res, 'INTERNAL_ERROR', 'Error al actualizar configuración del agente');
  }
});

/**
 * GET /agent/insights
 * Get insights for the chat panel
 */
router.get('/insights', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    const { data, error } = await supabaseAdmin
      .from('agent_insights')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return success(res, data || []);
  } catch (err) {
    console.error('Error fetching agent insights:', err);
    return sendError(res, 'INTERNAL_ERROR', 'Error al obtener insights del agente');
  }
});

/**
 * PUT /agent/insights/:id/read
 * Mark an insight as read
 */
router.put('/insights/:id/read', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('agent_insights')
      .update({ read: true })
      .eq('id', id)
      .eq('user_id', req.user.id);

    if (error) throw error;

    return success(res, { read: true });
  } catch (err) {
    console.error('Error marking insight as read:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
});

// =====================================================
// N8N WEBHOOK ROUTES (secret-protected, no user auth)
// =====================================================

/**
 * GET /agent/n8n/users-due
 * Returns users with agent enabled (for n8n cron to iterate)
 */
router.get('/n8n/users-due', async (req, res) => {
  if (!verifyAgentSecret(req, res)) return;

  try {
    const { data: configs, error } = await supabaseAdmin
      .from('agent_config')
      .select('user_id, shared_data')
      .eq('enabled', true);

    if (error) throw error;

    if (!configs || configs.length === 0) {
      return success(res, []);
    }

    // Get profiles for these users
    const userIds = configs.map((c) => c.user_id);
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name')
      .in('id', userIds);

    if (profilesError) throw profilesError;

    const profileMap = {};
    (profiles || []).forEach((p) => {
      profileMap[p.id] = p;
    });

    const result = configs.map((c) => ({
      user_id: c.user_id,
      email: profileMap[c.user_id]?.email || '',
      name: profileMap[c.user_id]?.full_name || '',
      shared_data: c.shared_data,
    }));

    return success(res, result);
  } catch (err) {
    console.error('Error fetching users due:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
});

/**
 * GET /agent/n8n/data/:userId
 * Returns financial data for a user based on their shared_data preferences
 */
router.get('/n8n/data/:userId', async (req, res) => {
  if (!verifyAgentSecret(req, res)) return;

  try {
    const { userId } = req.params;

    // Get agent config to know what data to include
    const { data: agentConfig, error: configError } = await supabaseAdmin
      .from('agent_config')
      .select('shared_data')
      .eq('user_id', userId)
      .single();

    if (configError) throw configError;

    const sharedData = agentConfig.shared_data || DEFAULT_SHARED_DATA;
    const result = { user_id: userId };

    // Get current month boundaries
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

    // Transactions summary
    if (sharedData.transactions) {
      const { data: transactions } = await supabaseAdmin
        .from('transactions')
        .select('type, amount, category_name')
        .eq('user_id', userId)
        .gte('date', startOfMonth)
        .lte('date', endOfMonth);

      const txns = transactions || [];
      const income = txns.filter((t) => t.type === 'income');
      const expenses = txns.filter((t) => t.type === 'expense');

      // Top expense categories
      const categoryTotals = {};
      expenses.forEach((t) => {
        const cat = t.category_name || 'Sin categoría';
        categoryTotals[cat] = (categoryTotals[cat] || 0) + Number(t.amount);
      });

      const topCategories = Object.entries(categoryTotals)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([name, total]) => ({ name, total }));

      result.transactions = {
        total_income: income.reduce((sum, t) => sum + Number(t.amount), 0),
        total_expenses: expenses.reduce((sum, t) => sum + Number(t.amount), 0),
        transaction_count: txns.length,
        top_expense_categories: topCategories,
      };
    }

    // Goals
    if (sharedData.goals) {
      const { data: goals } = await supabaseAdmin
        .from('goals')
        .select('*')
        .eq('user_id', userId);

      result.goals = goals || [];
    }

    // Budget
    if (sharedData.budget) {
      const { data: budgetConfig } = await supabaseAdmin
        .from('budget_config')
        .select('*')
        .eq('user_id', userId);

      result.budget = budgetConfig || [];
    }

    // Cartera
    if (sharedData.cartera) {
      const { data: cartera } = await supabaseAdmin
        .from('cartera')
        .select('amount, paid_amount, status')
        .eq('user_id', userId);

      const items = cartera || [];
      const totalCartera = items.reduce((sum, c) => sum + Number(c.amount || 0), 0);
      const totalPaid = items.reduce((sum, c) => sum + Number(c.paid_amount || 0), 0);

      result.cartera = {
        total: totalCartera,
        paid: totalPaid,
        pending: totalCartera - totalPaid,
        items_count: items.length,
        overdue: items.filter((c) => c.status === 'overdue').length,
      };
    }

    return success(res, result);
  } catch (err) {
    console.error('Error fetching agent data:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
});

/**
 * POST /agent/n8n/insights
 * Save AI-generated insight and create notification
 */
router.post('/n8n/insights', async (req, res) => {
  if (!verifyAgentSecret(req, res)) return;

  try {
    const { user_id, messages, data_snapshot } = req.body;

    if (!user_id || !messages) {
      return sendError(res, 'VALIDATION_ERROR', 'user_id y messages son requeridos');
    }

    // Insert insight
    const { data: insight, error: insightError } = await supabaseAdmin
      .from('agent_insights')
      .insert({
        user_id,
        messages,
        data_snapshot: data_snapshot || null,
        read: false,
      })
      .select()
      .single();

    if (insightError) throw insightError;

    // Create notification
    await supabaseAdmin
      .from('notifications')
      .insert({
        user_id,
        title: '🧠 Tu asesor financiero tiene nuevos consejos',
        message: 'Revisa los últimos consejos personalizados de tu asesor de IA.',
        type: 'info',
        read: false,
      });

    return success(res, insight);
  } catch (err) {
    console.error('Error saving agent insight:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
});

export default router;
