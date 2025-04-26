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
import { CACHE_KEYS, CACHE_PATTERNS, REDIS_ENTITIES } from './constants/redis-cache.keys.contants';
import { envs } from 'src/config';
import { buildRedisPattern, ParsedRedisKey, parseRedisKey } from './utils/redis-key-parser';



@Injectable()
export class RedisService {
  private readonly logger = new Logger('RedisService');
  private readonly config = envs.isProduction 
    ? REDIS_GATEWAY_CONFIG.MONITORING.PRODUCTION 
    : REDIS_GATEWAY_CONFIG.MONITORING.DEVELOPMENT;

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
    successRate: 10,
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
      this.logger.log('Iniciando servicio Redis...');
      this.serviceState = REDIS_SERVICE_STATE.CONNECTING;
  
      await this.cacheClient.connect();
      // const healthCheck = await this.healthCheck();
      await this.startConnectionMonitoring();
  
      // if (healthCheck.status !== 'healthy') throw new Error('Health check inicial fallido');
  
      Object.assign(this, {
        serviceState: REDIS_SERVICE_STATE.CONNECTED,
        consecutiveFailures: 0,
        lastOnlineTime: new Date()
      });
  
      this.logger.log('Servicio Redis inicializado correctamente');
    } catch (error) {
      this.serviceState = REDIS_SERVICE_STATE.ERROR;
      this.logger.error('Error inicializando el servicio Redis:', error);
      this.attemptReconnection();
    }
  }
 
  private startHealthCheck() {
    if (REDIS_GATEWAY_CONFIG.HEALTH_CHECK.ENABLED) {
      this.healthCheckInterval = setInterval(async () => {
        const health = await this.healthCheck();
        if (health.status !== 'healthy') {
          this.logger.warn(`Health check fallido: ${health.error}`);
        }
      }, REDIS_GATEWAY_CONFIG.HEALTH_CHECK.INTERVAL);
      
      this.logger.log(` Health check iniciado - Intervalo: ${REDIS_GATEWAY_CONFIG.HEALTH_CHECK.INTERVAL}ms`);
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
  
    this.logger.log('Iniciando reconexion...');
    this.serviceState = REDIS_SERVICE_STATE.CONNECTING;
  
    setTimeout(async () => {
      try {
        const healthCheck = await this.healthCheck();
        if (healthCheck.status === 'healthy') {
          this.logger.log('Reconexion exitosa');
          await this.handleReconnection(); // Limpieza y reinicio al reconectar
          this.serviceState = REDIS_SERVICE_STATE.CONNECTED;
          this.consecutiveFailures = 0;
          this.lastOnlineTime = new Date();
        } else {
          throw new Error('Health check fallido en reconexión');
        }
      } catch (error) {
        this.logger.warn(`Reconexion fallida (intento ${this.consecutiveFailures}), proximo intento en ${this.getBackoffDelay()}ms`);
        this.attemptReconnection();
      }
    }, this.getBackoffDelay());
  }

  private validateKey(key: string): void {
    if (!key || typeof key !== 'string') {
      throw new Error('La key debe ser un string no vacio');
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
      const wasConnected = this.serviceState === REDIS_SERVICE_STATE.CONNECTED;
      
      if (envs.isDevelopment) {
        this.logger.debug(' Verificando conexion con Redis...');
      }
  
      const response = await firstValueFrom(
        this.cacheClient.send(
          { cmd: REDIS_GATEWAY_CONFIG.COMMANDS.HEALTH }, 
          {}
        ).pipe(timeout(REDIS_GATEWAY_CONFIG.HEALTH_CHECK.TIMEOUT))
      );
  
      if (response.status !== 'healthy') {
        this.logger.warn('Health check indica estado unhealthy');
        return;
      }
  
      // Si estábamos desconectados y ahora nos reconectamos
      if (!wasConnected) {
        this.logger.log('Conexion con Redis restablecida');
        await this.handleReconnection(); // Limpieza y reinicio al reconectar
      }
  
      this.serviceState = REDIS_SERVICE_STATE.CONNECTED;
      this.consecutiveFailures = 0;
      this.lastOnlineTime = new Date();
  
    } catch (error) {
      this.handleConnectionFailure(error);
    }
  }

  // Método unificado de monitoreo
private async startConnectionMonitoring() {
  const config = envs.isProduction 
    ? REDIS_GATEWAY_CONFIG.MONITORING.PRODUCTION 
    : REDIS_GATEWAY_CONFIG.MONITORING.DEVELOPMENT;

  await this.checkConnection();
  
  if (envs.isDevelopment) {
    this.logger.debug('Iniciando monitoreo de conexion con Redis...');
  }

  // Limpiamos el intervalo anterior si existe
  if (this.connectionCheckInterval) {
    clearInterval(this.connectionCheckInterval);
  }

  this.connectionCheckInterval = setInterval(
    () => this.checkConnection(),
    config.CHECK_INTERVAL
  );

  // Log solo en desarrollo
  if (envs.isDevelopment) {
    this.logger.debug(`Intervalo de monitoreo configurado: ${config.CHECK_INTERVAL}ms`);
  }
}

private async handleReconnection() {
  this.logger.log('Iniciando proceso de reconexion y limpieza...');
  
  try {
    // 1. Limpiar caché local primero
    this.localCache.clear();
    this.logger.log('Cache local limpiado');

    // 2. Intentar limpiar Redis
    const response = await firstValueFrom(
      this.cacheClient.send(
        { cmd: REDIS_GATEWAY_CONFIG.COMMANDS.CLEAR }, 
        {}
      ).pipe(
        timeout(REDIS_GATEWAY_CONFIG.TIMEOUTS.OPERATION)
      )
    );

    if (response.success) {
      this.logger.log('Redis limpiado correctamente');
    } else {
      throw new Error('Fallo al limpiar Redis');
    }

    // 3. Reinicializar métricas
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
    
    this.logger.log('Reconexion y limpieza completada exitosamente');
  } catch (error) {
    this.logger.error('Error durante la reconexion y limpieza:', error);
    throw error;
  }
}
  
  private async handleConnectionFailure(error: Error) {
    this.consecutiveFailures++;
    
    if (this.serviceState === REDIS_SERVICE_STATE.CONNECTED) {
      this.serviceState = REDIS_SERVICE_STATE.ERROR;
      this.logger.error(`Conexion perdida con Redis: ${error.message}`);
    }
  
    const backoffDelay = this.getBackoffDelay();
    this.logger.warn(
      `Fallo de conexion (${this.consecutiveFailures}/${REDIS_GATEWAY_CONFIG.ERROR_HANDLING.MAX_RETRIES})`,
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

  private updateMetrics(operation: 'hit' | 'miss' | 'health_check', responseTime: number, failed = false) {
    // Ignorar health checks en las métricas
    if (operation === 'health_check') return;
  
    try {
      const validResponseTime = this.validateResponseTime(responseTime);
      const metrics = this.getCurrentMetrics();
  
      this.updateMetricsForCurrentState(metrics, operation, validResponseTime, failed);
      this.updateGlobalMetrics(metrics, validResponseTime);
  
      // Solo loguear métricas detalladas en desarrollo
      if (envs.isDevelopment && this.config.DETAILED_LOGGING) {
        this.logger.debug(`Metricas actualizadas: ${JSON.stringify(this.metrics, null, 2)}`);
      }
    } catch (error) {
      this.logger.error('Error actualizando metricas', { 
        error, 
        operation, 
        responseTime 
      });
    }
  }

private getCurrentMetrics(): ServiceMetrics {
  return this.serviceState === REDIS_SERVICE_STATE.CONNECTED 
    ? this.onlineMetrics 
    : this.offlineMetrics;
}

private updateMetricsForCurrentState(
  metrics: ServiceMetrics, 
  operation: 'hit' | 'miss', 
  responseTime: number, 
  failed: boolean
) {
  metrics.totalOperations = this.safeIncrement(metrics.totalOperations);
  metrics.lastResponseTime = responseTime;
  
  // Aplicamos el redondeo aquí para mantener consistencia
  metrics.averageResponseTime = Number(
    this.calculateMovingAverage(
      metrics.averageResponseTime, 
      responseTime, 
      metrics.totalOperations
    ).toFixed(2)  // Redondeamos a 2 decimales como en las métricas globales   
  );

  if (failed) {
    metrics.failedOperations = this.safeIncrement(metrics.failedOperations);
  }

  metrics[operation === 'hit' ? 'hits' : 'misses'] = 
    this.safeIncrement(metrics[operation === 'hit' ? 'hits' : 'misses']);

  metrics.successRate = this.calculateSuccessRate(metrics);
}

private updateGlobalMetrics(currentMetrics: ServiceMetrics, responseTime: number) {
  // Combinar métricas online y offline
  Object.assign(this.metrics, {
    hits: this.onlineMetrics.hits + this.offlineMetrics.hits,
    misses: this.onlineMetrics.misses + this.offlineMetrics.misses,
    totalOperations: this.onlineMetrics.totalOperations + this.offlineMetrics.totalOperations,
    failedOperations: this.onlineMetrics.failedOperations + this.offlineMetrics.failedOperations,
    online: this.onlineMetrics,
    offline: this.offlineMetrics,
    
    // Usar el mismo promedio que las métricas online cuando está conectado
    averageResponseTime: Number(
      (this.serviceState === REDIS_SERVICE_STATE.CONNECTED 
        ? this.onlineMetrics.averageResponseTime 
        : this.offlineMetrics.averageResponseTime
      ).toFixed(2)
    ),
    
    lastResponseTime: responseTime,
    successRate: this.calculateTotalSuccessRate(),
    localCacheSize: this.localCache.size,
    lastUpdated: new Date(),
    
    connectionStatus: {
      isConnected: this.serviceState === REDIS_SERVICE_STATE.CONNECTED,
      consecutiveFailures: this.getDisplayedFailures(),
      lastConnectionAttempt: new Date()
    }
  });

  // Solo loguear en desarrollo
  if (envs.isDevelopment && this.config.DETAILED_LOGGING) {
    this.logger.debug(`Metricas actualizadas: ${JSON.stringify(this.metrics, null, 2)}`);
  }
}


  // Cálculo de tasa de éxito con manejo de casos especiales
private calculateSuccessRate(metrics: ServiceMetrics): number {
  // Evitar división por cero
  if (metrics.totalOperations <= 0) {
    return 100;
  }

  // Calcular tasa de éxito
  const successRate = ((metrics.totalOperations - metrics.failedOperations) / 
    metrics.totalOperations) * 100;

  // Redondear y asegurar valor entre 0 y 100
  return Number(Math.min(100, Math.max(0, successRate)).toFixed(2));
}


private validateResponseTime(time: number): number {
  const numTime = Number(time);
  
  // Validar rangos razonables
  if (isNaN(numTime) || numTime <= 0 || numTime > 10000) {
    this.logger.debug(`Tiempo de respuesta invalido: ${time}. Usando ultimo promedio valido.`);
    return this.metrics.averageResponseTime || 200; // valor por defecto razonable
  }

  return numTime;
}

// Incremento seguro de contadores
private safeIncrement(value: number): number {
  // Asegurar que siempre sea un número positivo
  const numValue = Number(value);
  return isNaN(numValue) ? 1 : Math.max(1, numValue + 1);
}

// Cálculo de promedio móvil con validaciones
private calculateMovingAverage(
  currentAvg: number, 
  newValue: number, 
  totalCount: number
): number {
  // Si es el primer valor
  if (totalCount <= 1) return Number(newValue.toFixed(2));

  // Validaciones de valores
  if (newValue <= 0 || newValue > 10000) {
    return Number(currentAvg.toFixed(2));
  }

  const currentAvgNum = Number(currentAvg);
  const newValueNum = Number(newValue);

  // Si el promedio actual no es válido, usar el nuevo valor
  if (!isFinite(currentAvgNum) || isNaN(currentAvgNum)) {
    return Number(newValueNum.toFixed(2));
  }

  // Factor de peso para el promedio móvil exponencial
  const alpha = 0.1;  // 10% de peso para nuevos valores
  
  // Cálculo del promedio móvil exponencial (EMA)
  const ema = (newValueNum * alpha) + (currentAvgNum * (1 - alpha));

  // Limitar el resultado entre 0 y 3000ms y redondear a 2 decimales
  return Number(Math.min(Math.max(ema, 0), 3000).toFixed(2));
}

// Cálculo de tasa de éxito con manejo de casos especiales



  private calculateTotalSuccessRate(): number {
    const onlineOps = this.onlineMetrics.totalOperations || 0;
    const offlineOps = this.offlineMetrics.totalOperations || 0;
    const totalOps = onlineOps + offlineOps;
    
    if (totalOps <= 0) {
      return 100;
    }

    const onlineFails = this.onlineMetrics.failedOperations || 0;
    const offlineFails = this.offlineMetrics.failedOperations || 0;
    const totalFails = onlineFails + offlineFails;

    const successRate = ((totalOps - totalFails) / totalOps) * 100;
    return Number(Math.min(100, Math.max(0, successRate)).toFixed(2));
  }

  async get<T>(key: string): Promise<CacheResponse<T>> {
    const startTime = Date.now();

    try {
      this.validateKey(key);
  
      // 1. Primero verificar caché local
      const localValue = this.getFromLocalCache<T>(key, startTime);
      if (localValue.success) {
        this.logger.debug(`Cache hit local: ${key}`);
        return localValue;
      }
  
      // 2. Si no está en local, buscar en Redis
      const redisResponse = await this.getFromRedis<T>(key);
      
      // 3. Si se encontró en Redis, guardar en caché local
      if (redisResponse.success && redisResponse.data) {
        this.logger.debug(`Guardando en cache local desde Redis: ${key}`);
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
      this.logger.warn(`Error de conexion - Intentando usar cache local para key: ${key}`);
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
        this.logger.debug(`Guardando en Redis: ${key}`);
        
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
          this.logger.debug(`Dato guardado exitosamente en Redis: ${key}`);
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
      this.logger.debug(`Redis offline - Guardando solo en cache local: ${key}`);
      return this.setInLocalCache(key, value, startTime, ttl);
    } catch (error) {
      this.logger.error(`Error guardando dato - Key: ${key}`, error);
      return this.handleError(error, startTime, key);
    }
  }



  setInLocalCache(key: string, value: any, startTime: number, ttl?: number): CacheResponse {
    this.logger.debug(`Iniciando guardado en cache local - Key: ${key}`);
    
    // Verificar y limpiar si es necesario
    if (this.localCache.size >= REDIS_GATEWAY_CONFIG.LOCAL_CACHE.MAX_SIZE) {
      const deletedKey = this.localCache.keys().next().value;
      this.localCache.delete(deletedKey);
      this.logger.debug(`Limpiando cache local - Eliminada key: ${deletedKey}`);
    }
  
    // Calcular TTL
    const expiresAt = Date.now() + ((REDIS_GATEWAY_CONFIG.LOCAL_CACHE.TTL) * 1000);
    
    // Guardar en caché local
    this.localCache.set(key, {
      data: value,
      timestamp: Date.now(),
      expiresAt
    });
  
    this.logger.debug(`Dato guardado en cache local - Key: ${key}, Expires: ${new Date(expiresAt).toISOString()}`);
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
        this.logger.log('Servicio restaurado - Iniciando limpieza de caches');
        try {
          await this.clearAll();
        } catch (error) {
          this.logger.warn('Error al limpiar caches despues de reconexion:', error);
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
      this.logger.error('Health check fallido:', {
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

  /*
  * Método para limpiar caché por patrón localmente y en Redis
  * Se utiliza para limpiar caché de rubros, planes y archivos
  * Limpia todos los patrones que coincidan con el patrón dado de todas las entidades que existen en la caché local 
  */

  async clearByPattern(pattern: string): Promise<CacheResponse> {
    const startTime = Date.now();
    try {
      this.logger.debug(`Limpiando cache por patron: ${pattern}`);
    
      // Determinar qué módulo estamos limpiando basado en el patrón
      const modulePrefix = pattern.split('*')[0].split(':')[0]; // Extrae "archivo", "rubro", etc.
      
      // Eliminar de la caché local solo las entradas relacionadas con ese módulo
      let keysDeleted = 0;
      for (const key of Array.from(this.localCache.keys())) {
        if (key.startsWith(modulePrefix)) {
          this.localCache.delete(key);
          keysDeleted++;
        }
      }
    
    this.logger.debug(`Limpiadas ${keysDeleted} claves locales del modulo: ${modulePrefix}`);

      // Si Redis está desconectado, solo reportamos la limpieza local
      if (this.serviceState !== REDIS_SERVICE_STATE.CONNECTED) {
        this.logger.debug(`Limpiadas ${keysDeleted} claves locales con patron: ${pattern}`);
        return {
          success: true,
          source: 'local',
          details: {
            responseTime: Date.now() - startTime,
            lastCheck: new Date().toISOString(),
            keysDeleted,
            partialClear: true
          }
        };
      }
      
      // Si Redis está conectado, también limpiar allí
      const response = await firstValueFrom<CacheResponse>(
        this.cacheClient.send(
          { cmd: 'cache.clearPattern' }, 
          pattern
        ).pipe(
          timeout(this.timeoutMs)
        )
      );
      
      this.updateMetrics('hit', Date.now() - startTime);
      
      this.logger.debug(`Limpieza por patron completada: ${pattern} (${keysDeleted} claves locales, ${response.details?.keysDeleted || 0} claves en Redis)`);
      
      return {
        ...response,
        details: {
          ...response.details,
          // localKeysDeleted: keysDeleted,
          // totalKeysDeleted: (response.details?.keysDeleted || 0) + keysDeleted,
          responseTime: Date.now() - startTime,
          lastCheck: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error(`Error limpiando caché por patrón: ${pattern}`, error);
      return this.handleError(error, startTime);
    }
  }



  async clearRubroCache(): Promise<CacheResponse> {
    return this.clearByPattern(CACHE_KEYS.RUBRO.PATTERN);
  }
  
  async clearPlanCache(): Promise<CacheResponse> {
    return this.clearByPattern(CACHE_KEYS.PLAN.PATTERN);
  }
  
  async clearArchivoCache(): Promise<CacheResponse> {
    return this.clearByPattern(CACHE_KEYS.ARCHIVO.PATTERN_ACTIVE);
  }

    
  // Método selectivo para limpiar cache de archivos de una empresa específica
  async clearArchivoEmpresaCache(empresaId: string): Promise<CacheResponse> {
    return this.clearByPattern(CACHE_KEYS.ARCHIVO.EMPRESA_PATTERN(empresaId));
  }

  /*
  * Aqui termina la parte de limpieza de caché por patrón
  * Se utiliza para limpiar caché de rubros, planes y archivos
  */

  
  
  async getDetailedMetrics(): Promise<DetailedCacheMetrics> {
    const now = Date.now();
    let memoryUsageEstimate = 0;
    const patterns: Record<string, number> = {};
    const metrics = await this.getMetrics();
  
    // Encontrar entrada más antigua y más nueva
    let oldestTimestamp = now;
    let newestTimestamp = 0;
  
    const entries = Array.from(this.localCache.entries()).map(([key, entry]) => {
      const age = now - entry.timestamp;
      oldestTimestamp = Math.min(oldestTimestamp, entry.timestamp);
      newestTimestamp = Math.max(newestTimestamp, entry.timestamp);
      
      const pattern = this.getKeyPattern(key);
      patterns[pattern] = (patterns[pattern] || 0) + 1;
      
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
  
    const performance = {
      hits: metrics.hits,
      misses: metrics.misses,
      hitRatio: `${((metrics.hits / Math.max(metrics.totalOperations, 1)) * 100).toFixed(2)}%`,
      averageResponseTime: `${metrics.averageResponseTime ? metrics.averageResponseTime.toFixed(2) : '0.00'}ms`,
      successRate: `${metrics.successRate}%`,
      status: metrics.connectionStatus.isConnected 
        ? metrics.successRate >= 90 ? 'healthy' : 'degraded'
        : 'unhealthy'
    };
  
    return {
      ...metrics,
      status: 'success',
      timestamp: new Date().toISOString(),
      serviceState: metrics.connectionStatus.isConnected ? 'connected' : 'disconnected',
      localCache: {
        size: this.localCache.size,
        maxSize: REDIS_GATEWAY_CONFIG.LOCAL_CACHE.MAX_SIZE,
        usagePercentage: Number(((this.localCache.size / REDIS_GATEWAY_CONFIG.LOCAL_CACHE.MAX_SIZE) * 100).toFixed(2)),
        oldestEntry: this.localCache.size > 0 ? oldestTimestamp : null,
        newestEntry: this.localCache.size > 0 ? newestTimestamp : null,
        hitRatio: this.calculateHitRatio(),
        averageHits: this.calculateAverageHits(),
        totalHits: this.getTotalHits(),
        memoryUsageEstimate,
        totalMemoryUsage: this.formatBytes(memoryUsageEstimate),
        averageEntrySize: this.formatBytes(memoryUsageEstimate / Math.max(this.localCache.size, 1)),
        patterns
      },
      performance,
      entries: entries.sort((a, b) => b.hits - a.hits),
      timeOffline: metrics.timeOffline || 0,  // Aseguramos que sea número
      lastUpdated: metrics.lastUpdated
    };
  }

  // Método auxiliar para formatear bytes
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
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



  //**************************************** */




  /**
 * Método para limpiar el caché basado en componentes específicos de la clave
 * 
 * @param components Los componentes para construir el patrón de limpieza
 */
async clearByKeyComponents(components: Partial<ParsedRedisKey>): Promise<CacheResponse<void>> {
  const startTime = Date.now();
  try {
    const pattern = buildRedisPattern(components);
    
    this.logger.debug(`Limpiando cache por componentes específicos - Patrón: ${pattern}`);
    
    // Limpiar cache local primero
    let localKeysDeleted = 0;
    const regexStr = '^' + pattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\./g, '\\.');
    
    try {
      const regexPattern = new RegExp(regexStr);
      
      // Iterar sobre las claves de caché local y eliminar las que coincidan
      for (const key of Array.from(this.localCache.keys())) {
        if (regexPattern.test(key)) {
          this.localCache.delete(key);
          localKeysDeleted++;
        }
      }
    } catch (regexError) {
      this.logger.warn(`Error al crear regex para limpieza local: ${regexError.message}`);
    }
    
    // Si Redis está desconectado, solo reportamos la limpieza local
    if (this.serviceState !== REDIS_SERVICE_STATE.CONNECTED) {
      this.logger.debug(`Limpiadas ${localKeysDeleted} claves locales con patrón: ${pattern} (Redis offline)`);
      return {
        success: true,
        source: 'local',
        details: {
          responseTime: Date.now() - startTime,
          lastCheck: new Date().toISOString(),
          localKeysDeleted: localKeysDeleted,
          partialClear: true
        }
      };
    }
    
    // Si Redis está conectado, también limpiar allí
    const redisResponse  = await firstValueFrom<CacheResponse>(
      this.cacheClient.send(
        { cmd: 'cache.clearByKeyComponents' }, 
        components
      ).pipe(
        timeout(this.timeoutMs)
      )
    );
    
    this.updateMetrics('hit', Date.now() - startTime);
    
    this.logger.debug(`Limpieza por componentes completada. Patrón: ${pattern} (${localKeysDeleted} claves locales, ${redisResponse.details?.keysDeleted || 0} claves en Redis)`);

    const response: CacheResponse<void> = {
      success: redisResponse.success,
      source: redisResponse.source,
      details: {
        ...(redisResponse.details || {}),
        localKeysDeleted,
        responseTime: Date.now() - startTime,
        lastCheck: new Date().toISOString()
      }
    };
    
    // Si hay error en la respuesta original, lo preservamos
    if (redisResponse.error) {
      response.error = redisResponse.error;
    }   
    
    
  } catch (error) {
    this.logger.error(`Error limpiando caché por componentes: ${error.message}`, error);
    return this.handleError(error, startTime);
  }
}

/**
 * Método para limpiar el caché basado en una clave similar
 * 
 * @param sampleKey Clave de ejemplo para analizar
 * @param filterComponents Componentes a utilizar para el filtrado
 */
async clearBySimilarKeys(sampleKey: string, filterComponents: Array<keyof ParsedRedisKey>): Promise<CacheResponse<void>> {
  const startTime = Date.now();
  try {
    this.logger.debug(`Limpiando cache por clave similar: ${sampleKey}`);
    
    const parsedKey = parseRedisKey(sampleKey);
    const filterPattern: Partial<ParsedRedisKey> = {};
    
    // Solo incluir los componentes especificados en filterComponents
    for (const component of filterComponents) {
      if (component in parsedKey) {
        // Método seguro para asignar valores según el tipo de componente
        switch (component) {
          case 'entityType':
          case 'entityId':
          case 'subEntityType':
          case 'subEntityId':
          case 'operation':
          case 'originalKey':
            filterPattern[component] = parsedKey[component];
            break;
          case 'pagination':
            if (parsedKey.pagination) {
              filterPattern.pagination = { ...parsedKey.pagination };
            }
            break;
          case 'rawSegments':
            if (Array.isArray(parsedKey.rawSegments)) {
              filterPattern.rawSegments = [...parsedKey.rawSegments];
            }
            break;
        }
      }
    }
    
    // Si no hay componentes para filtrar, lanzar error
    if (Object.keys(filterPattern).length === 0) {
      throw new Error(`No se encontraron componentes válidos en la clave de ejemplo: ${sampleKey}`);
    }
    
    // Si Redis está desconectado, usar el método local
    if (this.serviceState !== REDIS_SERVICE_STATE.CONNECTED) {
      return this.clearByKeyComponents(filterPattern);
    }
    
    // Si Redis está conectado, llamar al microservicio
    const redisResponse  = await firstValueFrom<CacheResponse>(
      this.cacheClient.send(
        { cmd: 'cache.clearBySimilarKeys' }, 
        { sampleKey, filterComponents }
      ).pipe(
        timeout(this.timeoutMs)
      )
    );
    
    this.updateMetrics('hit', Date.now() - startTime);

    // Construimos una respuesta de tipo correcto
    const response: CacheResponse<void> = {
      success: redisResponse.success,
      source: redisResponse.source,
      details: {
        ...(redisResponse.details || {}),
        // localKeysDeleted,
        responseTime: Date.now() - startTime,
        lastCheck: new Date().toISOString()
      }
    };
    
    // Si hay error en la respuesta original, lo preservamos
    if (redisResponse.error) {
      response.error = redisResponse.error;
    }
    
    return response;
    
    
  } catch (error) {
    this.logger.error(`Error limpiando caché por clave similar: ${error.message}`, error);
    return this.handleError(error, startTime);
  }
}

/**
 * Método para limpiar el caché por entidad principal
 * 
 * @param entityType Tipo de entidad (ej: "SERVICIO")
 * @param entityId ID de la entidad (ej: "123")
 */
async clearByMainEntity(entityType: string, entityId: string): Promise<CacheResponse<void>> {
  const startTime = Date.now();
  try {
    this.logger.debug(`Limpiando cache por entidad principal: ${entityType}${entityId}`);
    
    // Construir el patrón para la limpieza
    const pattern = CACHE_PATTERNS.forEntityType(entityType, entityId);
    
    // Limpiar cache local primero
    let localKeysDeleted = 0;
    const regexStr = '^' + pattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\./g, '\\.');
    
    try {
      const regexPattern = new RegExp(regexStr);
      
      // Iterar sobre las claves de caché local y eliminar las que coincidan
      for (const key of Array.from(this.localCache.keys())) {
        if (regexPattern.test(key)) {
          this.localCache.delete(key);
          localKeysDeleted++;
        }
      }
    } catch (regexError) {
      this.logger.warn(`Error al crear regex para limpieza local: ${regexError.message}`);
    }
    
    // Si Redis está desconectado, solo reportamos la limpieza local
    if (this.serviceState !== REDIS_SERVICE_STATE.CONNECTED) {
      this.logger.debug(`Limpiadas ${localKeysDeleted} claves locales para entidad: ${entityType}${entityId} (Redis offline)`);
      return {
        success: true,
        source: 'local',
        details: {
          responseTime: Date.now() - startTime,
          lastCheck: new Date().toISOString(),
          localKeysDeleted,
          partialClear: true
        }
      };
    }
    
    // Si Redis está conectado, también limpiar allí
    const redisResponse  = await firstValueFrom<CacheResponse>(
      this.cacheClient.send(
        { cmd: 'cache.clearByMainEntity' }, 
        { entityType, entityId }
      ).pipe(
        timeout(this.timeoutMs)
      )
    );
    
    this.updateMetrics('hit', Date.now() - startTime);
    
    this.logger.debug(`Limpieza por entidad principal completada: ${entityType}${entityId} (${localKeysDeleted} claves locales, ${redisResponse.details?.keysDeleted || 0} claves en Redis)`);
    
    // Construir una respuesta del tipo correcto
const response: CacheResponse<void> = {
  success: redisResponse.success,
  source: redisResponse.source,
  details: {
    ...(redisResponse.details || {}),
    localKeysDeleted,
    responseTime: Date.now() - startTime,
    lastCheck: new Date().toISOString()
  }
};

// Si hay error en la respuesta original, lo preservamos
if (redisResponse.error) {
  response.error = redisResponse.error;
}

return response;
  } catch (error) {
    this.logger.error(`Error limpiando caché por entidad principal: ${error.message}`, error);
    return this.handleError(error, startTime);
  }
}

/**
 * Método para limpiar el caché por par de entidades
 * 
 * @param entityType Tipo de entidad principal (ej: "SERVICIO")
 * @param entityId ID de la entidad principal (ej: "123")
 * @param subEntityType Tipo de subentidad (ej: "SERV")
 * @param subEntityId ID de la subentidad (ej: "456")
 */
async clearByEntityPair(
  entityType: string, 
  entityId: string, 
  subEntityType: string, 
  subEntityId: string
): Promise<CacheResponse<void>> {
  const startTime = Date.now();
  try {
    this.logger.debug(`Limpiando cache por par de entidades: ${entityType}${entityId}:${subEntityType}${subEntityId}`);
    
    // Construir el patrón para la limpieza
    const pattern = CACHE_PATTERNS.forEntityPair(entityType, entityId, subEntityType, subEntityId);
    
    // Limpiar cache local primero
    let localKeysDeleted = 0;
    const regexStr = '^' + pattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\./g, '\\.');
    
    try {
      const regexPattern = new RegExp(regexStr);
      
      // Iterar sobre las claves de caché local y eliminar las que coincidan
      for (const key of Array.from(this.localCache.keys())) {
        if (regexPattern.test(key)) {
          this.localCache.delete(key);
          localKeysDeleted++;
        }
      }
    } catch (regexError) {
      this.logger.warn(`Error al crear regex para limpieza local: ${regexError.message}`);
    }
    
    // Si Redis está desconectado, solo reportamos la limpieza local
    if (this.serviceState !== REDIS_SERVICE_STATE.CONNECTED) {
      this.logger.debug(`Limpiadas ${localKeysDeleted} claves locales para par de entidades: ${entityType}${entityId}:${subEntityType}${subEntityId} (Redis offline)`);
      return {
        success: true,
        source: 'local',
        details: {
          responseTime: Date.now() - startTime,
          lastCheck: new Date().toISOString(),
          localKeysDeleted,
          partialClear: true
        }
      };
    }
    
    // Si Redis está conectado, también limpiar allí
    const redisResponse = await firstValueFrom<CacheResponse>(
      this.cacheClient.send(
        { cmd: 'cache.clearByEntityPair' }, 
        { entityType, entityId, subEntityType, subEntityId }
      ).pipe(
        timeout(this.timeoutMs)
      )
    );
    
    this.updateMetrics('hit', Date.now() - startTime);
    
    this.logger.debug(`Limpieza por par de entidades completada: ${entityType}${entityId}:${subEntityType}${subEntityId} (${localKeysDeleted} claves locales, ${redisResponse.details?.keysDeleted || 0} claves en Redis)`);
    
    // Construir una respuesta del tipo correcto
const response: CacheResponse<void> = {
  success: redisResponse.success,
  source: redisResponse.source,
  details: {
    ...(redisResponse.details || {}),
    localKeysDeleted,
    responseTime: Date.now() - startTime,
    lastCheck: new Date().toISOString()
  }
};
 
// Si hay error en la respuesta original, lo preservamos
if (redisResponse.error) {
  response.error = redisResponse.error;
}

return response;
  } catch (error) {
    this.logger.error(`Error limpiando caché por par de entidades: ${error.message}`, error);
    return this.handleError(error, startTime);
  }
}

/**
 * Método para limpiar el caché por segmentos de clave
 * 
 * @param segments Segmentos que componen la clave
 */
async clearByKeySegments(segments: string[]): Promise<CacheResponse<void>> {
  const startTime = Date.now();
  try {
    const pattern = CACHE_PATTERNS.forSegments(segments);
    this.logger.debug(`Limpiando cache por segmentos: ${pattern}`);
    
    // Limpiar cache local primero
    let localKeysDeleted = 0;
    const regexStr = '^' + pattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\./g, '\\.');
    
    try {
      const regexPattern = new RegExp(regexStr);
      
      // Iterar sobre las claves de caché local y eliminar las que coincidan
      for (const key of Array.from(this.localCache.keys())) {
        if (regexPattern.test(key)) {
          this.localCache.delete(key);
          localKeysDeleted++;
        }
      }
    } catch (regexError) {
      this.logger.warn(`Error al crear regex para limpieza local: ${regexError.message}`);
    }
    
    // Si Redis está desconectado, solo reportamos la limpieza local
    if (this.serviceState !== REDIS_SERVICE_STATE.CONNECTED) {
      this.logger.debug(`Limpiadas ${localKeysDeleted} claves locales con segmentos: ${segments.join(':')} (Redis offline)`);
      return {
        success: true,
        source: 'local',
        details: {
          responseTime: Date.now() - startTime,
          lastCheck: new Date().toISOString(),
          localKeysDeleted,
          partialClear: true
        }
      };
    }
    
    // Si Redis está conectado, también limpiar allí
    const redisResponse  = await firstValueFrom<CacheResponse>(
      this.cacheClient.send(
        { cmd: 'cache.clearByKeySegments' }, 
        segments
      ).pipe(
        timeout(this.timeoutMs)
      )
    );
    
    this.updateMetrics('hit', Date.now() - startTime);
    
    this.logger.debug(`Limpieza por segmentos completada: ${segments.join(':')} (${localKeysDeleted} claves locales, ${redisResponse .details?.keysDeleted || 0} claves en Redis)`);
    
    // Construir una respuesta del tipo correcto
const response: CacheResponse<void> = {
  success: redisResponse.success,
  source: redisResponse.source,
  details: {
    ...(redisResponse.details || {}),
    localKeysDeleted,
    responseTime: Date.now() - startTime,
    lastCheck: new Date().toISOString()
  }
};

// Si hay error en la respuesta original, lo preservamos
if (redisResponse.error) {
  response.error = redisResponse.error;
}

return response;
  } catch (error) {
    this.logger.error(`Error limpiando caché por segmentos: ${error.message}`, error);
    return this.handleError(error, startTime);
  }
}

/**
 * Método específico para limpiar caché de servicios
 * @param servicioId ID del servicio
 */
async clearServicioCache(servicioId: string): Promise<CacheResponse<void>> {
  return this.clearByMainEntity(REDIS_ENTITIES.SERVICIO, servicioId);
}

/**
 * Método específico para limpiar caché de un SERV específico
 * @param servId ID del SERV
 */
async clearServCache(servId: string): Promise<CacheResponse<void>> {
  const startTime = Date.now();
  try {
    const pattern = CACHE_KEYS.SERVICIO.SERV_PATTERN(servId);
    this.logger.debug(`Limpiando cache por SERV: ${servId}`);
    
    // Limpiar cache local primero
    let localKeysDeleted = 0;
    const regexStr = '^' + pattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\./g, '\\.');
    
    try {
      const regexPattern = new RegExp(regexStr);
      
      for (const key of Array.from(this.localCache.keys())) {
        if (regexPattern.test(key)) {
          this.localCache.delete(key);
          localKeysDeleted++;
        }
      }
    } catch (regexError) {
      this.logger.warn(`Error al crear regex para limpieza local: ${regexError.message}`);
    }
    
    // Si Redis está desconectado, solo reportamos la limpieza local
    if (this.serviceState !== REDIS_SERVICE_STATE.CONNECTED) {
      this.logger.debug(`Limpiadas ${localKeysDeleted} claves locales para SERV: ${servId} (Redis offline)`);
      return {
        success: true,
        source: 'local',
        details: {
          responseTime: Date.now() - startTime,
          lastCheck: new Date().toISOString(),
          localKeysDeleted,
          partialClear: true
        }
      };
    }
    
    // Si Redis está conectado, también limpiar allí
    const redisResponse  = await firstValueFrom<CacheResponse>(
      this.cacheClient.send(
        { cmd: 'cache.clearByPattern' }, 
        pattern
      ).pipe(
        timeout(this.timeoutMs)
      )
    );
    
    this.updateMetrics('hit', Date.now() - startTime);
    
    this.logger.debug(`Limpieza por SERV completada: ${servId} (${localKeysDeleted} claves locales, ${redisResponse.details?.keysDeleted || 0} claves en Redis)`);
    
    // Construir una respuesta del tipo correcto
const response: CacheResponse<void> = {
  success: redisResponse.success,
  source: redisResponse.source,
  details: {
    ...(redisResponse.details || {}),
    localKeysDeleted,
    responseTime: Date.now() - startTime,
    lastCheck: new Date().toISOString()
  }
};

// Si hay error en la respuesta original, lo preservamos
if (redisResponse.error) {
  response.error = redisResponse.error;
}

return response;
  } catch (error) {
    this.logger.error(`Error limpiando caché por SERV: ${error.message}`, error);
    return this.handleError(error, startTime);
  }
}

/**
 * Método específico para limpiar caché de un servicio y SERV específicos
 * @param servicioId ID del servicio
 * @param servId ID del SERV
 */
async clearServicioPorServCache(servicioId: string, servId: string): Promise<CacheResponse<void>> {
  return this.clearByEntityPair(
    REDIS_ENTITIES.SERVICIO, 
    servicioId, 
    REDIS_ENTITIES.SERV, 
    servId
  );
}

/**
 * Método para limpiar caché por una clave ejemplo
 * @param sampleKey Clave de ejemplo a usar como base para la limpieza
 */
async clearBySampleKey(sampleKey: string): Promise<CacheResponse<void>> {
  // Por defecto limpiamos basándonos en entityType y entityId
  return this.clearBySimilarKeys(sampleKey, ['entityType', 'entityId']);
}

/**
 * Método específico para limpiar caché de una operación específica
 * @param servicioId ID del servicio
 * @param servId ID del SERV
 * @param operation Operación (ej: "all")
 */
async clearOperationCache(servicioId: string, servId: string, operation: string): Promise<CacheResponse<void>> {
  const segments = [
    `${REDIS_ENTITIES.SERVICIO}${servicioId}`,
    `${REDIS_ENTITIES.SERV}${servId}`,
    operation
  ];
  
  return this.clearByKeySegments(segments);
}

/**
 * Método específico para limpiar caché con paginación
 * @param servicioId ID del servicio
 * @param servId ID del SERV
 * @param page Número de página
 * @param limit Límite de resultados
 */
async clearPaginatedCache(servicioId: string, servId: string, page: number, limit: number): Promise<CacheResponse<void>> {
  const startTime = Date.now();
  try {
    // Construir el patrón de clave basado en la paginación
    const pattern = CACHE_KEYS.SERVICIO.PAGINATED(servicioId, servId, page, limit);
    this.logger.debug(`Limpiando cache paginado: ${pattern}`);
    
    // Limpiar cache local primero
    const key = pattern; // En este caso, sabemos la clave exacta
    const deleted = this.localCache.delete(key);
    const localKeysDeleted = deleted ? 1 : 0;
    
    // Si Redis está desconectado, solo reportamos la limpieza local
    if (this.serviceState !== REDIS_SERVICE_STATE.CONNECTED) {
      this.logger.debug(`Limpiada ${localKeysDeleted} clave local paginada (Redis offline)`);
      return {
        success: true,
        source: 'local',
        details: {
          responseTime: Date.now() - startTime,
          lastCheck: new Date().toISOString(),
          localKeysDeleted,
          partialClear: true
        }
      };
    }
    
    // Si Redis está conectado, también limpiar allí
    const redisResponse  = await firstValueFrom<CacheResponse>(
      this.cacheClient.send(
        { cmd: 'cache.delete' }, 
        key
      ).pipe(
        timeout(this.timeoutMs)
      )
    );
    
    this.updateMetrics('hit', Date.now() - startTime);
    
    this.logger.debug(`Limpieza de caché paginado completada: ${key}`);
    
    // Construir una respuesta del tipo correcto
const response: CacheResponse<void> = {
  success: redisResponse.success,
  source: redisResponse.source,
  details: {
    ...(redisResponse.details || {}),
    localKeysDeleted,
    responseTime: Date.now() - startTime,
    lastCheck: new Date().toISOString()
  }
};

// Si hay error en la respuesta original, lo preservamos
if (redisResponse.error) {
  response.error = redisResponse.error;
}

return response;
  } catch (error) {
    this.logger.error(`Error limpiando caché paginado: ${error.message}`, error);
    return this.handleError(error, startTime);
  }
}




/**
 * Método flexible para limpiar el caché basado en entidades completas
 * Acepta la entidad completa (ej: "SERVICIO123") en lugar de separar tipo e ID
 * 
 * @param mainEntity Entidad principal completa (ej: "SERVICIO123")
 * @param subEntity Subentidad completa opcional (ej: "SERV456")
 */
async clearByEntities(mainEntity: string, subEntity?: string): Promise<CacheResponse<void>> {
  const startTime = Date.now();
  try {
    let pattern: string;
    
    if (subEntity) {
      // Si tenemos ambas entidades, construimos un patrón para el par
      pattern = `${mainEntity}:${subEntity}:*`;
      this.logger.debug(`Limpiando cache por par de entidades completas: ${mainEntity}:${subEntity}`);
    } else {
      // Si solo tenemos la entidad principal
      pattern = `${mainEntity}:*`;
      this.logger.debug(`Limpiando cache por entidad principal completa: ${mainEntity}`);
    }
    
    // Limpiar cache local primero
    let localKeysDeleted = 0;
    const regexStr = '^' + pattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\./g, '\\.');
    
    try {
      const regexPattern = new RegExp(regexStr);
      
      // Iterar sobre las claves de caché local y eliminar las que coincidan
      for (const key of Array.from(this.localCache.keys())) {
        if (regexPattern.test(key)) {
          this.localCache.delete(key);
          localKeysDeleted++;
        }
      }
    } catch (regexError) {
      this.logger.warn(`Error al crear regex para limpieza local: ${regexError.message}`);
    }
    
    // Si Redis está desconectado, solo reportamos la limpieza local
    if (this.serviceState !== REDIS_SERVICE_STATE.CONNECTED) {
      const entityDesc = subEntity ? `${mainEntity}:${subEntity}` : mainEntity;
      this.logger.debug(`Limpiadas ${localKeysDeleted} claves locales para entidad(es): ${entityDesc} (Redis offline)`);
      
      return {
        success: true,
        source: 'local',
        details: {
          responseTime: Date.now() - startTime,
          lastCheck: new Date().toISOString(),
          localKeysDeleted,
          partialClear: true
        }
      };
    }
    
    // Si Redis está conectado, limpiar usando el patrón
    const response = await firstValueFrom<CacheResponse<void>>(
      this.cacheClient.send(
        { cmd: 'cache.clearPattern' }, 
        pattern
      ).pipe(
        timeout(this.timeoutMs)
      )
    );
    
    this.updateMetrics('hit', Date.now() - startTime);
    
    const entityDesc = subEntity ? `${mainEntity}:${subEntity}` : mainEntity;
    this.logger.debug(`Limpieza por entidades completada: ${entityDesc} (${localKeysDeleted} claves locales, ${response.details?.keysDeleted || 0} claves en Redis)`);
    
    // Construir una respuesta del tipo correcto
    const result: CacheResponse<void> = {
      success: response.success,
      source: response.source,
      details: {
        ...(response.details || {}),
        localKeysDeleted,
        responseTime: Date.now() - startTime,
        lastCheck: new Date().toISOString()
      }
    };
    
    // Si hay error en la respuesta original, lo preservamos
    if (response.error) {
      result.error = response.error;
    }
    
    return result;
  } catch (error) {
    this.logger.error(`Error limpiando caché por entidades: ${error.message}`, error);
    return this.handleError(error, startTime);
  }
}

  

  
}