// src/files/services/unified-files.service.ts
import { Injectable, Inject, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout, catchError } from 'rxjs';
import { SERVICES } from 'src/transports/constants';
import { ArchivoService } from 'src/archivos/archivo.service';
import { CategoriaArchivo } from 'src/common/enums/categoria-archivo.enum';
import { formatFileSize } from 'src/common/util/format-file-size.util';
import { FILE_VALIDATION } from './common/constants/file.validator.constant';
import { FileErrorHelper } from './common/helpers/file-error.helper';
import { ImageProcessorService } from './image-processor.service';

const IMAGE_PROCESSING_CONFIG = {
  // Tamaño en bytes a partir del cual se procesarán las imágenes
  // Por defecto: 1MB
  sizeThreshold: 1024 * 1024,
  
  // Opciones de procesamiento para diferentes tipos de imágenes
  presets: {
    // Para imágenes de perfil/avatar (tamaño pequeño, alta calidad)
    profile: {
      maxWidth: 500,
      maxHeight: 500,
      quality: 90,
      format: 'jpeg' as const
    },
    // Para imágenes de productos (tamaño medio, buena calidad)
    product: {
      maxWidth: 1200,
      maxHeight: 1200,
      quality: 85,
      format: 'webp' as const
    },
    // Para imágenes de banners/portadas (más grandes, calidad media)
    banner: {
      maxWidth: 1920,
      maxHeight: 1080,
      quality: 80,
      format: 'webp' as const
    },
    // Para miniaturas (muy pequeñas, calidad reducida)
    thumbnail: {
      maxWidth: 300,
      maxHeight: 300,
      quality: 75,
      format: 'webp' as const
    },
    // Configuración por defecto para todas las demás imágenes
    default: {
      maxWidth: 1600,
      maxHeight: 1600,
      quality: 80,
      format: 'webp' as const
    }
  }
};

@Injectable()
export class UnifiedFilesService {
  private readonly logger = new Logger(UnifiedFilesService.name);
  private readonly isDevelopment = process.env.NODE_ENV !== 'production';

  constructor(
    @Inject(SERVICES.FILES) private readonly filesClient: ClientProxy,
    private readonly archivoService: ArchivoService,
    private readonly imageProcessor: ImageProcessorService
  ) {}

