import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { success, sendError } from '../utils/response.js';
import { authenticate } from '../middlewares/auth.js';
import { requireSubscriptionOrDev } from '../middlewares/subscription.js';
import { validateBody, validateUUID } from '../middlewares/validate.js';

const router = Router();

// Todas las rutas requieren autenticación y suscripción
router.use(authenticate);
router.use(requireSubscriptionOrDev);

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Calcula la próxima fecha a partir de un día del mes.
 * Si el día ya pasó este mes, devuelve el mes siguiente.
 */
function getNextDate(day, referenceDate = new Date()) {
  const now = referenceDate;
  let month = now.getMonth();
  let year = now.getFullYear();

  if (now.getDate() > day) {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const actualDay = Math.min(day, daysInMonth);

  return new Date(year, month, actualDay).toISOString().split('T')[0];
}

/**
 * Actualiza el balance de una cuenta sumando o restando un monto.
 * @param {object} supabase - cliente Supabase
 * @param {string} accountId - UUID de la cuenta
 * @param {number} amount - monto (siempre positivo)
 * @param {'add'|'subtract'} operation
 */
export async function updateAccountBalance(supabase, accountId, amount, operation) {
  const { data: account, error: fetchErr } = await supabase
    .from('accounts')
    .select('balance')
    .eq('id', accountId)
    .single();

  if (fetchErr || !account) {
    return { error: fetchErr || new Error('Account not found') };
  }

  const currentBalance = parseFloat(account.balance) || 0;
  const delta = operation === 'add' ? amount : -amount;
  const newBalance = parseFloat((currentBalance + delta).toFixed(2));

  const { error: updateErr } = await supabase
    .from('accounts')
    .update({ balance: newBalance, updated_at: new Date().toISOString() })
    .eq('id', accountId);

  if (updateErr) return { error: updateErr };

  return { balance: newBalance };
}

/**
 * Enriquece una cuenta de tipo credit_card con campos derivados.
 */
function enrichCreditCard(account, creditDetails) {
  if (!creditDetails) return account;

  const creditLimit = parseFloat(creditDetails.credit_limit) || 0;
  const used = Math.abs(parseFloat(account.balance) || 0);
  const available = creditLimit - used;
  const utilization = creditLimit > 0 ? parseFloat(((used / creditLimit) * 100).toFixed(1)) : 0;

  return {
    ...account,
    credit_card: {
      credit_limit: creditLimit,
      available,
      utilization_percent: utilization,
      cut_off_day: creditDetails.cut_off_day,
      payment_due_day: creditDetails.payment_due_day,
      interest_rate: creditDetails.interest_rate ? parseFloat(creditDetails.interest_rate) : null,
      next_cut_off: getNextDate(creditDetails.cut_off_day),
      next_payment_due: getNextDate(creditDetails.payment_due_day),
      minimum_payment: creditDetails.minimum_payment ? parseFloat(creditDetails.minimum_payment) : null,
      last_statement_balance: creditDetails.last_statement_balance ? parseFloat(creditDetails.last_statement_balance) : null,
      last_statement_date: creditDetails.last_statement_date,
    },
  };
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /accounts
 * Listar cuentas activas del usuario con summary
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: accounts, error } = await supabaseAdmin
      .from('accounts')
      .select('*')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) {
      console.error('List accounts error:', error);
      return sendError(res, 'INTERNAL_ERROR', 'Error al obtener cuentas');
    }

    // Obtener credit_card_details para cuentas de tipo credit_card
    const creditAccountIds = accounts.filter(a => a.type === 'credit_card').map(a => a.id);
    let creditDetailsMap = {};

    if (creditAccountIds.length > 0) {
      const { data: creditDetails } = await supabaseAdmin
        .from('credit_card_details')
        .select('*')
        .in('account_id', creditAccountIds);

      if (creditDetails) {
        creditDetailsMap = Object.fromEntries(creditDetails.map(d => [d.account_id, d]));
      }
    }

    // Enriquecer cuentas
    const enriched = accounts.map(a => {
      if (a.type === 'credit_card') {
        return enrichCreditCard(a, creditDetailsMap[a.id]);
      }
      return a;
    });

    // Calcular summary
    let totalAssets = 0;
    let totalDebts = 0;
    let totalCreditLimit = 0;
    let totalCreditUsed = 0;

    for (const a of enriched) {
      const bal = parseFloat(a.balance) || 0;
      if (a.type === 'credit_card') {
        totalDebts += Math.abs(bal);
        totalCreditUsed += Math.abs(bal);
        if (a.credit_card) {
          totalCreditLimit += a.credit_card.credit_limit;
        }
      } else {
        if (bal >= 0) totalAssets += bal;
        else totalDebts += Math.abs(bal);
      }
    }

    return success(res, {
      accounts: enriched,
      summary: {
        total_assets: parseFloat(totalAssets.toFixed(2)),
        total_debts: parseFloat(totalDebts.toFixed(2)),
        net_worth: parseFloat((totalAssets - totalDebts).toFixed(2)),
        total_credit_limit: parseFloat(totalCreditLimit.toFixed(2)),
        total_credit_used: parseFloat(totalCreditUsed.toFixed(2)),
      },
    });
  } catch (err) {
    console.error('List accounts error:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
});

