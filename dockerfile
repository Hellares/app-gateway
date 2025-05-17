FROM node:18-alpine AS builder

WORKDIR /app

# Instalar dependencias necesarias para compilación
RUN apk add --no-cache python3 make g++

# Copiar los archivos de configuración de dependencias
COPY package.json package-lock.json ./

# Instalar dependencias
RUN npm ci

# Copiar el resto del código fuente
COPY . .

# Compilar la aplicación
RUN npm run build

# Eliminar dependencias de desarrollo
RUN npm prune --production

# Imagen final
FROM node:18-alpine

WORKDIR /app

# Instalar dependencias no Node.js necesarias en producción
RUN apk add --no-cache curl

# Copiar la aplicación compilada y las dependencias
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Crear el directorio para logs
RUN mkdir -p /app/logs && chmod -R 777 /app/logs

# Variables de entorno por defecto (serán sobrescritas por el docker-compose)
ENV NODE_ENV=production
ENV PORT=3000
ENV RABBITMQ_SERVERS=amqp://jtorres:jtorres159.@172.20.0.2:5672
ENV AUTH_SERVICE_URL=http://161.132.50.183:3007
ENV JWT_SECRET=tu-secreto-jwt-suficientemente-largo-y-seguro

# Healthcheck para verificar que la aplicación está funcionando
# HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
#   CMD curl -f http://localhost:$PORT/api/health || exit 1

# Exponer puerto
EXPOSE 3000

# Comando para iniciar la aplicación
CMD ["node", "dist/main"]