// src/common/guards/rate-limit.config.ts
export interface RateLimitConfig {
  points: number;          // Número máximo de peticiones permitidas
  duration: number;        // Duración del período en segundos
  blockDuration: number;   // Duración del primer bloqueo
  refillRate: number;      // Tasa de reposición de tokens
  penalties: {
    warning: number;       // Umbral de advertencia (%)
    soft: number;         // Umbral de bloqueo suave (%)
    hard: number;         // Umbral de bloqueo duro (%)
  };
  blockDurations: {
    soft: number;         // Duración del bloqueo suave
    hard: number;         // Duración del bloqueo duro
    max: number;          // Duración máxima de bloqueo
  };
}

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  points: 100,            // 100 peticiones
  duration: 60,           // por minuto
  blockDuration: 300,     // bloqueo inicial de 5 minutos
  refillRate: 0.5,        // 1 token cada 2 segundos
  penalties: {
    warning: 80,          // Advertencia al 80% del límite
    soft: 100,           // Bloqueo suave al 100%
    hard: 150            // Bloqueo duro al 150%
  },
  blockDurations: {
    soft: 300,           // 5 minutos
    hard: 3600,          // 1 hora
    max: 86400          // 24 horas
  }
};

// Configuraciones predefinidas para diferentes escenarios
export const RATE_LIMIT_PRESETS = {
  // Para APIs públicas
  PUBLIC_API: {
    ...DEFAULT_RATE_LIMIT_CONFIG,
    points: 60,           // 1 petición por segundo
    duration: 60,
    blockDuration: 600    // 10 minutos de bloqueo inicial
  },

  // Para APIs privadas/autenticadas
  PRIVATE_API: {
    ...DEFAULT_RATE_LIMIT_CONFIG,
    points: 300,          // 5 peticiones por segundo
    duration: 60,
    blockDuration: 300    // 5 minutos de bloqueo inicial
  },

  // Para endpoints críticos (ej: autenticación)
  CRITICAL: {
    ...DEFAULT_RATE_LIMIT_CONFIG,
    points: 10,           // 10 intentos
    duration: 300,        // en 5 minutos
    blockDuration: 1800,  // 30 minutos de bloqueo inicial
    penalties: {
      warning: 70,        // Advertencia más temprana
      soft: 100,
      hard: 120          // Bloqueo duro más agresivo
    }
  },

  // Para endpoints de alta demanda (ej: lecturas)
  HIGH_TRAFFIC: {
    ...DEFAULT_RATE_LIMIT_CONFIG,
    points: 100,            // 100 peticiones
    duration: 60,           // por minuto
    refillRate: 1.66,       // ~100 tokens por minuto
    blockDuration: 300,     // 5 minutos de bloqueo inicial
    penalties: {
      warning: 90,
      soft: 120,
      hard: 150
    },
    blockDurations: {
      soft: 300,    // 5 minutos
      hard: 1800,   // 30 minutos
      max: 3600     // 1 hora
    }
  }
};