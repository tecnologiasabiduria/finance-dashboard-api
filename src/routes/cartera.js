import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticate } from '../middlewares/auth.js';
import { requireSubscriptionOrDev } from '../middlewares/subscription.js';
import { success, sendError } from '../utils/response.js';
import { getCarteraSaldoPendiente } from '../utils/carteraSaldo.js';

const router = Router();

router.use(authenticate);
router.use(requireSubscriptionOrDev);

// ─── GET /cartera ─ Listar todas las cuentas de cartera del usuario ──────────
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const { data, error } = await supabaseAdmin
      .from('cartera')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    // For each record, calculate total_abonos and saldo from pagos
    const ids = data.map((r) => r.id);
    let pagosData = [];
    if (ids.length > 0) {
      const { data: pagos, error: pagosError } = await supabaseAdmin
        .from('cartera_pagos')
        .select('cartera_id, monto')
        .eq('user_id', userId)
        .in('cartera_id', ids);
      if (!pagosError) pagosData = pagos;
    }

    // Sum pagos per cartera record
    const pagosSum = {};
    for (const p of pagosData) {
      pagosSum[p.cartera_id] = (pagosSum[p.cartera_id] || 0) + Number(p.monto);
    }

    const records = data.map((r) => {
      const totalAbonos = pagosSum[r.id] || 0;
      const saldo = Number(r.valor_venta) - Number(r.cash) - totalAbonos;
      return {
        ...r,
        total_abonos: totalAbonos,
        saldo: Math.max(0, saldo),
      };
    });

    success(res, { records });
  } catch (error) {
    console.error('Error fetching cartera:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al obtener cartera');
  }
});

// ─── GET /cartera/:id ─ Detalle de una cuenta ───────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('cartera')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return sendError(res, 'NOT_FOUND', 'Registro de cartera no encontrado');
      throw error;
    }

    // Get pagos for this record
    const { data: pagos, error: pagosError } = await supabaseAdmin
      .from('cartera_pagos')
      .select('*')
      .eq('cartera_id', data.id)
      .eq('user_id', req.user.id)
      .order('fecha', { ascending: false });
    if (pagosError) throw pagosError;

    const totalAbonos = pagos.reduce((sum, p) => sum + Number(p.monto), 0);
    const saldo = Math.max(0, Number(data.valor_venta) - Number(data.cash) - totalAbonos);

    success(res, { record: { ...data, total_abonos: totalAbonos, saldo }, pagos });
  } catch (error) {
    console.error('Error fetching cartera record:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al obtener registro de cartera');
  }
});

// ─── POST /cartera ─ Crear nueva cuenta de cartera ──────────────────────────
router.post('/', async (req, res) => {
  try {
    const { nombre, fecha_venta, valor_venta, cash = 0, plataforma, fuente, producto, notas } = req.body;

    if (!nombre || !fecha_venta || valor_venta === undefined || valor_venta === '') {
      return sendError(res, 'VALIDATION_ERROR', 'Nombre, fecha de venta y valor de la venta son requeridos');
    }

    const valorNum = Number(valor_venta);
    const cashNum = Number(cash);
    if (isNaN(valorNum) || valorNum <= 0) {
      return sendError(res, 'VALIDATION_ERROR', 'El valor de la venta debe ser un número mayor a 0');
    }
    if (isNaN(cashNum) || cashNum < 0) {
      return sendError(res, 'VALIDATION_ERROR', 'El cash debe ser un número mayor o igual a 0');
    }
    if (cashNum > valorNum) {
      return sendError(res, 'VALIDATION_ERROR', 'El cash no puede ser mayor al valor de la venta');
    }

    const { data, error } = await supabaseAdmin
      .from('cartera')
      .insert({
        user_id: req.user.id,
        nombre,
        fecha_venta,
        valor_venta: valorNum,
        cash: cashNum,
        plataforma: plataforma || null,
        fuente: fuente || null,
        producto: producto || null,
        notas: notas || null,
      })
      .select()
      .single();
    if (error) throw error;

    success(res, { record: { ...data, total_abonos: 0, saldo: valorNum - cashNum } }, 201);
  } catch (error) {
    console.error('Error creating cartera record:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al crear registro de cartera');
  }
});

