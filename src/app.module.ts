import { Module } from '@nestjs/common';
import { RabbitMQModule } from './transports/rabbitmq.module';
import { EmpresaModule } from './empresa/empresa.module';
import { RubroModule } from './rubro/rubro.module';
import { RedisModule } from './redis/redis.module';
// import { RedisService } from './redis/redis.service';
import { PlansModule } from './plans/plans.module';
import { FilesModule } from './files/files.module';
import { ArchivoModule } from './archivos/archivo.module';
import { LoggerModule } from 'nestjs-pino';

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
        
        // Personalización de los logs HTTP
        // autoLogging: {
        //   // No loguear health checks o solicitudes a recursos estáticos
        //   ignore: (req) => req.url.includes('/health') || 
        //                   req.url.includes('/favicon.ico') ||
        //                   req.url.includes('/public/'),
        // },
        
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
          req: (req) => ({
            id: req.id,
            method: req.method,
            url: req.url,
            // Limitar la cantidad de datos para reducir el tamaño del log
          }),
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
    ArchivoModule
  ],
})
export class AppModule {}
