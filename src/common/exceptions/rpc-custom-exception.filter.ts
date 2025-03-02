import { Catch, ArgumentsHost, ExceptionFilter, Logger, HttpStatus } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Observable, throwError } from 'rxjs';
import { ErrorResponse } from '../interfaces/error-response.interface';


@Catch(RpcException)
export class RpcCustomExceptionFilter implements ExceptionFilter {
  // Logger más ligero
  private readonly logger = new Logger(RpcCustomExceptionFilter.name, { 
    timestamp: false 
  });

  // Objeto de error por defecto reutilizable
  private readonly DEFAULT_ERROR: ErrorResponse = {
    success: false,
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
    baseError.success = false;
    if (typeof error === 'string') {
      return {
        ...baseError,
        status: HttpStatus.BAD_REQUEST,
        message: error,
        error: 'Error de Validación',
        code: 'VALIDATION_ERROR'
      }
    }

    if (error instanceof Error) {
      return {
        ...baseError,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: error.message,
        error: 'Error del Sistema',
        code: 'SYSTEM_ERROR'
      };
    }

    // Manejo de objetos de error
    if (typeof error === 'object' && error !== null) {
      return {
        ...baseError,
        status: RpcCustomExceptionFilter.STATUS_MAP[error.code] || error.status || HttpStatus.CONFLICT,
        message: error.message || 'Error de negocio',
        error: error.error || 'Error de Negocio',
        code: error.code || 'BUSINESS_ERROR'
      };
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
        // details: errorResponse.details
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
      success: false,
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