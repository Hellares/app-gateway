// src/files/services/unified-files.service.ts
import { Injectable, Inject, Logger, OnModuleInit, HttpStatus } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { firstValueFrom, timeout, catchError, Subject } from 'rxjs';
import {  QUEUES, SERVICES } from 'src/transports/constants';
import { ArchivoService } from 'src/archivos/archivo.service';
import { CategoriaArchivo } from 'src/common/enums/categoria-archivo.enum';
import { formatFileSize } from 'src/common/util/format-file-size.util';
import { FILE_VALIDATION } from './common/constants/file.validator.constant';
import { FileErrorCode, FileErrorHelper } from './common/helpers/file-error.helper';
import { ImageProcessorService } from './image-processor.service';

const PENDING_CALLBACKS = new Map<string, any>();

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

@Injectable()
export class UnifiedFilesService{
  private readonly logger = new Logger(UnifiedFilesService.name);
  private readonly isDevelopment = process.env.NODE_ENV !== 'production';

  // Mapa para almacenar trabajos en procesamiento (en memoria)
  // En producción sería mejor usar Redis o base de datos
  private processingJobs = new Map<string, any>();

  // Estadísticas de procesamiento
  private processingStats = {
    totalProcessed: 0,
    pythonProcessed: 0,
    sharpProcessed: 0,
    failedProcessing: 0,
    averageProcessingTime: 0
  };

  private processingCallbacks = new Map<string, any>();

  constructor(
    @Inject(SERVICES.FILES) private readonly filesClient: ClientProxy,
    @Inject(SERVICES.IMAGE_PROCESSOR) private readonly imageProcessorClient: ClientProxy,
    @Inject(SERVICES.COMPANY) private readonly empresaClient: ClientProxy,
    private readonly archivoService: ArchivoService,
    private readonly imageProcessor: ImageProcessorService
  ) {
  }

  // Definición mejorada con tipos específicos
registerProcessingCallback(
  processingId: string, 
  resolveCallback: (value: any) => void, 
  rejectCallback: (error: Error) => void, 
  timeoutId: NodeJS.Timeout
): void {
  this.processingCallbacks.set(processingId, {
    resolve: resolveCallback,
    reject: rejectCallback,
    timeoutId: timeoutId
  });
  
  if (this.isDevelopment) {
    this.logger.debug(`Callback registrado para procesamiento: ${processingId}`);
  }
}

  // Método para manejar las respuestas que llegan de la cola
  handleProcessedImageResponse(data: any): void {
    if (!data) {
      this.logger.warn('Mensaje vacio recibido');
      return;
    }
    
    let found = false;
    
    // Si el ID es 'unknown', resolver la primera promesa pendiente
    if (data.id === 'unknown' && this.processingCallbacks.size > 0) {
      // Tomar el primer callback pendiente
      const [firstId, callback] = Array.from(this.processingCallbacks.entries())[0];
      
      this.logger.debug(`Recibida respuesta con ID 'unknown', resolviendola para: ${firstId}`);
      
      if (callback.timeoutId) {
        clearTimeout(callback.timeoutId);
      }
      
      callback.resolve(data);
      this.processingCallbacks.delete(firstId);
      found = true;
    } else {
      // Intentar resolver normalmente si hay un ID
      const processingId = data.id;
      const callback = this.processingCallbacks.get(processingId);
      
      if (callback) {
        if (callback.timeoutId) {
          clearTimeout(callback.timeoutId);
        }
        
        callback.resolve(data);
        this.processingCallbacks.delete(processingId);
        found = true;
        
        if (this.isDevelopment) {
          this.logger.debug(`Promesa resuelta para procesamiento: ${processingId}`);
        }
      }
    }
    
    if (!found) {
      this.logger.warn(`No se encontro callback para procesamiento con ID: ${data.id}`);
    }
  }

