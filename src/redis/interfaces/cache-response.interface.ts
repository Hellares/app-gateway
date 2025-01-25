export type CacheSource = 'redis' | 'local' | 'none';

// export interface CacheResponse<T = any> {
//   success: boolean;
//   data?: T;
//   error?: string;
//   source: CacheSource;
// }

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
  };
}