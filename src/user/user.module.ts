// En user.module.ts
import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { AuthModule } from 'src/auth/auth.module';
import { RabbitMQModule } from 'src/transports/rabbitmq.module';

@Module({
  controllers: [UserController],
  imports: [
    AuthModule,
    RabbitMQModule
  ],
})
export class UserModule {}