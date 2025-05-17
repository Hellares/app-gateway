// src/auth/strategies/jwt.strategy.ts
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from '../auth.service';
import { envs } from '../../config';
import { Request } from 'express';


@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
  constructor(private readonly authService: AuthService) {

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: envs.jwtSecret,
      passReqToCallback: true, // Importante: pasar el objeto request al callback
    });
    this.logger.debug(`JWT Strategy inicializada con secretKey: ${envs.jwtSecret.substring(0, 3)}...`);
  }

  async validate(request: Request, payload: any) {
    this.logger.debug(`Validando token JWT: ${JSON.stringify(payload)}`);
    // Extraer el token del encabezado Authorization
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(request);
    
    if (!token) {
      this.logger.error('Token no proporcionado');
      throw new UnauthorizedException('Token no proporcionado');
    }
    
    // Validar el token con el microservicio de autenticación
    const user = await this.authService.validateToken(token);
    
    if (!user) {
      this.logger.error('Token inválido o expirado');
      throw new UnauthorizedException('Token inválido o expirado');
    }
    this.logger.debug(`Usuario validado: ${user.id}`);
    return user; // Este objeto estará disponible como req.user
  }
}