import { Get, Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { catchError, firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { CacheResponse } from './interfaces/cache-response.interface';
import { CacheMetrics, DetailedCacheMetrics, ServiceMetrics } from './interfaces/cache-metrics.interface';
import { SERVICES } from 'src/transports/constants';
import { 
  REDIS_GATEWAY_CONFIG, 
  REDIS_SERVICE_STATE, 
  REDIS_ERROR_TYPE,
  CACHE_RESPONSE_TYPE
} from './config/redis.constants';
import { LocalCacheEntry } from './interfaces/local-cache.interface';
import { HealthCheckResponse } from './interfaces/health-check.interface';
import { CACHE_KEYS } from './constants/redis-cache.keys.contants';



@Injectable()
export class RedisService {
  private readonly logger = new Logger('RedisService');
  private readonly timeoutMs = REDIS_GATEWAY_CONFIG.TIMEOUTS.OPERATION;
  private serviceState = REDIS_SERVICE_STATE.DISCONNECTED;
  private healthCheckInterval: NodeJS.Timeout;
  private connectionCheckInterval: NodeJS.Timeout;
  private consecutiveFailures = 0;
  private lastOnlineTime?: Date;
  localCache: Map<string, LocalCacheEntry> = new Map();
  private readonly serviceStartTime = Date.now();

  // Métricas separadas para online/offline
  private onlineMetrics: ServiceMetrics = this.initializeServiceMetrics();
  private offlineMetrics: ServiceMetrics = this.initializeServiceMetrics();

  // Mantener compatibilidad con la estructura actual
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
    },
  };

  

  
  constructor(
    @Inject(SERVICES.REDIS) private readonly cacheClient: ClientProxy,
  ) {}

  async onModuleInit() {
    await this.initializeService();
    this.startHealthCheck();
  }

  async onModuleDestroy() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
  }

  private initializeServiceMetrics(): ServiceMetrics {
    return {
      hits: 0,
      misses: 0,
      totalOperations: 0,
      averageResponseTime: 0,
      lastResponseTime: 0,
      failedOperations: 0,
      successRate: 100,
    };

  }


  private async initializeService() {
    try {
      this.logger.log('🔄 Iniciando servicio Redis...');
      this.serviceState = REDIS_SERVICE_STATE.CONNECTING;
  
      await this.cacheClient.connect();
      const healthCheck = await this.healthCheck();
      await this.checkConnectionLoop();
  
      if (healthCheck.status !== 'healthy') throw new Error('Health check inicial fallido');
  
      Object.assign(this, {
        serviceState: REDIS_SERVICE_STATE.CONNECTED,
        consecutiveFailures: 0,
        lastOnlineTime: new Date()
      });
  
      this.logger.log('✅ Servicio Redis inicializado correctamente');
    } catch (error) {
      this.serviceState = REDIS_SERVICE_STATE.ERROR;
      this.logger.error('❌ Error inicializando el servicio Redis:', error);
      this.attemptReconnection();
    }
  }

  private async startConnectionMonitoring() {
    this.logger.debug('📡 Iniciando monitoreo de conexión con Redis...');
    await this.checkConnection();
    
    this.connectionCheckInterval = setInterval(async () => {
      this.logger.debug('🔄 Ejecutando checkConnection...');
      await this.checkConnection();
    }, 10000);
  }

 

  private startHealthCheck() {
    if (REDIS_GATEWAY_CONFIG.HEALTH_CHECK.ENABLED) {
      this.healthCheckInterval = setInterval(async () => {
        const health = await this.healthCheck();
        if (health.status !== 'healthy') {
          this.logger.warn(`⚠️ Health check fallido: ${health.error}`);
        }
      }, REDIS_GATEWAY_CONFIG.HEALTH_CHECK.INTERVAL);
      
      this.logger.log(`✅ Health check iniciado - Intervalo: ${REDIS_GATEWAY_CONFIG.HEALTH_CHECK.INTERVAL}ms`);
    }
  }

  private getTimeOffline(): number | undefined {
    // Si está conectado, no hay tiempo offline
    if (this.serviceState === REDIS_SERVICE_STATE.CONNECTED) {
      return 0;
    }
  
    // Si no tenemos última vez online pero tenemos estado de error,
    // usamos el tiempo desde el inicio del servicio
    if (!this.lastOnlineTime && this.serviceState === REDIS_SERVICE_STATE.ERROR) {
      return Date.now() - this.serviceStartTime;
    }
  
    // Si tenemos última vez online, calculamos desde ahí
    if (this.lastOnlineTime) {
      return Date.now() - this.lastOnlineTime.getTime();
    }
  
    return undefined;
  }
  

  private formatTimeOffline(): string {
    const timeOffline = this.getTimeOffline();
    
    if (this.serviceState === REDIS_SERVICE_STATE.CONNECTED) {
      return '0s';
    }
    
    if (timeOffline === undefined) {
      return 'estado desconocido';
    }
  
    const seconds = Math.floor(timeOffline / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
  
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  private getBackoffDelay(): number {
    const { INITIAL_RETRY_DELAY, MAX_RETRY_DELAY, FACTOR } = REDIS_GATEWAY_CONFIG.ERROR_HANDLING.BACKOFF;
    const exponentialDelay = INITIAL_RETRY_DELAY * Math.pow(FACTOR, Math.min(this.consecutiveFailures, 5));
    return Math.min(exponentialDelay, MAX_RETRY_DELAY);
  }

  private getDisplayedFailures(): number {
    return Math.min(this.consecutiveFailures, REDIS_GATEWAY_CONFIG.ERROR_HANDLING.MAX_DISPLAYED_FAILURES);
  }

  private attemptReconnection() {
    if (this.serviceState === REDIS_SERVICE_STATE.CONNECTING) {
      return;
    }

    this.logger.log('🔄 Iniciando reconexión...');
    this.serviceState = REDIS_SERVICE_STATE.CONNECTING;

    setTimeout(async () => {
      try {
        const healthCheck = await this.healthCheck();
        if (healthCheck.status === 'healthy') {
          this.logger.log('✅ Reconexión exitosa');
          this.serviceState = REDIS_SERVICE_STATE.CONNECTED;
          this.consecutiveFailures = 0;
          this.lastOnlineTime = new Date();
        } else {
          throw new Error('Health check fallido en reconexión');
        }
      } catch (error) {
        this.logger.warn(`⚠️ Reconexión fallida (intento ${this.consecutiveFailures}), próximo intento en ${this.getBackoffDelay()}ms`);
        this.attemptReconnection();
      }
    }, this.getBackoffDelay());
  }

  private validateKey(key: string): void {
    if (!key || typeof key !== 'string') {
      throw new Error('La key debe ser un string no vacío');
    }
    if (key.length > REDIS_GATEWAY_CONFIG.PATTERNS.MAX_KEY_LENGTH) {
      throw new Error(`La key excede el máximo de ${REDIS_GATEWAY_CONFIG.PATTERNS.MAX_KEY_LENGTH} caracteres`);
    }
    if (!REDIS_GATEWAY_CONFIG.PATTERNS.VALID_KEY_REGEX.test(key)) {
      throw new Error('La key contiene caracteres no válidos');
    }
  }

  private async checkConnection() {
    try {
      this.logger.debug('🔍 Verificando conexión con Redis...');
          const response = await firstValueFrom(
        this.cacheClient.send(
          { cmd: REDIS_GATEWAY_CONFIG.COMMANDS.HEALTH }, 
          {}
        ).pipe(timeout(REDIS_GATEWAY_CONFIG.HEALTH_CHECK.TIMEOUT))
      );
  
      if (response.status !== 'healthy') {
        throw new Error('Health check indica estado unhealthy');
      }
  
      if (this.serviceState !== REDIS_SERVICE_STATE.CONNECTED) {
        this.logger.log('✅ Conexión con Redis restablecida');
        await this.handleReconnection();
      }
  
      Object.assign(this, {
        serviceState: REDIS_SERVICE_STATE.CONNECTED,
        lastOnlineTime: new Date(),
        consecutiveFailures: 0
      });
  
    } catch (error) {
      await this.handleConnectionFailure(error);
    }
  }

  private async handleReconnection() {
    this.logger.log('🔄 Iniciando proceso de reconexión...');
    
    try {
      // Limpiar caché local primero
      this.localCache.clear();
      this.logger.log('🧹 Caché local limpiado');
  
      // Intentar limpiar Redis
      const response = await firstValueFrom(
        this.cacheClient.send(
          { cmd: REDIS_GATEWAY_CONFIG.COMMANDS.CLEAR }, 
          {}
        ).pipe(
          timeout(REDIS_GATEWAY_CONFIG.TIMEOUTS.OPERATION)
        )
      );
  
      if (response.success) {
        this.logger.log('🧹 Redis limpiado correctamente');
      } else {
        throw new Error('Fallo al limpiar Redis');
      }
  
      // Reinicializar métricas con todas las propiedades requeridas
      const baseMetrics = this.initializeServiceMetrics();
      this.metrics = {
        ...baseMetrics,
        localCacheSize: this.localCache.size,
        lastUpdated: new Date(),
        connectionStatus: {
          isConnected: true,
          consecutiveFailures: 0,
          lastConnectionAttempt: new Date()
        },
        online: {
          ...baseMetrics,
          successRate: 100
        },
        offline: {
          ...baseMetrics,
          successRate: 100
        },
        lastOnlineTime: new Date(),
        timeOffline: 0,
        timeOfflineFormatted: '0s'
      };
      
      this.logger.log('✅ Reconexión completada exitosamente');
    } catch (error) {
      this.logger.error('❌ Error durante la reconexión:', error);
      throw error;
    }
  }
  
  private async handleConnectionFailure(error: Error) {
    this.consecutiveFailures++;
    
    if (this.serviceState === REDIS_SERVICE_STATE.CONNECTED) {
      this.serviceState = REDIS_SERVICE_STATE.ERROR;
      this.logger.error(`❌ Conexión perdida con Redis: ${error.message}`);
    }
  
    const backoffDelay = this.getBackoffDelay();
    this.logger.warn(
      `⚠️ Fallo de conexión (${this.consecutiveFailures}/${REDIS_GATEWAY_CONFIG.ERROR_HANDLING.MAX_RETRIES})`,
      {
        error: error.message,
        nextRetry: `${backoffDelay}ms`,
        state: this.serviceState
      }
    );
  
    if (this.consecutiveFailures >= REDIS_GATEWAY_CONFIG.ERROR_HANDLING.MAX_RETRIES) {
      this.attemptReconnection();
    }
  }

  // private updateMetrics(operation: 'hit' | 'miss', responseTime: number, failed = false) {
  //   if (responseTime <= 0){
  //     responseTime = 0.1; // valor minimo para evitar 0 o negativos
  //   }
  
  //   const metrics = this.serviceState === REDIS_SERVICE_STATE.CONNECTED 
  //     ? this.onlineMetrics 
  //     : this.offlineMetrics;

  //   metrics.totalOperations++;
  //   metrics.lastResponseTime = responseTime;

  //   // metrics.averageResponseTime = 
  //   //   ((metrics.averageResponseTime * (metrics.totalOperations - 1)) + responseTime) / metrics.totalOperations;
  //   // Cálculo correcto del promedio
  //   metrics.averageResponseTime = metrics.averageResponseTime === null 
  //     ? responseTime 
  //     : ((metrics.averageResponseTime * (metrics.totalOperations - 1)) + responseTime) / metrics.totalOperations;
  
  //   if (failed) metrics.failedOperations++;
  //   metrics[operation === 'hit' ? 'hits' : 'misses']++;
  
  //   metrics.successRate = this.calculateSuccessRate(metrics);
  //   Object.assign(this.metrics, {
  //     hits: this.onlineMetrics.hits + this.offlineMetrics.hits,
  //     misses: this.onlineMetrics.misses + this.offlineMetrics.misses,
  //     totalOperations: this.onlineMetrics.totalOperations + this.offlineMetrics.totalOperations,
  //     failedOperations: this.onlineMetrics.failedOperations + this.offlineMetrics.failedOperations,
  //     averageResponseTime: responseTime, // Aseguramos que nunca sea null
  //     lastResponseTime: responseTime,    // Aseguramos que nunca sea null
  //     successRate: this.calculateTotalSuccessRate(),
  //     localCacheSize: this.localCache.size,
  //     lastUpdated: new Date(),
  //     connectionStatus: {
  //       isConnected: this.serviceState === REDIS_SERVICE_STATE.CONNECTED,
  //       consecutiveFailures: this.getDisplayedFailures(),
  //       lastConnectionAttempt: new Date()
  //     }
  //   });
  // }

  private updateMetrics(operation: 'hit' | 'miss', responseTime: number, failed = false) {
    // Asegurar que responseTime sea un número válido
    const validResponseTime = responseTime <= 0 ? 0.1 : responseTime;
  
    const metrics = this.serviceState === REDIS_SERVICE_STATE.CONNECTED 
      ? this.onlineMetrics 
      : this.offlineMetrics;
  
    metrics.totalOperations++;
    metrics.lastResponseTime = validResponseTime;
  
    // Calcular el promedio asegurando valores numéricos
    if (metrics.averageResponseTime === null || isNaN(metrics.averageResponseTime)) {
      metrics.averageResponseTime = validResponseTime;
    } else {
      metrics.averageResponseTime = 
        ((metrics.averageResponseTime * (metrics.totalOperations - 1)) + validResponseTime) / 
        metrics.totalOperations;
    }
  
    if (failed) metrics.failedOperations++;
    metrics[operation === 'hit' ? 'hits' : 'misses']++;
    metrics.successRate = this.calculateSuccessRate(metrics);
  
    // Actualizar métricas globales asegurando valores numéricos
    Object.assign(this.metrics, {
      hits: this.onlineMetrics.hits + this.offlineMetrics.hits,
      misses: this.onlineMetrics.misses + this.offlineMetrics.misses,
      totalOperations: this.onlineMetrics.totalOperations + this.offlineMetrics.totalOperations,
      failedOperations: this.onlineMetrics.failedOperations + this.offlineMetrics.failedOperations,
      averageResponseTime: Number(metrics.averageResponseTime.toFixed(2)), // Asegurar número con 2 decimales
      lastResponseTime: validResponseTime,
      successRate: this.calculateTotalSuccessRate(),
      localCacheSize: this.localCache.size,
      lastUpdated: new Date(),
      connectionStatus: {
        isConnected: this.serviceState === REDIS_SERVICE_STATE.CONNECTED,
        consecutiveFailures: this.getDisplayedFailures(),
        lastConnectionAttempt: new Date()
      }
    });
  }

  private calculateSuccessRate(metrics: ServiceMetrics): number {
    if (metrics.totalOperations === 0) return 100;
    return Number(
      ((metrics.totalOperations - metrics.failedOperations) / 
      metrics.totalOperations * 100).toFixed(2)
    );
  }

  private calculateTotalSuccessRate(): number {
    const totalOps = this.onlineMetrics.totalOperations + this.offlineMetrics.totalOperations;
    const totalFails = this.onlineMetrics.failedOperations + this.offlineMetrics.failedOperations;
    
    if (totalOps === 0) return 100;
    return Number(((totalOps - totalFails) / totalOps * 100).toFixed(2));
  }


  async get<T>(key: string): Promise<CacheResponse<T>> {
    const startTime = Date.now();

    try {
      this.validateKey(key);
  
      // 1. Primero verificar caché local
      const localValue = this.getFromLocalCache<T>(key, startTime);
      if (localValue.success) {
        this.logger.debug(`💾 Cache hit local: ${key}`);
        return localValue;
      }
  
      // 2. Si no está en local, buscar en Redis
      const redisResponse = await this.getFromRedis<T>(key);
      
      // 3. Si se encontró en Redis, guardar en caché local
      if (redisResponse.success && redisResponse.data) {
        this.logger.debug(`📝 Guardando en caché local desde Redis: ${key}`);
        this.setInLocalCache(
          key, 
          redisResponse.data, 
          startTime, 
          this.extractTTL(redisResponse)
        );
      }
      return redisResponse;
  
    } catch (error) {
      if (error instanceof TimeoutError) {
        this.serviceState = REDIS_SERVICE_STATE.ERROR;
        this.consecutiveFailures++;
        return this.getFromLocalCache<T>(key, startTime);
      }
      return this.handleError<T>(error, startTime, key);
    }
  }
  
  //Método auxiliar para extraer TTL
  private extractTTL(response: CacheResponse): number {
    return response.details?.ttl || REDIS_GATEWAY_CONFIG.TTL.DEFAULT;
  }
  
  private async getFromRedis<T>(key: string): Promise<CacheResponse<T>> {
    const response = await firstValueFrom<CacheResponse<T>>(
      this.cacheClient.send<CacheResponse<T>>(
        { cmd: REDIS_GATEWAY_CONFIG.COMMANDS.GET }, key
      ).pipe(timeout(REDIS_GATEWAY_CONFIG.TIMEOUTS.OPERATION))
    );
  
    this.updateMetrics('hit', Date.now() - response.details.responseTime);
    return {
      ...response,
      details: {
        ...response.details,
        responseTime: Date.now() - response.details.responseTime,
        lastCheck: new Date().toISOString()
      }
    };
  }


  getFromLocalCache<T>(key: string, startTime: number): CacheResponse<T> {
    const entry = this.localCache.get(key);
    const now = Date.now();
  
  if (entry && entry.expiresAt > now) {

      this.updateMetrics('hit', now - startTime);
      return {
        success: true,
        source: 'local',
        data: entry.data as T,
        details: {
          responseTime: now - startTime,
          cached: true,
          lastCheck: new Date().toISOString(),
          age: now - entry.timestamp
        }
      };
    }
  
    if (entry) this.localCache.delete(key);
  
    this.updateMetrics('miss', now - startTime);
    return {
      success: false,
      source: 'local',
      error: entry ? 'Cache entry expired' : 'Key not found in local cache',
      details: {
        responseTime: now - startTime,
        cached: false,
        lastCheck: new Date().toISOString()
      }
    };
  }

  private handleError<T>(error: any, startTime: number, key?: string): CacheResponse<T> {
    const responseTime = Date.now() - startTime;
    this.updateMetrics('miss', responseTime, true);
    
    // Si el error es de conexión/timeout y tenemos la key, intentamos usar caché local
    if (key && (error instanceof TimeoutError || this.serviceState !== REDIS_SERVICE_STATE.CONNECTED)) {
      this.logger.warn(`⚠️ Error de conexión - Intentando usar caché local para key: ${key}`);
      return this.getFromLocalCache<T>(key, startTime);
    }
  
    return {
      success: false,
      error: error.message,
      source: 'none',
      details: {
        responseTime,
        cached: false,
        lastCheck: new Date().toISOString(),
        errorType: error instanceof TimeoutError ? 
          REDIS_ERROR_TYPE.TIMEOUT : 
          REDIS_ERROR_TYPE.UNKNOWN,
        timeOffline: this.getTimeOffline(),
        timeOfflineFormatted: this.formatTimeOffline()
      }
    };
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<CacheResponse> {
    const startTime = Date.now();
    try {
      this.validateKey(key);
  
      // Si Redis está conectado, guardar solo en Redis inicialmente
      if (this.serviceState === REDIS_SERVICE_STATE.CONNECTED) {
        this.logger.debug(`💾 Guardando en Redis: ${key}`);
        
        const response = await firstValueFrom<CacheResponse>(
          this.cacheClient.send(
            { cmd: REDIS_GATEWAY_CONFIG.COMMANDS.SET }, 
            { 
              key, 
              value, 
              ttl: REDIS_GATEWAY_CONFIG.TTL.DEFAULT 
            }
          ).pipe(timeout(this.timeoutMs))
        );
  
        if (response.success) {
          this.logger.debug(`✅ Dato guardado exitosamente en Redis: ${key}`);
        }
  
        this.updateMetrics('hit', Date.now() - startTime);
        
        return {
          ...response,
          details: {
            ...response.details,
            responseTime: Date.now() - startTime,
            lastCheck: new Date().toISOString()
          }
        };
      }
  
      // En modo offline, usar solo caché local
      this.logger.debug(`⚠️ Redis offline - Guardando solo en caché local: ${key}`);
      return this.setInLocalCache(key, value, startTime, ttl);
    } catch (error) {
      this.logger.error(`❌ Error guardando dato - Key: ${key}`, error);
      return this.handleError(error, startTime, key);
    }
  }



  setInLocalCache(key: string, value: any, startTime: number, ttl?: number): CacheResponse {
    this.logger.debug(`🔄 Iniciando guardado en caché local - Key: ${key}`);
    
    // Verificar y limpiar si es necesario
    if (this.localCache.size >= REDIS_GATEWAY_CONFIG.LOCAL_CACHE.MAX_SIZE) {
      const deletedKey = this.localCache.keys().next().value;
      this.localCache.delete(deletedKey);
      this.logger.debug(`🧹 Limpiando caché local - Eliminada key: ${deletedKey}`);
    }
  
    // Calcular TTL
    const expiresAt = Date.now() + ((REDIS_GATEWAY_CONFIG.LOCAL_CACHE.TTL) * 1000);
    
    // Guardar en caché local
    this.localCache.set(key, {
      data: value,
      timestamp: Date.now(),
      expiresAt
    });
  
    this.logger.debug(`✅ Dato guardado en caché local - Key: ${key}, Expires: ${new Date(expiresAt).toISOString()}`);
    this.updateMetrics('hit', Date.now() - startTime);
    
    return {
      success: true,
      source: 'local',
      data: value,
      details: {
        responseTime: Date.now() - startTime,
        cached: true,
        lastCheck: new Date().toISOString(),
        cacheSize: this.localCache.size,
        localCacheInfo: {
          size: this.localCache.size,
          keys: Array.from(this.localCache.keys())
        }
      }
    };
  }
  
  

  async delete(key: string): Promise<CacheResponse> {
    const startTime = Date.now();
    try {
      this.validateKey(key);
      this.localCache.delete(key);

      if (this.serviceState !== REDIS_SERVICE_STATE.CONNECTED) {
        return {
          success: true,
          source: 'local',
          details: {
            responseTime: Date.now() - startTime,
            lastCheck: new Date().toISOString(),
            partialDeletion: true
          }
        };
      }

      const response = await firstValueFrom<CacheResponse>(
        this.cacheClient.send(
          { cmd: REDIS_GATEWAY_CONFIG.COMMANDS.DEL }, 
          key
        ).pipe(
          timeout(this.timeoutMs)
        )
      );

      this.updateMetrics('hit', Date.now() - startTime);
      return response;

    } catch (error) {
      return this.handleError(error, startTime);
    }
  }

  async clearAll(): Promise<CacheResponse> {
    const startTime = Date.now();
    try {
      this.localCache.clear();

      if (this.serviceState !== REDIS_SERVICE_STATE.CONNECTED) {
        return {
          success: true,
          source: 'local',
          details: {
            responseTime: Date.now() - startTime,
            lastCheck: new Date().toISOString(),
            partialClear: true
          }
        };
      }

      const response = await firstValueFrom<CacheResponse>(
        this.cacheClient.send(
          { cmd: REDIS_GATEWAY_CONFIG.COMMANDS.CLEAR }, 
          {}
        ).pipe(
          timeout(this.timeoutMs)
        )
      );

      this.updateMetrics('hit', Date.now() - startTime);
      return response;

    } catch (error) {
      return this.handleError(error, startTime);
    }
  }

  public async healthCheck(): Promise<HealthCheckResponse> {
    const startTime = Date.now();
    try {
      if (!REDIS_GATEWAY_CONFIG.HEALTH_CHECK.ENABLED) {
        return { 
          status: 'disabled',
          serviceState: this.serviceState,
          timestamp: new Date().toISOString(),
          responseTime: 0
        };
      }
  
      if (this.serviceState === REDIS_SERVICE_STATE.ERROR && 
          this.consecutiveFailures >= REDIS_GATEWAY_CONFIG.ERROR_HANDLING.MAX_RETRIES) {
        return this.getOfflineHealthStatus(startTime);
      }
  
      const response = await firstValueFrom(
        this.cacheClient.send(
          { cmd: REDIS_GATEWAY_CONFIG.COMMANDS.HEALTH }, 
          {}
        ).pipe(
          timeout(REDIS_GATEWAY_CONFIG.HEALTH_CHECK.TIMEOUT),
          catchError(error => {
            this.logger.error('Health check error:', {
              error: error.message,
              isTimeout: error instanceof TimeoutError,
              consecutiveFailures: this.consecutiveFailures
            });
            throw error;
          })
        )
      );
  
      if (response.status !== 'healthy') {
        throw new Error('Microservicio reporta estado no saludable');
      }
  
      const wasOffline = this.serviceState !== REDIS_SERVICE_STATE.CONNECTED;
      this.serviceState = REDIS_SERVICE_STATE.CONNECTED;
      this.consecutiveFailures = 0;
      this.lastOnlineTime = new Date();
  
      if (wasOffline) {
        this.logger.log('🔄 Servicio restaurado - Iniciando limpieza de cachés');
        try {
          await this.clearAll();
        } catch (error) {
          this.logger.warn('⚠️ Error al limpiar cachés después de reconexión:', error);
        }
      }
  
      const responseTime = Date.now() - startTime;
      this.updateMetrics('hit', responseTime);
  
      const healthResponse: HealthCheckResponse = {
        status: 'healthy',
        serviceState: this.serviceState,
        responseTime,
        timestamp: new Date().toISOString(),
        timeOfflineFormatted: this.formatTimeOffline(),
        metrics: await this.getMetrics(),
        details: {
          redisConnected: true,
          lastCheck: new Date().toISOString(),
          responseTime,
          consecurityFailures: this.consecutiveFailures
        }
      };
  
      return healthResponse;
  
    } catch (error) {
      this.logger.error('❌ Health check fallido:', {
        error: error.message,
        consecutiveFailures: this.consecutiveFailures,
        serviceState: this.serviceState
      });
      return this.getOfflineHealthStatus(startTime);
    }
  }
  

  private async getOfflineHealthStatus(startTime: number): Promise<any> {
    const responseTime = Date.now() - startTime;
    this.consecutiveFailures = Math.min(
      this.consecutiveFailures + 1,
      REDIS_GATEWAY_CONFIG.ERROR_HANDLING.MAX_DISPLAYED_FAILURES
    );
    
    if (this.consecutiveFailures >= REDIS_GATEWAY_CONFIG.ERROR_HANDLING.MAX_RETRIES) {
      this.serviceState = REDIS_SERVICE_STATE.ERROR;
    }
  
    const timeOfflineFormatted = this.formatTimeOffline();
    this.updateMetrics('miss', responseTime, true);
    
    return {
      status: 'unhealthy',
      error: `Redis no disponible - Modo fallback activado - Offline por ${timeOfflineFormatted}`,
      serviceState: this.serviceState,
      consecutiveFailures: this.getDisplayedFailures(),
      responseTime,
      nextRetryIn: this.getBackoffDelay(),
      timestamp: new Date().toISOString(),
      timeOfflineFormatted,
      metrics: await this.getMetrics()
    };
  }
  

  async getMetrics(): Promise<CacheMetrics> {
    return {
      ...this.metrics,
      online: this.onlineMetrics,
      offline: this.offlineMetrics,
      lastOnlineTime: this.lastOnlineTime,
      timeOffline: this.getTimeOffline(),
      timeOfflineFormatted: this.formatTimeOffline(), // Añadido
      connectionStatus: {
        isConnected: this.serviceState === REDIS_SERVICE_STATE.CONNECTED,
        consecutiveFailures: this.getDisplayedFailures(),
        lastConnectionAttempt: new Date()
      }
    };
  }

  getLocalCache(): Map<string, any> {
    return this.localCache;
  }

  

  getLocalCacheDetails() {
    const cacheDetails = {
      size: this.localCache.size,
      lastUpdated: new Date().toISOString(),
      maxSize: REDIS_GATEWAY_CONFIG.LOCAL_CACHE.MAX_SIZE,
      usagePercentage: (this.localCache.size / REDIS_GATEWAY_CONFIG.LOCAL_CACHE.MAX_SIZE * 100).toFixed(2),
      entries: {} as Record<string, any>
    };

    for (const [key, value] of this.localCache.entries()) {
      cacheDetails.entries[key] = {
        type: typeof value,
        isArray: Array.isArray(value),
        size: JSON.stringify(value).length,
        hasMetadata: value?.metadata !== undefined,
        metadata: value?.metadata || {},
        lastModified: new Date().toISOString(),
        keyPattern: this.getKeyPattern(key)
      };
    }

    return {
      ...cacheDetails,
      summary: {
        patterns: this.summarizeKeyPatterns(Object.keys(cacheDetails.entries)),
        totalSize: Object.values(cacheDetails.entries)
          .reduce((acc, entry) => acc + (entry.size || 0), 0),
        avgEntrySize: Math.round(
          Object.values(cacheDetails.entries)
            .reduce((acc, entry) => acc + (entry.size || 0), 0) / 
          Math.max(Object.keys(cacheDetails.entries).length, 1)
        )
      }
    };
  }

  // private getKeyPattern(key: string): string {
  //   return key.replace(/\d+/g, '');
  // }

  private getKeyPattern(key: string): string {
    // Detectar patrones basados en CACHE_KEYS
    for (const [category, patterns] of Object.entries(CACHE_KEYS)) {
      for (const [type, pattern] of Object.entries(patterns)) {
        if (typeof pattern === 'string' && key.startsWith(pattern)) {
          return `${category}.${type}`;
        }
      }
    }
    return key.replace(/[\d-]+/g, '*');
  }

  private summarizeKeyPatterns(keys: string[]): Record<string, number> {
    const patterns: Record<string, number> = {};
    
    for (const key of keys) {
      const pattern = this.getKeyPattern(key);
      patterns[pattern] = (patterns[pattern] || 0) + 1;
    }
    
    return patterns;
  }

  private async checkConnectionLoop() {
    this.logger.debug('📡 Iniciando monitoreo de conexión con Redis...');
    await this.checkConnection();
  
    const runCheck = async () => {
      this.logger.debug('🔄 Ejecutando checkConnection...');
      await this.checkConnection();
      this.connectionCheckInterval = setTimeout(runCheck, 10000);
    };
  
    runCheck();
  }  

  async getDetailedMetrics(): Promise<DetailedCacheMetrics> {
    const now = Date.now();
    const totalHits = 0;
    const oldestEntry = now;
    const newestEntry = 0;
    let memoryUsageEstimate = 0;
    const patterns: Record<string, number> = {};

    const entries = Array.from(this.localCache.entries()).map(([key, entry]) => {
      const age = now - entry.timestamp;
      const pattern = this.getKeyPattern(key);
      patterns[pattern] = (patterns[pattern] || 0) + 1;
      
      // Estimación del tamaño en memoria
      const entrySize = JSON.stringify(entry.data).length * 2;
      memoryUsageEstimate += entrySize;

      const expiresIn = entry.expiresAt ? entry.expiresAt - now : undefined;

      return {
        key,
        hits: this.getHitsForKey(key),
        age,
        size: entrySize,
        expiresIn: expiresIn > 0 ? expiresIn : undefined,
        pattern,
        metadata: entry.metadata
      };
    });

    const metrics = await this.getMetrics();

    return {
      ...metrics,
      localCache: {
        size: this.localCache.size,
        maxSize: REDIS_GATEWAY_CONFIG.LOCAL_CACHE.MAX_SIZE,
        usagePercentage: (this.localCache.size / REDIS_GATEWAY_CONFIG.LOCAL_CACHE.MAX_SIZE) * 100,
        oldestEntry: this.localCache.size > 0 ? oldestEntry : null,
        newestEntry: this.localCache.size > 0 ? newestEntry : null,
        hitRatio: this.calculateHitRatio(),
        averageHits: this.calculateAverageHits(),
        totalHits: this.getTotalHits(),
        memoryUsageEstimate,
        patterns
      },
      entries: entries.sort((a, b) => b.hits - a.hits)
    };
  }

   

  private getHitsForKey(key: string): number {
    const metrics = this.metrics.online?.hits || 0;
    return Math.floor(metrics / Math.max(1, this.localCache.size));
  }

  private calculateHitRatio(): number {
    const hits = this.metrics.hits || 0;
    const total = this.metrics.totalOperations || 1;
    return (hits / total) * 100;
  }

  private calculateAverageHits(): number {
    const totalHits = this.metrics.hits || 0;
    return this.localCache.size > 0 ? totalHits / this.localCache.size : 0;
  }

  private getTotalHits(): number {
    return this.metrics.hits || 0;
  }

  
}