// import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
// import { AuthService } from '../auth.service';

// @Injectable()
// export class HybridAuthGuard implements CanActivate {
//   private readonly logger = new Logger(HybridAuthGuard.name);

//   constructor(private readonly authService: AuthService) {}

//   async canActivate(context: ExecutionContext): Promise<boolean> {
//     const request = context.switchToHttp().getRequest();
    
//     try {
//       const authHeader = request.headers.authorization;
      
//       if (!authHeader || !authHeader.startsWith('Bearer ')) {
//         throw new UnauthorizedException('Token requerido');
//       }

//       const token = authHeader.split(' ')[1];
      
//       // Primero intentar decodificación local
//       const tokenData = this.authService.validateTokenLight(token);
      
//       if (!tokenData) {
//         throw new UnauthorizedException('Token inválido o expirado');
//       }

//       // Si tiene empresa, es un token completo - usar solo datos locales
//       if (tokenData.empresaId) {
//         request.user = {
//           id: tokenData.userId,
//           dni: tokenData.dni,
//           email: tokenData.email,
//           empresaId: tokenData.empresaId,
//           roles: this.extractRoleNames(tokenData.roles) || [],
//           principalRole: tokenData.principalRole || '',
//           permissions: tokenData.permissions || [],
//           tokenType: 'empresa'
//         };
        
//         this.logger.debug(`Token con empresa autenticado: ${tokenData.dni} - Empresa: ${tokenData.empresaId}`);
//         return true;
//       }

//       // Token básico - intentar validar con microservicio como fallback
//       try {
//         const validatedUser = await this.authService.validateToken(token);
//         if (validatedUser) {
//           request.user = {
//             ...tokenData,
//             ...validatedUser,
//             tokenType: 'basic'
//           };
//           this.logger.debug(`Token básico validado con microservicio: ${tokenData.dni}`);
//           return true;
//         }
//       } catch (microserviceError) {
//         this.logger.warn(`Microservicio no disponible, usando datos del JWT: ${microserviceError.message}`);
//       }

//       // Fallback - usar solo datos del JWT decodificado
//       request.user = {
//         id: tokenData.userId,
//         dni: tokenData.dni,
//         email: tokenData.email,
//         tokenType: 'fallback'
//       };
      
//       this.logger.debug(`Token autenticado en modo fallback: ${tokenData.dni}`);
//       return true;

//     } catch (error) {
//       this.logger.error(`Error de autenticación: ${error.message}`);
//       throw new UnauthorizedException(error.message || 'Error de autenticación');
//     }
//   }

//   private extractRoleNames(roles: any[]): string[] {
//     if (!roles || !Array.isArray(roles)) return [];
    
//     return roles.map(role => {
//       if (typeof role === 'string') return role;
//       if (typeof role === 'object' && role.name) return role.name;
//       return 'UNKNOWN_ROLE';
//     });
//   }
// }

import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { AuthService } from '../auth.service';

@Injectable()
export class HybridAuthGuard implements CanActivate {
  private readonly logger = new Logger(HybridAuthGuard.name);

  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    
    try {
      const authHeader = request.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new UnauthorizedException('Token requerido');
      }

      const token = authHeader.split(' ')[1];
      
      // Decodificar JWT localmente (más rápido)
      const tokenData = this.authService.validateTokenLight(token);
      
      if (!tokenData) {
        throw new UnauthorizedException('Token inválido o expirado');
      }

      // ✅ SIMPLIFICAR: El token ya contiene toda la información procesada por Go
      if (tokenData.empresaId) {
        request.user = {
          id: tokenData.userId,
          dni: tokenData.dni,
          email: tokenData.email,
          empresaId: tokenData.empresaId,
          // ✅ Los datos ya vienen procesados del microservicio Go
          roles: tokenData.roles || [],                    // Ya son strings
          principalRole: tokenData.principalRole || 'USER', // Ya está calculado
          permissions: tokenData.permissions || [],         // Ya es array de strings
          tokenType: 'empresa'
        };
        
        this.logger.debug(`Token con empresa: ${tokenData.dni} - Empresa: ${tokenData.empresaId} - Rol: ${tokenData.principalRole}`);
        return true;
      }

      // Token básico - validar con microservicio como fallback
      try {
        const validatedUser = await this.authService.validateToken(token);
        if (validatedUser) {
          request.user = {
            ...tokenData,
            ...validatedUser,
            tokenType: 'basic'
          };
          this.logger.debug(`Token básico validado: ${tokenData.dni}`);
          return true;
        }
      } catch (microserviceError) {
        this.logger.warn(`Microservicio no disponible: ${microserviceError.message}`);
      }

      // Fallback
      request.user = {
        id: tokenData.userId,
        dni: tokenData.dni,
        email: tokenData.email,
        tokenType: 'fallback'
      };
      
      this.logger.debug(`Token fallback: ${tokenData.dni}`);
      return true;

    } catch (error) {
      this.logger.error(`Error de autenticación: ${error.message}`);
      throw new UnauthorizedException(error.message || 'Error de autenticación');
    }
  }
}