// ─── PUT /cartera/:id ─ Actualizar cuenta de cartera ────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { data: existing } = await supabaseAdmin
      .from('cartera')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (!existing) return sendError(res, 'NOT_FOUND', 'Registro de cartera no encontrado');

    const { nombre, fecha_venta, valor_venta, cash, plataforma, fuente, producto, notas } = req.body;
    const updateData = { updated_at: new Date().toISOString() };

    if (nombre !== undefined) updateData.nombre = nombre;
    if (fecha_venta !== undefined) updateData.fecha_venta = fecha_venta;
    if (valor_venta !== undefined) updateData.valor_venta = Number(valor_venta);
    if (cash !== undefined) updateData.cash = Number(cash);
    if (plataforma !== undefined) updateData.plataforma = plataforma || null;
    if (fuente !== undefined) updateData.fuente = fuente || null;
    if (producto !== undefined) updateData.producto = producto || null;
    if (notas !== undefined) updateData.notas = notas || null;

    // Validate cash <= valor_venta
    const finalValor = updateData.valor_venta !== undefined ? updateData.valor_venta : Number(existing.valor_venta);
    const finalCash = updateData.cash !== undefined ? updateData.cash : Number(existing.cash);
    if (finalCash > finalValor) {
      return sendError(res, 'VALIDATION_ERROR', 'El cash no puede ser mayor al valor de la venta');
    }

    const { data, error } = await supabaseAdmin
      .from('cartera')
      .update(updateData)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();
    if (error) throw error;

    // Compute total_abonos and saldo for response
    const { data: pagos } = await supabaseAdmin
      .from('cartera_pagos')
      .select('monto')
      .eq('cartera_id', data.id)
      .eq('user_id', req.user.id);
    const totalAbonos = (pagos || []).reduce((s, p) => s + Number(p.monto), 0);
    const saldo = Math.max(0, Number(data.valor_venta) - Number(data.cash) - totalAbonos);

    success(res, { record: { ...data, total_abonos: totalAbonos, saldo } });
  } catch (error) {
    console.error('Error updating cartera record:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al actualizar registro de cartera');
  }
});

