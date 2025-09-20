import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { EmpresaContext } from '../../types/express-extension';

export const GetEmpresaContext = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): EmpresaContext | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.empresaContext;
  },
);
