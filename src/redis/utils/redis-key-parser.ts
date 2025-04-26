// src/redis/utils/redis-key-parser.ts
import { REDIS_ENTITIES } from '../constants/redis-cache.keys.contants';

/**
 * Interfaz que define la estructura de una clave de Redis analizada
 */
export interface ParsedRedisKey {
  entityType?: string;     // Primer segmento (ej: SERVICIO123)
  entityId?: string;       // ID extraído del primer segmento si contiene números
  subEntityType?: string;  // Segundo segmento (ej: SERV456)
  subEntityId?: string;    // ID extraído del segundo segmento si contiene números
  operation?: string;      // Tercer segmento (ej: all)
  pagination?: {
    page?: number;
    limit?: number;
  };
  rawSegments: string[];   // Todos los segmentos originales
  originalKey: string;     // Clave completa original
}

/**
 * Analiza una clave de Redis y extrae sus componentes basados en la estructura:
 * SERVICIO123:SERV456:all:page2:limit10
 * 
 * @param key La clave de Redis a analizar
 * @returns Un objeto con los componentes de la clave
 */
export function parseRedisKey(key: string): ParsedRedisKey {
  const segments = key.split(':');
  const result: ParsedRedisKey = {
    rawSegments: segments,
    originalKey: key
  };

  // Procesar primer segmento (entidad principal)
  if (segments.length > 0) {
    const firstSegment = segments[0];
    const entityMatch = extractEntityInfo(firstSegment);
    
    if (entityMatch) {
      result.entityType = entityMatch.type;
      result.entityId = entityMatch.id;
    } else {
      result.entityType = firstSegment;
    }
  }

  // Procesar segundo segmento (subentidad)
  if (segments.length > 1) {
    const secondSegment = segments[1];
    const subEntityMatch = extractEntityInfo(secondSegment);
    
    if (subEntityMatch) {
      result.subEntityType = subEntityMatch.type;
      result.subEntityId = subEntityMatch.id;
    } else {
      result.subEntityType = secondSegment;
    }
  }

  // Procesar tercer segmento (operación)
  if (segments.length > 2) {
    result.operation = segments[2];
  }

  // Procesar paginación (page y limit)
  result.pagination = {};
  
  for (let i = 3; i < segments.length; i++) {
    const segment = segments[i];
    
    if (segment.startsWith('page')) {
      const pageValue = segment.replace('page', '');
      result.pagination.page = parseInt(pageValue, 10) || undefined;
    } else if (segment.startsWith('limit')) {
      const limitValue = segment.replace('limit', '');
      result.pagination.limit = parseInt(limitValue, 10) || undefined;
    }
  }

  return result;
}

/**
 * Función auxiliar para extraer tipo e ID de un segmento de clave
 * @param segment Segmento a analizar
 * @returns Objeto con tipo e ID si se encuentra un patrón, null si no
 */
function extractEntityInfo(segment: string): { type: string; id: string } | null {
  // Caso 1: Patrón estándar como "SERVICIO123" (letras seguidas de números)
  const standardMatch = segment.match(/^([A-Za-z]+)(\d+)$/);
  if (standardMatch) {
    return { type: standardMatch[1], id: standardMatch[2] };
  }
  
  // Caso 2: Verificar entidades conocidas con formatos especiales
  for (const [entityKey, entityValue] of Object.entries(REDIS_ENTITIES)) {
    // Si el segmento comienza con el tipo de entidad conocido
    if (segment.startsWith(entityValue)) {
      const id = segment.substring(entityValue.length);
      if (id) {
        return { type: entityValue, id };
      }
    }
  }

  // Caso 3: Entidades específicas como "rubro:123"
  if (segment.includes(':')) {
    const parts = segment.split(':');
    return { type: parts[0], id: parts[1] };
  }

  return null;
}

/**
 * Genera un patrón de Redis para limpiar claves basado en componentes específicos
 * 
 * @param components Objeto con componentes para construir el patrón
 * @returns Un patrón de Redis para usar con KEYS o SCAN
 */
export function buildRedisPattern(components: Partial<ParsedRedisKey>): string {
  const patterns: string[] = [];
  
  // Añadir entidad principal
  if (components.entityType) {
    if (components.entityId) {
      patterns.push(`${components.entityType}${components.entityId}`);
    } else {
      patterns.push(`${components.entityType}*`);
    }
  } else {
    patterns.push('*');
  }
  
  // Añadir subentidad
  if (components.subEntityType) {
    if (components.subEntityId) {
      patterns.push(`${components.subEntityType}${components.subEntityId}`);
    } else {
      patterns.push(`${components.subEntityType}*`);
    }
  } else if (patterns.length > 0) {
    patterns.push('*');
  }
  
  // Añadir operación
  if (components.operation) {
    patterns.push(components.operation);
  } else if (patterns.length > 0) {
    patterns.push('*');
  }
  
  // Añadir parámetros de paginación si existen
  if (components.pagination?.page !== undefined) {
    patterns.push(`page${components.pagination.page}`);
  } else if (patterns.length > 2) { // Solo si ya tenemos entidad y subentidad
    patterns.push('*');
  }
  
  if (components.pagination?.limit !== undefined) {
    patterns.push(`limit${components.pagination.limit}`);
  } else if (patterns.length > 3) { // Solo si ya tenemos entidad, subentidad y página
    patterns.push('*');
  }
  
  // Si tenemos rawSegments, los usamos directamente en lugar de construir el patrón
  if (components.rawSegments && components.rawSegments.length > 0) {
    return components.rawSegments.join(':') + ':*';
  }
  
  return patterns.join(':');
}