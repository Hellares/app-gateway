import { Controller, Get, Logger, Param, Post, Query, UseGuards } from '@nestjs/common';
import { RedisService } from './redis.service';
import { CacheMetrics } from './interfaces/cache-metrics.interface';
import { CACHE_KEYS } from './constants/redis-cache.keys.contants';
import { REDIS_GATEWAY_CONFIG } from './config/redis.constants';
import { RateLimitGuard } from 'src/common/guards/rate-limit.guard';


@Controller('redis')
// @UseGuards(RateLimitGuard)
export class RedisController {
  private readonly logger = new Logger('RedisController');
  constructor(private readonly redisService: RedisService) {}

  

  @Get('health')
async checkHealth() {
  this.logger.log('Verificando estado de Redis...');
  const health = await this.redisService.healthCheck();
  
  if (health.status === 'healthy') {
    this.logger.log('Redis esta funcionando correctamente', {
      responseTime: `${health.responseTime}ms`,
      successRate: `${health.metrics?.online.successRate}%`
    });
  } else {
    const offlineTime = health.timeOfflineFormatted || 'tiempo desconocido';
    this.logger.warn(`Redis no esta saludable - Offline por ${offlineTime}`, {
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
      this.logger.warn(`Redis offline por ${metrics.timeOffline || 'tiempo desconocido'}`);
      this.logger.verbose(`Usando cache local con ${metrics.localCacheSize} entradas`);
    }
    
    if (metrics.online.successRate < 90) {
      this.logger.warn(`Tasa de exito baja en modo online: ${metrics.online.successRate}%`);
    }
    
    if (metrics.connectionStatus.consecutiveFailures > 0) {
      this.logger.warn(`Fallos consecutivos: ${metrics.connectionStatus.consecutiveFailures}`);
    }

    return {
      metrics,
      timestamp: new Date().toISOString(),
      status: this.getHealthStatus(metrics)
    };
  }

  private getHealthStatus(metrics: CacheMetrics): string {
    // Si está desconectado, mantener el mensaje actual
    if (!metrics.connectionStatus.isConnected) {
      return `disconnected (${metrics.timeOffline ? 'offline por ' + this.formatTime(metrics.timeOffline) : 'tiempo desconocido'})`;
    }
  
    // Verificar tasa de éxito primero
    if (metrics.online.successRate < 90) return 'degraded';
  
    // Nuevos umbrales de tiempo de respuesta para entorno distribuido
    const avgTime = metrics.online.averageResponseTime;
    if (avgTime > 1000) return 'critical';    // > 1 segundo
    if (avgTime > 500) return 'slow';         // > 500ms
    if (avgTime > 300) return 'normal';       // > 300ms
    return 'healthy';                         // < 300ms
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
      this.logger.log('Cach limpiado exitosamente');
    } else {
      this.logger.error(`Error al limpiar cach: ${result.error}`);
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


@Get('debug/cache/stats')
async getLocalCacheStats() {
  return {
    status: 'success',
    ...this.redisService.getLocalCacheDetails(),
    metrics: await this.redisService.getMetrics()
  };
}


@Get('metrics/detailed')
async getDetailedMetrics() {
  this.logger.debug('Obteniendo metricas detalladas de Redis');
  const metrics = await this.redisService.getMetrics();
  const localCache = this.redisService.getLocalCache();
  const cacheDetails = this.redisService.getLocalCacheDetails();

  // Calcular métricas adicionales
  const now = Date.now();
  const entries = Array.from(localCache.entries()).map(([key, entry]) => {
    const age = now - entry.timestamp;
    const expiresIn = entry.expiresAt ? entry.expiresAt - now : undefined;
    
    return {
      key,
      age: this.formatDuration(age),
      expiresIn: expiresIn > 0 ? this.formatDuration(expiresIn) : 'Expirado',
      size: this.formatBytes(JSON.stringify(entry.data).length),
      metadata: entry.metadata || {},
      pattern: this.getKeyPattern(key)
    };
  });

  // Logging de estado y alertas
  if (!metrics.connectionStatus.isConnected) {
    this.logger.warn('Obteniendo metricas en modo offline');
  }

  const hitRatio = Number(((metrics.hits / Math.max(metrics.totalOperations, 1)) * 100).toFixed(2));
  const usagePercentage = Number(((localCache.size / REDIS_GATEWAY_CONFIG.LOCAL_CACHE.MAX_SIZE) * 100).toFixed(2));

  return {
    status: 'success',
    timestamp: new Date().toISOString(),
    serviceState: metrics.connectionStatus.isConnected ? 'connected' : 'disconnected',
    localCache: {
      size: localCache.size,
      maxSize: REDIS_GATEWAY_CONFIG.LOCAL_CACHE.MAX_SIZE,
      usagePercentage,
      oldestEntry: now,  // Se puede mejorar calculando la entrada más antigua
      newestEntry: now,  // Se puede mejorar calculando la entrada más reciente
      hitRatio,
      averageHits: metrics.hits / Math.max(localCache.size, 1),
      totalHits: metrics.hits,
      memoryUsageEstimate: this.formatBytes(cacheDetails.summary.totalSize),//this.formatBytes(cacheDetails.summary.totalSize),
      patterns: cacheDetails.summary.patterns
    },
    performance: {
      hits: metrics.hits,
      misses: metrics.misses,
      hitRatio: hitRatio,
      averageResponseTime: metrics.averageResponseTime,
      successRate: metrics.successRate,
      status: this.getHealthStatus(metrics)
    },
    entries,
    timeOffline: metrics.timeOffline || 0,
    lastUpdated: metrics.lastUpdated
  };
}

private getKeyPattern(key: string): string {
  // Intentar identificar el patrón basado en CACHE_KEYS
  for (const [category, patterns] of Object.entries(CACHE_KEYS)) {
    for (const [type, pattern] of Object.entries(patterns)) {
      if (typeof pattern === 'string' && key.startsWith(pattern)) {
        return `${category}.${type}`;
      }
    }
  }
  // Si no coincide con ningún patrón conocido, usar genérico
  return key.replace(/[\d-]+/g, '*');
}

private formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

private formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

@Post('test/populate')
async populateTestData() {
  this.logger.log('🔄 Iniciando inserción de datos de prueba...');
  
  const testData = [
    {
      key: CACHE_KEYS.RUBRO.BASE.ACTIVE,
      value: { 
        id: 1, 
        name: 'Rubro Test 1', 
        active: true,
        timestamp: new Date().toISOString()
      }
    },
    {
      key: CACHE_KEYS.RUBRO.SINGLE('123'),
      value: { 
        id: 123, 
        name: 'Rubro Individual', 
        active: true,
        metadata: {
          lastUpdate: new Date().toISOString(),
          version: '1.0'
        }
      }
    },
    {
      key: CACHE_KEYS.PLAN.BASE.ACTIVE,
      value: { 
        id: 1, 
        name: 'Plan Test 1', 
        active: true,
        details: {
          price: 100,
          currency: 'USD'
        }
      }
    }
  ];

  try {
    const results = [];
    for (const item of testData) {
      this.logger.debug(`⏳ Insertando key: ${item.key}`);
      const result = await this.redisService.set(item.key, item.value, 300);
      results.push({
        key: item.key,
        success: result.success,
        source: result.source,
        details: result.details
      });
    }

    // Verificar el estado del caché después de la inserción
    const cacheSize = this.redisService.getLocalCache().size;
    this.logger.log(`✅ Datos insertados. Tamaño actual del caché: ${cacheSize}`);

    return {
      status: 'success',
      message: 'Datos de prueba insertados',
      cacheSize,
      results,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    this.logger.error('❌ Error insertando datos de prueba:', error);
    throw error;
  }
}

@Get('test/verify')
async verifyTestData() {
  const localCache = this.redisService.getLocalCache();
  const entries = Array.from(localCache.entries());
  
  return {
    status: 'success',
    cacheSize: localCache.size,
    entries: entries.map(([key, value]) => ({
      key,
      value: value.data,
      timestamp: new Date(value.timestamp).toISOString(),
      expiresAt: new Date(value.expiresAt).toISOString(),
      timeToExpire: Math.max(0, value.expiresAt - Date.now()) / 1000 + 's'
    }))
  };
}



}
