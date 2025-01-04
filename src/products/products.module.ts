import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { RabbitMQModule } from 'src/transports/rabbitmq.module';

@Module({
  controllers: [ProductsController],
  providers: [],
  imports: [ RabbitMQModule],
})
export class ProductsModule {}
