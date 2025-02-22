// src/common/filters/multer-exception.filter.ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Response } from 'express';
import { MulterError } from 'multer';
import { FILE_CONFIG, formatFileSize } from 'src/files/common/constants/file.validator.constant';
import { ErrorResponse } from '../interfaces/error-response.interface';



@Catch(MulterError, HttpException)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(error: MulterError | HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    const fileType = request.params.type || 'default';
    const maxSize = FILE_CONFIG.types[fileType]?.maxSize || FILE_CONFIG.maxSize;

    let errorResponse: ErrorResponse;

    if (error instanceof MulterError) {
      switch (error.code) {
        case 'LIMIT_FILE_SIZE':
          errorResponse = {
            status: HttpStatus.PAYLOAD_TOO_LARGE,
            message: `El archivo excede el tamaño máximo permitido de ${formatFileSize(maxSize)}`,
            error: 'Archivo demasiado grande',
            code: 'FILE_SIZE_EXCEEDED',
            timestamp: new Date().toISOString(),
            details: { maxSize }
          };
          break;

        case 'LIMIT_UNEXPECTED_FILE':
          errorResponse = {
            status: HttpStatus.BAD_REQUEST,
            message: 'Campo de archivo no esperado',
            error: 'Archivo no válido',
            code: 'UNEXPECTED_FIELD',
            timestamp: new Date().toISOString()
          };
          break;

        default:
          errorResponse = {
            status: HttpStatus.BAD_REQUEST,
            message: error.message,
            error: 'Error al procesar archivo',
            code: 'FILE_PROCESSING_ERROR',
            timestamp: new Date().toISOString()
          };
      }
    } else if (error instanceof HttpException) {
      const status = error.getStatus();
      if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
        errorResponse = {
          status,
          message: `El archivo excede el tamaño máximo permitido de ${formatFileSize(maxSize)}`,
          error: 'Archivo demasiado grande',
          code: 'FILE_SIZE_EXCEEDED',
          timestamp: new Date().toISOString(),
          details: { maxSize }
        };
      } else {
        errorResponse = {
          status,
          message: error.message,
          error: 'Error de HTTP',
          code: 'HTTP_ERROR',
          timestamp: new Date().toISOString()
        };
      }
    } else {
      errorResponse = {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Error interno del servidor',
        error: 'Error del Sistema',
        code: 'SYSTEM_ERROR',
        timestamp: new Date().toISOString()
      };
    }

    return response.status(errorResponse.status).json(errorResponse);
  }
}