import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { envs } from './config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { CONSOLE_COLORS } from './common/constants/colors.constants';
import { RpcCustomExceptionFilter } from './common/exceptions/rpc-custom-exception.filter';

async function bootstrap() {
  const logger = new Logger(` ${CONSOLE_COLORS.TEXT.FUCHSIA}APP-GATEWAY ${CONSOLE_COLORS.TEXT.YELLOW}`);

  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new RpcCustomExceptionFilter());

  await app.listen(envs.port);
  logger.log(`${CONSOLE_COLORS.TEXT.CYAN }👾🐷🆗 Server started on port ${envs.port}`);
}
bootstrap();
