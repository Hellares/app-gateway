import { Module } from '@nestjs/common';
import { PlanController } from './plans.controller';
import { RabbitMQModule } from 'src/transports/rabbitmq.module';
import { RedisModule } from 'src/redis/redis.module';

@Module({
  controllers: [PlanController],
  providers: [],
  imports: [
    RabbitMQModule,
    RedisModule,
  ],
})
export class PlansModule {}



export class RubroModule {}

