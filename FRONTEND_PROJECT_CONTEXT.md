# Contexto del Proyecto: Finance Dashboard Frontend

> **IMPORTANTE:** Este archivo es para contextualizar el desarrollo del frontend.
> El backend existe en un repositorio separado y expone una API REST.

---

## 1. Qué Es Este Proyecto

**Producto:** Dashboard web para control de gastos e ingresos personales.

**Tipo:** Aplicación React (SPA) que consume una API REST.

**Modelo de Negocio:**
- Es una plataforma de pago (SaaS)
- Solo usuarios con suscripción activa pueden acceder
- El backend controla el acceso, el frontend solo muestra

---

## 2. Regla Fundamental

```
┌────────────────────────────────────────────────────────┐
│  EL FRONTEND NO DECIDE NADA SOBRE ACCESO O PAGOS      │
│  Solo muestra lo que el backend le permite ver        │
└────────────────────────────────────────────────────────┘
```

- ❌ NO validar suscripción en el frontend
- ❌ NO procesar pagos en el frontend
- ❌ NO guardar datos sensibles en localStorage
- ✅ SÍ mostrar UI según respuesta del backend
- ✅ SÍ redirigir si el backend dice "no autorizado"
- ✅ SÍ guardar el JWT en memoria o httpOnly cookie

---

## 3. Arquitectura General

```
┌─────────────────────────────────────────────────────────────┐
│                    FLUJO DE LA PLATAFORMA                   │
└─────────────────────────────────────────────────────────────┘

   Usuario paga en GoHighLevel/Stripe (externo)
          │
          ▼
   Backend Node.js (otro repositorio)
          │
          │ API REST
          ▼
   ┌──────────────────┐
   │  React Frontend  │  ◄── ESTE REPOSITORIO
   │  (Dashboard)     │
   └──────────────────┘
```

---

## 4. Comunicación con el Backend

### URL Base de la API

```env
# .env.local (desarrollo)
VITE_API_URL=http://localhost:3000

# .env.production (producción)
VITE_API_URL=https://api.tu-dominio.com
```

### Endpoints Disponibles

| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| GET | `/health` | Estado del servidor | No |
| POST | `/auth/login` | Iniciar sesión | No |
| POST | `/auth/register` | Registrarse | No |
| GET | `/auth/me` | Datos del usuario actual | Sí |
| GET | `/dashboard/summary` | Resumen financiero | Sí |
| GET | `/transactions` | Listar transacciones | Sí |
| POST | `/transactions` | Crear transacción | Sí |
| PUT | `/transactions/:id` | Editar transacción | Sí |
| DELETE | `/transactions/:id` | Eliminar transacción | Sí |

### Formato de Respuestas del Backend

```javascript
// Respuesta exitosa
{
  "success": true,
  "data": { /* datos */ }
}

// Respuesta de error
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Token inválido o expirado"
  }
}
```

### Códigos de Error Importantes

| Código HTTP | Significado | Acción en Frontend |
|-------------|-------------|-------------------|
| 200 | OK | Mostrar datos |
| 201 | Creado | Mostrar éxito, refrescar lista |
| 400 | Datos inválidos | Mostrar errores en formulario |
| 401 | No autenticado | Redirigir a `/login` |
| 403 | Suscripción inactiva | Redirigir a `/subscription-required` |
| 404 | No encontrado | Mostrar mensaje |
| 500 | Error del servidor | Mostrar error genérico |

---

## 5. Flujo de Autenticación

```
┌─────────────────────────────────────────────────────────────┐
│                    FLUJO DE LOGIN                           │
└─────────────────────────────────────────────────────────────┘

1. Usuario ingresa email y contraseña
              │
              ▼
2. Frontend hace POST /auth/login
              │
              ▼
3. Backend valida credenciales + suscripción
              │
              ├── 401: Credenciales inválidas → Mostrar error
              │
              ├── 403: Suscripción inactiva → Página de "Activa tu suscripción"
              │
              ▼
4. Backend responde con JWT + datos de usuario
              │
              ▼
5. Frontend guarda JWT en memoria (Context/Zustand)
              │
              ▼
6. Frontend redirige al Dashboard
              │
              ▼
7. Todas las peticiones incluyen: Authorization: Bearer <jwt>
```

