import { Get, Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { catchError, firstValueFrom, throwError, timeout, TimeoutError } from 'rxjs';
import { CacheResponse } from './interfaces/cache-response.interface';
import { SERVICES } from 'src/transports/constants';
import { CONSOLE_COLORS } from 'src/common/constants/colors.constants';
import { CacheMetrics } from './interfaces/cache-metrics.interface';

@Injectable()
export class RedisService {
  private readonly logger = new Logger(`${CONSOLE_COLORS.TEXT.FUCHSIA}RedisService ${CONSOLE_COLORS.TEXT.YELLOW}`);
  private readonly timeoutMs = 5000;
  private isConnected = false;
  private connectionCheckInterval: NodeJS.Timeout;
  private reconnectionTimeout: NodeJS.Timeout | null = null;
  private readonly reconnectionInterval = 2000;  //! 2 segundos para reconectar
  private consecutiveFailures = 0;
  private readonly maxConsecutiveFailures = 3;
  private localCache: Map<string, any> = new Map(); // Implementación de caché local

  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    totalOperations: 0,
    averageResponseTime: 0,
    lastResponseTime: 0,
    failedOperations: 0,
    successRate: 100,
    localCacheSize: 0,
    lastUpdated: new Date(),
    connectionStatus: {
      isConnected: false,
      consecutiveFailures: 0,
      lastConnectionAttempt: new Date()
    }
  };

  constructor(
    @Inject(SERVICES.REDIS) private readonly cacheClient: ClientProxy,
  ) {}

  async getMetrics(): Promise<CacheMetrics> {
    return {
      ...this.metrics,
      localCacheSize: this.localCache.size,
      successRate: this.calculateSuccessRate(),
      lastUpdated: new Date(),
      connectionStatus: {
        isConnected: this.isConnected,
        consecutiveFailures: this.consecutiveFailures,
        lastConnectionAttempt: new Date()
      }
    };
  }

  private calculateSuccessRate(): number {
    if (this.metrics.totalOperations === 0) return 100;
    return Number(((this.metrics.totalOperations - this.metrics.failedOperations) / 
      this.metrics.totalOperations * 100).toFixed(2));
  }

  private updateMetrics(operation: 'hit' | 'miss', responseTime: number, failed: boolean = false) {
    this.metrics.totalOperations++;
    this.metrics.lastResponseTime = responseTime;
    
    // Actualizar tiempo promedio de respuesta
    // this.metrics.averageResponseTime = Number(
    //   ((this.metrics.averageResponseTime * (this.metrics.totalOperations - 1) + responseTime) / 
    //   this.metrics.totalOperations).toFixed(2)
    // );
    this.metrics.averageResponseTime =
  (this.metrics.averageResponseTime * (this.metrics.totalOperations - 1) + responseTime) /
  this.metrics.totalOperations;

    if (failed) {
      this.metrics.failedOperations++;
    }

    if (operation === 'hit') {
      this.metrics.hits++;
    } else {
      this.metrics.misses++;
    }

    this.metrics.lastUpdated = new Date();
    this.metrics.localCacheSize = this.localCache.size;
  }

  async onModuleInit() {
    try {
      await this.initializeConnection();
    } catch (error) {
      this.logger.error('❌ Error en la inicialización:', error);
      this.attemptReconnection();
    }
  }

  async onModuleDestroy() {
    this.clearIntervals();
  }

  private clearIntervals() {
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
    }
    if (this.reconnectionTimeout) {
      clearTimeout(this.reconnectionTimeout);
      this.reconnectionTimeout = null;
    }
  }

  private async initializeConnection() {
    try {
      await this.cacheClient.connect();
      await this.startConnectionMonitoring();
    } catch (error) {
      this.logger.error('❌ Error al conectar:', error);
      throw error;
    }
  }

  private async startConnectionMonitoring() {
    await this.checkConnection();
    
    this.connectionCheckInterval = setInterval(async () => {
      await this.checkConnection();
    }, 10000); //! 10 segundos para verificar la conexión
  }

  private async checkConnection() {
    try {
      const health = await this.healthCheck();
      
      if (health.status === 'healthy') {
        const wasDisconnected = !this.isConnected;
        
        if (wasDisconnected) {
          this.isConnected = true;
          this.consecutiveFailures = 0;
          this.logger.log('✅ Conexión establecida con el servicio Redis');
          
          // Limpiamos ambas cachés cuando Redis vuelve a estar disponible
          try {
            // Primero limpiamos la caché local
            await this.clearLocalCache();
            this.logger.log('🧹 Caché local limpiado después de reconexión');
            
            // Luego limpiamos Redis de forma más robusta
            const response = await firstValueFrom(
              this.cacheClient.send({ cmd: 'cache.clear' }, {}).pipe(
                timeout(this.timeoutMs),
                catchError(error => {
                  this.logger.error('Error al limpiar Redis:', error);
                  return throwError(() => error);
                })
              )
            );
            
            if (response.success) {
              this.logger.log('🧹 Caché de Redis limpiado después de reconexión');
            } else {
              // Si no se pudo limpiar, vamos a intentar reconectar
              this.logger.warn('⚠️ No se pudo limpiar el caché de Redis después de reconexión');
              this.isConnected = false;
              await this.handleConnectionFailure('Fallo al limpiar caché de Redis');
            }
          } catch (error) {
            this.logger.error('❌ Error al limpiar cachés después de reconexión:', error);
            // Si hay error al limpiar, también tratamos como fallo de conexión
            this.isConnected = false;
            await this.handleConnectionFailure('Error al limpiar cachés');
          }
          
          if (this.reconnectionTimeout) {
            clearTimeout(this.reconnectionTimeout);
            this.reconnectionTimeout = null;
          }
        }
      } else {
        await this.handleConnectionFailure('Health check indica estado unhealthy');
      }
    } catch (error) {
      await this.handleConnectionFailure(error.message);
    }
}


  
  
  private async handleConnectionFailure(reason: string) {
    this.consecutiveFailures++;
    
    if (this.isConnected) {
      this.isConnected = false;
      this.logger.error(`❌ Conexión perdida con el servicio Redis: ${reason}`);
    } else {
      this.logger.warn(`⚠️ No se puede conectar al servicio Redis (Intento ${this.consecutiveFailures}): ${reason}`);
    }

    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      this.logger.error(`🔄 Iniciando reconexión después de ${this.consecutiveFailures} fallos consecutivos`);
      this.attemptReconnection();
    }
  }



  private attemptReconnection() {
    if (this.reconnectionTimeout) {
      return; // Ya hay una reconexión programada
    }

    const attemptReconnect = async () => {
      try {
        this.logger.debug('🔄 Intentando reconectar...');
        await this.cacheClient.connect();
        const health = await this.healthCheck();
        
        if (health.status === 'healthy') {
          this.logger.log('✅ Reconexión exitosa');
          
          // Asegurarnos de limpiar ambas cachés después de reconectar
          try {
            await this.clearLocalCache();
            const response = await firstValueFrom(
              this.cacheClient.send({ cmd: 'cache.clear' }, {}).pipe(
                timeout(this.timeoutMs)
              )
            );
            
            if (response.success) {
              this.isConnected = true;
              this.consecutiveFailures = 0;
              this.logger.log('🧹 Cachés limpiados después de reconexión');
            } else {
              throw new Error('No se pudo limpiar el caché de Redis');
            }
          } catch (error) {
            this.logger.error('❌ Error al limpiar cachés en reconexión:', error);
            // Programar nuevo intento
            this.reconnectionTimeout = setTimeout(attemptReconnect, this.reconnectionInterval);
            return;
          }
          
          if (this.reconnectionTimeout) {
            clearTimeout(this.reconnectionTimeout);
            this.reconnectionTimeout = null;
          }
        } else {
          throw new Error('Health check unhealthy después de reconexión');
        }
      } catch (error) {
        this.logger.warn('⚠️ Intento de reconexión fallido, reintentando en 2 segundos');
        this.reconnectionTimeout = setTimeout(attemptReconnect, this.reconnectionInterval);
      }
    };

    attemptReconnect();
}

  

  private validateKey(key: string): void {
    if (!key || typeof key !== 'string') {
      throw new Error('La key debe ser un string no vacío');
    }
    if (key.length > 512) {
      throw new Error('La key es demasiado larga');
    }
    if (!/^[\w:.-]+$/.test(key)) {
      throw new Error('La key contiene caracteres no válidos');
    }
  }

  
  async get<T>(key: string): Promise<CacheResponse<T>> {
    const startTime = Date.now();
    try {
      this.validateKey(key);

      if (!this.isConnected) {
        const hasLocalCache = this.localCache.has(key);
        this.updateMetrics(
          hasLocalCache ? 'hit' : 'miss', 
          Date.now() - startTime
        );

        if (hasLocalCache) {
          const data = this.localCache.get(key);
          this.logger.debug(`🔄 Caché local utilizado. Datos: ${JSON.stringify(data)}`);
          return { 
            success: true, 
            source: 'local', 
            data,
            details: {
              responseTime: Date.now() - startTime,
              cached: true,
              lastCheck: new Date().toISOString()
            }
          };
        } else {
          this.logger.warn(`❌ Key no encontrada en caché local: ${key}`);
          return { 
            success: false, 
            source: 'local', 
            error: 'Key not found in local cache',
            details: {
              responseTime: Date.now() - startTime,
              cached: false,
              lastCheck: new Date().toISOString()
            }
          };
        }
      }

      this.logger.debug(`📤 Solicitando caché para key: ${key}`);
      const response = await firstValueFrom(
        this.cacheClient.send({ cmd: 'cache.get' }, key).pipe(
          timeout(this.timeoutMs),
          catchError(error => {
            this.logger.error(`❌ Error en caché para key ${key}:`, error);
            throw error;
          })
        )
      );

      const operationTime = Date.now() - startTime;
      this.updateMetrics(
        response.success ? 'hit' : 'miss',
        operationTime
      );

      this.logger.debug(`📥 Respuesta de caché para key ${key}: ${response.success ? 'hit' : 'miss'} (${response.source})`);
      return {
        ...response,
        details: {
          ...response.details,
          responseTime: operationTime,
          lastCheck: new Date().toISOString()
        }
      };
    } catch (error) {
      const operationTime = Date.now() - startTime;
      this.updateMetrics('miss', operationTime, true);
      
      return {
        success: false,
        error: 'Error al obtener caché',
        source: 'none',
        details: {
          responseTime: operationTime,
          cached: false,
          lastCheck: new Date().toISOString(),
          lastError: error.message
        }
      };
    }
  }


  async set<T>(key: string, value: T, ttl?: number): Promise<CacheResponse> {
    try {
      this.validateKey(key);
      
      if (!this.isConnected) {
        this.logger.warn(`⚠️ Redis no disponible. Guardando en caché local para key: ${key}`);
        
        // Guardamos manteniendo las entradas existentes
        this.localCache.set(key, value);
        this.logger.debug(`✅ Caché local actualizado para key: ${key}, total entradas: ${this.localCache.size}`);
        
        return { 
          success: true, 
          source: 'local',
          details: {
            cached: true,
            lastCheck: new Date().toISOString(),
            cacheSize: this.localCache.size,
            key: key,
            localCacheInfo: {
              size: this.localCache.size,
              keys: Array.from(this.localCache.keys())
            }
          }
        };
      }

      this.logger.debug(`📤 Estableciendo caché para key: ${key} (TTL: ${ttl || 'default'})`);
      const response = await firstValueFrom(
        this.cacheClient.send({ cmd: 'cache.set' }, { key, value, ttl }).pipe(
          timeout(this.timeoutMs),
          catchError(error => {
            this.logger.error(`❌ Error estableciendo caché para key ${key}:`, error);
            throw error;
          })
        )
      );

      // Solo eliminamos la key específica si existe
      if (this.localCache.has(key)) {
        this.localCache.delete(key);
        this.logger.debug(`🧹 Key específica eliminada del caché local: ${key}`);
      }

      return {
        ...response,
        details: {
          ...response.details,
          lastCheck: new Date().toISOString(),
          cacheSize: this.localCache.size,
          key: key
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Error al establecer caché',
        source: 'none',
        details: {
          lastError: error.message,
          lastCheck: new Date().toISOString(),
          cacheSize: this.localCache.size,
          key: key
        }
      };
    }
}

  async clearLocalCache(): Promise<void> {
    this.localCache.clear();
    this.logger.log('🧹 Caché local limpiado');
  }
  

  // Modificamos el método delete
async delete(key: string): Promise<CacheResponse> {
  try {
      // Si la key termina en :*, es un patrón
      const isPattern = key.endsWith(':*');
      
      // Si Redis no está disponible, solo limpiamos el caché local
      if (!this.isConnected) {
          if (isPattern) {
              // Eliminamos el : final si existe
              const pattern = key.endsWith(':') ? key.slice(0, -1) : key;
              await this.clearLocalCacheByPattern(pattern);
          } else {
              this.localCache.delete(key);
              this.logger.debug(`🧹 Key eliminada del caché local: ${key}`);
          }
          return {
              success: true,
              source: 'local'
          };
      }

      // Intentamos eliminar en Redis
      const response = await firstValueFrom(
          this.cacheClient.send({ cmd: 'cache.delete' }, key)
              .pipe(timeout(this.timeoutMs))
      );

      // También limpiamos el caché local
      if (isPattern) {
          const pattern = key.endsWith(':') ? key.slice(0, -1) : key;
          await this.clearLocalCacheByPattern(pattern);
      } else {
          this.localCache.delete(key);
      }

      return response;
  } catch (error) {
      this.logger.warn(`Error deleting cache for key ${key}:`, error);
      
      // Si hay error, intentamos al menos limpiar el caché local
      if (key.endsWith(':*')) {
          const pattern = key.endsWith(':') ? key.slice(0, -1) : key;
          await this.clearLocalCacheByPattern(pattern);
      } else {
          this.localCache.delete(key);
      }
      
      return {
          success: false,
          error: error.message || 'Failed to delete cache',
          source: 'none'
      };
  }
}

  async exists(key: string): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.cacheClient.send({ cmd: 'cache.exists' }, key)
          .pipe(timeout(this.timeoutMs))
      );
      return response.exists;
    } catch (error) {
      this.logger.warn(`Error checking cache existence for key ${key}:`, error);
      return false;
    }
  }

 
  async clearAll(): Promise<CacheResponse> {
    try {
      await this.clearLocalCache();
      return await firstValueFrom(
        this.cacheClient.send({ cmd: 'cache.clear' }, {}).pipe(timeout(this.timeoutMs))
      );
    } catch (error) {
      this.logger.warn('Error clearing cache:', error);
      return {
        success: false,
        error: error.message || 'Failed to clear cache',
        source: 'none'
      };
    }
  }

  async healthCheck(): Promise<any> {
    try {
      this.logger.debug('🏥 Iniciando health check de Redis');

      const health = await firstValueFrom(
        this.cacheClient.send({ cmd: 'cache.health' }, {}).pipe(
          timeout(this.timeoutMs),
          catchError(error => {
            this.logger.error('Error en health check:', {
              error: error.message,
              stack: error.stack,
              isTimeout: error instanceof TimeoutError,
              code: error.code,
              status: error.status,
              consecutiveFailures: this.consecutiveFailures
            });
            throw error;
          })
        )
      );
      
      this.logger.debug('✅ Health check completado:', health);
      
      return {
        ...health,
        gatewayConnection: this.isConnected,
        timestamp: new Date().toISOString(),
        consecutiveFailures: this.consecutiveFailures
      };
    } catch (error) {
      const errorDetails = {
        message: error.message || 'Error desconocido',
        isTimeout: error instanceof TimeoutError,
        type: error.constructor.name,
        code: error.code,
        status: error.status,
        consecutiveFailures: this.consecutiveFailures
      };

      this.logger.error(`❌ Health check fallido:`, errorDetails);

      return {
        status: 'unhealthy',
        error: errorDetails.message,
        errorDetails,
        gatewayConnection: this.isConnected,
        microserviceConnection: false,
        timestamp: new Date().toISOString(),
        circuitBreaker: 'unknown',
        consecutiveFailures: this.consecutiveFailures
      };
    }
  }

  // Primero agregamos el método para limpiar caché local por patrón
async clearLocalCacheByPattern(pattern: string): Promise<void> {
  const keysToDelete: string[] = [];
  
  // Convertimos el patrón de Redis a una expresión regular
  const regexPattern = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  
  // Buscamos todas las keys que coincidan con el patrón
  for (const key of this.localCache.keys()) {
      if (regexPattern.test(key)) {
          keysToDelete.push(key);
      }
  }
  
  // Eliminamos las keys encontradas
  keysToDelete.forEach(key => {
      this.localCache.delete(key);
      this.logger.debug(`🧹 Key eliminada del caché local por patrón: ${key}`);
  });
  
  if (keysToDelete.length > 0) {
      this.logger.log(`🧹 Se eliminaron ${keysToDelete.length} keys del caché local usando el patrón: ${pattern}`);
  }
}

getLocalCache(): Map<string, any> {
  return this.localCache;
}
}