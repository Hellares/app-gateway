import { Module } from '@nestjs/common';
import { RabbitMQModule } from 'src/transports/rabbitmq.module';
import { EmpresaController } from './empresa.controller';
import { ArchivoService } from 'src/archivos/archivo.service';
import { RedisModule } from 'src/redis/redis.module';

@Module({
  controllers: [
    EmpresaController,
  ],
  providers: [ArchivoService],
  imports: [ 
    RabbitMQModule,
    RedisModule,
  ],
})
export class EmpresaModule {}
