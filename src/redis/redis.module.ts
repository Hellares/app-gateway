import { Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { RabbitMQModule } from 'src/transports/rabbitmq.module';
import { RedisController } from './redis.controller';
import { DEFAULT_RATE_LIMIT_CONFIG } from 'src/common/guards/rate-limit.config';

@Module({
  imports: [RabbitMQModule],
  controllers: [RedisController],
  providers: [
    RedisService, 
    {
      provide: 'RATE_LIMIT_CONFIG',
      useValue: DEFAULT_RATE_LIMIT_CONFIG
    }
  ],
  exports: [RedisService],
})
export class RedisModule {}
