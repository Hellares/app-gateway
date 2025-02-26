export interface FileTypeConfig {
  maxSize: number;
  allowedMimeTypes: string[];
}

export const FILE_CONFIG = {
  maxSize: 20 * 1024 * 1024, // 20MB como máximo general
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
};

export const FILE_VALIDATION = {
  MAX_FILES: 10,
  TIMEOUT: 30000, // 30 segundos
  CHUNK_SIZE: 512 * 1024 // 512KB por chunk
};