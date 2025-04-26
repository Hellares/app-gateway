import { Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Inject } from '@nestjs/common';
import { SERVICES } from 'src/transports/constants';
import { FileErrorCode, FileErrorHelper } from './common/helpers/file-error.helper';
import { FILE_VALIDATION } from './common/constants/file.validator.constant';
import { firstValueFrom, timeout, catchError } from 'rxjs';

@Injectable()
export class FileStorageService {
  private readonly logger = new Logger(FileStorageService.name);
  private readonly isDevelopment = process.env.NODE_ENV !== 'production';

  constructor(
    @Inject(SERVICES.FILES) private readonly filesClient: ClientProxy,
    @Inject(SERVICES.COMPANY) private readonly empresaClient: ClientProxy,
  ) {}

  /**
   * Sube un archivo al proveedor de almacenamiento
   */

  async uploadFile(file: { 
    originalname: string; 
    mimetype: string; 
    size: number; 
    bufferBase64?: string;
    buffer?: Buffer;
  }, options?: {
    provider?: string;
    tenantId?: string;
    empresaId?: string;
  }) {
    const startTime = Date.now();
    
    try {
      // Verificar cuota si hay un ID de empresa
      if (options?.empresaId) {
        await this.checkStorageQuota(options.empresaId, file.size);
      }
      
      // Preparar el objeto file para enviar
      let bufferBase64;
      
      // Obtener el base64 ya sea de bufferBase64 o convertir desde buffer
      if (file.bufferBase64) {
        bufferBase64 = file.bufferBase64;
      } else if (file.buffer) {
        bufferBase64 = file.buffer.toString('base64');
      } else {
        throw new Error(`El archivo ${file.originalname} no tiene datos (buffer y bufferBase64 indefinidos)`);
      }
      
      // Para archivos grandes, considerar chunking
      if (file.size > 5 * 1024 * 1024 && file.buffer) { // 5MB
        return this.uploadLargeFile(file, options);
      }
      
      // Crear el objeto con la estructura correcta que espera el microservicio
      const message = {
        file: {
          originalname: file.originalname,  // ← CORRECTO: originalname, no filename
          mimetype: file.mimetype,
          size: file.size,
          bufferBase64: bufferBase64        // ← CORRECTO: bufferBase64, no data
        },
        provider: options?.provider || 'firebase',
        tenantId: options?.tenantId || 'admin',
        empresaId: options?.empresaId
      };
      
      // Log para depuración
      this.logger.debug(
        `Enviando a files-microservice: ${file.originalname}, ` +
        `tamanio=${file.size}, ` +
        `bufferBase64=${bufferBase64.substring(0, 20)}...` // Mostrar solo parte para no llenar los logs
      );
      
      // Usar el formato existente para mantener compatibilidad
      const fileResponse = await firstValueFrom(
        this.filesClient.send('file.upload.optimized', message).pipe(
          timeout(FILE_VALIDATION.TIMEOUT),
          catchError(error => {
            throw FileErrorHelper.handleUploadError(error, file.originalname);
          })
        )
      );
  
      const duration = Date.now() - startTime;
      
      if (this.isDevelopment) {
        this.logger.debug(`Archivo subido en ${duration}ms: ${fileResponse.filename}`);
      }
  
      return fileResponse;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Error al subir archivo: ${file.originalname} en ${duration}ms`, error);
      throw error;
    }
  }


// Método para subir archivos grandes con firma compatible
private async uploadLargeFile(file: { 
  originalname: string; 
  mimetype: string; 
  size: number; 
  buffer?: Buffer;        // Hacemos buffer opcional para compatibilidad
  bufferBase64?: string;  // Añadimos soporte para bufferBase64
}, options?: any) {
  const chunkSize = 512 * 1024; // 512KB por chunk
  
  // Verificamos que tengamos algún tipo de buffer
  if (!file.buffer && !file.bufferBase64) {
    throw new Error('Se requiere buffer o bufferBase64 para subir archivos grandes');
  }
  
  // Si nos pasan bufferBase64, lo convertimos a buffer para procesamiento
  let buffer: Buffer;
  if (file.buffer) {
    buffer = file.buffer;
  } else {
    buffer = Buffer.from(file.bufferBase64, 'base64');
  }
  
  const totalChunks = Math.ceil(file.size / chunkSize);
  const fileId = `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  
  this.logger.debug(`Iniciando upload en chunks para ${file.originalname}: ${totalChunks} chunks`);
  
  try {
    // Enviar metadata primero
    await firstValueFrom(
      this.filesClient.send('file.upload.start', {
        fileId,
        filename: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        totalChunks,
        provider: options?.provider || 'firebase',
        tenantId: options?.tenantId || 'admin',
        empresaId: options?.empresaId,
      })
    );
    
    // Enviar chunks
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = buffer.slice(start, end);
      
      await firstValueFrom(
        this.filesClient.send('file.upload.chunk', {
          fileId,
          chunkIndex: i,
          totalChunks,
          data: chunk.toString('base64'),
          provider: options?.provider || 'firebase',
          tenantId: options?.tenantId || 'admin',
        })
      );
      
      if (this.isDevelopment && i % 5 === 0) {
        this.logger.debug(`Progreso de upload: ${Math.round((i+1) / totalChunks * 100)}%`);
      }
    }
    
    // Finalizar upload y obtener respuesta
    return firstValueFrom(
      this.filesClient.send('file.upload.complete', {
        fileId,
        provider: options?.provider || 'firebase',
        tenantId: options?.tenantId || 'admin',
      })
    );
  } catch (error) {
    this.logger.error(`Error en upload por chunks: ${file.originalname}`, error);
    throw FileErrorHelper.handleUploadError(error, file.originalname);
  }
}



