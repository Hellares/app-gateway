export type CacheSource = 'redis' | 'local' | 'none';
export interface CacheResponse<T = unknown> {
  success: boolean;
  source: CacheSource;
  data?: T;
  error?: string;
  details?: {
    cached?: boolean;
    lastCheck?: string;
    timeSinceLastCheck?: number;
    responseTime?: number;
    consecutiveFailures?: number;
    lastError?: string;
    lastSuccessful?: string;
    cacheSize?: number;        // Añadimos esta propiedad
    key?: string;             // Añadimos esta propiedad
    localCacheInfo?: {        // Información adicional del caché local
      size: number;
      keys: string[];
    };
  };
}