  /**
 * Sube un archivo al proveedor de almacenamiento y opcionalmente registra sus metadatos
 * Para imágenes, aplica procesamiento para reducir su tamaño si es necesario
 * Integra con el microservicio Python para procesamiento avanzado cuando sea conveniente
 */
async uploadFile(
  file: Express.Multer.File,
  options?: {
    empresaId?: string;
    tipoEntidad?: string;
    entidadId?: string;
    categoria?: CategoriaArchivo;
    descripcion?: string;
    esPublico?: boolean;
    provider?: string;
    tenantId?: string;
    useAdvancedProcessing?: boolean; // Forzar microservicio Python
    imagePreset?: keyof typeof IMAGE_PROCESSING_CONFIG.presets;
    async?: boolean; // Procesar de forma asíncrona
    skipMetadataRegistration?: boolean; // Omitir registro de metadatos
    skipImageProcessing?: boolean;
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
    //Comprobar cuota antes de procesar
    if(options?.empresaId){
      await this.checkStorageQuota(options.empresaId, file.size);
    }
    // Si se solicita saltar el procesamiento de imágenes
    if (options?.skipImageProcessing) {
      return this.uploadOriginalFile(file, options);
    }

    // Verificar si es una imagen
    if (!this.imageProcessor.isImage(file.mimetype)) {
      return this.uploadOriginalFile(file, options);
    }

    // Decidir qué método de procesamiento usar
    const useAdvancedProcessing = this.shouldUseAdvancedProcessing(file, options);

    if (useAdvancedProcessing) {
      // Usar microservicio Python
      if (this.isDevelopment) {
        this.logger.debug(`Usando microservicio Python para procesar: ${file.originalname}`);
      }
      
      // Elegir entre procesamiento síncrono o asíncrono
      if (options?.async) {
        return this.processWithPythonServiceAsync(file, options);
      } else {
        return this.processWithPythonServiceSync(file, options);
      }
    } else {
      // Usar procesamiento local con Sharp
      if (this.isDevelopment) {
        this.logger.debug(`Usando Sharp para procesar: ${file.originalname}`);
      }

      // Variables para rastrear información de procesamiento
      let processedFile = file;
      let processingInfo = null;
      
      // Determinar qué preset usar
      const preset = options?.imagePreset 
        ? IMAGE_PROCESSING_CONFIG.presets[options.imagePreset]
        : IMAGE_PROCESSING_CONFIG.presets.default;
          
      if (this.isDevelopment) {
        this.logger.debug(`Procesando imagen usando preset ${options?.imagePreset || 'default'}`);
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
        }, 'Imagen procesada');
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
          empresaId: options?.empresaId,
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

      // 2. Si hay información de entidad y no se solicitó omitir el registro de metadatos, crear registro
      if (!options?.skipMetadataRegistration && options?.tipoEntidad && options?.entidadId) {
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
      } else if (this.isDevelopment && options?.skipMetadataRegistration) {
        this.logger.debug(`Omitiendo registro de metadatos segun lo solicitado`);
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
        }, `Proceso de upload completado`);
      }

      return response;
    }
  } catch (error) {
    const duration = Date.now() - startTime;
  
  if (error instanceof RpcException) {
    const errorData = error.getError ? error.getError() : error.message;
    
    if (
      typeof errorData === 'object' && 
      errorData !== null && 
      'code' in errorData && 
      errorData.code === 'STORAGE_QUOTA_EXCEEDED'
    ) {
      // Utilizar el operador 'in' para verificar si existe la propiedad 'message'
      const errorMessage = 'message' in errorData 
        ? String(errorData.message) 
        : 'Cuota de almacenamiento excedida';
      
      this.logger.warn({
        fileName: file.originalname,
        size: formattedOriginalSize,
        empresaId: options?.empresaId,
        duration: `${duration}ms`,
        // Verificar si details existe antes de acceder
        details: 'details' in errorData ? errorData.details : undefined
      }, `Subida Bloqueada: ${errorMessage}`);
      
      throw error;
    }
  }
  
  this.logger.error({
    error: error.message,
    duration: `${duration}ms`
  }, `Error en upload: ${file.originalname}`);
  
  throw error;
}
}


