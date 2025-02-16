// src/security/security.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';


@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);

  // Constantes para las keys de seguridad
  private readonly SECURITY_KEYS = {
    RATE_LIMIT: {
      BLOCKED: {
        PREFIX: 'ratelimit:blocked:',
        PATTERN: 'ratelimit:blocked:*'
      }
    }
  } as const;

  constructor(private readonly redisService: RedisService) {}

  async getBlockedIps(): Promise<any[]> {
    try {
      const pattern = this.SECURITY_KEYS.RATE_LIMIT.BLOCKED.PATTERN;
      const response = await this.redisService.get<any[]>(pattern);
      
      if (!response?.success) {
        return [];
      }

      const blockedIps = [];
      const data = response.data || [];

      // Procesar cada key encontrada
      for (const item of data) {
        if (item && typeof item === 'object') {
          const ip = item.key?.replace(this.SECURITY_KEYS.RATE_LIMIT.BLOCKED.PREFIX, '');
          if (ip) {
            blockedIps.push({
              ip,
              blockedAt: item.timestamp || new Date().toISOString(),
              expiresAt: item.expiresAt
            });
          }
        }
      }

      return blockedIps;
    } catch (error) {
      this.logger.error('Error obteniendo IPs bloqueadas:', error);
      return [];
    }
  }

  async generateSecurityReport(): Promise<any> {
    const blockedIps = await this.getBlockedIps();
    const currentTime = new Date().toISOString();

    return {
      timestamp: currentTime,
      totalBlockedIps: blockedIps.length,
      blockedIps,
      metrics: {
        activeBlocks: blockedIps.filter(ip => ip.expiresAt > currentTime).length,
        expiredBlocks: blockedIps.filter(ip => ip.expiresAt <= currentTime).length
      }
    };
  }

  // Método auxiliar para limpiar IPs bloqueadas expiradas
  async cleanupExpiredBlocks(): Promise<void> {
    try {
      const blockedIps = await this.getBlockedIps();
      const currentTime = new Date().toISOString();

      for (const ip of blockedIps) {
        if (ip.expiresAt <= currentTime) {
          const key = this.SECURITY_KEYS.RATE_LIMIT.BLOCKED.PREFIX + ip.ip;
          await this.redisService.delete(key);
          this.logger.debug(`Limpiado bloqueo expirado para IP: ${ip.ip}`);
        }
      }
    } catch (error) {
      this.logger.error('Error limpiando bloques expirados:', error);
    }
  }
}