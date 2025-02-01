import { Controller, Get, Logger, Post } from '@nestjs/common';
import { RedisService } from './redis.service';
import { CacheMetrics } from './interfaces/cache-metrics.interface';


@Controller('redis')
export class RedisController {
  private readonly logger = new Logger('RedisController');
  constructor(private readonly redisService: RedisService) {}

  

  @Get('health')
async checkHealth() {
  this.logger.log('🔍 Verificando estado de Redis...');
  const health = await this.redisService.healthCheck();
  
  if (health.status === 'healthy') {
    this.logger.log('✅ Redis está funcionando correctamente', {
      responseTime: `${health.responseTime}ms`,
      successRate: `${health.metrics?.online.successRate}%`
    });
  } else {
    const offlineTime = health.timeOfflineFormatted || 'tiempo desconocido';
    this.logger.warn(`⚠️ Redis no está saludable - Offline por ${offlineTime}`, {
      failures: health.consecutiveFailures,
      nextRetry: health.nextRetryIn ? `${health.nextRetryIn}ms` : 'N/A'
    });
  }
  
  return health;
}

  @Get('metrics')
  async getMetricsCache() {
    this.logger.debug('🔍 Obteniendo métricas de Redis');
    const metrics = await this.redisService.getMetrics();
    
    // Añadir alertas basadas en métricas
    if (!metrics.connectionStatus.isConnected) {
      this.logger.warn(`⚠️ Redis offline por ${metrics.timeOffline || 'tiempo desconocido'}`);
      this.logger.verbose(`ℹ️ Usando caché local con ${metrics.localCacheSize} entradas`);
    }
    
    if (metrics.online.successRate < 90) {
      this.logger.warn(`⚠️ Tasa de éxito baja en modo online: ${metrics.online.successRate}%`);
    }
    
    if (metrics.connectionStatus.consecutiveFailures > 0) {
      this.logger.warn(`⚠️ Fallos consecutivos: ${metrics.connectionStatus.consecutiveFailures}`);
    }

    return {
      metrics,
      timestamp: new Date().toISOString(),
      status: this.getHealthStatus(metrics)
    };
  }

  private getHealthStatus(metrics: CacheMetrics): string {
    if (!metrics.connectionStatus.isConnected) {
      return `disconnected (${metrics.timeOffline ? 'offline por ' + this.formatTime(metrics.timeOffline) : 'tiempo desconocido'})`;
    }
    if (metrics.online.successRate < 90) return 'degraded';
    if (metrics.online.averageResponseTime > 100) return 'slow';
    return 'healthy';
  }

  private formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }


  @Post('clear')
  async clearCache() {
    this.logger.log('🧹 Limpiando caché de Redis...');
    const result = await this.redisService.clearAll();
    
    if (result.success) {
      this.logger.log('✅ Caché limpiado exitosamente');
    } else {
      this.logger.error(`❌ Error al limpiar caché: ${result.error}`);
    }
    
    return result;
  }

  @Get('debug/cache')
async getLocalCacheContent() {
  const cacheContent = {};
  const localCache = this.redisService.getLocalCache();
  
  for (const [key, value] of localCache.entries()) {
    cacheContent[key] = {
      dataLength: Array.isArray(value?.data) ? value.data.length : 'N/A',
      metadata: value?.metadata || {},
      timestamp: new Date().toISOString()
    };
  }

  return {
    status: 'success',
    cacheSize: localCache.size,
    keys: Object.keys(cacheContent),
    details: cacheContent,
    metrics: await this.redisService.getMetrics()
  };
}

// @Post('debug/cache/clear')
// async clearLocalCache() {
//   await this.redisService.clearLocalCache();
//   return {
//     status: 'success',
//     message: 'Caché local limpiado',
//     timestamp: new Date().toISOString()
//   };
// }

@Get('debug/cache/stats')
async getLocalCacheStats() {
  return {
    status: 'success',
    ...this.redisService.getLocalCacheDetails(),
    metrics: await this.redisService.getMetrics()
  };
}
}
