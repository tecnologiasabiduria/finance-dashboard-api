#!/bin/bash

# Script para iniciar el servidor backend de Sabiduría Empresarial
cd "$(dirname "$0")"

# Matar procesos existentes en el puerto 3000
echo "🔍 Verificando puerto 3000..."
PID=$(lsof -ti:3000 2>/dev/null)
if [ -n "$PID" ]; then
    echo "⚠️  Matando proceso existente en puerto 3000 (PID: $PID)"
    kill -9 $PID 2>/dev/null
    sleep 1
fi

# Iniciar servidor
echo "🚀 Iniciando servidor..."
exec node src/index.js
