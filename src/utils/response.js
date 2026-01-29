/**
 * Respuesta exitosa estándar
 */
export function success(res, data, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    data,
  });
}

/**
 * Respuesta de error estándar
 */
export function error(res, message, code = 'ERROR', statusCode = 400) {
  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
    },
  });
}

/**
 * Códigos de error predefinidos
 */
export const ErrorCodes = {
  // Autenticación
  UNAUTHORIZED: { code: 'UNAUTHORIZED', status: 401 },
  INVALID_CREDENTIALS: { code: 'INVALID_CREDENTIALS', status: 401 },
  TOKEN_EXPIRED: { code: 'TOKEN_EXPIRED', status: 401 },
  EMAIL_NOT_CONFIRMED: { code: 'EMAIL_NOT_CONFIRMED', status: 401 },
  
  // Autorización
  FORBIDDEN: { code: 'FORBIDDEN', status: 403 },
  SUBSCRIPTION_REQUIRED: { code: 'SUBSCRIPTION_REQUIRED', status: 403 },
  SUBSCRIPTION_INACTIVE: { code: 'SUBSCRIPTION_INACTIVE', status: 403 },
  
  // Recursos
  NOT_FOUND: { code: 'NOT_FOUND', status: 404 },
  
  // Validación
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', status: 400 },
  INVALID_REQUEST: { code: 'INVALID_REQUEST', status: 400 },
  
  // Rate Limit
  RATE_LIMIT: { code: 'RATE_LIMIT', status: 429 },
  
  // Servidor
  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', status: 500 },
  SERVICE_UNAVAILABLE: { code: 'SERVICE_UNAVAILABLE', status: 503 },
};

/**
 * Helper para enviar errores predefinidos
 */
export function sendError(res, errorType, customMessage) {
  const { code, status } = ErrorCodes[errorType] || ErrorCodes.INTERNAL_ERROR;
  const message = customMessage || getDefaultMessage(errorType);
  return error(res, message, code, status);
}

function getDefaultMessage(errorType) {
  const messages = {
    UNAUTHORIZED: 'No autorizado. Token inválido o faltante.',
    INVALID_CREDENTIALS: 'Credenciales inválidas.',
    TOKEN_EXPIRED: 'Token expirado. Por favor inicia sesión nuevamente.',
    FORBIDDEN: 'No tienes permiso para realizar esta acción.',
    SUBSCRIPTION_REQUIRED: 'Se requiere una suscripción activa.',
    SUBSCRIPTION_INACTIVE: 'Tu suscripción no está activa.',
    NOT_FOUND: 'Recurso no encontrado.',
    VALIDATION_ERROR: 'Error de validación en los datos enviados.',
    INVALID_REQUEST: 'Solicitud inválida.',
    INTERNAL_ERROR: 'Error interno del servidor.',
    SERVICE_UNAVAILABLE: 'Servicio temporalmente no disponible.',
  };
  return messages[errorType] || 'Error desconocido.';
}
