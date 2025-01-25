// cache-keys.constants.ts
export const CACHE_KEYS = {
  RUBRO: {
    ALL_ACTIVE: 'rubroactive:all',
    ALL_DELETED: 'rubrodeleted:all',
    SINGLE: (id: string) => `rubro:${id}`
  },
  PLAN: {
    ALL_ACTIVE: 'planactive:all',
    ALL_DELETED: 'plandeleted:all',
    SINGLE: (id: string) => `plan:${id}`
  },
  // Otros módulos...
} as const;

// export const CACHE_TTL = {
//   SHORT: 300,     // 5 minutos
//   MEDIUM: 3600,   // 1 hora
//   LONG: 86400,    // 1 día
//   PERMANENT: -1   // Sin expiración
// } as const;