  /**
   * Verifica si una empresa tiene cuota disponible
   */
  async checkStorageQuota(empresaId: string, fileSize: number): Promise<boolean> {
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
        
        throw FileErrorHelper.createError(
          'Cuota de almacenamiento excedida. Por favor, libere espacio antes de subir más archivos / Contrate un plan Superior.',
          FileErrorCode.QUOTA_EXCEEDED, // <-- Necesitamos agregar este código
          403,
          {
            usage: quotaCheck.usage,
            limit: quotaCheck.limit,
            fileSize
          }
        );
      }
  
      return true;
    } catch (error) {
      throw FileErrorHelper.handleUploadError(error);
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

      const duration = Date.now() - startTime;
      
      if (this.isDevelopment) {
        this.logger.debug(`Archivo obtenido en ${duration}ms: ${filename}`);
      }

      return buffer;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Error al obtener archivo: ${filename} en ${duration}ms`, error);
      throw error;
    }
  }

  /**
   * Elimina un archivo
   */
  async deleteFile(
    filename: string,
    // options?: {
    //   // provider?: string;
    //   // tenantId?: string;
    // }
  ) {
    const startTime = Date.now();
    
    try {
      await firstValueFrom(
        this.filesClient.send('file.delete', {
          filename,
          // provider: options?.provider || 'firebase',
          // tenantId: options?.tenantId || 'admin'
        }).pipe(
          timeout(FILE_VALIDATION.TIMEOUT),
          catchError(error => {
            throw FileErrorHelper.handleDeleteError(error, filename);
          })
        )
      );

      const duration = Date.now() - startTime;
      
      if (this.isDevelopment) {
        this.logger.debug(`Archivo eliminado en ${duration}ms: ${filename}`);
      }

      return {
        success: true,
        filename,
        duration: `${duration}ms`
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Error al eliminar archivo: ${filename} en ${duration}ms`, error);
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
    // Crear el objeto con la estructura correcta que espera el microservicio
    const message = {
      tenantId: tenantId,
      provider: options?.provider || 'firebase'
    };
    
    // Log para depuración
    this.logger.debug(`Solicitando lista de archivos para tenant: ${tenantId}`);
    
    // Llamar al microservicio
    const fileResponse = await firstValueFrom(
      this.filesClient.send('files.list', message).pipe(
        timeout(FILE_VALIDATION.TIMEOUT),
        catchError(error => {
          throw FileErrorHelper.handleUploadError(error);
        })
      )
    );
    
    const duration = Date.now() - startTime;
    
    if (this.isDevelopment) {
      this.logger.debug(`Lista de archivos obtenida en ${duration}ms: ${fileResponse.summary.count} archivos`);
    }
    
    return fileResponse;
  } catch (error) {
    const duration = Date.now() - startTime;
    this.logger.error(`Error al listar archivos para ${tenantId} en ${duration}ms`, error);
    throw error;
  }
}

  
}