### Implementación del Auth Context

```javascript
// src/context/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  // Verificar sesión al cargar
  useEffect(() => {
    const checkAuth = async () => {
      const savedToken = sessionStorage.getItem('token');
      if (savedToken) {
        try {
          const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/me`, {
            headers: { 'Authorization': `Bearer ${savedToken}` }
          });
          if (response.ok) {
            const { data } = await response.json();
            setUser(data.user);
            setToken(savedToken);
          } else {
            sessionStorage.removeItem('token');
          }
        } catch (error) {
          sessionStorage.removeItem('token');
        }
      }
      setLoading(false);
    };
    checkAuth();
  }, []);

  const login = async (email, password) => {
    const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      throw { status: response.status, ...result.error };
    }
    
    setUser(result.data.user);
    setToken(result.data.token);
    sessionStorage.setItem('token', result.data.token);
    
    return result.data;
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    sessionStorage.removeItem('token');
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
```

---

## 6. Rutas y Páginas

### Estructura de Rutas

```
/                     → Redirige a /login o /dashboard
/login                → Página de inicio de sesión
/register             → Página de registro
/subscription-required → Usuario sin suscripción activa
/dashboard            → Panel principal (protegido)
/transactions         → Lista de transacciones (protegido)
/transactions/new     → Crear transacción (protegido)
/transactions/:id     → Editar transacción (protegido)
/settings             → Configuración de cuenta (protegido)
```

### Componente de Ruta Protegida

```javascript
// src/components/ProtectedRoute.jsx
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div>Cargando...</div>; // O un spinner
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
```

---

## 7. Páginas a Implementar

### 7.1 Página de Login (`/login`)

**Funcionalidad:**
- Formulario con email y contraseña
- Validación de campos requeridos
- Mostrar errores del backend
- Redirigir al dashboard si éxito
- Link a registro

**Estados a manejar:**
- `loading`: mientras se procesa el login
- `error`: mensaje de error del backend
- Código 403: mostrar mensaje especial de suscripción

---

### 7.2 Página de Registro (`/register`)

**Funcionalidad:**
- Formulario: nombre, email, contraseña, confirmar contraseña
- Validación de campos
- Mostrar errores
- Redirigir a página de "Activa tu suscripción" después del registro

**Nota:** El registro NO da acceso automático. El usuario debe pagar primero.

---

### 7.3 Página de Suscripción Requerida (`/subscription-required`)

**Funcionalidad:**
- Mensaje claro: "Necesitas una suscripción activa"
- Botón/Link hacia la página de pago (GoHighLevel/Stripe)
- Opción de cerrar sesión

---

### 7.4 Dashboard (`/dashboard`)

**Funcionalidad:**
- Resumen financiero (ingresos vs gastos del mes)
- Gráfico de barras o dona
- Lista de últimas 5 transacciones
- Accesos rápidos a crear ingreso/gasto

**Datos del endpoint `/dashboard/summary`:**
```javascript
{
  "success": true,
  "data": {
    "balance": 1500.00,
    "totalIncome": 3000.00,
    "totalExpenses": 1500.00,
    "transactionsCount": 25,
    "recentTransactions": [
      { "id": "...", "type": "expense", "amount": 50, "category": "food", "date": "2025-01-28" },
      // ...
    ]
  }
}
```

---

### 7.5 Lista de Transacciones (`/transactions`)

**Funcionalidad:**
- Tabla con todas las transacciones
- Filtros: tipo (ingreso/gasto), categoría, rango de fechas
- Paginación
- Botón para crear nueva
- Acciones: editar, eliminar

**Parámetros de query para `/transactions`:**
```
GET /transactions?type=expense&category=food&from=2025-01-01&to=2025-01-31&page=1&limit=20
```

---

### 7.6 Crear/Editar Transacción (`/transactions/new`, `/transactions/:id`)

**Campos del formulario:**
- Tipo: ingreso o gasto (select)
- Monto: número decimal positivo
- Categoría: select con opciones predefinidas
- Descripción: texto opcional
- Fecha: date picker

**Categorías sugeridas:**
```javascript
const CATEGORIES = {
  income: ['Salario', 'Freelance', 'Inversiones', 'Otros'],
  expense: ['Alimentación', 'Transporte', 'Servicios', 'Entretenimiento', 'Salud', 'Educación', 'Otros']
};
```

---

## 8. Estructura de Carpetas

```
finance-dashboard-frontend/
├── public/
│   └── favicon.ico
├── src/
│   ├── components/
│   │   ├── ui/                    # Componentes reutilizables
│   │   │   ├── Button.jsx
│   │   │   ├── Input.jsx
│   │   │   ├── Card.jsx
│   │   │   ├── Modal.jsx
│   │   │   └── Spinner.jsx
│   │   ├── layout/
│   │   │   ├── Header.jsx
│   │   │   ├── Sidebar.jsx
│   │   │   └── DashboardLayout.jsx
│   │   ├── ProtectedRoute.jsx
│   │   └── TransactionForm.jsx
│   ├── pages/
│   │   ├── Login.jsx
│   │   ├── Register.jsx
│   │   ├── SubscriptionRequired.jsx
│   │   ├── Dashboard.jsx
│   │   ├── Transactions.jsx
│   │   ├── TransactionNew.jsx
│   │   ├── TransactionEdit.jsx
│   │   └── Settings.jsx
│   ├── context/
│   │   └── AuthContext.jsx
│   ├── hooks/
│   │   ├── useApi.js             # Hook para llamadas a la API
│   │   └── useTransactions.js
│   ├── services/
│   │   └── api.js                # Cliente HTTP configurado
│   ├── utils/
│   │   ├── formatCurrency.js
│   │   └── formatDate.js
│   ├── styles/
│   │   └── globals.css
│   ├── App.jsx
│   └── main.jsx
├── .env.local
├── .env.production
├── .gitignore
├── index.html
├── package.json
├── vite.config.js
└── README.md
```

---

## 9. Servicio API (Cliente HTTP)

```javascript
// src/services/api.js
const API_URL = import.meta.env.VITE_API_URL;

