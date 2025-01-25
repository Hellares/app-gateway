import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { RabbitMQModule } from 'src/transports/rabbitmq.module';

@Module({
  imports: [RabbitMQModule],
  controllers: [FilesController],
  providers: [],
})
export class FilesModule {}