/**
 * GET /accounts/summary
 * Resumen financiero rápido (definido ANTES de /:id)
 */
router.get('/summary', async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: accounts, error } = await supabaseAdmin
      .from('accounts')
      .select('id, type, balance')
      .eq('user_id', userId)
      .is('deleted_at', null);

    if (error) {
      console.error('Account summary error:', error);
      return sendError(res, 'INTERNAL_ERROR', 'Error al obtener resumen');
    }

    const creditAccountIds = accounts.filter(a => a.type === 'credit_card').map(a => a.id);
    let totalCreditLimit = 0;

    if (creditAccountIds.length > 0) {
      const { data: creditDetails } = await supabaseAdmin
        .from('credit_card_details')
        .select('credit_limit')
        .in('account_id', creditAccountIds);

      if (creditDetails) {
        totalCreditLimit = creditDetails.reduce((sum, d) => sum + (parseFloat(d.credit_limit) || 0), 0);
      }
    }

    let totalAssets = 0;
    let totalDebts = 0;
    let totalCreditUsed = 0;

    for (const a of accounts) {
      const bal = parseFloat(a.balance) || 0;
      if (a.type === 'credit_card') {
        totalDebts += Math.abs(bal);
        totalCreditUsed += Math.abs(bal);
      } else {
        if (bal >= 0) totalAssets += bal;
        else totalDebts += Math.abs(bal);
      }
    }

    return success(res, {
      total_assets: parseFloat(totalAssets.toFixed(2)),
      total_debts: parseFloat(totalDebts.toFixed(2)),
      net_worth: parseFloat((totalAssets - totalDebts).toFixed(2)),
      total_credit_limit: parseFloat(totalCreditLimit.toFixed(2)),
      total_credit_used: parseFloat(totalCreditUsed.toFixed(2)),
    });
  } catch (err) {
    console.error('Account summary error:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
});

/**
 * POST /accounts/init
 * Crear cuentas por defecto (Efectivo + Banco) si el usuario no tiene ninguna
 */
