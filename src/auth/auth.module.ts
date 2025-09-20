// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
// import { JwtStrategy } from './strategies/jwt.strategy';
import { envs } from '../config';
import { RabbitMQModule } from 'src/transports/rabbitmq.module';
import { HttpModule } from '@nestjs/axios';
import { EmpresaGuard } from './guards/empresa.guard';
import { EmpresaContextMiddlewareOptimized } from './middleware/empresa-context.middleware';
import { HybridAuthGuard } from './guards/hybrid-auth.guard';
import { RedisModule } from 'src/redis/redis.module';
// import { EmpresaContextMiddleware } from './middleware/empresa-context.middleware';

@Module({
  imports: [
    HttpModule,
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: envs.jwtSecret,
      signOptions: { expiresIn: '24h' },
    }),
    RabbitMQModule,
    RedisModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService, 
    // JwtStrategy,
    EmpresaGuard,
    EmpresaContextMiddlewareOptimized,
    HybridAuthGuard,
  ],
  exports: [
    AuthService, 
    JwtModule, 
    PassportModule,
    EmpresaGuard,
    HybridAuthGuard,
    EmpresaContextMiddlewareOptimized,
  ],
})
export class AuthModule {}