export const SERVICES = {
  REDIS: 'REDIS_SERVICE',
  PRODUCTS: 'PRODUCTS_SERVICE',
  COMPANY: 'COMPANY_SERVICE',
  RUBROS: 'RUBROS_SERVICE',
  FILES: 'FILES_SERVICE',
  ARCHIVO: 'ARCHIVO_SERVICE',
  IMAGE_PROCESSOR: 'IMAGE_PROCESSOR_SERVICE', // Nuevo servicio para el procesador de imágenes
  PROCESSED_IMAGES: 'PROCESSED_IMAGES_SERVICE',
} as const;

export const QUEUES = {
  REDIS: 'redis_queue',
  PRODUCTS: 'products_queue',
  COMPANY: 'company_queue',
  RUBROS: 'rubros_queue',
  FILES: 'files_queue',
  ARCHIVO: 'archivo_queue',
  IMAGES_TO_PROCESS: 'images-to-process', // Cola para enviar imágenes a procesar
  PROCESSED_IMAGES: 'processed-images', // Cola para recibir resultados
} as const;