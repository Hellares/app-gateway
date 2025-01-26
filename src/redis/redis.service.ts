import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { catchError, firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { CacheResponse } from './interfaces/cache-response.interface';
import { SERVICES } from 'src/transports/constants';
import { CONSOLE_COLORS } from 'src/common/constants/colors.constants';

@Injectable()
export class RedisService {
  private readonly logger = new Logger(`${CONSOLE_COLORS.TEXT.FUCHSIA}RedisService ${CONSOLE_COLORS.TEXT.YELLOW}`);
  private readonly timeoutMs = 5000;
  private isConnected = false;
  private connectionCheckInterval: NodeJS.Timeout;
  private reconnectionTimeout: NodeJS.Timeout | null = null;
  private readonly reconnectionInterval = 5000;  // 5 segundos
  private consecutiveFailures = 0;
  private readonly maxConsecutiveFailures = 3;

  private localCache: Map<string, any> = new Map(); // Implementación de caché local

  constructor(
    @Inject(SERVICES.REDIS) private readonly cacheClient: ClientProxy,
  ) {}

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
    }, 30000);
  }

  private async checkConnection() {
    try {
      const health = await this.healthCheck();
      
      if (health.status === 'healthy') {
        if (!this.isConnected) {
          this.isConnected = true;
          this.consecutiveFailures = 0;
          this.logger.log('✅ Conexión establecida con el servicio Redis');
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
          this.isConnected = true;
          this.consecutiveFailures = 0;
          if (this.reconnectionTimeout) {
            clearTimeout(this.reconnectionTimeout);
            this.reconnectionTimeout = null;
          }
        }
      } catch (error) {
        this.logger.warn('⚠️ Intento de reconexión fallido, reintentando en 5 segundos');
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
    try {
      this.validateKey(key);

      if (!this.isConnected) {
        this.logger.warn(`⚠️ Redis no disponible. Usando caché local para key: ${key}`);
        if (this.localCache.has(key)) {
          const data = this.localCache.get(key);
          this.logger.debug(`🔄 Caché local utilizado. Datos: ${JSON.stringify(data)}`);
          return { success: true, source: 'local', data };
        } else {
          this.logger.warn(`❌ Key no encontrada en caché local: ${key}`);
          return { success: false, source: 'local', error: 'Key not found in local cache' };
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

      this.logger.debug(`📥 Respuesta de caché para key ${key}: ${response.success ? 'hit' : 'miss'} (${response.source})`);
      return response;
    } catch (error) {
      return {
        success: false,
        error: 'Error al obtener caché',
        source: 'none'
      };
    }
  }

 
  async set<T>(key: string, value: T, ttl?: number): Promise<CacheResponse> {
    try {
      this.validateKey(key);
      
      if (!this.isConnected) {
        this.logger.warn(`⚠️ Redis no disponible. Guardando en caché local para key: ${key}`);
        this.localCache.set(key, value);
        this.logger.debug(`✅ Caché local actualizado para key: ${key}`);
        return { success: true, source: 'local' };
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

      // Eliminar la key correspondiente en el caché local tras actualizar en Redis
      if (this.localCache.has(key)) {
        this.localCache.delete(key);
        this.logger.debug(`🧹 Key eliminada del caché local tras actualizar en Redis: ${key}`);
      }

      return response;
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Error al establecer caché',
        source: 'none'
      };
    }
  }

  async clearLocalCache(): Promise<void> {
    this.localCache.clear();
    this.logger.log('🧹 Caché local limpiado');
  }
  

  async delete(key: string): Promise<CacheResponse> {
    try {
      return await firstValueFrom(
        this.cacheClient.send({ cmd: 'cache.delete' }, key)
          .pipe(timeout(this.timeoutMs))
      );
    } catch (error) {
      this.logger.warn(`Error deleting cache for key ${key}:`, error);
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
}