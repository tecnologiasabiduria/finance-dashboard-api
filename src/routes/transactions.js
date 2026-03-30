import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { success, sendError } from '../utils/response.js';
import { authenticate } from '../middlewares/auth.js';
import { requireSubscriptionOrDev } from '../middlewares/subscription.js';
import { validateBody, validateUUID } from '../middlewares/validate.js';
import { getCarteraSaldoPendiente } from '../utils/carteraSaldo.js';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

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
    if (type && ['income', 'expense', 'transfer'].includes(type)) {
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
 * POST /transactions/import
 * Importar múltiples transacciones desde CSV
 */
router.post('/import', async (req, res) => {
  try {
    const userId = req.user.id;
    const { transactions } = req.body;

    if (!Array.isArray(transactions) || transactions.length === 0) {
      return sendError(res, 'VALIDATION_ERROR', 'Se requiere un array de transacciones');
    }

    // Límite de 500 transacciones por importación
    if (transactions.length > 500) {
      return sendError(res, 'VALIDATION_ERROR', 'Máximo 500 transacciones por importación');
    }

    const validTypes = ['income', 'expense', 'transfer'];
    const validInvoiceStatuses = ['FACTURADO', 'NO FACTURADO'];
    const errors = [];
    const rows = [];

    for (let i = 0; i < transactions.length; i++) {
      const t = transactions[i];

      // Validar campos obligatorios
      if (!t.date || !t.amount) {
        errors.push({ row: i + 1, message: 'Fecha y monto son obligatorios' });
        continue;
      }

      const amount = parseFloat(t.amount);
      if (isNaN(amount) || amount <= 0) {
        errors.push({ row: i + 1, message: `Monto inválido: ${t.amount}` });
        continue;
      }

      const type = validTypes.includes(t.type) ? t.type : 'expense';

      const row = {
        user_id: userId,
        type,
        amount,
        date: t.date,
        category: t.category || null,
        description: t.description || null,
      };

      // Campos de ingreso
      if (type === 'income') {
        if (t.invoice_number) row.invoice_number = t.invoice_number;
        if (t.client_document) row.client_document = t.client_document;
        if (t.client_name) row.client_name = t.client_name;
        if (t.client_address) row.client_address = t.client_address;
        if (t.client_email) row.client_email = t.client_email;
        if (t.client_phone) row.client_phone = t.client_phone;
        if (t.invoice_status && validInvoiceStatuses.includes(t.invoice_status)) {
          row.invoice_status = t.invoice_status;
        }
      }

      // Campos de gasto
      if (type === 'expense') {
        if (t.provider_document) row.provider_document = t.provider_document;
        if (t.provider_name) row.provider_name = t.provider_name;
        if (t.payment_method) row.payment_method = t.payment_method;
      }

      // Campos de transferencia
      if (type === 'transfer') {
        if (t.source_account) row.source_account = t.source_account;
        if (t.destination_account) row.destination_account = t.destination_account;
      }

      rows.push(row);
    }

    if (rows.length === 0) {
      return sendError(res, 'VALIDATION_ERROR', 'Ninguna transacción válida para importar');
    }

    // Insertar en lotes de 100
    let imported = 0;
    const batchSize = 100;
    const insertErrors = [];

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { data, error } = await supabaseAdmin
        .from('transactions')
        .insert(batch)
        .select('id');

      if (error) {
        console.error(`Import batch error (rows ${i}-${i + batch.length}):`, error);
        insertErrors.push(`Lote ${Math.floor(i / batchSize) + 1}: ${error.message}`);
      } else {
        imported += data.length;
      }
    }

    return success(res, {
      imported,
      failed: transactions.length - imported,
      errors: [...errors, ...insertErrors.map((e) => ({ message: e }))],
    }, 201);
  } catch (err) {
    console.error('Import transactions error:', err);
    return sendError(res, 'INTERNAL_ERROR', 'Error al importar transacciones');
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

    const { data: linkRow } = await supabaseAdmin
      .from('cartera_pagos')
      .select('id, cartera_id, monto, fecha')
      .eq('transaction_id', id)
      .eq('user_id', userId)
      .maybeSingle();

    let cartera_link = null;
    if (linkRow) {
      const { data: carRow } = await supabaseAdmin
        .from('cartera')
        .select('nombre')
        .eq('id', linkRow.cartera_id)
        .single();
      cartera_link = {
        pago_id: linkRow.id,
        cartera_id: linkRow.cartera_id,
        cartera_nombre: carRow?.nombre || null,
        monto: linkRow.monto,
        fecha: linkRow.fecha,
      };
    }

    return success(res, { transaction: data, cartera_link });
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
    { name: 'type', options: ['income', 'expense', 'transfer'] },
    { name: 'amount', type: 'number', min: 0.01 },
    'date',
    { name: 'category', required: false },
    { name: 'description', required: false },
  ]),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const {
        type, amount, category, description, date,
        // Campos de ingreso (datos del cliente)
        invoice_number, client_document, client_name,
        client_address, client_email, client_phone, invoice_status,
        // Campos de gasto (datos del proveedor)
        provider_document, provider_name, payment_method,
        // Campos de transferencia
        source_account, destination_account,
        cartera_id,
      } = req.body;

      const amountNum = parseFloat(amount);
      const carteraIdTrimmed = typeof cartera_id === 'string' ? cartera_id.trim() : '';
      if (carteraIdTrimmed) {
        if (type !== 'income') {
          return sendError(res, 'VALIDATION_ERROR', 'cartera_id solo aplica a ingresos');
        }
        if (!isUuid(carteraIdTrimmed)) {
          return sendError(res, 'VALIDATION_ERROR', 'cartera_id debe ser un UUID válido');
        }
        const { saldo, error: saldoErr } = await getCarteraSaldoPendiente(carteraIdTrimmed, userId);
        if (saldoErr === 'NOT_FOUND') {
          return sendError(res, 'NOT_FOUND', 'Registro de cartera no encontrado');
        }
        if (amountNum > saldo) {
          return sendError(
            res,
            'VALIDATION_ERROR',
            `El monto excede el saldo pendiente en cartera ($${saldo.toFixed(2)})`
          );
        }
      }

      const insertData = {
        user_id: userId,
        type,
        amount: amountNum,
        category: category || null,
        description: description || null,
        date,
      };

      // Campos de ingreso
      if (type === 'income') {
        if (invoice_number !== undefined) insertData.invoice_number = invoice_number || null;
        if (client_document !== undefined) insertData.client_document = client_document || null;
        if (client_name !== undefined) insertData.client_name = client_name || null;
        if (client_address !== undefined) insertData.client_address = client_address || null;
        if (client_email !== undefined) insertData.client_email = client_email || null;
        if (client_phone !== undefined) insertData.client_phone = client_phone || null;
        if (invoice_status !== undefined) insertData.invoice_status = invoice_status || null;
      }

      // Campos de gasto
      if (type === 'expense') {
        if (provider_document !== undefined) insertData.provider_document = provider_document || null;
        if (provider_name !== undefined) insertData.provider_name = provider_name || null;
        if (payment_method !== undefined) insertData.payment_method = payment_method || null;
      }

      // Campos de transferencia
      if (type === 'transfer') {
        if (source_account !== undefined) insertData.source_account = source_account || null;
        if (destination_account !== undefined) insertData.destination_account = destination_account || null;
      }

      const { data, error } = await supabaseAdmin
        .from('transactions')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        console.error('Create transaction error:', error);
        return sendError(res, 'INTERNAL_ERROR', 'Error al crear transacción');
      }

      let cartera_pago = null;
      if (carteraIdTrimmed) {
        const { data: pagoRow, error: pagoError } = await supabaseAdmin
          .from('cartera_pagos')
          .insert({
            cartera_id: carteraIdTrimmed,
            user_id: userId,
            fecha: date,
            monto: amountNum,
            transaction_id: data.id,
            notas: description || null,
          })
          .select()
          .single();

        if (pagoError) {
          console.error('Create cartera_pago after transaction:', pagoError);
          await supabaseAdmin.from('transactions').delete().eq('id', data.id).eq('user_id', userId);
          return sendError(res, 'INTERNAL_ERROR', 'Error al vincular el abono en cartera');
        }
        cartera_pago = pagoRow;
      }

      return success(res, { transaction: data, cartera_pago }, 201);
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
      const {
        type, amount, category, description, date,
        invoice_number, client_document, client_name,
        client_address, client_email, client_phone, invoice_status,
        provider_document, provider_name, payment_method,
        source_account, destination_account,
      } = req.body;

      const { data: existing, error: existingErr } = await supabaseAdmin
        .from('transactions')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (existingErr || !existing) {
        return sendError(res, 'NOT_FOUND', 'Transacción no encontrada');
      }

      const { data: linkedPago } = await supabaseAdmin
        .from('cartera_pagos')
        .select('id, cartera_id, monto, fecha')
        .eq('transaction_id', id)
        .eq('user_id', userId)
        .maybeSingle();

      // Preparar datos de actualización
      const updateData = {};
      if (type && ['income', 'expense', 'transfer'].includes(type)) updateData.type = type;
      if (amount !== undefined) updateData.amount = parseFloat(amount);
      if (category !== undefined) updateData.category = category;
      if (description !== undefined) updateData.description = description;
      if (date) updateData.date = date;

      // Campos de ingreso
      if (invoice_number !== undefined) updateData.invoice_number = invoice_number || null;
      if (client_document !== undefined) updateData.client_document = client_document || null;
      if (client_name !== undefined) updateData.client_name = client_name || null;
      if (client_address !== undefined) updateData.client_address = client_address || null;
      if (client_email !== undefined) updateData.client_email = client_email || null;
      if (client_phone !== undefined) updateData.client_phone = client_phone || null;
      if (invoice_status !== undefined) updateData.invoice_status = invoice_status || null;

      // Campos de gasto
      if (provider_document !== undefined) updateData.provider_document = provider_document || null;
      if (provider_name !== undefined) updateData.provider_name = provider_name || null;
      if (payment_method !== undefined) updateData.payment_method = payment_method || null;

      // Campos de transferencia
      if (source_account !== undefined) updateData.source_account = source_account || null;
      if (destination_account !== undefined) updateData.destination_account = destination_account || null;

      const nextType = updateData.type !== undefined ? updateData.type : existing.type;
      if (linkedPago && nextType !== 'income') {
        return sendError(
          res,
          'VALIDATION_ERROR',
          'No puedes cambiar el tipo de un ingreso vinculado a cartera.'
        );
      }

      if (linkedPago && (amount !== undefined || date !== undefined)) {
        const newAmount = amount !== undefined ? parseFloat(amount) : Number(existing.amount);
        const newDate = date !== undefined ? date : existing.date;
        if (Number.isNaN(newAmount) || newAmount <= 0) {
          return sendError(res, 'VALIDATION_ERROR', 'El monto debe ser mayor a 0');
        }
        const { saldo, error: saldoErr } = await getCarteraSaldoPendiente(
          linkedPago.cartera_id,
          userId,
          { excludePagoId: linkedPago.id }
        );
        if (saldoErr === 'NOT_FOUND') {
          return sendError(res, 'INTERNAL_ERROR', 'Error al validar saldo de cartera');
        }
        if (newAmount > saldo) {
          return sendError(
            res,
            'VALIDATION_ERROR',
            `El monto excede el saldo pendiente en cartera ($${saldo.toFixed(2)})`
          );
        }

        const prevMonto = Number(linkedPago.monto);
        const prevFecha = linkedPago.fecha;

        const { error: pagoUpdErr } = await supabaseAdmin
          .from('cartera_pagos')
          .update({ monto: newAmount, fecha: newDate })
          .eq('id', linkedPago.id)
          .eq('user_id', userId);

        if (pagoUpdErr) {
          console.error('Sync cartera_pago on transaction update:', pagoUpdErr);
          return sendError(res, 'INTERNAL_ERROR', 'Error al sincronizar abono de cartera');
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
          await supabaseAdmin
            .from('cartera_pagos')
            .update({ monto: prevMonto, fecha: prevFecha })
            .eq('id', linkedPago.id)
            .eq('user_id', userId);
          return sendError(res, 'INTERNAL_ERROR', 'Error al actualizar transacción');
        }

        return success(res, { transaction: data });
      }

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
