import { Module } from '@nestjs/common';
import { RubroController } from './rubro.controller';
import { RabbitMQModule } from 'src/transports/rabbitmq.module';
import { RedisModule } from 'src/redis/redis.module';
import { DEFAULT_RATE_LIMIT_CONFIG } from 'src/common/guards/rate-limit.config';
import { RateLimitGuard } from 'src/common/guards/rate-limit.guard';
import { ArchivoModule } from 'src/archivos/archivo.module';
import { ArchivoService } from 'src/archivos/archivo.service';
import { UnifiedFilesService } from 'src/files/unified-files.service';
import { ImageProcessorService } from 'src/files/image-processor.service';
// import { FileValidator } from 'src/files/common/validator/file.validator';



@Module({
  imports: [
    RabbitMQModule,
    RedisModule,
    ArchivoModule
  ],
  controllers: [RubroController],
  providers: [
    {
          provide: 'RATE_LIMIT_CONFIG',
          useValue: DEFAULT_RATE_LIMIT_CONFIG
        },
    RateLimitGuard,
    UnifiedFilesService,
    ImageProcessorService,
    // FileValidator,
  ],
})
export class RubroModule {}
