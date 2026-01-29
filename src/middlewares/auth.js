import { supabase, supabaseAdmin } from '../config/supabase.js';
import { sendError } from '../utils/response.js';

/**
 * Middleware de autenticación
 * Verifica el JWT de Supabase y añade el usuario a req.user
 */
export async function authenticate(req, res, next) {
  try {
    // Obtener token del header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(res, 'UNAUTHORIZED', 'Token de autenticación requerido');
    }

    const token = authHeader.split(' ')[1];

    // Verificar token con Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      console.error('Auth error:', error?.message);
      return sendError(res, 'UNAUTHORIZED', 'Token inválido o expirado');
    }

    // Añadir usuario y token a la request
    req.user = user;
    req.token = token;
    
    next();
  } catch (err) {
    console.error('Authenticate middleware error:', err);
    return sendError(res, 'INTERNAL_ERROR');
  }
}

/**
 * Middleware opcional de autenticación
 * No bloquea si no hay token, pero añade usuario si existe
 */
export async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const { data: { user } } = await supabase.auth.getUser(token);
      
      if (user) {
        req.user = user;
        req.token = token;
      }
    }
    
    next();
  } catch (err) {
    // En caso de error, simplemente continuamos sin usuario
    next();
  }
}
