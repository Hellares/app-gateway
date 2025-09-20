// import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
// import { Request, Response, NextFunction } from 'express';
// import { AuthService } from '../auth.service';
// // Los tipos ya están disponibles globalmente

// @Injectable()
// export class EmpresaContextMiddleware implements NestMiddleware {
//   private readonly logger = new Logger(EmpresaContextMiddleware.name);

//   constructor(private readonly authService: AuthService) {}

//   async use(req: Request, res: Response, next: NextFunction) {
//     try {
//       const authHeader = req.headers.authorization;
//       if (!authHeader || !authHeader.startsWith('Bearer ')) {
//         return next();
//       }

//       const token = authHeader.split(' ')[1];
//       const tokenData = await this.authService.validateToken(token);
      
//       if (!tokenData) {
//         return next();
//       }

//       if (tokenData.empresaId) {
//         req.empresaContext = {
//           empresaId: tokenData.empresaId,
//           roles: tokenData.roles || [],
//           principalRole: tokenData.principalRole || '',
//           permissions: tokenData.permissions || []
//         };
        
//         this.logger.debug(`Contexto de empresa establecido: ${tokenData.empresaId}`);
//       }

//       next();
//     } catch (error) {
//       this.logger.error(`Error en middleware de contexto de empresa: ${error.message}`);
//       next();
//     }
//   }
// }

import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../auth.service';

@Injectable()
export class EmpresaContextMiddlewareOptimized implements NestMiddleware {
  private readonly logger = new Logger(EmpresaContextMiddlewareOptimized.name);
  
  private readonly excludedPaths = [
    '/auth/login',
    '/auth/register',
    '/auth/verify-email',
    '/auth/request-password-reset',
    '/auth/reset-password',
    '/health',
    '/metrics'
  ];

  constructor(private readonly authService: AuthService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    try {
      const path = req.path;
      if (this.excludedPaths.some(excluded => path.startsWith(excluded))) {
        return next();
      }

      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next();
      }

      const token = authHeader.split(' ')[1];
      const tokenData = this.authService.validateTokenLight(token);
      
      if (!tokenData) {
        return next();
      }

      // ✅ SIMPLIFICAR: Los datos ya vienen procesados correctamente del JWT
      if (tokenData.empresaId) {
        req.empresaContext = {
          empresaId: tokenData.empresaId,
          roles: tokenData.roles || [],           // Ya son strings desde Go
          principalRole: tokenData.principalRole || 'USER', // Ya calculado en Go
          permissions: tokenData.permissions || [] // Ya es array desde Go
        };
        
        this.logger.debug(`Contexto establecido: ${tokenData.empresaId} - Rol: ${tokenData.principalRole}`);
      }

      next();
    } catch (error) {
      this.logger.error(`Error en middleware: ${error.message}`);
      next();
    }
  }
}