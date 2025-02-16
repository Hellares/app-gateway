import { Module } from '@nestjs/common';
import { RubroController } from './rubro.controller';
import { RabbitMQModule } from 'src/transports/rabbitmq.module';
import { RedisModule } from 'src/redis/redis.module';
import { DEFAULT_RATE_LIMIT_CONFIG } from 'src/common/guards/rate-limit.config';
import { RateLimitGuard } from 'src/common/guards/rate-limit.guard';



@Module({
  controllers: [RubroController],
  providers: [
    {
          provide: 'RATE_LIMIT_CONFIG',
          useValue: DEFAULT_RATE_LIMIT_CONFIG
        },
    RateLimitGuard
  ],
  imports: [
    RabbitMQModule,
    RedisModule,

  ],
})
export class RubroModule {}
