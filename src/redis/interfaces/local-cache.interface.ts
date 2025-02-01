export interface LocalCacheEntry<T = any> {
  data: T;
  timestamp: number;
  expiresAt: number;
  metadata?: any;  // Añadimos metadata como opcional
}