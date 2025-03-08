import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { envs } from './config';
import {  ValidationPipe } from '@nestjs/common';
import { CONSOLE_COLORS } from './common/constants/colors.constants';
import { RpcCustomExceptionFilter } from './common/exceptions/rpc-custom-exception.filter';
import { Logger, PinoLogger  } from 'nestjs-pino';

async function bootstrap() {
  // const logger = new Logger(` ${CONSOLE_COLORS.TEXT.FUCHSIA}APP-GATEWAY ${CONSOLE_COLORS.TEXT.YELLOW}`);

  const app = await NestFactory.create(AppModule,{
    bufferLogs: true,
    logger: ['error', 'warn']
  });
  // Obtener la instancia base de Logger para useLogger
  const logger = app.get(Logger);
  
  // Obtener PinoLogger para el contexto específico
  const pinoLogger = await app.resolve(PinoLogger);
  pinoLogger.setContext('APP-GATEWAY');

  // Usar Pino como logger principal
  app.useLogger(logger);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  

  app.useGlobalFilters(new RpcCustomExceptionFilter());

  await app.listen(envs.port);
  
  pinoLogger.info(`Server started on port ${envs.port}`);
}
bootstrap();
