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
  SIZE_EXCEEDED = 'FILE_SIZE_EXCEEDED',
  QUOTA_EXCEEDED = 'STORAGE_QUOTA_EXCEEDED'
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
      // `Error al subir el archivo${filename ? ` ${filename}` : ''}: ${error.message || 'Error desconocido'}`,
      `Error al subir el archivo`,
      FileErrorCode.UPLOAD_ERROR,
      HttpStatus.INTERNAL_SERVER_ERROR,
      { originalError: error.message, filename }
    );
  }

  static handleDeleteError(error: any, filename: string): never {
    if (error instanceof TimeoutError) {
      throw this.createError(
        // `Tiempo de espera agotado al eliminar el archivo ${filename}`,
        `Tiempo de espera agotado al eliminar el archivo`,
        FileErrorCode.TIMEOUT_ERROR,
        HttpStatus.GATEWAY_TIMEOUT,
        { filename }
      );
    }

    throw this.createError(
      // `Error al eliminar el archivo ${filename}`,
      `Error al eliminar el archivo`,
      FileErrorCode.DELETE_ERROR,
      HttpStatus.BAD_REQUEST,
      { originalError: error.message, filename }
    );
  }

  
  static handleFileNotFound(filename: string): never {
    throw this.createError(
      // `El archivo ${filename} no fue encontrado`,
      `El archivo no fue encontrado`,
      FileErrorCode.NOT_FOUND,
      HttpStatus.NOT_FOUND,
      { filename }
    );
  }

   // Para manejo de eliminación por lotes
   static handleBatchDeleteError(error: any, filenames: string[]): never {
    if (error instanceof TimeoutError) {
      throw this.createError(
        `Tiempo de espera agotado al eliminar archivos`,
        FileErrorCode.TIMEOUT_ERROR,
        HttpStatus.GATEWAY_TIMEOUT,
        { filenames }
      );
    }

    throw this.createError(
      `Error al eliminar archivos`,
      FileErrorCode.DELETE_ERROR,
      HttpStatus.INTERNAL_SERVER_ERROR,
      { originalError: error.message, filenames }
    );
  }
}