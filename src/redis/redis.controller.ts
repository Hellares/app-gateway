import { Controller, Get, Logger, Post } from '@nestjs/common';
import { RedisService } from './redis.service';
import { CacheMetrics } from './interfaces/cache-metrics.interface';

@Controller('redis')
export class RedisController {
  private readonly logger = new Logger('RedisController');
  constructor(private readonly redisService: RedisService) {}

  @Get('metrics')
  async getMetrics() {
    this.logger.debug('🔍 Obteniendo métricas de Redis');
    const metrics = await this.redisService.getMetrics();
    
    // Añadir alertas basadas en métricas
    if (metrics.successRate < 90) {
      this.logger.warn(`⚠️ Tasa de éxito baja: ${metrics.successRate}%`);
    }
    
    if (metrics.averageResponseTime > 100) {
      this.logger.warn(`⚠️ Tiempo de respuesta promedio alto: ${metrics.averageResponseTime}ms`);
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
    if (!metrics.connectionStatus.isConnected) return 'disconnected';
    if (metrics.successRate < 90) return 'degraded';
    if (metrics.averageResponseTime > 100) return 'slow';
    return 'healthy';
  }

  @Get('debug/cache')
  async getLocalCacheContent() {
    const cacheContent = {};
    for (const [key, value] of this.redisService.getLocalCache().entries()) {
      cacheContent[key] = {
        dataLength: Array.isArray(value?.data) ? value.data.length : 'N/A',
        metadata: value?.metadata || {},
        timestamp: new Date().toISOString()
      };
    }

    return {
      status: 'success',
      cacheSize: this.redisService.getLocalCache().size,
      keys: Object.keys(cacheContent),
      details: cacheContent
    };
  }



  @Get('health')
  async checkHealth() {
    this.logger.log('🔍 Verificando estado de Redis...');
    const health = await this.redisService.healthCheck();
    
    if (health.status === 'healthy') {
      this.logger.log('✅ Redis está funcionando correctamente');
    } else {
      this.logger.warn(`⚠️ Redis no está saludable: ${health.error || 'Unknown error'}`);
    }
    
    return health;
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
}
