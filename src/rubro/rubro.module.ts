import { Module } from '@nestjs/common';
import { RubroController } from './rubro.controller';
import { RabbitMQModule } from 'src/transports/rabbitmq.module';
import { RedisModule } from 'src/redis/redis.module';

@Module({
  controllers: [RubroController],
  providers: [],
  imports: [
    RabbitMQModule,
    RedisModule,
  ],
})
export class RubroModule {}
