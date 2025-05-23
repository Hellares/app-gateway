import { MiddlewareConsumer, Module } from '@nestjs/common';
import { RabbitMQModule } from './transports/rabbitmq.module';
import { EmpresaModule } from './empresa/empresa.module';
import { RubroModule } from './rubro/rubro.module';
import { RedisModule } from './redis/redis.module';
// import { RedisService } from './redis/redis.service';
import { PlansModule } from './plans/plans.module';
import { FilesModule } from './files/files.module';
import { ArchivoModule } from './archivos/archivo.module';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';


@Module({
  controllers: [],
  providers: [],
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',

        messageKey: 'message',

        // Desactivar el logging automático de HTTP (mejor para microservicios)
        autoLogging: false,
        
        // Formateo para desarrollo
        transport: process.env.NODE_ENV !== 'production' 
          ? {
              target: 'pino-pretty',
              options: {
                messageKey: 'message',
                colorize: true,
                ignore: 'pid,hostname',
                translateTime: 'SYS:standard',
              },
            }
          : undefined,
        
        // Información personalizada
        customProps: () => ({
          service: 'api-gateway',
          environment: process.env.NODE_ENV || 'development',
          version: process.env.APP_VERSION || '1.0.0',
        }),

        // Redactado de información sensible
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
          remove: true,
        },
        
        // Optimización de serialización
        serializers: {
          req: () => undefined,
          res: (res) => ({
            statusCode: res.statusCode,
          }),
          err: (err) => ({
            type: err.constructor.name,
            message: err.message,
            stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
          }),
        },
      },
    }),
    RabbitMQModule, 
    EmpresaModule,
    RubroModule,
    RedisModule,
    PlansModule,
    FilesModule,
    ArchivoModule,
    AuthModule,
    UserModule,
  ],
})
export class AppModule {}

