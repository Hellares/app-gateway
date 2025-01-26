// // cache-keys.constants.ts
// export const CACHE_KEYS = {
//   RUBRO: {
//     ALL_ACTIVE: 'rubroactive:all',
//     ALL_DELETED: 'rubrodeleted:all',
//     SINGLE: (id: string) => `rubro:${id}`
//   },
//   PLAN: {
//     ALL_ACTIVE: 'planactive:all',
//     ALL_DELETED: 'plandeleted:all',
//     SINGLE: (id: string) => `plan:${id}`
//   },
//   // Otros módulos...
// } as const;

// redis-cache.keys.constants.ts

// Prefijos para cada tipo de recurso
// redis-cache.keys.constants.ts

// Prefijos para cada tipo de recurso

export const CACHE_KEYS = {
  RUBRO: {
    // Keys base que pueden ser usadas directamente
    BASE: {
      ACTIVE: 'rubroactive',
      DELETED: 'rubrodeleted',
    },
    // Métodos para generar keys específicas
    PAGINATED: (page: number, limit: number) => 
      `rubroactive:all:page${page}:limit${limit}`,
    SINGLE: (id: string) => 
      `rubro:${id}`,
    ALL_ACTIVE: 'rubroactive:all',
    ALL_DELETED: 'rubrodeleted:all',
    // Patrón para invalidación
    PATTERN: 'rubro:*'
  },
  
  PLAN: {
    BASE: {
      ACTIVE: 'planactive',
      DELETED: 'plandeleted',
    },
    PAGINATED: (page: number, limit: number) => 
      `planactive:all:page${page}:limit${limit}`,
    SINGLE: (id: string) => 
      `plan:${id}`,
    ALL_ACTIVE: 'planactive:all',
    ALL_DELETED: 'plandeleted:all',
    PATTERN: 'plan:*'
  },
} as const;
