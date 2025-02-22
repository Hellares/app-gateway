// src/common/helpers/file-error.helper.ts
import { HttpStatus } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { TimeoutError } from 'rxjs';

export enum FileErrorCode {
  UPLOAD_ERROR = 'FILE_UPLOAD_ERROR',
  DELETE_ERROR = 'FILE_DELETE_ERROR',
  VALIDATION_ERROR = 'FILE_VALIDATION_ERROR',
  TIMEOUT_ERROR = 'FILE_TIMEOUT_ERROR',
  PROCESSING_ERROR = 'FILE_PROCESSING_ERROR',
  NOT_FOUND = 'FILE_NOT_FOUND',
  INVALID_TYPE = 'INVALID_FILE_TYPE',
  SIZE_EXCEEDED = 'FILE_SIZE_EXCEEDED'
}

export class FileErrorHelper {
  static createError(
    message: string,
    code: FileErrorCode,
    status: number = HttpStatus.BAD_REQUEST,
    details?: any
  ): RpcException {
    return new RpcException({
      message,
      code,
      status,
      details,
      timestamp: new Date().toISOString()
    });
  }

  static handleUploadError(error: any, filename?: string): never {
    if (error instanceof TimeoutError) {
      throw this.createError(
        'Tiempo de espera agotado al subir el archivo',
        FileErrorCode.TIMEOUT_ERROR,
        HttpStatus.GATEWAY_TIMEOUT,
        { filename }
      );
    }

    if (error instanceof RpcException) {
      throw error;
    }

    throw this.createError(
      `Error al subir el archivo${filename ? ` ${filename}` : ''}: ${error.message || 'Error desconocido'}`,
      FileErrorCode.UPLOAD_ERROR,
      HttpStatus.INTERNAL_SERVER_ERROR,
      { originalError: error.message, filename }
    );
  }

  static handleDeleteError(error: any, filename: string): never {
    if (error instanceof TimeoutError) {
      throw this.createError(
        `Tiempo de espera agotado al eliminar el archivo ${filename}`,
        FileErrorCode.TIMEOUT_ERROR,
        HttpStatus.GATEWAY_TIMEOUT,
        { filename }
      );
    }

    throw this.createError(
      `Error al eliminar el archivo ${filename}`,
      FileErrorCode.DELETE_ERROR,
      HttpStatus.INTERNAL_SERVER_ERROR,
      { originalError: error.message, filename }
    );
  }

  static handleValidationError(file: Express.Multer.File, config: any): void {
    if (!file) {
      throw this.createError(
        'No se ha proporcionado ningún archivo',
        FileErrorCode.VALIDATION_ERROR,
        HttpStatus.BAD_REQUEST
      );
    }

    if (file.size > config.maxSize) {
      throw this.createError(
        `El archivo excede el tamaño máximo permitido de ${config.maxSize / (1024 * 1024)}MB`,
        FileErrorCode.SIZE_EXCEEDED,
        HttpStatus.BAD_REQUEST,
        {
          maxSize: config.maxSize,
          actualSize: file.size,
          filename: file.originalname
        }
      );
    }

    if (!config.allowedMimeTypes.includes(file.mimetype)) {
      throw this.createError(
        `Formato de archivo no permitido. Formatos aceptados: ${config.allowedMimeTypes.join(', ')}`,
        FileErrorCode.INVALID_TYPE,
        HttpStatus.BAD_REQUEST,
        {
          allowedTypes: config.allowedMimeTypes,
          receivedType: file.mimetype,
          filename: file.originalname
        }
      );
    }
  }

  static handleProcessingError(error: any, filename: string, operation: string): never {
    throw this.createError(
      `Error al procesar el archivo ${filename} durante ${operation}`,
      FileErrorCode.PROCESSING_ERROR,
      HttpStatus.INTERNAL_SERVER_ERROR,
      {
        operation,
        filename,
        originalError: error.message
      }
    );
  }

  static handleFileNotFound(filename: string): never {
    throw this.createError(
      `El archivo ${filename} no fue encontrado`,
      FileErrorCode.NOT_FOUND,
      HttpStatus.NOT_FOUND,
      { filename }
    );
  }
}