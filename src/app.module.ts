import { Module } from '@nestjs/common';
import { ProductsModule } from './products/products.module';
import { RabbitMQModule } from './transports/rabbitmq.module';

@Module({
  controllers: [],
  providers: [],
  imports: [ProductsModule, RabbitMQModule],
})
export class AppModule {}
