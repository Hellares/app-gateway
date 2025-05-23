// export type CacheSource = 'redis' | 'local' | 'none';
// export interface CacheResponse<T = unknown> {
//   success: boolean;
//   source: CacheSource;
//   data?: T;
//   error?: string;
//   details?: {
//     cached?: boolean;
//     lastCheck?: string;
//     timeSinceLastCheck?: number;
//     responseTime?: number;
//     consecutiveFailures?: number;
//     lastError?: string;
//     lastSuccessful?: string;
//     cacheSize?: number;        // Añadimos esta propiedad
//     key?: string;             // Añadimos esta propiedad
//     localCacheInfo?: {        // Información adicional del caché local
//       size: number;
//       keys: string[];
//     };
//   };
// }

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
    cacheSize?: number;
    key?: string;
    errorType?: string;
    partialDeletion?: boolean;
    partialClear?: boolean;
    age?: number;
    timeOffline?: number;
    timeOfflineFormatted?: string;
    ttl?: number;  // Añadimos esta línea
    keysDeleted?: number; // Añadimos esta línea
    localKeysDeleted?: number; // Añadimos esta línea
   
    localCacheInfo?: {
      size: number;
      keys: string[];
    };
};

}

