
// export const CACHE_KEYS = {

  
//   RUBRO: {
//     // Keys base que pueden ser usadas directamente
//     BASE: {
//       ACTIVE: 'rubroactive',
//       DELETED: 'rubrodeleted',
//     },
//     // Métodos para generar keys específicas
//     PAGINATED: (page: number, limit: number) => 
//       `rubroactive:all:page${page}:limit${limit}`,
//     SINGLE: (id: string) => 
//       `rubro:${id}`,
//     ALL_ACTIVE: 'rubroactive:all',
//     ALL_DELETED: 'rubrodeleted:all',
//     // Patrón para invalidación
//     PATTERN: 'rubro:*'
//   },
  
//   PLAN: {
//     BASE: {
//       ACTIVE: 'planactive',
//       DELETED: 'plandeleted',
//     },
//     PAGINATED: (page: number, limit: number) => 
//       `planactive:all:page${page}:limit${limit}`,
//     SINGLE: (id: string) => 
//       `plan:${id}`,
//     ALL_ACTIVE: 'planactive:all',
//     ALL_DELETED: 'plandeleted:all',
//     PATTERN: 'plan:*'
//   },

//   ARCHIVO: {
//     BASE: {
//       ACTIVE: 'archivoactive',
//       DELETED: 'archivodeleted',
//     },
//     PAGINATED: (page: number, limit: number) => 
//       `archivoactive:all:page${page}:limit${limit}`,
//     PAGINATED_BY_EMPRESA: (empresaId: string, page: number, limit: number, categoria?: string) => 
//       `archivoactive:empresa:${empresaId}:${categoria || 'all'}:page${page}:limit${limit}`,
//     PAGINATED_BY_ENTIDAD: (tipoEntidad: string, entidadId: string, page: number, limit: number, categoria?: string) => 
//       `${tipoEntidad}:${entidadId}:${categoria || 'all'}:page${page}:limit${limit}`,
//     SINGLE: (id: string) => 
//       `archivo:${id}`,
//     ALL_ACTIVE: 'archivoactive:all',
//     ALL_DELETED: 'archivodeleted:all',
//     PATTERN: 'archivo:*',
//     PATTERN_ACTIVE: 'archivoactive:*',
//     PATTERN_SINGLE: 'archivo:*',
//     EMPRESA_PATTERN: (empresaId: string) => `archivoactive:empresa:${empresaId}:*`,
//     ENTIDAD_PATTERN: (tipoEntidad: string, entidadId: string) => 
//     `archivoactive:entidad:${tipoEntidad}:${entidadId}:*`
//   },
// } as const;

// Actualización de src/redis/constants/redis-cache.keys.contants.ts

export const REDIS_ENTITIES = {
  SERVICIO: 'SERVICIO',
  SERV: 'SERV',
  RUBRO: 'rubro',
  PLAN: 'plan',
  ARCHIVO: 'archivo',
  EMPRESA: 'empresa',
  ENTIDAD: 'entidad'
};

export const CACHE_KEYS = {
  AUTH: {
    USER_EMPRESAS: (userId: string) => `user:empresas:${userId}`,
    USER_LOGIN: (dni: string) => `user:login:${dni}`,
    EMPRESAS_ENRICHED: (hash: string) => `auth:empresas:enriched:${hash}`,
    PATTERN: 'auth:*',
  },

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

  ARCHIVO: {
    BASE: {
      ACTIVE: 'archivoactive',
      DELETED: 'archivodeleted',
    },
    PAGINATED: (page: number, limit: number) => 
      `archivoactive:all:page${page}:limit${limit}`,
    PAGINATED_BY_EMPRESA: (empresaId: string, page: number, limit: number, categoria?: string) => 
      `archivoactive:empresa:${empresaId}:${categoria || 'all'}:page${page}:limit${limit}`,
    PAGINATED_BY_ENTIDAD: (tipoEntidad: string, entidadId: string, page: number, limit: number, categoria?: string) => 
      `${tipoEntidad}:${entidadId}:${categoria || 'all'}:page${page}:limit${limit}`,
    SINGLE: (id: string) => 
      `archivo:${id}`,
    ALL_ACTIVE: 'archivoactive:all',
    ALL_DELETED: 'archivodeleted:all',
    PATTERN: 'archivo:*',
    PATTERN_ACTIVE: 'archivoactive:*',
    PATTERN_SINGLE: 'archivo:*',
    EMPRESA_PATTERN: (empresaId: string) => `archivoactive:empresa:${empresaId}:*`,
    ENTIDAD_PATTERN: (tipoEntidad: string, entidadId: string) => 
    `archivoactive:entidad:${tipoEntidad}:${entidadId}:*`
  },

  // Nuevas claves estructuradas para entidades dinámicas (SERVICIO:SERV)
  SERVICIO: {
    BASE: (servicioId: string) => `${REDIS_ENTITIES.SERVICIO}${servicioId}`,
    WITH_SERV: (servicioId: string, servId: string) => 
      `${REDIS_ENTITIES.SERVICIO}${servicioId}:${REDIS_ENTITIES.SERV}${servId}`,
    PAGINATED: (servicioId: string, servId: string, page: number, limit: number) => 
      `${REDIS_ENTITIES.SERVICIO}${servicioId}:${REDIS_ENTITIES.SERV}${servId}:all:page${page}:limit${limit}`,
    ALL: (servicioId: string, servId: string) => 
      `${REDIS_ENTITIES.SERVICIO}${servicioId}:${REDIS_ENTITIES.SERV}${servId}:all`,
    // Patrones para limpieza
    PATTERN: `${REDIS_ENTITIES.SERVICIO}*`,
    SERVICIO_PATTERN: (servicioId: string) => `${REDIS_ENTITIES.SERVICIO}${servicioId}:*`,
    SERV_PATTERN: (servId: string) => `*:${REDIS_ENTITIES.SERV}${servId}:*`,
    SERVICIO_SERV_PATTERN: (servicioId: string, servId: string) => 
      `${REDIS_ENTITIES.SERVICIO}${servicioId}:${REDIS_ENTITIES.SERV}${servId}:*`
  }
} as const;

// Funciones útiles para limpieza por segmentos
export const CACHE_PATTERNS = {
  // Genera un patrón para limpiar todas las claves relacionadas con una entidad principal
  forEntityType: (entityType: string, entityId: string) => 
    `${entityType}${entityId}:*`,
  
  // Genera un patrón para limpiar todas las claves relacionadas con una subentidad
  forSubEntityType: (subEntityType: string, subEntityId: string) => 
    `*:${subEntityType}${subEntityId}:*`,
  
  // Genera un patrón para limpiar todas las claves relacionadas con una entidad y subentidad
  forEntityPair: (entityType: string, entityId: string, subEntityType: string, subEntityId: string) => 
    `${entityType}${entityId}:${subEntityType}${subEntityId}:*`,
  
  // Genera un patrón para limpiar todas las claves que coincidan con los segmentos específicos
  forSegments: (segments: string[]) => segments.join(':') + ':*'
};
