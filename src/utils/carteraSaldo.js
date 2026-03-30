import { supabaseAdmin } from '../config/supabase.js';

/**
 * Saldo pendiente de un registro de cartera (valor_venta - cash - sum(pagos)).
 * @param {string} excludePagoId - excluir este pago al recalcular (p. ej. edición del abono vinculado)
 */
export async function getCarteraSaldoPendiente(carteraId, userId, { excludePagoId = null } = {}) {
  const { data: cartera, error: cErr } = await supabaseAdmin
    .from('cartera')
    .select('id, valor_venta, cash')
    .eq('id', carteraId)
    .eq('user_id', userId)
    .single();

  if (cErr || !cartera) {
    return { error: 'NOT_FOUND' };
  }

  const { data: pagos } = await supabaseAdmin
    .from('cartera_pagos')
    .select('id, monto')
    .eq('cartera_id', carteraId)
    .eq('user_id', userId);

  const totalAbonos = (pagos || [])
    .filter((p) => !excludePagoId || p.id !== excludePagoId)
    .reduce((s, p) => s + Number(p.monto), 0);

  const saldo = Math.max(0, Number(cartera.valor_venta) - Number(cartera.cash) - totalAbonos);

  return { saldo, cartera };
}
