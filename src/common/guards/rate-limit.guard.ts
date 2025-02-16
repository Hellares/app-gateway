import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus, Logger, Inject } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { RateLimitConfig } from './rate-limit.config';
import { CacheResponse } from 'src/redis/interfaces/cache-response.interface';
import { TokenBucket } from './token-bucket';

// @Injectable()
// export class RateLimitGuard implements CanActivate {
//   private readonly logger = new Logger(RateLimitGuard.name);
//   private readonly SECURITY_KEYS = {
//     RATE_LIMIT: {
//       BLOCKED: {
//         PREFIX: 'ratelimit:blocked:',
//         PATTERN: 'ratelimit:blocked:*'
//       }
//     }
//   } as const;

//   constructor(
//     private readonly redisService: RedisService,
//     @Inject('RATE_LIMIT_CONFIG') private readonly config: RateLimitConfig
//   ) {}

//   async canActivate(context: ExecutionContext): Promise<boolean> {
//     const request = context.switchToHttp().getRequest();
//     const ip = this.getClientIp(request);
//     const key = `ratelimit:${ip}`;

//     try {
//       // 1. Verificar bloqueo
//       const blockKey = `ratelimit:blocked:${ip}`;
//       const isBlocked = await this.redisService.get<boolean>(blockKey);
      
//       if (isBlocked?.data) {
//         this.logger.warn(`IP bloqueada: ${ip}`);
//         throw new HttpException({
//           statusCode: HttpStatus.TOO_MANY_REQUESTS,
//           message: 'Demasiadas peticiones, por favor intente más tarde',
//           timeToReset: this.config.blockDuration
//         }, HttpStatus.TOO_MANY_REQUESTS);
//       }

//       // 2. Obtener e incrementar contador
//       const currentCount = await this.incrementCounter(key);

//       this.logger.log(`Petición ${currentCount}/${this.config.points} para IP ${ip}`);
      
//       // 3. Verificar límites
//       if (currentCount > this.config.points - 10) {
//         this.logger.warn(`IP ${ip} cerca del límite: ${currentCount}/${this.config.points}`);
//       }

//       if (currentCount > this.config.points) {
//         // Corregido: solo pasamos ip y currentCount
//         await this.blockIp(ip, currentCount);
//         return false;
//       }
      
//       return true;

//     } catch (error) {
//       if (error instanceof HttpException) {
//         throw error;
//       }
//       this.logger.error(`Error en rate limit para IP ${ip}:`, error);
//       return false;
//     }
//   }

//   private async incrementCounter(key: string): Promise<number> {
//     try {
//       const entry = this.redisService.localCache.get(key);
      
//       if (entry?.expiresAt > Date.now()) {
//         const nextCount = Number(entry.data) + 1;
//         entry.data = nextCount;
//         return nextCount;
//       }
  
//       const redisResult = await this.redisService.get<number>(key);
//       const nextCount = (redisResult?.success && redisResult.data !== undefined)
//         ? Number(redisResult.data) + 1 
//         : 1;
  
//       this.redisService.localCache.set(key, {
//         data: nextCount,
//         timestamp: Date.now(),
//         expiresAt: Date.now() + (this.config.duration * 1000)
//       });
  
//       this.redisService.set(key, nextCount, this.config.duration)
//         .catch(err => this.logger.error('Error updating Redis:', err));
  
//       return nextCount;
//     } catch (error) {
//       this.logger.error('Rate limit error:', error);
//       return 1;
//     }
//   }

//   private async blockIp(ip: string, currentCount: number): Promise<void> {
//     try {
//       const blockKey = this.SECURITY_KEYS.RATE_LIMIT.BLOCKED.PREFIX + ip;
//       const now = new Date();
//       const expiresAt = new Date(now.getTime() + (this.config.blockDuration * 1000));
      
//       // Datos del bloqueo
//       const blockData = {
//         blocked: true,
//         ip: ip,
//         timestamp: now.toISOString(),
//         expiresAt: expiresAt.toISOString(),
//         reason: 'Rate limit exceeded',
//         details: {
//           currentRequests: currentCount,
//           limit: this.config.points,
//           blockDuration: this.config.blockDuration,
//           requestsOverLimit: currentCount - this.config.points
//         }
//       };
  
//       // Guardar información del bloqueo
//       await this.redisService.set(blockKey, blockData, this.config.blockDuration);
      
//       this.logger.warn(`IP ${ip} bloqueada por exceder ${this.config.points} peticiones`, {
//         currentCount,
//         expiresAt: expiresAt.toISOString(),
//         blockDuration: `${this.config.blockDuration} segundos`
//       });
  
