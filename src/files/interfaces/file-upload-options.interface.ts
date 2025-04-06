// file-upload-options.interface.ts
import { CategoriaArchivo } from 'src/common/enums/categoria-archivo.enum';

/**
 * Opciones para la carga y procesamiento de archivos
 */
export interface FileUploadOptions {
  // Identificación y metadatos
  empresaId?: string;
  tipoEntidad?: string;
  entidadId?: string;
  categoria?: CategoriaArchivo;
  descripcion?: string;
  esPublico?: boolean;
  
  // Opciones de almacenamiento
  provider?: string;
  tenantId?: string;
  
  // Opciones de procesamiento
  useAdvancedProcessing?: boolean;
  imagePreset?: 'profile' | 'PRODUCTO' | 'banner' | 'thumbnail' | 'default';
  async?: boolean;
  
  // Configuración de comportamiento
  skipMetadataRegistration?: boolean;
  skipImageProcessing?: boolean;
}