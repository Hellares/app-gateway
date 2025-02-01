// src/redis/config/redis-gateway.constants.ts

export const REDIS_GATEWAY_CONFIG = {
  // Comandos RMQ para Redis
  COMMANDS: {
    GET: 'cache.get',
    SET: 'cache.set',
    DEL: 'cache.delete',
    EXISTS: 'cache.exists',
    CLEAR: 'cache.clear',
    HEALTH: 'cache.health'
  },

  // Timeouts ajustados para RMQ
  TIMEOUTS: {
    OPERATION: 5000,      // 1 segundos para operaciones estándar
    HEALTH_CHECK: 5000,   // 1 segundo para health checks
    COMMAND: 5000        // 1 segundos para comandos
  },

  // Configuración de caché local (solo para fallback)
  LOCAL_CACHE: {
    ENABLED: true,
    MAX_SIZE: 1000,       // Número máximo de entradas
    CLEANUP_INTERVAL: 300000,  // 5 minutos
    TTL: 300             // 5 minutos de TTL para entradas locales
  },

  // Health check de microservicio
  HEALTH_CHECK: {
    ENABLED: true,
    INTERVAL: 30000,      // 30 segundos entre checks
    TIMEOUT: 2000,        // 1 segundo de timeout para health check
    MAX_CONSECUTIVE_FAILURES: 3  // Número de fallos antes de considerar servicio caído
  },

  // Configuración de reintentos mejorada
  ERROR_HANDLING: {
    MAX_RETRIES: 3,
    MAX_DISPLAYED_FAILURES: 5,    // Máximo de fallos a mostrar
    BACKOFF: {
      INITIAL_RETRY_DELAY: 2000,  // 2 segundo
      MAX_RETRY_DELAY: 30000,     // 30 segundos
      FACTOR: 2                   // Factor de incremento exponencial
    }
  },

  // TTLs por defecto (en segundos)
  TTL: {
    DEFAULT: 3600,        // 1 hora
    SHORT: 300,          // 5 minutos
    MEDIUM: 1800,        // 30 minutos
    LONG: 86400,         // 24 horas
  },

  // Validación de keys
  PATTERNS: {
    KEY_SEPARATOR: ':',
    VALID_KEY_REGEX: /^[\w:.-]+$/,
    MAX_KEY_LENGTH: 512
  }
} as const;

// Estados de conexión con el microservicio
export enum REDIS_SERVICE_STATE {
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  ERROR = 'error'
}

// Tipos de errores
export enum REDIS_ERROR_TYPE {
  SERVICE_UNAVAILABLE = 'service_unavailable',
  TIMEOUT = 'timeout_error',
  COMMAND_FAILED = 'command_failed',
  KEY_ERROR = 'key_error',
  UNKNOWN = 'unknown_error'
}

// Tipos de respuesta
export enum CACHE_RESPONSE_TYPE {
  SUCCESS = 'success',
  ERROR = 'error',
  NOT_FOUND = 'not_found',
  TIMEOUT = 'timeout',
  INVALID = 'invalid'
}