  /**
   * Sube un archivo al proveedor de almacenamiento y opcionalmente registra sus metadatos
   * Para imágenes, aplica procesamiento para reducir su tamaño si es necesario
   */
  async uploadFile(
    file: Express.Multer.File,
    options?: {
      provider?: string;
      tenantId?: string;
      empresaId?: string;
      tipoEntidad?: string;
      entidadId?: string;
      categoria?: CategoriaArchivo;
      descripcion?: string;
      esPublico?: boolean;
      imagePreset?: keyof typeof IMAGE_PROCESSING_CONFIG.presets; // Nuevo: preset para procesamiento de imágenes
      skipImageProcessing?: boolean; // Nuevo: opción para omitir el procesamiento
    }
  ) {
    const startTime = Date.now();
    const originalFileSize = file.size;
    const formattedOriginalSize = formatFileSize(originalFileSize);

    // Solo log en desarrollo
    if (this.isDevelopment) {
      this.logger.debug(`Iniciando upload: ${file.originalname} (${formattedOriginalSize})`);
    }

    try {
      // Variables para rastrear información de procesamiento
      let processedFile = file;
      let processingInfo = null;
      // Verificar si es una imagen que debe ser procesada
      const shouldProcessImage = !options?.skipImageProcessing && 
                               this.imageProcessor.isImage(file.mimetype) && 
                               file.size > IMAGE_PROCESSING_CONFIG.sizeThreshold;

      // Procesar la imagen si es necesario
      if (shouldProcessImage) {
        // Determinar qué preset usar
        const preset = options?.imagePreset 
          ? IMAGE_PROCESSING_CONFIG.presets[options.imagePreset]
          : IMAGE_PROCESSING_CONFIG.presets.default;
          
        if (this.isDevelopment) {
          this.logger.debug(`🖼️ Procesando imagen usando preset ${options?.imagePreset || 'default'}`);
        }
        
        // Procesar la imagen
        const { buffer, info } = await this.imageProcessor.processImage(file.buffer, file.mimetype, preset);
        
        // Actualizar el archivo con el buffer procesado
        processedFile = {
          ...file,
          buffer,
          size: buffer.length // Actualizar el tamaño
        };
        
        processingInfo = info;
        
        if (this.isDevelopment && info.processed) {
          this.logger.debug({
            originalSize: formattedOriginalSize,
            newSize: formatFileSize(buffer.length),
            reduction: info.reduction,
            processingTime: info.duration
          }, '🖼️ Imagen procesada');
        }
      }

     // Crear una versión optimizada del objeto file para enviar por RabbitMQ
     const bufferBase64 = processedFile.buffer.toString('base64');

      // Solo log de análisis de tamaño en desarrollo
      if (this.isDevelopment) {
        const optimizedFileSize = Buffer.byteLength(bufferBase64);
        const formattedOptimizedSize = formatFileSize(optimizedFileSize);
        const compressionRatio = (optimizedFileSize / originalFileSize).toFixed(2);

        this.logger.debug({
          originalSize: formattedOriginalSize,
          serializedSize: formattedOptimizedSize,
          compressionRatio: compressionRatio,
          fileName: file.originalname
        }, 'Analisis de tamanio del mensaje');
      }



      // Crear una versión optimizada del objeto file para enviar por RabbitMQ
      const optimizedFile = {
        originalname: processedFile.originalname,
        mimetype: processedFile.mimetype,
        size: processedFile.size,  // Usar el tamaño procesado
        bufferBase64: processedFile.buffer.toString('base64')  // Usar el buffer procesado
      };

      // 1. Subir el archivo físico
      const fileResponse = await firstValueFrom(
        this.filesClient.send('file.upload.optimized', {
          file: optimizedFile,
          provider: options?.provider || 'firebase',
          tenantId: options?.tenantId || 'admin'
        }).pipe(
          timeout(FILE_VALIDATION.TIMEOUT),
          catchError(error => {
            throw FileErrorHelper.handleUploadError(error, file.originalname);
          })
        )
      );

      // Solo log en desarrollo
      if (this.isDevelopment) {
        this.logger.debug(`Archivo subido: ${fileResponse.filename}`);
      }

      // 2. Si hay información de entidad, crear registro de metadatos
      if (options?.tipoEntidad && options?.entidadId) {
        await this.archivoService.createArchivo({
          nombre: processedFile.originalname,  // Usar los datos del archivo procesado
          filename: this.archivoService.extractFilename(fileResponse.filename),
          ruta: fileResponse.filename,
          tipo: processedFile.mimetype,
          tamanho: processedFile.size,  // Usar el tamaño procesado
          empresaId: options.empresaId,
          categoria: options.categoria || CategoriaArchivo.LOGO,
          tipoEntidad: options.tipoEntidad,
          entidadId: options.entidadId,
          descripcion: options.descripcion || `Archivo para ${options.tipoEntidad}`,
          esPublico: options.esPublico !== undefined ? options.esPublico : true,
          provider: options.provider,
          // metadatos: processingInfo ? { imagenProcesada: processingInfo } : undefined
        });
        
        // Solo log en desarrollo
        if (this.isDevelopment) {
          this.logger.debug(`Metadatos de archivo registrados para ${options.tipoEntidad} ${options.entidadId}`);
        }
      }

      // Construir respuesta enriquecida
      const response = {
        ...fileResponse,
        url: this.archivoService.buildFileUrl(fileResponse.filename),
        processed: processingInfo ? processingInfo.processed : false,
        originalSize: file.size,
        finalSize: processedFile.size,
        reduction: processingInfo ? processingInfo.reduction : '0%'
      };

      const duration = Date.now() - startTime;
      
      if (this.isDevelopment) {
        this.logger.debug({
          fileName: file.originalname,
          duration: `${duration}ms`,
          originalSize: formattedOriginalSize,
          finalSize: formatFileSize(processedFile.size),
          processed: processingInfo ? true : false,
          ...(processingInfo && { reduction: processingInfo.reduction })
        }, `✅ Proceso de upload completado`);
      }


      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Error en upload: ${file.originalname}`, {
        error: error.message,
        duration: `${duration}ms`
      });
      throw error;
    }
  }

  /**
   * Elimina un archivo y sus metadatos asociados
   */
  async deleteFile(
    filename: string,
    options?: {
      provider?: string;
      tenantId?: string;
      eliminarMetadatos?: boolean;
    }
  ) {
    const startTime = Date.now();
    
    // Solo log en desarrollo
    if (this.isDevelopment) {
      this.logger.debug(`Eliminando archivo: ${filename}`);
    }

    try {
      // 1. Eliminar el archivo físico
      await firstValueFrom(
        this.filesClient.send('file.delete', {
          filename,
          provider: options?.provider || 'firebase',
          tenantId: options?.tenantId || 'admin'
        }).pipe(
          timeout(FILE_VALIDATION.TIMEOUT),
          catchError(error => {
            throw FileErrorHelper.handleDeleteError(error, filename);
          })
        )
      );

      // 2. Si se solicita, eliminar también los metadatos asociados
      if (options?.eliminarMetadatos !== false) {
        // Implementación de eliminación de metadatos
        
        // Solo log en desarrollo
        if (this.isDevelopment) {
          this.logger.debug(`Metadatos de archivo eliminados para ${filename}`);
        }
      }

      // Solo log en desarrollo
      if (this.isDevelopment) {
        const duration = Date.now() - startTime;
        this.logger.debug(`Archivo eliminado en ${duration}ms`);
      }

      return {
        success: true,
        message: `Archivo ${filename} eliminado correctamente`,
        duration: `${Date.now() - startTime}ms`
      };
    } catch (error) {
      // Los errores sí se loguean tanto en desarrollo como en producción
      const duration = Date.now() - startTime;
      this.logger.error(`Error al eliminar: ${filename}`, {
        error: error.message,
        duration: `${duration}ms`
      });
      throw error;
    }
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
    const startTime = Date.now();
    
    // Solo log en desarrollo
    if (this.isDevelopment) {
      this.logger.debug(`Obteniendo archivo: ${filename}`);
    }

    try {
      const buffer = await firstValueFrom(
        this.filesClient.send('file.get', {
          filename,
          provider: options?.provider || 'firebase',
          tenantId: options?.tenantId || 'admin'
        }).pipe(
          timeout(FILE_VALIDATION.TIMEOUT),
          catchError(error => {
            throw FileErrorHelper.handleUploadError(error, filename);
          })
        )
      );

      // Solo log en desarrollo
      if (this.isDevelopment) {
        const duration = Date.now() - startTime;
        this.logger.debug(`Archivo obtenido en ${duration}ms`);
      }

      return buffer;
    } catch (error) {
      // Los errores sí se loguean tanto en desarrollo como en producción
      const duration = Date.now() - startTime;
      this.logger.error(`Error al obtener: ${filename}`, {
        error: error.message,
        duration: `${duration}ms`
      });
      throw error;
    }
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
        url: this.archivoService.buildFileUrl(archivo.ruta)
      }));
    } catch (error) {
      // Los errores sí se loguean tanto en desarrollo como en producción
      this.logger.error(`Error al obtener archivos para ${tipoEntidad} ${entidadId}`, {
        error: error.message
      });
      throw error;
    }
  }
}