import { SetMetadata } from '@nestjs/common';

export const RequireEmpresaRoles = (...roles: string[]) => SetMetadata('empresaRoles', roles);
export const RequireEmpresaPermissions = (...permissions: string[]) => SetMetadata('empresaPermissions', permissions);
