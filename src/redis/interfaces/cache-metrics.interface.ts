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
  connectionStatus: {
    isConnected: boolean;
    consecutiveFailures: number;
    lastConnectionAttempt: Date;
  };
}