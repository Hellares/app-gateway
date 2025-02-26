import {  Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { RabbitMQModule } from 'src/transports/rabbitmq.module';
import { APP_FILTER } from '@nestjs/core';
import { MulterExceptionFilter } from 'src/common/exceptions/multer-exception.filter';
import { RpcCustomExceptionFilter } from 'src/common/exceptions/rpc-custom-exception.filter';
// import { FileValidator } from './common/validator/file.validator';

@Module({
  imports: [RabbitMQModule],
  controllers: [FilesController],
  providers: [
    // FileValidator,
    {
      provide: APP_FILTER,
      useClass: MulterExceptionFilter,
    },
    {
      provide: APP_FILTER,
      useClass: RpcCustomExceptionFilter,
    }
  ],
  exports: [],
})
export class FilesModule {}
