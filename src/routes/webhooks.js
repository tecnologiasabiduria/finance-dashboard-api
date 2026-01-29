import { Router } from 'express';
import { success, sendError } from '../utils/response.js';
import { stripeService } from '../services/stripe.js';
import { ghlService } from '../services/gohighlevel.js';
import { config } from '../config/env.js';

const router = Router();

/**
 * POST /webhooks/stripe
 * Recibir webhooks de Stripe
 * 
 * IMPORTANTE: Este endpoint necesita el raw body para verificar la firma
 * Debe configurarse ANTES del middleware json() en Express
 */
router.post('/stripe', async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'];
    const rawBody = req.rawBody; // Se configura en index.js

    if (!signature && !config.isDev) {
      return sendError(res, 'UNAUTHORIZED', 'Firma de webhook faltante');
    }

    let event;

    // Verificar firma en producción
    if (!config.isDev && config.stripe.webhookSecret) {
      try {
        event = stripeService.verifyWebhookSignature(rawBody, signature);
      } catch (err) {
        console.error('Stripe signature verification failed:', err.message);
        return sendError(res, 'UNAUTHORIZED', 'Firma de webhook inválida');
      }
    } else {
      // En desarrollo, parsear el body directamente
      event = req.body;
    }

    // Procesar evento
    const result = await stripeService.handleWebhookEvent(event);

    // Stripe espera 200 para confirmar recepción
    return success(res, { received: true, ...result });
  } catch (err) {
    console.error('Stripe webhook error:', err);
    // Aún así retornamos 200 para que Stripe no reintente
    return success(res, { received: true, error: err.message });
  }
});

/**
 * POST /webhooks/gohighlevel
 * Recibir webhooks de GoHighLevel
 */
router.post('/gohighlevel', async (req, res) => {
  try {
    const signature = req.headers['x-ghl-signature'] || req.headers['x-webhook-signature'];

    // Verificar firma en producción
    if (!config.isDev && config.ghl.webhookSecret) {
      if (!ghlService.verifyWebhookSignature(req.body, signature)) {
        console.error('GHL signature verification failed');
        return sendError(res, 'UNAUTHORIZED', 'Firma de webhook inválida');
      }
    }

    // Procesar evento
    const result = await ghlService.handleWebhookEvent(req.body);

    return success(res, { received: true, ...result });
  } catch (err) {
    console.error('GHL webhook error:', err);
    return success(res, { received: true, error: err.message });
  }
});

/**
 * POST /webhooks/test
 * Endpoint de prueba para simular webhooks (solo desarrollo)
 */
if (config.isDev) {
  router.post('/test', async (req, res) => {
    try {
      const { provider, event, data } = req.body;

      console.log(`🧪 Test webhook: ${provider} - ${event}`);

      let result;
      if (provider === 'stripe') {
        result = await stripeService.handleWebhookEvent({ type: event, data: { object: data } });
      } else if (provider === 'gohighlevel') {
        result = await ghlService.handleWebhookEvent({ type: event, data });
      } else {
        return sendError(res, 'VALIDATION_ERROR', 'Provider debe ser "stripe" o "gohighlevel"');
      }

      return success(res, { test: true, ...result });
    } catch (err) {
      console.error('Test webhook error:', err);
      return sendError(res, 'INTERNAL_ERROR', err.message);
    }
  });
}

export default router;
