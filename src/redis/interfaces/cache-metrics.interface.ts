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


