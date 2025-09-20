// src/types/express-extension.d.ts
   export interface EmpresaContext {
     empresaId: string;
     roles: string[];
     principalRole: string;
     permissions: string[];
   }

   declare module 'express-serve-static-core' {
     interface Request {
       empresaContext?: EmpresaContext;
     }
   }