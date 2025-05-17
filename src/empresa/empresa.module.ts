import { Module } from '@nestjs/common';
import { RabbitMQModule } from 'src/transports/rabbitmq.module';
import { EmpresaController } from './empresa.controller';
import { ArchivoService } from 'src/archivos/archivo.service';
import { RedisModule } from 'src/redis/redis.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  controllers: [
    EmpresaController,
  ],
  providers: [ArchivoService],
  imports: [ 
    RabbitMQModule,
    RedisModule,
    AuthModule, // Importar AuthModule para poder usar JwtAuthGuard
  ],
})
export class EmpresaModule {}
