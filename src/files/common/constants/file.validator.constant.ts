// src/files/common/constants/file.validator.constant.ts

import { FileConfigurations } from "../interfaces/file-config.interface";
import { FileType } from "./file-types.constant";



export const DEFAULT_IMAGE_CONFIG = {
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as const
};

export const FILE_CONFIG: FileConfigurations = {
  // Configuración base/default para validaciones generales
  maxSize: 2 * 1024 * 1024, // 2MB como máximo general
  allowedMimeTypes: [...DEFAULT_IMAGE_CONFIG.allowedMimeTypes],
  
  // Configuraciones específicas por tipo
  types: {
    [FileType.CATEGORY]: {
      maxSize: 500 * 1024, // 500KB
      dimensions: {
        width: 800,
        height: 600,
        quality: 80
      },
      allowedMimeTypes: [...DEFAULT_IMAGE_CONFIG.allowedMimeTypes],
      processOptions: {
        image: {
          maxWidth: 800,
          maxHeight: 600,
          quality: 80
        }
      }
    },

    [FileType.ICON]: {
      maxSize: 200 * 1024, // 200KB
      dimensions: {
        width: 200,
        height: 200,
        quality: 85
      },
      allowedMimeTypes: [...DEFAULT_IMAGE_CONFIG.allowedMimeTypes],
      processOptions: {
        image: {
          maxWidth: 200,
          maxHeight: 200,
          quality: 85
        }
      }
    },

    [FileType.THUMBNAIL]: {
      maxSize: 150 * 1024, // 150KB
      dimensions: {
        width: 320,
        height: 240,
        quality: 75
      },
      allowedMimeTypes: [...DEFAULT_IMAGE_CONFIG.allowedMimeTypes],
      processOptions: {
        image: {
          maxWidth: 320,
          maxHeight: 240,
          quality: 75
        }
      }
    },

    [FileType.BANNER]: {
      maxSize: 1024 * 1024, // 1MB
      dimensions: {
        width: 1920,
        height: 480,
        quality: 85
      },
      allowedMimeTypes: [...DEFAULT_IMAGE_CONFIG.allowedMimeTypes],
      processOptions: {
        image: {
          maxWidth: 1920,
          maxHeight: 480,
          quality: 85
        }
      }
    },

    [FileType.PORTADA]: {
      maxSize: 2 * 1024 * 1024, // 2MB
      dimensions: {
        width: 1200,
        height: 630,
        quality: 90
      },
      allowedMimeTypes: [...DEFAULT_IMAGE_CONFIG.allowedMimeTypes],
      processOptions: {
        image: {
          maxWidth: 1200,
          maxHeight: 630,
          quality: 90
        }
      }
    },

    [FileType.AVATAR]: {
      maxSize: 100 * 1024, // 100KB
      dimensions: {
        width: 150,
        height: 150,
        quality: 80
      },
      allowedMimeTypes: [...DEFAULT_IMAGE_CONFIG.allowedMimeTypes],
      processOptions: {
        image: {
          maxWidth: 150,
          maxHeight: 150,
          quality: 80
        }
      }
    }
  }
} as const;

// Constantes adicionales para validación
export const FILE_VALIDATION = {
  MAX_FILES: 10,
  TIMEOUT: 30000,
  MAX_RETRIES: 3,          // Número máximo de reintentos
  RETRY_DELAY: 1000, 
  SIZE_UNITS: {
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024
  }
} as const;

// Helper para convertir bytes a una unidad legible
export const formatFileSize = (bytes: number): string => {
  if (bytes < FILE_VALIDATION.SIZE_UNITS.KB) return `${bytes} B`;
  if (bytes < FILE_VALIDATION.SIZE_UNITS.MB) return `${(bytes / FILE_VALIDATION.SIZE_UNITS.KB).toFixed(2)} KB`;
  if (bytes < FILE_VALIDATION.SIZE_UNITS.GB) return `${(bytes / FILE_VALIDATION.SIZE_UNITS.MB).toFixed(2)} MB`;
  return `${(bytes / FILE_VALIDATION.SIZE_UNITS.GB).toFixed(2)} GB`;
};