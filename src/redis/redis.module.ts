import { Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { RedisController } from './redis.controller';
import { RabbitMQModule } from 'src/transports/rabbitmq.module';

@Module({
  controllers: [RedisController],
  providers: [RedisService, ],
  imports: [RabbitMQModule],
  exports: [RedisService],
})
export class RedisModule {}
