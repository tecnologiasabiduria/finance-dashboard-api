import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config/env.js';

// Importar rutas
import authRoutes from './routes/auth.js';
import transactionsRoutes from './routes/transactions.js';
import dashboardRoutes from './routes/dashboard.js';
import webhooksRoutes from './routes/webhooks.js';

const app = express();

// =============================================================================
// MIDDLEWARE DE SEGURIDAD Y LOGGING
// =============================================================================

// Helmet para headers de seguridad
app.use(helmet());

// Morgan para logging (solo en desarrollo)
if (config.isDev) {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// CORS configuración
const corsOptions = {
  origin: config.isDev 
    ? ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173']
    : config.frontendUrl,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};
app.use(cors(corsOptions));

// =============================================================================
// PARSER MIDDLEWARE
// =============================================================================

// Raw body para webhooks de Stripe (debe ir ANTES del json parser para esta ruta)
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));

// JSON parser para el resto
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// =============================================================================
// HEALTH CHECK
// =============================================================================

app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'API Sabiduría Empresarial - Finanzas Sabias',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

// =============================================================================
// RUTAS DE LA API
// =============================================================================

app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/webhooks', webhooksRoutes);

// =============================================================================
// MANEJO DE ERRORES
// =============================================================================

// Ruta no encontrada
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `La ruta ${req.originalUrl} no existe`,
    },
  });
});

// Error handler global
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);

  // Error de Stripe webhook
  if (err.type === 'StripeSignatureVerificationError') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'WEBHOOK_SIGNATURE_ERROR',
        message: 'Firma de webhook inválida',
      },
    });
  }

  // Error de JSON inválido
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: 'El cuerpo de la solicitud no es JSON válido',
      },
    });
  }

  // Error genérico
  res.status(err.status || 500).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: config.isDev ? err.message : 'Error interno del servidor',
      ...(config.isDev && { stack: err.stack }),
    },
  });
});

// =============================================================================
// INICIAR SERVIDOR
// =============================================================================

const PORT = config.port || 3001;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                                                            ║');
  console.log('║   🌟 SABIDURÍA EMPRESARIAL - FINANZAS SABIAS API 🌟       ║');
  console.log('║                                                            ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║   🚀 Servidor corriendo en puerto: ${PORT}                    ║`);
  console.log(`║   🌍 Entorno: ${config.nodeEnv.padEnd(38)}   ║`);
  console.log(`║   📅 ${new Date().toISOString().padEnd(42)}  ║`);
  console.log('║                                                            ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log('║   Endpoints disponibles:                                   ║');
  console.log('║   • GET  /health            - Health check                 ║');
  console.log('║   • POST /api/auth/register - Registro de usuarios         ║');
  console.log('║   • POST /api/auth/login    - Inicio de sesión             ║');
  console.log('║   • GET  /api/auth/me       - Perfil del usuario           ║');
  console.log('║   • GET  /api/transactions  - Listar transacciones         ║');
  console.log('║   • POST /api/transactions  - Crear transacción            ║');
  console.log('║   • GET  /api/dashboard/*   - Datos del dashboard          ║');
  console.log('║   • POST /api/webhooks/*    - Webhooks Stripe/GHL          ║');
  console.log('║                                                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
});

// Manejar errores del servidor
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Error: El puerto ${PORT} ya está en uso`);
    console.error('   Intenta cerrar la aplicación que usa ese puerto o usa otro puerto');
  } else {
    console.error('❌ Error del servidor:', err);
  }
  process.exit(1);
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  console.log(`\n⚠️  Recibida señal ${signal}. Cerrando servidor...`);
  server.close(() => {
    console.log('✅ Servidor cerrado correctamente');
    process.exit(0);
  });
  
  // Forzar cierre después de 10 segundos
  setTimeout(() => {
    console.error('⚠️  Forzando cierre del servidor');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Manejar errores no capturados
process.on('uncaughtException', (err) => {
  console.error('❌ Error no capturado:', err);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promesa rechazada no manejada:', reason);
});

export default app;
