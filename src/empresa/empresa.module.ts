import { Module } from '@nestjs/common';
import { RabbitMQModule } from 'src/transports/rabbitmq.module';
import { EmpresaController } from './empresa.controller';

@Module({
  controllers: [EmpresaController],
  providers: [],
  imports: [ RabbitMQModule],
})
export class EmpresaModule {}
