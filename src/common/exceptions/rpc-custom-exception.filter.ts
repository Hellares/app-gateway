import { Catch, ArgumentsHost, ExceptionFilter, Logger, HttpStatus } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Observable, throwError } from 'rxjs';
import { ErrorResponse } from '../interfaces/error-response.interface';


// @Catch(RpcException)
// export class RpcCustomExceptionFilter implements ExceptionFilter {
//   protected readonly logger = new Logger('RpcExceptionFilter');

//   catch(exception: RpcException, host: ArgumentsHost): Observable<any> {
//     const error = exception.getError();
//     let errorResponse: ErrorResponse;

//     try {
//       errorResponse = this.parseError(error);

//       // Logging basado en el tipo de error
//       this.logError(errorResponse);

//       if (host.getType() === 'http') {
//         const response = host.switchToHttp().getResponse();
//         return response.status(errorResponse.status).json(errorResponse);
//       }

//       return throwError(() => errorResponse);
//     } catch (unexpectedError) {
//       return this.handleUnexpectedError(unexpectedError);
//     }
//   }

//   private parseError(error: any): ErrorResponse {
//     if (typeof error === 'string') {
//       return {
//         status: HttpStatus.BAD_REQUEST,
//         message: error,
//         error: 'Error de Validación',
//         code: 'VALIDATION_ERROR',
//         timestamp: new Date().toISOString()
//       };
//     }

//     if (error instanceof Error) {
//       return {
//         status: HttpStatus.INTERNAL_SERVER_ERROR,
//         message: error.message,
//         error: 'Error del Sistema',
//         code: 'SYSTEM_ERROR',
//         timestamp: new Date().toISOString(),
//         details: error.stack
//       };
//     }

//     if (typeof error === 'object' && error !== null) {
//       return {
//         status: error.status || HttpStatus.CONFLICT,
//         message: error.message || 'Error de negocio',
//         error: error.error || 'Error de Negocio',
//         code: error.code || 'BUSINESS_ERROR',
//         timestamp: new Date().toISOString(),
//         details: error.details || error
//       };
//     }

//     return {
//       status: HttpStatus.INTERNAL_SERVER_ERROR,
//       message: 'Error interno del servidor',
//       error: 'Error Inesperado',
//       code: 'INTERNAL_SERVER_ERROR',
//       timestamp: new Date().toISOString()
//     };
//   }

//   private logError(errorResponse: ErrorResponse): void {
//     if (errorResponse.status === HttpStatus.INTERNAL_SERVER_ERROR) {
//       this.logger.error(`❌ Error interno: ${errorResponse.message}`, {
//         code: errorResponse.code,
//         details: errorResponse.details
//       });
//     } else {
//       this.logger.warn(`⚠️ Error de negocio: ${errorResponse.message}`, {
//         code: errorResponse.code,
//         details: errorResponse.details
//       });
//     }
//   }

//   private handleUnexpectedError(unexpectedError: any): Observable<any> {
//     const fallbackError: ErrorResponse = {
//       status: HttpStatus.INTERNAL_SERVER_ERROR,
//       message: 'Error inesperado en el servidor',
//       error: 'Error Crítico',
//       code: 'CRITICAL_ERROR',
//       timestamp: new Date().toISOString()
//     };
    
//     this.logger.error('❌ Error crítico en el filtro:', unexpectedError);
//     return throwError(() => fallbackError);
//   }
// }

@Catch(RpcException)
export class RpcCustomExceptionFilter implements ExceptionFilter {
  // Logger más ligero
  private readonly logger = new Logger(RpcCustomExceptionFilter.name, { 
    timestamp: false 
  });

  // Objeto de error por defecto reutilizable
  private readonly DEFAULT_ERROR: ErrorResponse = {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Error interno del servidor',
    error: 'Error Inesperado',
    code: 'INTERNAL_SERVER_ERROR',
    timestamp: ''
  };

