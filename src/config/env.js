import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // Server
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',

  // Supabase
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },

  // JWT
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',

  // Stripe
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  },

  // GoHighLevel
  ghl: {
    webhookSecret: process.env.GHL_WEBHOOK_SECRET,
  },

  // CORS
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
};

// Validar variables críticas en producción
export function validateEnv() {
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  
  if (config.nodeEnv === 'production') {
    required.push('SUPABASE_SERVICE_ROLE_KEY', 'JWT_SECRET');
  }

  const missing = required.filter((key) => !process.env[key]);
  
  if (missing.length > 0) {
    console.warn(`⚠️  Variables de entorno faltantes: ${missing.join(', ')}`);
    if (config.nodeEnv === 'production') {
      throw new Error('Variables de entorno críticas no configuradas');
    }
  }
}
