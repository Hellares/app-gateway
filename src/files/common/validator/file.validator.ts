import { Injectable, Logger } from '@nestjs/common';
import { FileType } from '../constants/file-types.constant';
import { FileErrorCode, FileErrorHelper } from '../helpers/file-error.helper';
import { FileTypeConfig } from '../interfaces/file-config.interface';
import { FILE_CONFIG, FILE_VALIDATION } from '../constants/file.validator.constant';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';


@Injectable()
export class FileValidator {
  private readonly logger = new Logger(FileValidator.name);

  validateFile(file: Express.Multer.File, type: FileType): void {
    try {
      const config = this.getConfig(type);
      
      // Validar si existe el archivo
      if (!file) {
        throw FileErrorHelper.createError(
          'No se ha proporcionado ningún archivo',
          FileErrorCode.VALIDATION_ERROR
        );
      }

      // Validar tamaño
      if (file.size > config.maxSize) {
        throw FileErrorHelper.createError(
          `El archivo excede el tamaño máximo permitido de ${config.maxSize / (1024 * 1024)}MB`,
          FileErrorCode.SIZE_EXCEEDED,
          400,
          {
            maxSize: config.maxSize,
            actualSize: file.size,
            filename: file.originalname
          }
        );
      }

      // Validar tipo MIME
      if (!config.allowedMimeTypes.includes(file.mimetype)) {
        throw FileErrorHelper.createError(
          `Tipo de archivo no permitido. Use: ${config.allowedMimeTypes.join(', ')}`,
          FileErrorCode.INVALID_TYPE,
          400,
          {
            allowedTypes: config.allowedMimeTypes,
            receivedType: file.mimetype
          }
        );
      }

      this.logger.debug(`Archivo validado exitosamente: ${file.originalname} (${type})`);
    } catch (error) {
      this.logger.error(`Error validando archivo: ${file?.originalname}`, error);
      throw error;
    }
  }


  getConfig(type: FileType): FileTypeConfig {
    const config = FILE_CONFIG.types[type];
    if (!config) {
      throw FileErrorHelper.createError(
        `Tipo de archivo no configurado: ${type}`,
        FileErrorCode.INVALID_TYPE,
        400,
        { availableTypes: Object.keys(FILE_CONFIG.types) }
      );
    }
    return config;
  }


  createFileInterceptorOptions(type: FileType): MulterOptions {
    const config = this.getConfig(type);
    
    return {
      limits: {
        fileSize: config.maxSize,
        files: 1 // Limitar a un archivo por defecto
      },
      fileFilter: (
        req: Request, 
        file: Express.Multer.File, 
        callback: (error: Error | null, acceptFile: boolean) => void
      ) => {
        try {
          // Registrar intento de subida
          this.logger.debug(`Validando archivo: ${file.originalname} (${file.mimetype})`);

          // Validar el archivo
          this.validateFile(file, type);

          // Si la validación es exitosa
          this.logger.debug(`Archivo ${file.originalname} validado correctamente`);
          callback(null, true);
        } catch (error) {
          // Registrar el error
          this.logger.error(`Error validando archivo ${file.originalname}:`, error);
          
          // Convertir el error a RpcException si es necesario
          const rpcError = error instanceof Error ? 
            FileErrorHelper.createError(
              error.message,
              FileErrorCode.VALIDATION_ERROR,
              400,
              { filename: file.originalname }
            ) : 
            error;

          callback(rpcError, false);
        }
      }
    };
  }

  createMultipleFilesInterceptorOptions(
    type: FileType, 
    maxFiles: number = FILE_VALIDATION.MAX_FILES
  ): MulterOptions {
    const baseOptions = this.createFileInterceptorOptions(type);
    
    return {
      ...baseOptions,
      limits: {
        ...baseOptions.limits,
        files: maxFiles
      }
    };
  }
}