  // Mapeo estático de códigos de error
  private static readonly STATUS_MAP: Record<string, number> = {
    'VALIDATION_ERROR': HttpStatus.BAD_REQUEST,
    'SYSTEM_ERROR': HttpStatus.INTERNAL_SERVER_ERROR,
    'BUSINESS_ERROR': HttpStatus.CONFLICT,
    'UNAUTHORIZED': HttpStatus.UNAUTHORIZED,
    'NOT_FOUND': HttpStatus.NOT_FOUND
  };

  // Caché de mensajes de error
  private static readonly ERROR_MESSAGE_CACHE = new Map<string, string>();

  catch(exception: RpcException, host: ArgumentsHost): Observable<any> {
    const error = exception.getError();
    
    // Reutilizar objeto de error
    const errorResponse = this.parseError(error, { ...this.DEFAULT_ERROR });

    // Minimizar llamadas a new Date()
    errorResponse.timestamp = errorResponse.timestamp || new Date().toISOString();

    try {
      this.logError(errorResponse);

      if (host.getType() === 'http') {
        const response = host.switchToHttp().getResponse();
        return response.status(errorResponse.status).json(errorResponse);
      }

      return throwError(() => errorResponse);
    } catch (unexpectedError) {
      return this.handleUnexpectedError(unexpectedError);
    }
  }

  private parseError(error: any, baseError: ErrorResponse): ErrorResponse {
    // Manejo de errores tipo string
    if (typeof error === 'string') {
      baseError.status = HttpStatus.BAD_REQUEST;
      baseError.message = error;
      baseError.error = 'Error de Validación';
      baseError.code = 'VALIDATION_ERROR';
      return baseError;
    }

    // Manejo de errores nativos de JavaScript
    if (error instanceof Error) {
      baseError.status = HttpStatus.INTERNAL_SERVER_ERROR;
      baseError.message = error.message;
      baseError.error = 'Error del Sistema';
      baseError.code = 'SYSTEM_ERROR';
      baseError.details = error.stack;
      return baseError;
    }

    // Manejo de objetos de error
    if (typeof error === 'object' && error !== null) {
      // Usar mapeo estático de códigos de estado
      baseError.status = RpcCustomExceptionFilter.STATUS_MAP[error.code] 
        || error.status 
        || HttpStatus.CONFLICT;
      
      baseError.message = error.message || 'Error de negocio';
      baseError.error = error.error || 'Error de Negocio';
      baseError.code = error.code || 'BUSINESS_ERROR';
      baseError.details = error.details || error;
      
      return baseError;
    }

    // Error por defecto
    return baseError;
  }

  private logError(errorResponse: ErrorResponse): void {
    // Criterios más selectivos para loguear
    if (this.shouldLog(errorResponse)) {
      // Usar caché de mensajes
      const cacheKey = `${errorResponse.code}-${errorResponse.status}`;
      let logMessage = RpcCustomExceptionFilter.ERROR_MESSAGE_CACHE.get(cacheKey);

      if (!logMessage) {
        logMessage = `❌ ${errorResponse.error}: ${errorResponse.message}`;
        RpcCustomExceptionFilter.ERROR_MESSAGE_CACHE.set(cacheKey, logMessage);
      }

      this.logger.error(logMessage, {
        code: errorResponse.code,
        details: errorResponse.details
      });
    }
  }

  private shouldLog(errorResponse: ErrorResponse): boolean {
    return errorResponse.status === HttpStatus.INTERNAL_SERVER_ERROR 
           || this.isImportantBusinessError(errorResponse);
  }

  private isImportantBusinessError(errorResponse: ErrorResponse): boolean {
    const importantCodes = ['UNAUTHORIZED', 'FORBIDDEN', 'CONFLICT'];
    return importantCodes.includes(errorResponse.code);
  }

  private handleUnexpectedError(unexpectedError: any): Observable<any> {
    const fallbackError: ErrorResponse = {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Error inesperado en el servidor',
      error: 'Error Crítico',
      code: 'CRITICAL_ERROR',
      timestamp: new Date().toISOString()
    };
    
    this.logger.error('❌ Error crítico en el filtro:', unexpectedError);
    return throwError(() => fallbackError);
  }
}