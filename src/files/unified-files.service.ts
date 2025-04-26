import { Injectable, Logger } from '@nestjs/common';
import { FileStorageService } from './file-storage.service';
import { ImageProcessingService } from './image-processing.service';
import { ProcessingManagerService } from './processing-manager.service';
import { ArchivoService } from 'src/archivos/archivo.service';
import { CategoriaArchivo } from 'src/common/enums/categoria-archivo.enum';
import { FileUploadOptions } from './interfaces/file-upload-options.interface';
import { url } from 'inspector';


@Injectable()
export class UnifiedFilesService {
  private readonly logger = new Logger(UnifiedFilesService.name);
  private readonly isDevelopment = process.env.NODE_ENV !== 'production';

  constructor(
    private readonly fileStorage: FileStorageService,
    private readonly imageProcessing: ImageProcessingService,
    private readonly processingManager: ProcessingManagerService,
    private readonly archivoService: ArchivoService
  ) {}

  /**
   * Método principal para subir y procesar archivos
   * Actúa como fachada para los servicios especializados
   */
  async uploadFile(
    file: Express.Multer.File,
    options?: FileUploadOptions
  ) {
    const startTime = Date.now();
    
    try {
      // Comprobar si es una imagen
      const isImage = this.imageProcessing['isImage'](file.mimetype);
      
      // Para archivos que no son imágenes o si se solicita omitir el procesamiento
      if (!isImage || options?.skipImageProcessing) {
        const result = await this.uploadRawFile(file, options);
        
        if (this.isDevelopment) {
          const duration = Date.now() - startTime;
          this.logger.debug(`Archivo subido sin procesar en ${duration}ms: ${file.originalname}`);
        }
        
        return result;
      }
      
      // Para imágenes que deben procesarse
      const result = await this.imageProcessing.processAndUploadFile(file, options);
      
      if (this.isDevelopment) {
        const duration = Date.now() - startTime;
        this.logger.debug(`Imagen procesada y subida en ${duration}ms: ${file.originalname}`);
      }
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error({
        error: error.message,
        duration: `${duration}ms`
      }, `Error en upload: ${file.originalname}`);
      
      throw error;
    }
  }
  
  /**
   * Sube un archivo sin procesamiento
   */
  private async uploadRawFile(
    file: Express.Multer.File,
    options?: FileUploadOptions
  ) {
    // Optimizar para envío
    const optimizedFile = {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      bufferBase64: file.buffer.toString('base64')
    };

    // Subir al almacenamiento
    const fileResponse = await this.fileStorage.uploadFile(optimizedFile, {
      provider: options?.provider || 'firebase',
      tenantId: options?.tenantId || 'admin',
      empresaId: options?.empresaId
    });

    // Registrar metadatos si es necesario
    if (!options?.skipMetadataRegistration && options?.tipoEntidad && options?.entidadId) {
      await this.archivoService.createArchivo({
        nombre: file.originalname,
        filename: this.archivoService.extractFilename(fileResponse.filename),
        ruta: fileResponse.filename,
        tipo: file.mimetype,
        tamanho: file.size,
        empresaId: options.empresaId,
        categoria: options.categoria || CategoriaArchivo.LOGO,
        tipoEntidad: options.tipoEntidad,
        entidadId: options.entidadId,
        descripcion: options.descripcion || `Archivo para ${options.tipoEntidad}`,
        esPublico: options.esPublico !== undefined ? options.esPublico : true,
        provider: options.provider
      });
    }

    // Construir respuesta
    return {
      ...fileResponse,
      // url: this.archivoService.buildFileUrl(fileResponse.filename),
      url: this.archivoService.buildFileUrl(fileResponse.filename, {
        provider: options?.provider
      }),
      originalName: file.originalname,
      originalSize: file.size,
      finalSize: file.size,
      processed: false,
      reduction: '0%',
    };
  }

  /**
   * Obtiene un archivo por su nombre
   */
  async getFile(
    filename: string,
    options?: {
      provider?: string;
      tenantId?: string;
    }
  ) {
    return this.fileStorage.getFile(filename, options);
  }

