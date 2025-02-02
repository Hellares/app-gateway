import { Module } from '@nestjs/common';
import { RabbitMQModule } from './transports/rabbitmq.module';
import { EmpresaModule } from './empresa/empresa.module';
import { RubroModule } from './rubro/rubro.module';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';
import { PlansModule } from './plans/plans.module';
import { FilesModule } from './files/files.module';

@Module({
  controllers: [],
  providers: [],
  imports: [
    RabbitMQModule, 
    EmpresaModule,
    RubroModule,
    RedisModule,
    PlansModule,
    FilesModule,
    
  ],
})
export class AppModule {}
