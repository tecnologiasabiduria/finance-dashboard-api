# Contexto del Proyecto: Finance Dashboard API

## 1. Visión General

**Producto:** API REST para plataforma SaaS de control de gastos e ingresos.

**Este Repositorio:** Solo el backend (API). El frontend está en un repositorio separado.

**Modelo de Negocio:** 
- Usuario paga suscripción → Accede al dashboard.
- Sin suscripción activa → Acceso bloqueado.

**Integraciones:**
- **GoHighLevel / Stripe** → Procesamiento de pagos
- **Supabase** → Base de datos + Autenticación
- **VPS (Ubuntu)** → Hosting del backend y frontend

---

## 2. Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────────────┐
│                    FLUJO DE LA PLATAFORMA                   │
└─────────────────────────────────────────────────────────────┘

   GoHighLevel / Stripe
          │
          │ Webhook (POST)
          ▼
   ┌──────────────────┐
   │  Backend Node.js │  ◄── ESTE REPOSITORIO
   │  (Express API)   │
   └────────┬─────────┘
            │
            │ Valida, decide, escribe
            ▼
   ┌──────────────────┐
   │    Supabase      │  ◄── INFRAESTRUCTURA (externo)
   │  (DB + Auth)     │
   └────────┬─────────┘
            │
            │ JWT + Datos
            ▼
   ┌──────────────────┐
   │  React Frontend  │  ◄── REPOSITORIO SEPARADO
   │  (Dashboard)     │
   └──────────────────┘
```

**Alcance de este repo:** Desde el webhook hasta exponer la API REST.

---

## 3. Roles y Responsabilidades (Sin Ambigüedad)

### A. Backend Node.js (Este Repositorio) — EL CEREBRO

**Función:** Controla toda la lógica de negocio y acceso.

| Responsabilidad | Descripción |
|-----------------|-------------|
| Recibir webhooks | Endpoint para GoHighLevel/Stripe |
| Validar firmas | Verificar que el webhook es legítimo |
| Gestionar suscripciones | Activar/desactivar acceso según pago |
| Escribir en Supabase | CRUD de usuarios y estados |
| Proteger endpoints | Middleware de autorización |
| Exponer API REST | Endpoints para el frontend |

**Regla:** Todo lo que habilita o bloquea dinero pasa por aquí.

---

### B. Supabase — INFRAESTRUCTURA

**Función:** Almacena datos y emite tokens. NO decide.

| Componente | Uso |
|------------|-----|
| PostgreSQL | Tablas: usuarios, suscripciones, ingresos, gastos |
| Auth | Login/registro, emisión de JWT |
| RLS (Row Level Security) | Seguridad a nivel de fila |

**Regla:** Supabase obedece, no orquesta.

---

### C. React Frontend — LA PANTALLA

**Función:** Interfaz de usuario. NO valida acceso.

| Responsabilidad | Descripción |
|-----------------|-------------|
| Consumir API | Llamadas al backend Node.js |
| Renderizar dashboard | Gráficos, tablas, formularios |
| Manejar sesión | Guardar JWT en memoria/localStorage |
| UX/UI | Experiencia del usuario |

**Regla:** El frontend muestra, no decide.

---

## 4. Modelo de Datos (Supabase)

### Tablas Principales

```sql
-- Usuarios (extendiendo auth.users de Supabase)
CREATE TABLE public.profiles (
    id UUID REFERENCES auth.users(id) PRIMARY KEY,
    email TEXT NOT NULL,
    full_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Suscripciones
CREATE TABLE public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'cancelled', 'past_due')),
    provider TEXT NOT NULL, -- 'stripe' o 'gohighlevel'
    external_id TEXT, -- ID en el proveedor de pagos
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transacciones (ingresos y gastos)
CREATE TABLE public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    amount DECIMAL(12,2) NOT NULL,
    category TEXT,
    description TEXT,
    date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 5. Endpoints del Backend

