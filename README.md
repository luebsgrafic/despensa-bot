# DespensaBot 🏠

Bot de Telegram para gestionar el inventario completo de casa para una familia de 4 usuarios.

## Stack

- **Runtime**: Node.js + TypeScript
- **Bot**: Telegraf v4 (long polling)
- **BD**: Neon (PostgreSQL serverless)
- **IA**: DeepSeek Chat (`deepseek-v4-flash`)
- **Tests**: Vitest

## Setup

```bash
# 1. Clonar e instalar
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus tokens y IDs de usuario

# 3. Iniciar en desarrollo
npm run dev
```

## Variables de entorno

| Variable | Descripción |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token del bot de @BotFather |
| `DEEPSEEK_API_KEY` | API Key de platform.deepseek.com |
| `TELEGRAM_ALLOWED_USERS` | IDs de Telegram separados por coma |
| `DATABASE_URL` | Connection string de Neon PostgreSQL |

## Comandos

```bash
npm run dev        # Desarrollo con hot reload
npm run build      # Compilar TypeScript
npm start          # Producción
npm test           # Tests
npm run typecheck  # Type checking
```

## Funcionalidades

- 📦 **Ver despensa** — productos organizados por zona con paginación
- ➕ **Añadir** — wizard conversacional de 6 pasos con botones
- ➖ **Gastar** — registra consumo, avisa si queda bajo mínimo
- 🛒 **Lista compra** — tachar productos, compartir, limpiar tachados
- 🍳 **IA con DeepSeek** — recetas, ubicación de productos, preguntas de cocina
- ⏰ **Alertas diarias** — productos próximos a caducar a las 9:00 AM
- 🔒 **Autorización** — solo usuarios permitidos

## Estructura

```
src/
  index.ts          # Punto de entrada
  types/            # Tipos compartidos
  utils/            # Configuración
  db/               # Esquema y repositorios (Neon)
  middleware/       # Auth y sesión
  handlers/         # Lógica del bot
  services/         # DeepSeek y scheduler
tests/              # Tests unitarios
```
