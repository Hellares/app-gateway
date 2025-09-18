interface EmpresaAuth {
  id: string;
  roles: string[];
  principalRole: string;
  permissions: string[];
  rubros?: string; // Opcional, si decides incluir rubros en el futuro
}

interface EmpresaDetail {
  id: string;
  razonSocial: string;
  ruc: string;
  estado: string;
  rubro?: string; // Opcional, si decides incluir rubros en el futuro
}

interface EmpresaEnriquecida {
  id: string;
  // name: string;
  razonSocial: string | null;
  ruc: string | null;
  estado: string;
  roles: string[];
  principalRole: string;
  permissions: string[];
  rubros?: string; // Opcional, si decides incluir rubros en el futuro
}

interface LoginResponse {
  token: string;
  user: any;
  empresas: EmpresaAuth[];
  isSuperAdmin: boolean;
  needsEmpresaSelection: boolean;
}