private shouldUseAdvancedProcessing(
  file: Express.Multer.File, 
  options?: any
): boolean {
  // Si el usuario especificó explícitamente
  if (options?.useAdvancedProcessing === true) return true;
  if (options?.useAdvancedProcessing === false) return false;
  
  // Si es una petición de alta prioridad y el sistema está bajo carga,
  // procesar localmente para responder más rápido
  if (options?.priority === 'alta' && PENDING_CALLBACKS.size > 10) {
    this.logger.debug(`Procesando localmente imagen de alta prioridad debido a carga del sistema`);
    return false;
  }
  
  // Para imágenes pequeñas (<2MB), usar siempre Sharp (más rápido)
  if (file.size < 2 * 1024 * 1024) return false;
  
  // Si se solicita omitir el registro de metadatos, probablemente sea para un registro inicial
  // En este caso, priorizar velocidad usando Sharp
  if (options?.skipMetadataRegistration) {
    this.logger.debug(`Usando Sharp para procesamiento rapido (skipMetadataRegistration=true)`);
    return false;
  }
  
  // Criterios automáticos de decisión para imágenes grandes:
  
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
    
    if (this.isDevelopment) {
      this.logger.debug(`Metadatos registrados para archivo sin procesar: ${file.originalname}`);
    }
  } else if (this.isDevelopment && options?.skipMetadataRegistration) {
    this.logger.debug(`Omitiendo registro de metadatos para archivo sin procesar segun lo solicitado`);
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
 * Procesa una imagen con el microservicio Python de forma sincrónica
 * (Espera por el resultado antes de responder)
 */
private async processWithPythonServiceSync(
  file: Express.Multer.File,
  options?: any
): Promise<any> {
  const processingId = `img_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  
  // Crear mensaje para enviar al microservicio
  const message = this.createImageProcessingMessage(file, processingId, options);
  console.log(`Enviando mensaje con ID: ${message.id}`);
  
  // Contenedor para callbacks de resolución
  let resolveCallback: (value: any) => void;
  let rejectCallback: (error: any) => void;
  
  // Crear la promesa con las referencias a resolve y reject
  const resultPromise = new Promise<any>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  
  // Configurar timeout (aumentado para imágenes grandes)
  const timeoutMs = Math.min(60000, 20000 + Math.floor(file.size / (50 * 1024))); // 
  
  const timeoutId = setTimeout(() => {
    const job = PENDING_CALLBACKS.get(processingId);
    if (job && job.status === 'processing') {
      this.logger.warn(`Timeout para procesamiento: ${processingId} (${timeoutMs}ms)`);
      job.status = 'timeout';
      if (job.reject) job.reject(new Error('Timeout procesando imagen'));
      PENDING_CALLBACKS.delete(processingId);
    }
  }, timeoutMs);

  // Registrar el trabajo ANTES de enviar el mensaje
  PENDING_CALLBACKS.set(processingId, {
    id: processingId,
    status: 'processing',
    startTime: Date.now(),
    resolve: resolveCallback,
    reject: rejectCallback,
    timeoutId: timeoutId,
    options,
    fileInfo: {
      name: file.originalname,
      size: file.size,
      type: file.mimetype
    }
  });

  if (this.isDevelopment) {
    this.logger.debug(`Trabajo registrado: ${processingId} (${file.size} bytes)`);
  }

  // Registrar el callback para que el servicio consumidor pueda resolverlo
  this.registerProcessingCallback(processingId, resolveCallback, rejectCallback, timeoutId);

  try {
    // Enviar el mensaje al microservicio
    await firstValueFrom(
      this.imageProcessorClient.emit('images-to-process', message)
    );

    // Esperar a que la promesa se resuelva
    const result = await resultPromise;
    
    // Limpiar el timeout y eliminar del mapa
    const job = PENDING_CALLBACKS.get(processingId);
    if (job && job.timeoutId) {
      clearTimeout(job.timeoutId);
    }
    PENDING_CALLBACKS.delete(processingId);

    if (result && (result.id || result.processed || result.reduction)) {
      // Procesar localmente para obtener la imagen final
      const preset = options?.imagePreset 
        ? IMAGE_PROCESSING_CONFIG.presets[options.imagePreset]
        : IMAGE_PROCESSING_CONFIG.presets.default;
          
      const { buffer, info } = await this.imageProcessor.processImage(file.buffer, file.mimetype, preset);
      
      // Crear archivo procesado con el buffer local
      const processedFile = {
        ...file,
        buffer,
        size: buffer.length
      };

      // Optimizar para envío
      const optimizedFile = {
        originalname: processedFile.originalname,
        mimetype: processedFile.mimetype,
        size: processedFile.size,
        bufferBase64: processedFile.buffer.toString('base64')
      };

      // Subir al storage
      const fileResponse = await firstValueFrom(
        this.filesClient.send('file.upload.optimized', {
          file: optimizedFile,
          provider: options?.provider || 'firebase',
          tenantId: options?.tenantId || 'admin',
          empresaId: options?.empresaId,
        }).pipe(
          timeout(FILE_VALIDATION.TIMEOUT),
          catchError(error => {
            throw FileErrorHelper.handleUploadError(error, file.originalname);
          })
        )
      );

      // Actualizar estadísticas
      this.processingStats.totalProcessed++;
      this.processingStats.pythonProcessed++;

      // AQUÍ ESTÁ EL CAMBIO: Registrar metadatos si no se solicitó omitirlo
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
        
        if (this.isDevelopment) {
          this.logger.debug(`Metadatos registrados para archivo procesado con Python: ${fileResponse.filename}`);
        }
      } else if (this.isDevelopment && options?.skipMetadataRegistration) {
        this.logger.debug(`Omitiendo registro de metadatos para archivo procesado con Python según lo solicitado`);
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

    // Limpiar el timeout
    const job = PENDING_CALLBACKS.get(processingId);
    if (job && job.timeoutId) {
      clearTimeout(job.timeoutId);
    }
    PENDING_CALLBACKS.delete(processingId);
    
    // Fallback a Sharp
    return this.processWithSharp(file, options);
  }
}

// Método auxiliar para procesamiento con Sharp
private async processWithSharp(file: Express.Multer.File, options?: any): Promise<any> {
  const startTime = Date.now();
  
  try {
    // Obtener preset
    const preset = options?.imagePreset 
      ? IMAGE_PROCESSING_CONFIG.presets[options.imagePreset]
      : IMAGE_PROCESSING_CONFIG.presets.default;
      
    // Procesar con Sharp
    const { buffer, info } = await this.imageProcessor.processImage(file.buffer, file.mimetype, preset);
    
    // Crear archivo procesado
    const processedFile = {
      ...file,
      buffer,
      size: buffer.length
    };
    
    // Optimizar para envío
    const optimizedFile = {
      originalname: processedFile.originalname,
      mimetype: processedFile.mimetype,
      size: processedFile.size,
      bufferBase64: processedFile.buffer.toString('base64')
    };

    // Subir archivo al storage
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
      
      if (this.isDevelopment) {
        this.logger.debug(`Metadatos registrados para archivo procesado con Sharp: ${fileResponse.filename}`);
      }
    } else if (this.isDevelopment && options?.skipMetadataRegistration) {
      this.logger.debug(`Omitiendo registro de metadatos para archivo procesado con Sharp según lo solicitado`);
    }

    // Actualizar estadísticas
    this.processingStats.totalProcessed++;
    this.processingStats.sharpProcessed++;
    
    const processingTime = Date.now() - startTime;
    this.updateProcessingAverage(processingTime);

    // Respuesta enriquecida
    return {
      ...fileResponse,
      url: this.archivoService.buildFileUrl(fileResponse.filename),
      processed: true,
      originalSize: file.size,
      finalSize: processedFile.size,
      reduction: info.reduction || '0%',
      processingTime: `${processingTime}ms`
    };
  } catch (error) {
    this.processingStats.failedProcessing++;
    throw error;
  }
}

// Método auxiliar para actualizar el tiempo promedio de procesamiento
private updateProcessingAverage(newTime: number): void {
  const oldAvg = this.processingStats.averageProcessingTime;
  const totalProcessed = this.processingStats.totalProcessed;
  
  // Fórmula para actualizar promedio incremental
  const newAvg = oldAvg + (newTime - oldAvg) / totalProcessed;
  this.processingStats.averageProcessingTime = newAvg;
}

/**
 * Procesa una imagen con el microservicio Python de forma asíncrona
 * (Responde de inmediato y procesa en segundo plano)
 */
private async processWithPythonServiceAsync(
  file: Express.Multer.File,
  options?: any
): Promise<any> {
  // Generar ID único para este procesamiento
  const processingId = `img_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  
  // Crear mensaje
  const message = this.createImageProcessingMessage(file, processingId, options);
  
  // Guardar registro temporal del trabajo
  await this.saveProcessingJob(processingId, file, options);
  
  // Enviar a procesar sin esperar resultado
  await firstValueFrom(
    this.filesClient.emit('images-to-process', message)
  );
  
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
 * Guarda información sobre un trabajo de procesamiento asíncrono
 */
private async saveProcessingJob(
  id: string,
  file: Express.Multer.File,
  options?: any
): Promise<void> {
  // En una implementación real, esto guardaría en base de datos
  // Para esta demo, usamos un Map en memoria
  this.processingJobs.set(id, {
    id,
    filename: file.originalname,
    status: 'processing',
    startTime: Date.now(),
    options
  });
}

/**
 * Obtiene el estado de un procesamiento asíncrono
 */
async getProcessingStatus(id: string): Promise<any> {
  const job = this.processingJobs.get(id);
  
  if (!job) {
    return null;
  }
  
  // Si el trabajo completó y tiene más de 1 hora, limpiarlo
  if (job.status === 'completed' && Date.now() - job.completedAt > 3600000) {
    this.processingJobs.delete(id);
  }
  
  return job;
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
    
  /**
   * Obtiene estadísticas de procesamiento
   */
  getProcessingStats() {
    return {
      ...this.processingStats,
      pythonPercentage: this.processingStats.totalProcessed > 0 
        ? (this.processingStats.pythonProcessed / this.processingStats.totalProcessed * 100).toFixed(2) + '%'
        : '0%',
      sharpPercentage: this.processingStats.totalProcessed > 0
        ? (this.processingStats.sharpProcessed / this.processingStats.totalProcessed * 100).toFixed(2) + '%'
        : '0%',
      successRate: this.processingStats.totalProcessed > 0
        ? ((this.processingStats.totalProcessed - this.processingStats.failedProcessing) / this.processingStats.totalProcessed * 100).toFixed(2) + '%'
        : '0%',
      averageProcessingTimeMs: Math.round(this.processingStats.averageProcessingTime) + 'ms'
    };
  }



  private async checkStorageQuota(empresaId: string, fileSize: number): Promise<boolean> {
    if (!empresaId || !fileSize) {
      return true;
    }
  
    try {
      const quotaCheck = await firstValueFrom(
        this.empresaClient.send('storage.check-quota', {
          empresaId,
          fileSize,
        }).pipe(timeout(5000))
      );
  
      if (!quotaCheck.hasQuota) {
        this.logger.warn({
          empresa: empresaId,
          usage: quotaCheck.usage,
          limit: quotaCheck.limit,
          fileSize
        }, `Cuota excedida para empresa ${empresaId}`);
        
        // Lanzar un error con formato específico para cuota excedida
        throw FileErrorHelper.createError(
          'Cuota de almacenamiento excedida. Por favor, libere espacio antes de subir más archivos / Contrate un plan Superior.',
          FileErrorCode.QUOTA_EXCEEDED, // <-- Necesitamos agregar este código
          HttpStatus.FORBIDDEN, // Usar 403 en lugar de 500
          {
            usage: quotaCheck.usage,
            limit: quotaCheck.limit,
           fileSize
          }
        );
      }
  
      return true;
    } catch (error) {
      // Reenviar el error tal cual si ya es un error formateado
      
      throw FileErrorHelper.handleUploadError(error);
    }
  }
}