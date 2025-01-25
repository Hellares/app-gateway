export const SERVICES = {
  REDIS: 'REDIS_SERVICE',
  PRODUCTS: 'PRODUCTS_SERVICE',
  COMPANY: 'COMPANY_SERVICE',
  RUBROS: 'RUBROS_SERVICE',
  FILES: 'FILES_SERVICE',
} as const;

export const QUEUES = {
  REDIS: 'redis_queue',
  PRODUCTS: 'products_queue',
  COMPANY: 'company_queue',
  RUBROS: 'rubros_queue',
  FILES: 'files_queue',
} as const;