class ApiService {
  constructor() {
    this.token = null;
  }

  setToken(token) {
    this.token = token;
  }

  clearToken() {
    this.token = null;
  }

  async request(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      const error = new Error(data.error?.message || 'Error desconocido');
      error.status = response.status;
      error.code = data.error?.code;
      throw error;
    }

    return data;
  }

  // Auth
  login(email, password) {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  register(data) {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  getMe() {
    return this.request('/auth/me');
  }

  // Dashboard
  getDashboardSummary() {
    return this.request('/dashboard/summary');
  }

  // Transactions
  getTransactions(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/transactions${query ? `?${query}` : ''}`);
  }

  getTransaction(id) {
    return this.request(`/transactions/${id}`);
  }

  createTransaction(data) {
    return this.request('/transactions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  updateTransaction(id, data) {
    return this.request(`/transactions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  deleteTransaction(id) {
    return this.request(`/transactions/${id}`, {
      method: 'DELETE',
    });
  }
}

export const api = new ApiService();
```

---

## 10. Dependencias Recomendadas

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.x",
    "recharts": "^2.x",
    "date-fns": "^2.x",
    "clsx": "^2.x"
  },
  "devDependencies": {
    "vite": "^5.x",
    "@vitejs/plugin-react": "^4.x",
    "tailwindcss": "^3.x",
    "autoprefixer": "^10.x",
    "postcss": "^8.x"
  }
}
```

**Notas:**
- **Recharts**: para gráficos del dashboard
- **date-fns**: para formateo de fechas
- **Tailwind CSS**: para estilos (opcional, puedes usar otro)

---

## 11. Manejo de Estados de Carga

```javascript
// Ejemplo en página Dashboard
function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const { data } = await api.getDashboardSummary();
        setSummary(data);
      } catch (err) {
        if (err.status === 401) {
          // Token expirado, redirigir
          navigate('/login');
        } else if (err.status === 403) {
          // Sin suscripción
          navigate('/subscription-required');
        } else {
          setError(err.message);
        }
      } finally {
        setLoading(false);
      }
    };
    fetchSummary();
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ErrorMessage message={error} />;
  return <DashboardContent data={summary} />;
}
```

---

## 12. Diseño Visual (Sugerencias)

### Paleta de Colores
```css
:root {
  --primary: #3B82F6;      /* Azul */
  --success: #10B981;      /* Verde - ingresos */
  --danger: #EF4444;       /* Rojo - gastos */
  --background: #F9FAFB;   /* Gris claro */
  --card: #FFFFFF;
  --text: #1F2937;
  --text-muted: #6B7280;
}
```

### Layout del Dashboard
```
┌─────────────────────────────────────────────────────────┐
│  Header (Logo + User menu + Logout)                     │
├──────────┬──────────────────────────────────────────────┤
│          │                                              │
│ Sidebar  │   Contenido Principal                        │
│          │                                              │
│ - Home   │   ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│ - Trans. │   │ Balance │ │Ingresos │ │ Gastos  │       │
│ - Config │   └─────────┘ └─────────┘ └─────────┘       │
│          │                                              │
│          │   ┌──────────────────────────────────┐       │
│          │   │         Gráfico                  │       │
│          │   └──────────────────────────────────┘       │
│          │                                              │
│          │   ┌──────────────────────────────────┐       │
│          │   │   Últimas Transacciones          │       │
│          │   └──────────────────────────────────┘       │
└──────────┴──────────────────────────────────────────────┘
```

---

## 13. Checklist de Implementación

### Fase 1: Setup
- [ ] Crear proyecto con Vite + React
- [ ] Configurar Tailwind CSS
- [ ] Configurar React Router
- [ ] Crear estructura de carpetas
- [ ] Configurar variables de entorno

### Fase 2: Autenticación
- [ ] Implementar AuthContext
- [ ] Crear servicio API
- [ ] Página de Login
- [ ] Página de Registro
- [ ] Componente ProtectedRoute
- [ ] Página SubscriptionRequired

### Fase 3: Dashboard
- [ ] Layout principal (Header + Sidebar)
- [ ] Página Dashboard con cards
- [ ] Integrar gráfico con Recharts
- [ ] Lista de transacciones recientes

### Fase 4: Transacciones
- [ ] Página lista de transacciones
- [ ] Filtros y paginación
- [ ] Formulario crear transacción
- [ ] Formulario editar transacción
- [ ] Confirmación de eliminación

### Fase 5: Pulido
- [ ] Manejo de errores global
- [ ] Estados de carga (spinners)
- [ ] Mensajes de éxito (toasts)
- [ ] Responsive design
- [ ] Página de configuración

---

## 14. Comandos Útiles

```bash
# Desarrollo
npm run dev

# Build para producción
npm run build

# Preview del build
npm run preview
```

---

## 15. Variables de Entorno

```env
# .env.local (desarrollo)
VITE_API_URL=http://localhost:3000

# .env.production (producción - configurar en el VPS)
VITE_API_URL=https://api.tu-dominio.com
```

---

*Este documento contextualiza el frontend. El backend es un proyecto separado con su propia documentación.*
