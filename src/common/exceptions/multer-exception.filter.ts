import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';
import { FILE_CONFIG } from 'src/files/common/constants/file.validator.constant';
import { RpcException } from '@nestjs/microservices';
import { ErrorResponse } from '../interfaces/error-response.interface';

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

// @Catch(MulterError)
// export class MulterExceptionFilter implements ExceptionFilter {
//   private readonly logger = new Logger(MulterExceptionFilter.name);

//   catch(error: MulterError, host: ArgumentsHost) {
//     const ctx = host.switchToHttp();
//     const response = ctx.getResponse<Response>();

//     const errorResponse: ErrorResponse = {
//       status: this.getStatusCode(error),
//       message: this.getErrorMessage(error),
//       code: this.getErrorCode(error),
//       error: 'Error de Archivo',
//       timestamp: new Date().toISOString(),
//       details: { 
//         originalError: error.message,
//         code: error.code 
//       }
//     };

//     this.logger.error(`❌ Error de archivo: ${errorResponse.message}`, {
//       code: error.code,
//       status: errorResponse.status
//     });

//     return response.status(errorResponse.status).json(errorResponse);
//   }

//   private getStatusCode(error: MulterError): number {
//     switch (error.code) {
//       case 'LIMIT_FILE_SIZE':
//         return HttpStatus.PAYLOAD_TOO_LARGE;
//       case 'LIMIT_UNEXPECTED_FILE':
//         return HttpStatus.BAD_REQUEST;
//       default:
//         return HttpStatus.BAD_REQUEST;
//     }
//   }

//   private getErrorMessage(error: MulterError): string {
//     switch (error.code) {
//       case 'LIMIT_FILE_SIZE':
//         return `El archivo excede el tamaño máximo permitido de ${formatFileSize(FILE_CONFIG.maxSize)}`;
//       case 'LIMIT_UNEXPECTED_FILE':
//         return 'Campo de archivo no esperado o inválido';
//       default:
//         return `Error al procesar archivo: ${error.message}`;
//     }
//   }

//   private getErrorCode(error: MulterError): string {
//     switch (error.code) {
//       case 'LIMIT_FILE_SIZE':
//         return 'FILE_SIZE_EXCEEDED';
//       case 'LIMIT_UNEXPECTED_FILE':
//         return 'UNEXPECTED_FIELD';
//       default:
//         return 'FILE_PROCESSING_ERROR';
//     }
//   }
// }

@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(MulterExceptionFilter.name, { 
    timestamp: false 
  });

  // Caché de mensajes de error
  private static readonly ERROR_MESSAGE_CACHE = new Map<string, string>();

  // Mapeo estático de códigos de error
  private static readonly ERROR_CODE_MAP: Record<string, { 
    status: number, 
    code: string, 
    defaultMessage?: string 
  }> = {
    'LIMIT_FILE_SIZE': {
      status: HttpStatus.PAYLOAD_TOO_LARGE,
      code: 'FILE_SIZE_EXCEEDED',
      defaultMessage: `El archivo excede el tamaño máximo permitido de ${formatFileSize(FILE_CONFIG.maxSize)}`
    },
    'LIMIT_UNEXPECTED_FILE': {
      status: HttpStatus.BAD_REQUEST,
      code: 'UNEXPECTED_FIELD',
      defaultMessage: 'Campo de archivo no esperado o inválido'
    },
    'default': {
      status: HttpStatus.BAD_REQUEST,
      code: 'FILE_PROCESSING_ERROR'
    }
  };

  catch(error: MulterError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const errorConfig = MulterExceptionFilter.ERROR_CODE_MAP[error.code] 
      || MulterExceptionFilter.ERROR_CODE_MAP['default'];

    // Usar caché de mensajes
    const cacheKey = error.code;
    let message = MulterExceptionFilter.ERROR_MESSAGE_CACHE.get(cacheKey);

    if (!message) {
      message = errorConfig.defaultMessage 
        || `Error al procesar archivo: ${error.message}`;
      MulterExceptionFilter.ERROR_MESSAGE_CACHE.set(cacheKey, message);
    }

    const errorResponse: ErrorResponse = {
      status: errorConfig.status,
      message,
      code: errorConfig.code,
      error: 'Error de Archivo',
      timestamp: new Date().toISOString(),
      details: { 
        originalError: error.message,
        code: error.code 
      }
    };

    this.logger.error(`❌ Error de archivo: ${message}`, {
      code: error.code,
      status: errorResponse.status
    });

    return response.status(errorResponse.status).json(errorResponse);
  }
}

