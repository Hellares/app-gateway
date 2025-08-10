// src/redis/interfaces/cache-metrics.interface.ts

export interface ServiceMetrics {
  hits: number;
  misses: number;
  totalOperations: number;
  averageResponseTime: number;
  lastResponseTime: number;
  failedOperations: number;
  successRate: number;
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  totalOperations: number;
  averageResponseTime: number;
  lastResponseTime: number;
  failedOperations: number;
  successRate: number;
  localCacheSize: number;
  lastUpdated: Date;
  online?: ServiceMetrics;
  offline?: ServiceMetrics;
  lastOnlineTime?: Date;
  timeOffline?: number;
  timeOfflineFormatted?: string;
  connectionStatus: {
    isConnected: boolean;
    consecutiveFailures: number;
    lastConnectionAttempt: Date;

  };
  
}

export interface DetailedCacheMetrics extends CacheMetrics {
  status: string;  // Añadido
  serviceState: string;  // Añadido también si no existe
  timestamp: string;  // Añadido
  localCache: {
    size: number;
    maxSize: number;
    usagePercentage: number;
    oldestEntry: number | null;
    newestEntry: number | null;
    hitRatio: number;
    averageHits: number;
    totalHits: number;
    memoryUsageEstimate: number;
    totalMemoryUsage?: string;    // Añadido
    averageEntrySize?: string;    // Añadido
    patterns: Record<string, number>;
  };
  entries: Array<{
    key: string;
    hits: number;
    age: number;
    size: number;
    expiresIn?: number;
    pattern: string;
    metadata?: any;
  }>;
  performance?: {  // Añadido también
    hits: number;
    misses: number;
    hitRatio: string;
    averageResponseTime: string;
    successRate: string;
    status: string;
  };
}


