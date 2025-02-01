import { CacheMetrics } from "./cache-metrics.interface";

export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy' | 'disabled';
  serviceState: string;
  responseTime: number;
  timestamp: string;
  timeOfflineFormatted?: string;
  error?: string;
  consecutiveFailures?: number;
  nextRetryIn?: number;
  metrics?: CacheMetrics;
  details?: {
    redisConnected: boolean;
    lastCheck: string;
    responseTime: number;
    consecurityFailures: number;
  };
}