### Webhooks (Entrada de pagos)
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/webhooks/stripe` | Recibe eventos de Stripe |
| POST | `/webhooks/gohighlevel` | Recibe eventos de GoHighLevel |

### Autenticación
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/auth/login` | Login (delega a Supabase, valida suscripción) |
| POST | `/auth/register` | Registro inicial |
| GET | `/auth/me` | Datos del usuario autenticado |

### Dashboard (Protegidos)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/dashboard/summary` | Resumen financiero |
| GET | `/transactions` | Listar transacciones |
| POST | `/transactions` | Crear transacción |
| PUT | `/transactions/:id` | Editar transacción |
| DELETE | `/transactions/:id` | Eliminar transacción |

### Sistema
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Estado del servidor |

---

## 6. Flujo de Suscripción (Detallado)

```
1. Usuario paga en GoHighLevel/Stripe
              │
              ▼
2. Webhook llega a Backend Node.js
              │
              ▼
3. Backend valida firma del webhook
              │
              ├── Inválido → Rechaza (401)
              │
              ▼
4. Backend extrae datos (user_email, status, plan)
              │
              ▼
5. Backend busca/crea usuario en Supabase
              │
              ▼
6. Backend actualiza tabla `subscriptions`
              │
              ▼
7. Usuario intenta login
              │
              ▼
8. Backend verifica subscription.status === 'active'
              │
              ├── Inactivo → Bloquea acceso (403)
              │
              ▼
9. Usuario accede al Dashboard
```

---

## 7. Hoja de Ruta

### Fase 1: Fundación (Actual)
- [x] Definir arquitectura
- [ ] Inicializar proyecto Node.js
- [ ] Configurar estructura de carpetas
- [ ] Endpoint `GET /health`
- [ ] Configurar variables de entorno

### Fase 2: Integración Supabase
- [ ] Conectar cliente Supabase
- [ ] Crear tablas en Supabase
- [ ] Configurar RLS básico

### Fase 3: Autenticación
- [ ] Endpoint `POST /auth/login`
- [ ] Endpoint `GET /auth/me`
- [ ] Middleware de autenticación (JWT)
- [ ] Middleware de verificación de suscripción

### Fase 4: Webhooks de Pago
- [ ] Endpoint `POST /webhooks/stripe`
- [ ] Endpoint `POST /webhooks/gohighlevel`
- [ ] Validación de firmas
- [ ] Lógica de activación/desactivación

### Fase 5: Dashboard API
- [ ] CRUD de transacciones
- [ ] Endpoint de resumen financiero
- [ ] Filtros por fecha/categoría

### Fase 6: Despliegue
- [ ] Configurar Nginx en VPS
- [ ] Configurar PM2 para Node.js
- [ ] SSL con Let's Encrypt
- [ ] CI/CD básico (GitHub → VPS)

---

## 8. Estructura de Carpetas

```
finance-dashboard-api/
├── src/
│   ├── config/
│   │   ├── supabase.js      # Cliente Supabase
│   │   └── env.js           # Variables de entorno
│   ├── middlewares/
│   │   ├── auth.js          # Verificar JWT
│   │   └── subscription.js  # Verificar suscripción activa
│   ├── routes/
│   │   ├── auth.js
│   │   ├── webhooks.js
│   │   ├── transactions.js
│   │   └── dashboard.js
│   ├── services/
│   │   ├── stripe.js
│   │   ├── gohighlevel.js
│   │   └── subscription.js
│   ├── utils/
│   │   └── response.js      # Helpers de respuesta
│   └── index.js             # Entry point
├── .env.example
├── .gitignore
├── package.json
└── PROJECT_CONTEXT.md
```

---

## 9. Variables de Entorno

```env
# Server
PORT=3000
NODE_ENV=development

# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=xxxx
SUPABASE_SERVICE_ROLE_KEY=xxxx

# Stripe
STRIPE_SECRET_KEY=sk_xxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxx

# GoHighLevel
GHL_WEBHOOK_SECRET=xxxx
```

---

## 10. Decisiones Técnicas

