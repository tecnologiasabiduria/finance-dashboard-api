import { sendError } from '../utils/response.js';

/**
 * Middleware para validar campos requeridos en el body
 */
export function validateBody(requiredFields) {
  return (req, res, next) => {
    const missing = [];
    const errors = {};

    for (const field of requiredFields) {
      if (typeof field === 'string') {
        // Campo simple requerido
        if (req.body[field] === undefined || req.body[field] === '') {
          missing.push(field);
        }
      } else if (typeof field === 'object') {
        // Campo con validación personalizada
        const { name, type, min, max, options, required = true } = field;
        const value = req.body[name];

        if (required && (value === undefined || value === '')) {
          missing.push(name);
          continue;
        }

        if (value !== undefined && value !== '') {
          // Validar tipo
          if (type === 'number' && typeof value !== 'number') {
            errors[name] = `${name} debe ser un número`;
          }

          if (type === 'email' && !/^\S+@\S+\.\S+$/.test(value)) {
            errors[name] = `${name} debe ser un email válido`;
          }

          // Validar min/max para números
          if (type === 'number' && min !== undefined && value < min) {
            errors[name] = `${name} debe ser al menos ${min}`;
          }

          if (type === 'number' && max !== undefined && value > max) {
            errors[name] = `${name} debe ser máximo ${max}`;
          }

          // Validar opciones permitidas
          if (options && !options.includes(value)) {
            errors[name] = `${name} debe ser uno de: ${options.join(', ')}`;
          }
        }
      }
    }

    if (missing.length > 0) {
      return sendError(
        res,
        'VALIDATION_ERROR',
        `Campos requeridos faltantes: ${missing.join(', ')}`
      );
    }

    if (Object.keys(errors).length > 0) {
      return sendError(res, 'VALIDATION_ERROR', Object.values(errors).join('. '));
    }

    next();
  };
}

/**
 * Middleware para validar UUID
 */
export function validateUUID(paramName = 'id') {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  return (req, res, next) => {
    const value = req.params[paramName];

    if (!value || !uuidRegex.test(value)) {
      return sendError(res, 'VALIDATION_ERROR', `${paramName} debe ser un UUID válido`);
    }

    next();
  };
}
