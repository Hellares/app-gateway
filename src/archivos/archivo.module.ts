// src/archivos/archivo.module.ts
import { Module } from '@nestjs/common';
import { ArchivoService } from './archivo.service';
import { ConfigModule } from '@nestjs/config';
import { RabbitMQModule } from 'src/transports/rabbitmq.module';

@Module({
  imports: [
    ConfigModule,
    RabbitMQModule
  ],
  providers: [ArchivoService],
  exports: [ArchivoService],
})
export class ArchivoModule {}