| Decisión | Justificación |
|----------|---------------|
| Backend propio | Control total de lógica de pagos y acceso |
| Supabase para DB/Auth | Reduce código de auth, PostgreSQL robusto |
| Express.js | Simplicidad, madurez, documentación |
| Middlewares separados | Auth y suscripción son concerns distintos |
| Webhooks validados | Seguridad: nunca confiar en entrada externa |

---

## 11. Cómo Probar la API

### A. Sin Frontend (Desarrollo)

#### Opción 1: cURL (Terminal)
```bash
# Health check
curl http://localhost:3000/health

# Login (cuando esté implementado)
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "123456"}'

# Endpoint protegido (con token)
curl http://localhost:3000/dashboard/summary \
  -H "Authorization: Bearer <tu_jwt_token>"

# Crear transacción
curl -X POST http://localhost:3000/transactions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <tu_jwt_token>" \
  -d '{"type": "expense", "amount": 50.00, "category": "food", "date": "2025-01-15"}'
```

#### Opción 2: Postman / Insomnia
1. Importar colección o crear requests manualmente
2. Configurar variable de entorno `base_url = http://localhost:3000`
3. Guardar token en variable después del login
4. Usar `{{token}}` en headers de requests protegidos

#### Opción 3: Extensión VS Code
- **Thunder Client** - Cliente REST integrado en VS Code
- **REST Client** - Archivos `.http` con requests

Ejemplo de archivo `requests.http`:
```http
### Health Check
GET http://localhost:3000/health

### Login
POST http://localhost:3000/auth/login
Content-Type: application/json

{
  "email": "test@example.com",
  "password": "123456"
}

### Get Dashboard (reemplazar token)
GET http://localhost:3000/dashboard/summary
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

### B. Con Frontend (Integración)

#### Configuración CORS
El backend debe permitir requests del frontend:

```javascript
// En src/index.js
const cors = require('cors');

app.use(cors({
  origin: [
    'http://localhost:5173',  // Vite dev server
    'http://localhost:3001',  // Otro puerto de desarrollo
    'https://tu-dominio.com'  // Producción
  ],
  credentials: true
}));
```

#### Flujo de Pruebas
```
1. Backend corriendo en localhost:3000
2. Frontend corriendo en localhost:5173
3. Frontend hace fetch a http://localhost:3000/api/...
4. Backend responde con JSON
5. Frontend renderiza datos
```

#### Variables de Entorno del Frontend
El frontend necesitará:
```env
VITE_API_URL=http://localhost:3000
```

---

### C. Simular Webhooks (Stripe/GoHighLevel)

#### Con cURL
```bash
# Simular webhook de Stripe (sin firma válida, solo desarrollo)
curl -X POST http://localhost:3000/webhooks/stripe \
  -H "Content-Type: application/json" \
  -d '{
    "type": "customer.subscription.created",
    "data": {
      "object": {
        "customer_email": "user@example.com",
        "status": "active"
      }
    }
  }'
```

#### Con Stripe CLI (Recomendado)
```bash
# Instalar Stripe CLI
# Iniciar túnel para webhooks locales
stripe listen --forward-to localhost:3000/webhooks/stripe

# En otra terminal, disparar eventos de prueba
stripe trigger customer.subscription.created
```

---

### D. Testing Automatizado (Futuro)

```
finance-dashboard-api/
├── tests/
│   ├── health.test.js
│   ├── auth.test.js
│   └── transactions.test.js
```

Herramientas recomendadas:
- **Jest** - Test runner
- **Supertest** - HTTP assertions

---

## 12. Comunicación con Frontend

### Contrato de API

El frontend consumirá esta API así:

```javascript
// En el frontend (React)
const API_URL = import.meta.env.VITE_API_URL;

// Login
const response = await fetch(`${API_URL}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
});
const { token, user } = await response.json();

// Request protegido
const transactions = await fetch(`${API_URL}/transactions`, {
  headers: { 'Authorization': `Bearer ${token}` }
});
```

### Formato de Respuestas (Estándar)

```javascript
// Éxito
{
  "success": true,
  "data": { ... }
}

// Error
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Token inválido o expirado"
  }
}
```

---

*Documento actualizado para reflejar arquitectura profesional con separación clara de responsabilidades.*