//       // Lanzar excepción con información detallada
//       throw new HttpException({
//         statusCode: HttpStatus.TOO_MANY_REQUESTS,
//         error: 'Too Many Requests',
//         message: 'Rate limit excedido',
//         details: {
//           currentRequests: currentCount,
//           limit: this.config.points,
//           nextValidRequestTime: expiresAt.toISOString(),
//           timeToReset: this.config.blockDuration,
//           blockedUntil: expiresAt.toISOString()
//         }
//       }, HttpStatus.TOO_MANY_REQUESTS);
  
//     } catch (error) {
//       if (error instanceof HttpException) {
//         throw error;
//       }
//       this.logger.error(`Error al bloquear IP ${ip}:`, error);
//       throw new HttpException({
//         statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
//         message: 'Error al procesar el bloqueo',
//       }, HttpStatus.INTERNAL_SERVER_ERROR);
//     }
//   }

//   private getClientIp(request: any): string {
//     const ip = request.ip || 
//                request.connection.remoteAddress || 
//                request.headers['x-forwarded-for'];
             
//     return Array.isArray(ip) ? ip[0].split(',')[0].trim() : ip.split(',')[0].trim();
//   }
// }
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly tokenBuckets = new Map<string, TokenBucket>();

  constructor(
    private readonly redisService: RedisService,
    @Inject('RATE_LIMIT_CONFIG') private readonly defaultConfig: RateLimitConfig
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
     // Aquí debemos obtener la configuración específica del endpoint
     const handler = context.getHandler();
     const configMetadata = Reflect.getMetadata('rateLimit', handler);
     // Usar la configuración del preset o la default
     const config = configMetadata || this.defaultConfig;
 
    const request = context.switchToHttp().getRequest();
    const ip = this.getClientIp(request);

    this.logger.debug(`🔍 Verificando rate limit para IP: ${ip}`);

    // 1. Verificar si ya está bloqueada
    const blockKey = `blocked:${ip}`;
    const isBlocked = await this.redisService.get<{
      blocked: boolean;
      expiresAt: string;
      reason: string;
    }>(blockKey);

    if (isBlocked?.data?.blocked) {
      const timeLeft = new Date(isBlocked.data.expiresAt).getTime() - Date.now();
      throw new HttpException({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'IP bloqueada por exceso de peticiones',
        timeToReset: Math.ceil(timeLeft / 1000),
        reason: isBlocked.data.reason
      }, HttpStatus.TOO_MANY_REQUESTS);
    }

    // 2. Obtener o crear bucket
    let bucket = this.tokenBuckets.get(ip);
    if (!bucket) {
      this.logger.debug(`🆕 Creando nuevo bucket para IP: ${ip}`);
      bucket = new TokenBucket(
        config.points,
        config.refillRate,
        config.duration
      );
      this.tokenBuckets.set(ip, bucket);
    }

    // 3. Intentar consumir token
    const result = await bucket.tryConsume();
    this.logger.debug(`📊 Estado del bucket - IP: ${ip}, Tokens restantes: ${bucket.getTokens()}`);

    if (!result.allowed) {
      const overagePercentage = ((config.points - bucket.getTokens()) / config.points) * 100;

      if (overagePercentage >= config.penalties.hard) {
        // Bloqueo duro
        await this.blockIp(ip, {
          duration: config.blockDurations.hard,
          reason: 'Violación severa del rate limit',
          overagePercentage
        });
      } else if (overagePercentage >= config.penalties.soft) {
        // Bloqueo suave
        await this.blockIp(ip, {
          duration: config.blockDurations.soft,
          reason: 'Exceso del rate limit',
          overagePercentage
        });
      }

      throw new HttpException({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Rate limit excedido',
        retryAfter: Math.ceil(1 / config.refillRate),
        currentUsage: {
          remaining: bucket.getTokens(),
          limit: config.points,
          resetIn: config.duration
        }
      }, HttpStatus.TOO_MANY_REQUESTS);
    }

    // 4. Verificar si está cerca del límite
    if (bucket.getTokens() <= config.points * 0.3) { // 30% restante
      this.logger.warn(`⚠️ IP ${ip} cerca del límite: ${bucket.getTokens()} tokens restantes`);
    }

    return true;
  }

  private async blockIp(ip: string, options: {
    duration: number;
    reason: string;
    overagePercentage: number;
  }): Promise<void> {
    const blockKey = `blocked:${ip}`;
    // const blockDuration = options.duration || 300; // 5 minutos por defecto
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (options.duration * 1000));

    await this.redisService.set(
      blockKey,
      {
        blocked: true,
        timestamp: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        reason: options.reason,
        details: {
          overagePercentage: options.overagePercentage,
          blockDuration: options.duration
        }
      },
      options.duration
    );

    this.logger.warn(`🚫 IP ${ip} bloqueada: ${options.reason} - Expira: ${expiresAt.toISOString()}`);
    
    // Limpiar recursos
    this.tokenBuckets.delete(ip);
  }

  

  private getClientIp(request: any): string {
    return request.ip || 
           request.connection.remoteAddress || 
           request.headers['x-forwarded-for']?.split(',')[0];
  }
}