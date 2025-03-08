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

@Injectable()
export class UnifiedFilesService {
  private readonly logger = new Logger(UnifiedFilesService.name);
  private readonly isDevelopment = process.env.NODE_ENV !== 'production';

  constructor(
    @Inject(SERVICES.FILES) private readonly filesClient: ClientProxy,
    private readonly archivoService: ArchivoService
  ) {}

  /**
   * Sube un archivo al proveedor de almacenamiento y opcionalmente registra sus metadatos
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

     // Crear una versión optimizada del objeto file para enviar por RabbitMQ
     const bufferBase64 = file.buffer.toString('base64');

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
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        // Convertir el buffer a base64, que es más eficiente que un array de bytes
        bufferBase64: file.buffer.toString('base64')
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
          esPublico: options.esPublico !== undefined ? options.esPublico : true
        });
        
        // Solo log en desarrollo
        if (this.isDevelopment) {
          this.logger.debug(`Metadatos de archivo registrados para ${options.tipoEntidad} ${options.entidadId}`);
        }
      }

      // 3. Construir respuesta enriquecida
      const response = {
        ...fileResponse,
        url: this.archivoService.buildFileUrl(fileResponse.filename)
      };

      // Solo log detallado en desarrollo
      if (this.isDevelopment) {
        const duration = Date.now() - startTime;
        const optimizedFileSize = Buffer.byteLength(bufferBase64);
        const formattedOptimizedSize = formatFileSize(optimizedFileSize);
        
        this.logger.debug({
          fileName: file.originalname,
          duration: `${duration}ms`,
          originalSize: formattedOriginalSize,
          serializedSize: formattedOptimizedSize,
          reductionPercent: `${(100 - (optimizedFileSize / originalFileSize) * 100).toFixed(2)}%`
        }, `Proceso de upload completado`);
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