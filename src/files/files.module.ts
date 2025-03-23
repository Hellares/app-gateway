import {  Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { RabbitMQModule } from 'src/transports/rabbitmq.module';
import { APP_FILTER } from '@nestjs/core';
import { MulterExceptionFilter } from 'src/common/exceptions/multer-exception.filter';
import { RpcCustomExceptionFilter } from 'src/common/exceptions/rpc-custom-exception.filter';
import { UnifiedFilesService } from './unified-files.service';
import { ArchivoModule } from 'src/archivos/archivo.module';
import { ImageProcessorService } from './image-processor.service';
import { ProcessingStatusController } from './processing-status.controller';
import { RabbitMQConsumerService } from './rabbitmq-consumer.service';
// import { FileValidator } from './common/validator/file.validator';

@Module({
  imports: [
    RabbitMQModule,
    ArchivoModule
  ],
  controllers: [
    FilesController,
    ProcessingStatusController // Asegúrate de incluir este controlador
  ],
  providers: [
    // FileValidator,
    UnifiedFilesService,
    ImageProcessorService,
    RabbitMQConsumerService, // Añadimos el nuevo servicio consumidor
    {
      provide: APP_FILTER,
      useClass: MulterExceptionFilter,
    },
    {
      provide: APP_FILTER,
      useClass: RpcCustomExceptionFilter,
    }
  ],
  exports: [UnifiedFilesService],
})
export class FilesModule {}