router.post('/init', async (req, res) => {
  try {
    const userId = req.user.id;

    // Verificar si ya tiene cuentas
    const { data: existing, error: checkErr } = await supabaseAdmin
      .from('accounts')
      .select('id')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .limit(1);

    if (checkErr) {
      console.error('Init accounts check error:', checkErr);
      return sendError(res, 'INTERNAL_ERROR', 'Error al verificar cuentas');
    }

    if (existing && existing.length > 0) {
      return success(res, { accounts: [], message: 'Ya tienes cuentas creadas' });
    }

    const defaultAccounts = [
      {
        user_id: userId,
        name: 'Efectivo',
        type: 'cash',
        balance: 0,
        currency: 'COP',
        color: '#22C55E',
        icon: 'wallet',
        is_default: true,
      },
      {
        user_id: userId,
        name: 'Banco',
        type: 'bank',
        balance: 0,
        currency: 'COP',
        color: '#3B82F6',
        icon: 'building-2',
        is_default: false,
      },
    ];

    const { data: created, error: insertErr } = await supabaseAdmin
      .from('accounts')
      .insert(defaultAccounts)
      .select();

    if (insertErr) {
      console.error('Init accounts insert error:', insertErr);
      return sendError(res, 'INTERNAL_ERROR', 'Error al crear cuentas por defecto');
    }

    return success(res, {
      accounts: created,
      message: 'Cuentas por defecto creadas correctamente',
    }, 201);
  } catch (err) {
    console.error('Init accounts error:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
});

/**
 * POST /accounts
 * Crear nueva cuenta
 */
router.post(
  '/',
  validateBody([
    'name',
    { name: 'type', options: ['cash', 'bank', 'credit_card'] },
    { name: 'balance', type: 'number', required: false },
    { name: 'currency', required: false },
    { name: 'color', required: false },
    { name: 'icon', required: false },
    // credit_card fields
    { name: 'credit_limit', type: 'number', required: false },
    { name: 'cut_off_day', type: 'number', required: false, min: 1, max: 31 },
    { name: 'payment_due_day', type: 'number', required: false, min: 1, max: 31 },
    { name: 'interest_rate', type: 'number', required: false },
  ]),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const {
        name, type, balance, currency, color, icon,
        credit_limit, cut_off_day, payment_due_day, interest_rate,
      } = req.body;

      // Validar campos requeridos para tarjeta de crédito
      if (type === 'credit_card') {
        if (!credit_limit || credit_limit <= 0) {
          return sendError(res, 'VALIDATION_ERROR', 'Límite de crédito es requerido para tarjetas');
        }
        if (!cut_off_day) {
          return sendError(res, 'VALIDATION_ERROR', 'Día de corte es requerido para tarjetas');
        }
        if (!payment_due_day) {
          return sendError(res, 'VALIDATION_ERROR', 'Día de pago es requerido para tarjetas');
        }
      }

      // Verificar nombre duplicado para este usuario
      const { data: dup } = await supabaseAdmin
        .from('accounts')
        .select('id')
        .eq('user_id', userId)
        .ilike('name', name.trim())
        .is('deleted_at', null)
        .maybeSingle();

      if (dup) {
        return sendError(res, 'VALIDATION_ERROR', 'Ya existe una cuenta con ese nombre');
      }

      // Verificar si es la primera cuenta (hacerla default)
      const { data: existingAccounts } = await supabaseAdmin
        .from('accounts')
        .select('id')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .limit(1);

      const isFirst = !existingAccounts || existingAccounts.length === 0;

      const accountData = {
        user_id: userId,
        name: name.trim(),
        type,
        balance: type === 'credit_card' ? 0 : (balance || 0),
        currency: currency || 'COP',
        color: color || null,
        icon: icon || null,
        is_default: isFirst,
      };

      const { data: account, error: insertErr } = await supabaseAdmin
        .from('accounts')
        .insert(accountData)
        .select()
        .single();

      if (insertErr) {
        console.error('Create account error:', insertErr);
        return sendError(res, 'INTERNAL_ERROR', 'Error al crear cuenta');
      }

      // Si es tarjeta de crédito, insertar detalles
      if (type === 'credit_card') {
        const { error: ccErr } = await supabaseAdmin
          .from('credit_card_details')
          .insert({
            account_id: account.id,
            credit_limit,
            cut_off_day,
            payment_due_day,
            interest_rate: interest_rate || null,
          });

        if (ccErr) {
          console.error('Create credit card details error:', ccErr);
          // Rollback: eliminar la cuenta creada
          await supabaseAdmin.from('accounts').delete().eq('id', account.id);
          return sendError(res, 'INTERNAL_ERROR', 'Error al crear detalles de tarjeta de crédito');
        }

        // Devolver cuenta enriquecida
        const enriched = enrichCreditCard(account, {
          credit_limit,
          cut_off_day,
          payment_due_day,
          interest_rate,
          minimum_payment: null,
          last_statement_balance: null,
          last_statement_date: null,
        });
        return success(res, { account: enriched }, 201);
      }

      return success(res, { account }, 201);
    } catch (err) {
      console.error('Create account error:', err);
      return sendError(res, 'INTERNAL_ERROR');
    }
  }
);

/**
 * GET /accounts/:id
 * Obtener cuenta específica con detalles
 */
router.get('/:id', validateUUID('id'), async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { data: account, error } = await supabaseAdmin
      .from('accounts')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .single();

    if (error || !account) {
      return sendError(res, 'NOT_FOUND', 'Cuenta no encontrada');
    }

    if (account.type === 'credit_card') {
      const { data: creditDetails } = await supabaseAdmin
        .from('credit_card_details')
        .select('*')
        .eq('account_id', id)
        .single();

      return success(res, { account: enrichCreditCard(account, creditDetails) });
    }

    return success(res, { account });
  } catch (err) {
    console.error('Get account error:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
});

/**
 * PUT /accounts/:id
 * Actualizar cuenta
 */