// ─── DELETE /cartera/:id ─ Eliminar cuenta (CASCADE borra pagos) ────────────
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('cartera')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    if (error) throw error;
    success(res, { message: 'Registro de cartera eliminado correctamente' });
  } catch (error) {
    console.error('Error deleting cartera record:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al eliminar registro de cartera');
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CARTERA PAGOS (abonos / installments)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /cartera/:id/pagos ─ Listar pagos de una cuenta ────────────────────
router.get('/:id/pagos', async (req, res) => {
  try {
    // Verify ownership of the parent cartera record
    const { data: cartera } = await supabaseAdmin
      .from('cartera')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (!cartera) return sendError(res, 'NOT_FOUND', 'Registro de cartera no encontrado');

    const { data, error } = await supabaseAdmin
      .from('cartera_pagos')
      .select('*')
      .eq('cartera_id', req.params.id)
      .eq('user_id', req.user.id)
      .order('fecha', { ascending: false });
    if (error) throw error;

    success(res, { pagos: data });
  } catch (error) {
    console.error('Error fetching cartera pagos:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al obtener pagos de cartera');
  }
});

// ─── POST /cartera/:id/pagos ─ Agregar un pago/abono ───────────────────────
router.post('/:id/pagos', async (req, res) => {
  try {
    const { fecha, monto, notas } = req.body;
    if (!fecha || monto === undefined || monto === '') {
      return sendError(res, 'VALIDATION_ERROR', 'Fecha y monto son requeridos');
    }

    const montoNum = Number(monto);
    if (isNaN(montoNum) || montoNum <= 0) {
      return sendError(res, 'VALIDATION_ERROR', 'El monto debe ser un número mayor a 0');
    }

    const { saldo: saldoActual, error: saldoErr } = await getCarteraSaldoPendiente(
      req.params.id,
      req.user.id
    );
    if (saldoErr === 'NOT_FOUND') {
      return sendError(res, 'NOT_FOUND', 'Registro de cartera no encontrado');
    }

    if (montoNum > saldoActual) {
      return sendError(res, 'VALIDATION_ERROR', `El monto del abono excede el saldo pendiente ($${saldoActual.toFixed(2)})`);
    }

    const { data, error } = await supabaseAdmin
      .from('cartera_pagos')
      .insert({
        cartera_id: req.params.id,
        user_id: req.user.id,
        fecha,
        monto: montoNum,
        notas: notas || null,
      })
      .select()
      .single();
    if (error) throw error;

    success(res, { pago: data }, 201);
  } catch (error) {
    console.error('Error creating cartera pago:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al crear pago de cartera');
  }
});

// ─── PUT /cartera/:id/pagos/:pagoId ─ Editar un pago/abono ─────────────────
router.put('/:id/pagos/:pagoId', async (req, res) => {
  try {
    const { data: existingPago } = await supabaseAdmin
      .from('cartera_pagos')
      .select('*')
      .eq('id', req.params.pagoId)
      .eq('cartera_id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (!existingPago) return sendError(res, 'NOT_FOUND', 'Pago no encontrado');

    const linkedTransactionId = existingPago.transaction_id || null;

    const { fecha, monto, notas } = req.body;
    const updateData = {};

    if (fecha !== undefined) updateData.fecha = fecha;
    if (notas !== undefined) updateData.notas = notas || null;
    if (monto !== undefined) {
      const montoNum = Number(monto);
      if (isNaN(montoNum) || montoNum <= 0) {
        return sendError(res, 'VALIDATION_ERROR', 'El monto debe ser un número mayor a 0');
      }

      const { saldo: saldoDisponible, error: saldoErr } = await getCarteraSaldoPendiente(
        req.params.id,
        req.user.id,
        { excludePagoId: req.params.pagoId }
      );
      if (saldoErr === 'NOT_FOUND') {
        return sendError(res, 'NOT_FOUND', 'Registro de cartera no encontrado');
      }

      if (montoNum > saldoDisponible) {
        return sendError(res, 'VALIDATION_ERROR', `El monto excede el saldo disponible ($${saldoDisponible.toFixed(2)})`);
      }
      updateData.monto = montoNum;
    }

    if (Object.keys(updateData).length === 0) {
      return sendError(res, 'VALIDATION_ERROR', 'No se proporcionaron campos para actualizar');
    }

    const { data, error } = await supabaseAdmin
      .from('cartera_pagos')
      .update(updateData)
      .eq('id', req.params.pagoId)
      .eq('cartera_id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();
    if (error) throw error;

    if (linkedTransactionId && (updateData.monto !== undefined || updateData.fecha !== undefined)) {
      const txUpdate = {};
      if (updateData.monto !== undefined) txUpdate.amount = updateData.monto;
      if (updateData.fecha !== undefined) txUpdate.date = updateData.fecha;
      const { error: txErr } = await supabaseAdmin
        .from('transactions')
        .update(txUpdate)
        .eq('id', linkedTransactionId)
        .eq('user_id', req.user.id);
      if (txErr) {
        console.error('Sync transaction from cartera pago:', txErr);
        await supabaseAdmin
          .from('cartera_pagos')
          .update({
            monto: existingPago.monto,
            fecha: existingPago.fecha,
            notas: existingPago.notas,
          })
          .eq('id', req.params.pagoId)
          .eq('user_id', req.user.id);
        return sendError(res, 'INTERNAL_ERROR', 'Error al sincronizar la transacción vinculada');
      }
    }

    success(res, { pago: data });
  } catch (error) {
    console.error('Error updating cartera pago:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al actualizar pago de cartera');
  }
});

// ─── DELETE /cartera/:id/pagos/:pagoId ─ Eliminar un pago ──────────────────
router.delete('/:id/pagos/:pagoId', async (req, res) => {
  try {
    const { data: pagoRow } = await supabaseAdmin
      .from('cartera_pagos')
      .select('id, transaction_id')
      .eq('id', req.params.pagoId)
      .eq('cartera_id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (!pagoRow) {
      return sendError(res, 'NOT_FOUND', 'Pago no encontrado');
    }

    if (pagoRow.transaction_id) {
      const { error: txDelErr } = await supabaseAdmin
        .from('transactions')
        .delete()
        .eq('id', pagoRow.transaction_id)
        .eq('user_id', req.user.id);
      if (txDelErr) throw txDelErr;
    } else {
      const { error } = await supabaseAdmin
        .from('cartera_pagos')
        .delete()
        .eq('id', req.params.pagoId)
        .eq('cartera_id', req.params.id)
        .eq('user_id', req.user.id);
      if (error) throw error;
    }

    success(res, { message: 'Pago eliminado correctamente' });
  } catch (error) {
    console.error('Error deleting cartera pago:', error);
    sendError(res, 'INTERNAL_ERROR', 'Error al eliminar pago de cartera');
  }
});

export default router;
