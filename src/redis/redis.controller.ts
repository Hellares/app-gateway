import { Controller, Get, Logger, Post } from '@nestjs/common';
import { RedisService } from './redis.service';

@Controller('redis')
export class RedisController {
  private readonly logger = new Logger('RedisController');
  constructor(private readonly redisService: RedisService) {}

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
