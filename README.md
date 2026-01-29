# Finance Dashboard API

Este repositorio contiene el código fuente del **Backend** para la plataforma de gestión financiera (Finance Dashboard).

Está construido con **Node.js** y **Express**, y es responsable de la lógica de negocio, autenticación, y validación de suscripciones.

## 📋 Características

*   **API RESTful:** Endpoints para la gestión de usuarios y datos financieros.
*   **Seguridad:** Autenticación y validación de estado de suscripción.
*   **Separación de Responsabilidades:** Arquitectura desacoplada del Frontend (React).

## 🚀 Requisitos Previos

*   Node.js (LTS recomendado)
*   npm

## 🛠️ Instalación y Configuración

1.  **Clonar el repositorio:**
    ```bash
    git clone <url-del-repositorio>
    cd finance-dashboard-api
    ```

2.  **Instalar dependencias:**
    ```bash
    npm install
    ```

3.  **Configurar variables de entorno:**
    Crea un archivo `.env` en la raíz del proyecto (basado en `.env.example` si existe) y configura tus variables (PUERTO, DB_URL, STRIPE_KEYS, etc.).

4.  **Iniciar el servidor en desarrollo:**
    ```bash
    npm run dev
    # o
    node index.js
    ```

## 📂 Estructura del Proyecto (Propuesta)

```text
finance-dashboard-api/
├── src/
│   ├── routes/         # Definición de rutas de la API
│   ├── middlewares/    # Middlewares (ej. auth, suscripción)
│   ├── controllers/    # Lógica de los endpoints
│   └── index.js        # Punto de entrada de la aplicación
├── .env                # Variables de entorno
└── package.json        # Dependencias y scripts
```

## 📖 Documentación Adicional

Para más detalles sobre las decisiones arquitectónicas y el contexto del proyecto, consulta el archivo [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md).

## 🤝 Contribución

1.  Haz un Fork del proyecto.
2.  Crea una rama para tu funcionalidad (`git checkout -b feature/nueva-funcionalidad`).
3.  Haz Commit de tus cambios (`git commit -m 'Add: nueva funcionalidad'`).
4.  Haz Push a la rama (`git push origin feature/nueva-funcionalidad`).
5.  Abre un Pull Request.
