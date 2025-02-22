import { Module } from '@nestjs/common';
import { RubroController } from './rubro.controller';
import { RabbitMQModule } from 'src/transports/rabbitmq.module';
import { RedisModule } from 'src/redis/redis.module';
import { DEFAULT_RATE_LIMIT_CONFIG } from 'src/common/guards/rate-limit.config';
import { RateLimitGuard } from 'src/common/guards/rate-limit.guard';
import { FileValidator } from 'src/files/common/validator/file.validator';



@Module({
  controllers: [RubroController],
  providers: [
    {
          provide: 'RATE_LIMIT_CONFIG',
          useValue: DEFAULT_RATE_LIMIT_CONFIG
        },
    RateLimitGuard,
    FileValidator,
  ],
  imports: [
    RabbitMQModule,
    RedisModule,

  ],
})
export class RubroModule {}
