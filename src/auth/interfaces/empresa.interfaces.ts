// src/auth/interfaces/empresa.interfaces.ts

// export interface EmpresaAuth {
//   id: string;
//   roles: string[];
//   principalRole: string;
//   permissions: string[];
// }

// export interface EmpresaDetail {
//   id: string;
//   razonSocial: string;
//   ruc: string;
//   estado: string;
//   rubro?: string;
// }

// export interface EmpresaEnriquecida {
//   id: string;
//   razonSocial: string | null;
//   ruc: string | null;
//   estado: string;
//   rubro?: string | null;
//   roles: string[];
//   principalRole: string;
//   permissions: string[];
// }

// export interface SelectEmpresaResponse {
//   token: string;
//   empresaId: string;
//   roles: string[];
//   permissions: string[];
//   principalRole: string;
// }

// export interface LoginMultiempresaResponse {
//   token: string;
//   user: any;
//   empresas: EmpresaAuth[];
//   isSuperAdmin: boolean;
//   needsEmpresaSelection: boolean;
// }

// DTO para selección de empresa
export interface SelectEmpresaDto {
  empresaId: string;
}