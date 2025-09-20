import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../auth.service';

@Injectable()
export class EmpresaContextMiddlewareOptimized implements NestMiddleware {
  private readonly logger = new Logger(EmpresaContextMiddlewareOptimized.name);
  
  // Cache en memoria para tokens validados (para reducir latencia)
  private readonly tokenCache = new Map<string, { data: any; expiry: number }>();
  private readonly CACHE_TTL = 60000; // 60 segundos
  
  private readonly excludedPaths = [
    '/auth/login',
    '/auth/register',
    '/auth/verify-email',
    '/auth/request-password-reset',
    '/auth/reset-password',
    '/health',
    '/metrics'
  ];

  constructor(private readonly authService: AuthService) {
    // Limpiar caché expirado cada 5 minutos
    setInterval(() => this.cleanExpiredCache(), 300000);
  }

  async use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    
    try {
      const path = req.path;
      if (this.excludedPaths.some(excluded => path.startsWith(excluded))) {
        return next();
      }

      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next();
      }

      const token = authHeader.split(' ')[1];
      
      // ✅ OPTIMIZACIÓN: Cache en memoria para evitar re-validar tokens
      const cacheKey = this.generateCacheKey(token);
      const cached = this.getFromCache(cacheKey);
      
      let tokenData;
      if (cached) {
        tokenData = cached;
      } else {
        // ✅ OPTIMIZACIÓN: Timeout para validateTokenLight
        tokenData = await Promise.race([
          Promise.resolve(this.authService.validateTokenLight(token)),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Token validation timeout')), 1500)
          )
        ]) as any;
        
        // Cachear resultado si es válido
        if (tokenData) {
          this.setCache(cacheKey, tokenData);
        }
      }
      
      if (!tokenData) {
        return next();
      }

      // Los datos ya vienen procesados correctamente del JWT
      if (tokenData.empresaId) {
        req.empresaContext = {
          empresaId: tokenData.empresaId,
          roles: tokenData.roles || [],
          principalRole: tokenData.principalRole || 'USER',
          permissions: tokenData.permissions || []
        };
        
        const processingTime = Date.now() - startTime;
        
        // Solo log en desarrollo y si toma más de 100ms
        if (process.env.NODE_ENV === 'development' && processingTime > 100) {
          this.logger.debug(`Contexto establecido: ${tokenData.empresaId} - Rol: ${tokenData.principalRole} (${processingTime}ms)`);
        }
      }

      next();
    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      // Log de error solo si no es timeout esperado
      if (!error.message.includes('timeout')) {
        this.logger.error(`Error en middleware: ${error.message} (${processingTime}ms)`);
      }
      
      // Continuar sin bloquear
      next();
    }
  }

  // ✅ MÉTODOS DE CACHÉ PARA OPTIMIZAR LATENCIA
  private generateCacheKey(token: string): string {
    // Usar solo los primeros 32 caracteres para el cache key
    return `token:${token.substring(0, 32)}`;
  }

  private getFromCache(key: string): any | null {
    const cached = this.tokenCache.get(key);
    if (!cached) return null;
    
    if (Date.now() > cached.expiry) {
      this.tokenCache.delete(key);
      return null;
    }
    
    return cached.data;
  }

  private setCache(key: string, data: any): void {
    // Limitar tamaño del caché
    if (this.tokenCache.size > 1000) {
      this.cleanExpiredCache();
    }
    
    this.tokenCache.set(key, {
      data,
      expiry: Date.now() + this.CACHE_TTL
    });
  }

  private cleanExpiredCache(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, value] of this.tokenCache.entries()) {
      if (now > value.expiry) {
        this.tokenCache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0 && process.env.NODE_ENV === 'development') {
      this.logger.debug(`Cache limpiado: ${cleaned} entradas expiradas`);
    }
  }
}