router.put('/:id', validateUUID('id'), async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const {
      name, color, icon, currency, is_active, is_default,
      credit_limit, cut_off_day, payment_due_day, interest_rate, minimum_payment,
    } = req.body;

    // Verificar que existe y pertenece al usuario
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('accounts')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .single();

    if (fetchErr || !existing) {
      return sendError(res, 'NOT_FOUND', 'Cuenta no encontrada');
    }

    // Verificar nombre duplicado si se cambia
    if (name && name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      const { data: dup } = await supabaseAdmin
        .from('accounts')
        .select('id')
        .eq('user_id', userId)
        .ilike('name', name.trim())
        .is('deleted_at', null)
        .neq('id', id)
        .maybeSingle();

      if (dup) {
        return sendError(res, 'VALIDATION_ERROR', 'Ya existe una cuenta con ese nombre');
      }
    }

    const updateData = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name.trim();
    if (color !== undefined) updateData.color = color;
    if (icon !== undefined) updateData.icon = icon;
    if (currency !== undefined) updateData.currency = currency;
    if (is_active !== undefined) updateData.is_active = is_active;
    if (is_default !== undefined) updateData.is_default = !!is_default;

    // Si se marca como default, desmarcar las demás cuentas del usuario
    if (is_default === true) {
      const { error: unsetErr } = await supabaseAdmin
        .from('accounts')
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .neq('id', id)
        .is('deleted_at', null);

      if (unsetErr) {
        console.error('Unset other defaults error:', unsetErr);
        return sendError(res, 'INTERNAL_ERROR', 'Error al actualizar cuenta por defecto');
      }
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('accounts')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateErr) {
      console.error('Update account error:', updateErr);
      return sendError(res, 'INTERNAL_ERROR', 'Error al actualizar cuenta');
    }

    // Actualizar detalles de tarjeta si aplica
    if (existing.type === 'credit_card') {
      const ccUpdate = {};
      if (credit_limit !== undefined) ccUpdate.credit_limit = credit_limit;
      if (cut_off_day !== undefined) ccUpdate.cut_off_day = cut_off_day;
      if (payment_due_day !== undefined) ccUpdate.payment_due_day = payment_due_day;
      if (interest_rate !== undefined) ccUpdate.interest_rate = interest_rate;
      if (minimum_payment !== undefined) ccUpdate.minimum_payment = minimum_payment;

      if (Object.keys(ccUpdate).length > 0) {
        const { error: ccErr } = await supabaseAdmin
          .from('credit_card_details')
          .update(ccUpdate)
          .eq('account_id', id);

        if (ccErr) {
          console.error('Update credit card details error:', ccErr);
        }
      }

      // Devolver enriquecida
      const { data: creditDetails } = await supabaseAdmin
        .from('credit_card_details')
        .select('*')
        .eq('account_id', id)
        .single();

      return success(res, { account: enrichCreditCard(updated, creditDetails) });
    }

    return success(res, { account: updated });
  } catch (err) {
    console.error('Update account error:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
});

/**
 * DELETE /accounts/:id
 * Soft delete (o hard delete si no tiene transacciones)
 */
router.delete('/:id', validateUUID('id'), async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { data: account, error: fetchErr } = await supabaseAdmin
      .from('accounts')
      .select('id, is_default, name')
      .eq('id', id)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .single();

    if (fetchErr || !account) {
      return sendError(res, 'NOT_FOUND', 'Cuenta no encontrada');
    }

    if (account.is_default) {
      return sendError(res, 'VALIDATION_ERROR', 'No puedes eliminar la cuenta por defecto');
    }

    // Verificar si tiene transacciones
    const { count } = await supabaseAdmin
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', id);

    if (count > 0) {
      // Soft delete
      const { error: delErr } = await supabaseAdmin
        .from('accounts')
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq('id', id)
        .eq('user_id', userId);

      if (delErr) {
        console.error('Soft delete account error:', delErr);
        return sendError(res, 'INTERNAL_ERROR', 'Error al eliminar cuenta');
      }

      return success(res, {
        message: 'Cuenta desactivada (tiene transacciones asociadas)',
        soft_deleted: true,
      });
    }

    // Hard delete (sin transacciones)
    const { error: delErr } = await supabaseAdmin
      .from('accounts')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (delErr) {
      console.error('Delete account error:', delErr);
      return sendError(res, 'INTERNAL_ERROR', 'Error al eliminar cuenta');
    }

    return success(res, { message: 'Cuenta eliminada', soft_deleted: false });
  } catch (err) {
    console.error('Delete account error:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
});

/**
 * GET /accounts/:id/movements
 * Transacciones de una cuenta específica
 */
router.get('/:id/movements', validateUUID('id'), async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { page = 1, limit = 20, from, to } = req.query;

    // Verificar que la cuenta existe y pertenece al usuario
    const { data: account, error: accErr } = await supabaseAdmin
      .from('accounts')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (accErr || !account) {
      return sendError(res, 'NOT_FOUND', 'Cuenta no encontrada');
    }

    // Buscar transacciones donde account_id = id OR to_account_id = id
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    // Transacciones desde esta cuenta
    let queryFrom = supabaseAdmin
      .from('transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .or(`account_id.eq.${id},to_account_id.eq.${id}`);

    if (from) queryFrom = queryFrom.gte('date', from);
    if (to) queryFrom = queryFrom.lte('date', to);

    queryFrom = queryFrom
      .order('date', { ascending: false })
      .range(offset, offset + limitNum - 1);

    const { data, error, count } = await queryFrom;

    if (error) {
      console.error('Get account movements error:', error);
      return sendError(res, 'INTERNAL_ERROR', 'Error al obtener movimientos');
    }

    return success(res, {
      movements: data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count,
        totalPages: Math.ceil(count / limitNum),
      },
    });
  } catch (err) {
    console.error('Get account movements error:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
});

export default router;
