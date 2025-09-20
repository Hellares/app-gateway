// import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
// import { Reflector } from '@nestjs/core';

// @Injectable()
// export class EmpresaGuard implements CanActivate {
//   private readonly logger = new Logger(EmpresaGuard.name);

//   constructor(private reflector: Reflector) {}

//   canActivate(context: ExecutionContext): boolean {
//     // Obtener roles requeridos del metadata del controlador/método
//     const requiredRoles = this.reflector.get<string[]>('empresaRoles', context.getHandler()) ||
//                          this.reflector.get<string[]>('empresaRoles', context.getClass()) ||
//                          [];

//     const requiredPermissions = this.reflector.get<string[]>('empresaPermissions', context.getHandler()) ||
//                                this.reflector.get<string[]>('empresaPermissions', context.getClass()) ||
//                                [];

//     // Si no hay requisitos específicos, permitir acceso
//     if (requiredRoles.length === 0 && requiredPermissions.length === 0) {
//       return true;
//     }

//     const request = context.switchToHttp().getRequest();
//     const empresaContext = request.empresaContext;

//     if (!empresaContext) {
//       this.logger.warn('No hay contexto de empresa en la petición');
//       throw new ForbiddenException('Contexto de empresa requerido');
//     }

//     // Verificar roles requeridos
//     if (requiredRoles.length > 0) {
//       const hasRequiredRole = requiredRoles.some(role => 
//         empresaContext.roles.includes(role) || empresaContext.principalRole === role
//       );
      
//       if (!hasRequiredRole) {
//         this.logger.warn(`Usuario no tiene roles requeridos: ${requiredRoles.join(', ')}`);
//         throw new ForbiddenException('Rol insuficiente para esta operación');
//       }
//     }

//     // Verificar permisos requeridos
//     if (requiredPermissions.length > 0) {
//       const hasRequiredPermission = requiredPermissions.some(permission => 
//         empresaContext.permissions.includes(permission)
//       );
      
//       if (!hasRequiredPermission) {
//         this.logger.warn(`Usuario no tiene permisos requeridos: ${requiredPermissions.join(', ')}`);
//         throw new ForbiddenException('Permisos insuficientes para esta operación');
//       }
//     }

//     this.logger.debug(`Acceso autorizado para empresa: ${empresaContext.empresaId}`);
//     return true;
//   }
// }

import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class EmpresaGuard implements CanActivate {
  private readonly logger = new Logger(EmpresaGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Obtener roles requeridos del metadata del controlador/método
    const requiredRoles = this.reflector.get<string[]>('empresaRoles', context.getHandler()) ||
                         this.reflector.get<string[]>('empresaRoles', context.getClass()) ||
                         [];

    const requiredPermissions = this.reflector.get<string[]>('empresaPermissions', context.getHandler()) ||
                               this.reflector.get<string[]>('empresaPermissions', context.getClass()) ||
                               [];

    // Si no hay requisitos específicos, permitir acceso
    if (requiredRoles.length === 0 && requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    
    // ✅ PRIORIZAR datos del usuario autenticado por HybridAuthGuard
    const user = request.user;
    const empresaContext = request.empresaContext;
    
    // Usar datos del usuario si están disponibles, sino usar contexto del middleware
    const contextData = user?.empresaId ? {
      empresaId: user.empresaId,
      roles: user.roles || [],
      principalRole: user.principalRole || 'USER',
      permissions: user.permissions || []
    } : empresaContext;

    if (!contextData || !contextData.empresaId) {
      this.logger.warn('No hay contexto de empresa disponible');
      throw new ForbiddenException('Contexto de empresa requerido');
    }

    // Verificar roles requeridos
    if (requiredRoles.length > 0) {
      const hasRequiredRole = requiredRoles.some(role => 
        contextData.roles.includes(role) || contextData.principalRole === role
      );
      
      if (!hasRequiredRole) {
        this.logger.warn(`Usuario no tiene roles requeridos: ${requiredRoles.join(', ')}`);
        throw new ForbiddenException('Rol insuficiente para esta operación');
      }
    }

    // Verificar permisos requeridos
    if (requiredPermissions.length > 0) {
      const hasRequiredPermission = requiredPermissions.some(permission => 
        contextData.permissions.includes(permission)
      );
      
      if (!hasRequiredPermission) {
        this.logger.warn(`Usuario no tiene permisos requeridos: ${requiredPermissions.join(', ')}`);
        throw new ForbiddenException('Permisos insuficientes para esta operación');
      }
    }

    this.logger.debug(`Acceso autorizado para empresa: ${contextData.empresaId} - Rol: ${contextData.principalRole}`);
    return true;
  }
}