  /**
   * Elimina un archivo y opcionalmente sus metadatos
   */
  async deleteFile(
    filename: string,
    options?: {
      provider?: string;
      tenantId?: string;
      eliminarMetadatos?: boolean;
    }
  ) {
    const fileResult = await this.fileStorage.deleteFile(filename);
    
    // Eliminar metadatos si se solicita
    if (options?.eliminarMetadatos !== false) {
      // Extraer el nombre base sin la ruta
      const baseFilename = this.archivoService.extractFilename(filename);
      
      try {
        await this.archivoService.deleteArchivo(filename);
        
        if (this.isDevelopment) {
          this.logger.debug(`Metadatos eliminados para: ${baseFilename}`);
        }
      return fileResult;
      } catch (error) {
        if (this.isDevelopment) {
          this.logger.warn(`No se pudieron eliminar metadatos para: `, error.message);
        }
      }
    
  
    return fileResult;
    }
  }

  async deleteMultipleFiles(
    filenames: string[],
    options?: {
      provider?: string;
      tenantId?: string;
      eliminarMetadatos?: boolean;
    }
  ) {
    const results = {
      deletedFiles: [],
      failedFiles: []
    };
  
    // Procesar cada archivo para eliminar
    await Promise.all(
      filenames.map(async (filename) => {
        try {
          // Usar el método existente para eliminar cada archivo
          await this.deleteFile(filename, options);
          results.deletedFiles.push(filename);
        } catch (error) {
          this.logger.error(`Error al eliminar archivo ${filename}:`, error);
          results.failedFiles.push({
            filename,
            error: error.message || 'Error desconocido'
          });
        }
      })
    );
  
    if (this.isDevelopment) {
      this.logger.debug(`Eliminados ${results.deletedFiles.length} archivos, fallaron ${results.failedFiles.length}`);
    }
  
    return results;
  }

  /**
   * Obtiene las imágenes asociadas a una entidad específica
   */
  async getEntityFiles(tipoEntidad: string, entidadId: string) {
    try {
      const archivos = await this.archivoService.findArchivosByEntidad(tipoEntidad, entidadId);
      
      // Enriquecer con URLs
      return archivos.map(archivo => ({
        ...archivo,
        url: this.archivoService.buildFileUrl(archivo.ruta),
      }));
    } catch (error) {
      this.logger.error(`Error al obtener archivos para ${tipoEntidad} ${entidadId}`, {
        error: error.message
      });
      throw error;
    }
  }

  /**
 * Lista archivos por tenantId
 */
async listFiles(
  tenantId: string,
  options?: {
    provider?: string;
  }
) {
  const startTime = Date.now();
  
  try {
    if (!tenantId) {
      throw new Error('Se requiere un tenantId para listar archivos');
    }
    
    const result = await this.fileStorage.listFiles(tenantId, options);
    
    const duration = Date.now() - startTime;
    
    if (this.isDevelopment) {
      this.logger.debug(`Archivos listados en ${duration}ms: ${result.summary.count} archivos para ${tenantId}`);
    }
    
    // Enriquecer con URLs
    result.files = result.files.map(files => ({
      ...files,
      // url: this.archivoService.buildFileUrl(files.filename)
    }));
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    this.logger.error(`Error al listar archivos para ${tenantId} en ${duration}ms`, error);
    throw error;
  }
}
  
  /**
   * Obtiene el estado de un procesamiento asíncrono
   */
  async getProcessingStatus(processingId: string) {
    return this.processingManager.getJobStatus(processingId);
  }
  
  /**
   * Obtiene estadísticas de procesamiento
   */
  getProcessingStats() {
    return this.processingManager.getProcessingStats();
  }
  
  /**
   * Método para que los callbacks de procesamiento resuelvan promesas pendientes
   */
  handleProcessedImageResponse(data: any): void {
    this.processingManager.handleProcessedImageResponse(data);
  }

 
}