// image-processing.service.ts
import { Injectable, Logger, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { SERVICES } from 'src/transports/constants';
import { firstValueFrom } from 'rxjs';
import { ProcessingManagerService } from './processing-manager.service';
import { FileStorageService } from './file-storage.service';
import { ArchivoService } from 'src/archivos/archivo.service';
import { CategoriaArchivo } from 'src/common/enums/categoria-archivo.enum';

import * as sharp from 'sharp';
import { FileUploadOptions } from './interfaces/file-upload-options.interface';

// Configuración de procesamiento de imágenes
export const IMAGE_PROCESSING_CONFIG = {
  // Tamaño en bytes a partir del cual se procesarán las imágenes (1MB)
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
    PRODUCTO: {
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

export interface ProcessedImageResult {
  buffer: Buffer;
  info: {
    processed: boolean;
    originalSize: number;
    newSize: number;
    reduction: string;
    width?: number;
    height?: number;
    format?: string;
    newFormat?: string;
    duration?: string;
    reason?: string;
    message?: string;
  };
}

export interface ImageProcessOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: 'jpeg' | 'png' | 'webp';
  preserveAspectRatio?: boolean;
}

@Injectable()
export class ImageProcessingService {
  private readonly logger = new Logger(ImageProcessingService.name);
  private readonly isDevelopment = process.env.NODE_ENV !== 'production';

  constructor(
    @Inject(SERVICES.IMAGE_PROCESSOR) private readonly imageProcessorClient: ClientProxy,
    private readonly processingManager: ProcessingManagerService,
    private readonly fileStorage: FileStorageService,
    private readonly archivoService: ArchivoService
  ) {}

  /**
   * Procesa y sube un archivo con la estrategia adecuada
   */
  async processAndUploadFile(
    file: Express.Multer.File,
    options?: FileUploadOptions
  ) {
    const startTime = Date.now();
    const originalFileSize = file.size;
    
    try {
      // Si se solicita saltar el procesamiento de imágenes o no es una imagen
      if (options?.skipImageProcessing || !this.isImage(file.mimetype)) {
        return this.uploadOriginalFile(file, options);
      }

      // Decidir si usar procesamiento avanzado (Python) o básico (Sharp)
      const useAdvancedProcessing = this.shouldUseAdvancedProcessing(file, options);
      
      if (useAdvancedProcessing) {
        // Usar microservicio Python
        if (this.isDevelopment) {
          this.logger.debug(`Usando microservicio 'GO' para procesar: ${file.originalname}`);
        }
        
        // Procesamiento síncrono o asíncrono según la opción
        if (options?.async) {
          return this.processWithGoServiceAsync(file, options);
        } else {
          return this.processWithGoServiceSync(file, options);
        }
      } else {
        // Usar procesamiento local con Sharp
        if (this.isDevelopment) {
          this.logger.debug(`Usando Sharp para procesar: ${file.originalname}`);
        }
        
        // Procesar con Sharp
        return this.processWithSharp(file, options);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error({
        error: error.message,
        duration: `${duration}ms`
      }, `Error procesando archivo: ${file.originalname}`);
      
      throw error;
    }
  }

  /**
   * Determina si debe usar el microservicio Python para el procesamiento
   */
  private shouldUseAdvancedProcessing(
    file: Express.Multer.File,
    options?: any
  ): boolean {
    // Si el usuario especificó explícitamente
    if (options?.useAdvancedProcessing === true) return true;
    if (options?.useAdvancedProcessing === false) return false;
    
    // Si es una petición de alta prioridad y el sistema está bajo carga,
    // procesar localmente para responder más rápido
    if (options?.priority === 'alta' && this.processingManager.getProcessingStats().totalProcessed > 10) {
      if (this.isDevelopment) {
        this.logger.debug(`Procesando localmente imagen de alta prioridad debido a carga del sistema`);
      }
      return false;
    }
    
    // Para imágenes pequeñas (<2MB), usar siempre Sharp (más rápido)
    if (file.size < 2 * 1024 * 1024) return false;
    
    // Si se solicita omitir el registro de metadatos, probablemente sea para un registro inicial
    // En este caso, priorizar velocidad usando Sharp
    if (options?.skipMetadataRegistration) {
      return false;
    }
    
    // Criterios automáticos de decisión para imágenes grandes
    
    // 1. Por formato: formatos complejos o con transparencia al microservicio
    const complexFormats = ['image/png', 'image/webp', 'image/gif'];
    if (complexFormats.includes(file.mimetype)) return true;
    
    // 2. Por preset: ciertos presets requieren procesamiento avanzado
    if (options?.imagePreset === 'product' || options?.imagePreset === 'banner') return true;
    
    // 3. Por tamaño: imágenes muy grandes (>5MB) al microservicio
    if (file.size > 5 * 1024 * 1024) return true;
    
    // Por defecto, usar Sharp para todo lo demás
    return false;
  }

  /**
   * Sube el archivo original sin procesamiento
   */
  private async uploadOriginalFile(
    file: Express.Multer.File,
    options?: any
  ): Promise<any> {
    // Optimizar objeto file para enviar por RabbitMQ
    const optimizedFile = {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      bufferBase64: file.buffer.toString('base64')
    };

    // Subir archivo físico
    const fileResponse = await this.fileStorage.uploadFile(optimizedFile, {
      provider: options?.provider || 'firebase',
      tenantId: options?.tenantId || 'admin',
      empresaId: options?.empresaId
    });

    // Registrar metadatos si es necesario y no se solicitó omitirlo
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
      url: this.archivoService.buildFileUrl(fileResponse.filename),
      processed: false,
      originalSize: file.size,
      finalSize: file.size,
      reduction: '0%'
    };
  }

  /**
   * Procesa una imagen con Sharp
   */
  private async processWithSharp(
    file: Express.Multer.File,
    options?: any
  ): Promise<any> {
    const startTime = Date.now();
    
    try {
      // Obtener preset
      const preset = options?.imagePreset 
        ? IMAGE_PROCESSING_CONFIG.presets[options.imagePreset]
        : IMAGE_PROCESSING_CONFIG.presets.default;
      
      // Procesar la imagen
      const result = await this.processImage(file.buffer, file.mimetype, preset);
      
      // Crear archivo procesado
      const processedFile = {
        ...file,
        buffer: result.buffer,
        size: result.buffer.length
      };
      
      // Optimizar para envío
      const optimizedFile = {
        originalname: processedFile.originalname,
        mimetype: processedFile.mimetype,
        size: processedFile.size,
        bufferBase64: processedFile.buffer.toString('base64')
      };

      // Subir archivo al almacenamiento
      const fileResponse = await this.fileStorage.uploadFile(optimizedFile, {
        provider: options?.provider || 'firebase',
        tenantId: options?.tenantId || 'admin',
        empresaId: options?.empresaId
      });

      // Registrar metadatos si es necesario
      if (!options?.skipMetadataRegistration && options?.tipoEntidad && options?.entidadId) {
        await this.archivoService.createArchivo({
          nombre: processedFile.originalname,
          filename: this.archivoService.extractFilename(fileResponse.filename),
          ruta: fileResponse.filename,
          tipo: processedFile.mimetype,
          tamanho: processedFile.size,
          empresaId: options.empresaId,
          categoria: options.categoria || CategoriaArchivo.LOGO,
          tipoEntidad: options.tipoEntidad,
          entidadId: options.entidadId,
          descripcion: options.descripcion || `Archivo para ${options.tipoEntidad}`,
          esPublico: options.esPublico !== undefined ? options.esPublico : true,
          provider: options.provider
        });
      }
      
      const processingTime = Date.now() - startTime;

      // Respuesta enriquecida
      return {
        ...fileResponse,
        url: this.archivoService.buildFileUrl(fileResponse.filename),
        processed: true,
        originalSize: file.size,
        finalSize: processedFile.size,
        reduction: result.info.reduction || '0%',
        processingTime: `${processingTime}ms`
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Procesa una imagen con el microservicio Python de forma sincrónica
   */
  private async processWithGoServiceSync(
    file: Express.Multer.File,
    options?: any
  ): Promise<any> {
    // Registrar un trabajo de procesamiento
    const processingId = this.processingManager.registerProcessingJob(file, options);
    
    // Crear mensaje para el microservicio
    const message = this.createImageProcessingMessage(file, processingId, options);
    
    try {
      // Marcar como iniciado el procesamiento
      this.processingManager.startProcessing(processingId);
      
      // Enviar el mensaje al microservicio
      await firstValueFrom(
        this.imageProcessorClient.emit('images-to-process', message)
      );
      
      // Esperar por el resultado usando el Job ID
      // La promesa se resolverá cuando handleProcessedImageResponse sea llamado
      const result = await new Promise<any>((resolve, reject) => {
        // Esperar a que el processingManager resuelva este trabajo
        const subscription = this.processingManager.jobCompleted$.subscribe(({ id, result }) => {
          if (id === processingId) {
            resolve(result);
            subscription.unsubscribe();
          }
        });
        
        // También podríamos rechazar la promesa si el trabajo falla
        // Esto normalmente se manejaría mediante timeouts en el processingManager
      });
      
      if (result && (result.id || result.processed || result.reduction)) {
        // Procesamos localmente la imagen usando el resultado del microservicio
        const preset = options?.imagePreset 
          ? IMAGE_PROCESSING_CONFIG.presets[options.imagePreset]
          : IMAGE_PROCESSING_CONFIG.presets.default;
            
        const processedResult = await this.processImage(file.buffer, file.mimetype, preset);
        
        // Crear archivo procesado con el buffer local
        const processedFile = {
          ...file,
          buffer: processedResult.buffer,
          size: processedResult.buffer.length
        };

        // Optimizar para envío
        const optimizedFile = {
          originalname: processedFile.originalname,
          mimetype: processedFile.mimetype,
          size: processedFile.size,
          bufferBase64: processedFile.buffer.toString('base64')
        };

        // Subir al almacenamiento
        const fileResponse = await this.fileStorage.uploadFile(optimizedFile, {
          provider: options?.provider || 'firebase',
          tenantId: options?.tenantId || 'admin',
          empresaId: options?.empresaId
        });

        // Registrar metadatos si no se solicitó omitirlo
        if (!options?.skipMetadataRegistration && options?.tipoEntidad && options?.entidadId) {
          await this.archivoService.createArchivo({
            nombre: processedFile.originalname,
            filename: this.archivoService.extractFilename(fileResponse.filename),
            ruta: fileResponse.filename,
            tipo: processedFile.mimetype,
            tamanho: processedFile.size,
            empresaId: options.empresaId,
            categoria: options.categoria || CategoriaArchivo.LOGO,
            tipoEntidad: options.tipoEntidad,
            entidadId: options.entidadId,
            descripcion: options.descripcion || `Archivo para ${options.tipoEntidad}`,
            esPublico: options.esPublico !== undefined ? options.esPublico : true,
            provider: options.provider
          });
        }

        // Respuesta enriquecida
        return {
          ...fileResponse,
          url: this.archivoService.buildFileUrl(fileResponse.filename),
          processed: true,
          originalSize: file.size,
          finalSize: processedFile.size,
          pythonProcessed: true,
          pythonReduction: result.reduction,
          pythonDuration: result.duration,
          pythonInfo: result.info
        };
      } else {
        // Fallback a Sharp si el resultado no es válido
        if (this.isDevelopment) {
          this.logger.warn(`Resultado incompleto del microservicio, usando Sharp como fallback`);
        }
        return this.processWithSharp(file, options);
      }
    } catch (error) {
      if (this.isDevelopment) {
        this.logger.warn(`Error con microservicio Python: ${error.message}`);
      }
      
      // Marcar el trabajo como fallido
      this.processingManager.failJob(processingId, error);
      
      // Fallback a Sharp
      return this.processWithSharp(file, options);
    }
  }

  /**
   * Procesa una imagen con el microservicio Python de forma asíncrona
   */
  private async processWithGoServiceAsync(
    file: Express.Multer.File,
    options?: any
  ): Promise<any> {
    // Generar ID único para este procesamiento
    const processingId = this.processingManager.registerProcessingJob(file, options);
    
    // Crear mensaje
    const message = this.createImageProcessingMessage(file, processingId, options);
    
    // Enviar a procesar sin esperar resultado
    await firstValueFrom(
      this.imageProcessorClient.emit('images-to-process', message)
    );
    
    // Marcar como iniciado
    this.processingManager.startProcessing(processingId);
    
    return {
      success: true,
      status: 'processing',
      processingId,
      message: 'La imagen está siendo procesada en segundo plano',
      originalName: file.originalname,
      size: file.size,
      estimatedTime: this.estimateProcessingTime(file.size),
      checkStatusUrl: `/files/processing/status/${processingId}`
    };
  }

  /**
   * Crea un mensaje para el microservicio Python
   */
  private createImageProcessingMessage(
    file: Express.Multer.File,
    id: string,
    options?: any
  ): any {
    // Determinar qué preset usar
    const presetName = options?.imagePreset || 'default';
    const preset = IMAGE_PROCESSING_CONFIG.presets[presetName];
    
    // Determinar prioridad (1-10, donde 10 es la más alta)
    let priority = 5; // Prioridad media por defecto
    
    if (options?.priority) {
      switch(options.priority) {
        case 'alta':
          priority = 10;
          break;
        case 'media':
          priority = 5;
          break;
        case 'baja':
          priority = 1;
          break;
        default:
          // Si es un número entre 1-10, usarlo directamente
          const numPriority = parseInt(options.priority);
          if (!isNaN(numPriority) && numPriority >= 1 && numPriority <= 10) {
            priority = numPriority;
          }
      }
    }
    
    return {
      filename: file.originalname,
      mimetype: file.mimetype,
      data: file.buffer.toString('base64'),
      id: id,
      companyId: options?.empresaId || 'default',
      userId: options?.entidadId || 'anonymous',
      module: options?.tipoEntidad || 'general',
      priority, // Añadir prioridad al mensaje
      options: {
        imagePreset: presetName,
        maxWidth: options?.maxWidth || preset.maxWidth,
        maxHeight: options?.maxHeight || preset.maxHeight,
        quality: options?.quality || preset.quality,
        format: options?.format || preset.format,
        preserveAspectRatio: true
      }
    };
  }

  /**
   * Estima el tiempo de procesamiento basado en el tamaño
   */
  private estimateProcessingTime(fileSize: number): string {
    const sizeInMB = fileSize / (1024 * 1024);
    let estimatedSeconds;
    
    if (sizeInMB < 1) {
      estimatedSeconds = 2;
    } else if (sizeInMB < 5) {
      estimatedSeconds = 5;
    } else if (sizeInMB < 10) {
      estimatedSeconds = 10;
    } else {
      estimatedSeconds = Math.ceil(sizeInMB);
    }
    
    return `${estimatedSeconds} segundos aproximadamente`;
  }

  /**
   * Procesa una imagen para reducir su tamaño usando Sharp
   */
  async processImage(
    buffer: Buffer, 
    mimetype: string,
    customOptions?: Partial<ImageProcessOptions>
  ): Promise<ProcessedImageResult> {
    if (!this.isImage(mimetype)) {
      return { 
        buffer, 
        info: { 
          processed: false, 
          originalSize: buffer.length,
          newSize: buffer.length,
          reduction: '0%',
          reason: 'not-an-image' 
        } 
      };
    }

    const options = { 
      maxWidth: 1920,
      maxHeight: 1080,
      quality: 80,
      format: 'jpeg' as const,
      preserveAspectRatio: true,
      ...customOptions 
    };
    
    const startTime = Date.now();

    try {
      let transformer = sharp(buffer);
      const metadata = await transformer.metadata();
      
      // Solo redimensionar si la imagen es más grande que los límites
      const needsResize = 
        (options.maxWidth && metadata.width && metadata.width > options.maxWidth) ||
        (options.maxHeight && metadata.height && metadata.height > options.maxHeight);
      
      if (needsResize) {
        transformer = transformer.resize({
          width: options.maxWidth,
          height: options.maxHeight,
          fit: options.preserveAspectRatio ? 'inside' : 'fill',
          withoutEnlargement: true
        });
      }

      // Configurar el formato de salida
      if (options.format === 'jpeg') {
        transformer = transformer.jpeg({ quality: options.quality });
      } else if (options.format === 'png') {
        transformer = transformer.png({ quality: options.quality });
      } else if (options.format === 'webp') {
        transformer = transformer.webp({ quality: options.quality });
      }

      // Procesar la imagen
      const processedBuffer = await transformer.toBuffer();
      const duration = Date.now() - startTime;
      
      // Calcular reducción en tamaño
      const originalSize = buffer.length;
      const newSize = processedBuffer.length;
      const reduction = ((originalSize - newSize) / originalSize * 100).toFixed(2);
      
      const info = {
        processed: true,
        originalSize,
        newSize,
        reduction: `${reduction}%`,
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        newFormat: options.format,
        duration: `${duration}ms`
      };
      
      if (this.isDevelopment) {
        this.logger.debug({ 
          originalSize: originalSize / 1024, 
          newSize: newSize / 1024, 
          reduction 
        }, `Imagen procesada: ${reduction}% de reduccion en ${duration}ms`);
      }
      
      return { buffer: processedBuffer, info };
    } catch (error) {
      this.logger.error(`Error procesando imagen: ${error.message}`, error.stack);
      // Devolver la imagen original en caso de error
      return { 
        buffer, 
        info: { 
          processed: false, 
          originalSize: buffer.length,
          newSize: buffer.length,
          reduction: '0%',
          reason: 'error', 
          message: error.message 
        } 
      };
    }
  }
  
  /**
   * Determina si un archivo es una imagen basado en su tipo MIME
   */
  private isImage(mimetype: string): boolean {
    return /^image\/(jpeg|png|gif|webp|svg\+xml)$/i.test(mimetype);
  }
  
  /**
   * Determina si una imagen debe ser procesada basada en su tamaño y tipo
   */
  private shouldProcess(file: Express.Multer.File, sizeThreshold: number = 1024 * 1024): boolean {
    // Procesar si es una imagen Y es más grande que el umbral (por defecto 1MB)
    return this.isImage(file.mimetype) && file.size > sizeThreshold;
  }
}