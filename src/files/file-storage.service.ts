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
  async uploadFile(
    file: { 
      originalname: string; 
      mimetype: string; 
      size: number; 
      bufferBase64: string;
    },
    options?: {
      provider?: string;
      tenantId?: string;
      empresaId?: string;
    }
  ) {
    const startTime = Date.now();
    
    if (this.isDevelopment) {
      this.logger.debug(`Subiendo archivo: ${file.originalname}`);
    }

    try {
      // Verificar cuota si hay un ID de empresa
      if (options?.empresaId) {
        await this.checkStorageQuota(options.empresaId, file.size);
      }

      // Subir el archivo al proveedor de almacenamiento
      const fileResponse = await firstValueFrom(
        this.filesClient.send('file.upload.optimized', {
          file,
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
    options?: {
      provider?: string;
      tenantId?: string;
    }
  ) {
    const startTime = Date.now();
    
    try {
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
}