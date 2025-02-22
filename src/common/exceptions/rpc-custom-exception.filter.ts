import { Catch, ArgumentsHost, ExceptionFilter, Logger, HttpStatus } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Observable, throwError } from 'rxjs';
import { ErrorResponse } from '../interfaces/error-response.interface';

@Catch(RpcException)
export class RpcCustomExceptionFilter implements ExceptionFilter {
  protected readonly logger = new Logger('RpcExceptionFilter');

  catch(exception: RpcException, host: ArgumentsHost): Observable<any> {
    const rpcError = exception.getError();
    let errorResponse: ErrorResponse = {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Error interno del servidor',
      code: 'INTERNAL_SERVER_ERROR',
      timestamp: new Date().toISOString(),
    };

    try {
      if (typeof rpcError === 'string') {
        errorResponse = this.handleStringError(rpcError);
      } else if (this.isObjectError(rpcError)) {
        errorResponse = this.handleObjectError(rpcError);
      } else if (rpcError instanceof Error) {
        errorResponse = this.handleNativeError(rpcError);
      }

      this.logError(errorResponse);

      if (host.getType() === 'http') {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        return response.status(errorResponse.status).json(errorResponse);
      }

      return throwError(() => errorResponse);

    } catch (error) {
      const fallbackError: ErrorResponse = {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Error interno del servidor',
        error: 'Error Inesperado',
        code: 'INTERNAL_SERVER_ERROR',
        timestamp: new Date().toISOString()
      };
      
      this.logger.error('Error inesperado en el filtro de excepciones:', error);
      return throwError(() => fallbackError);
    }
  }

  protected handleStringError(error: string): ErrorResponse {
    return {
      status: HttpStatus.BAD_REQUEST,
      message: error,
      error: 'Error de Validación',
      code: 'VALIDATION_ERROR',
      timestamp: new Date().toISOString()
    };
  }

  protected handleObjectError(error: any): ErrorResponse {
    return {
      status: this.getStatusCode(error.status),
      message: error.message || 'Error desconocido',
      error: error.error || 'Error de Inesperado',
      code: error.code || 'APPLICATION_ERROR',
      timestamp: new Date().toISOString(),
      details: error.details
    };
  }

  protected handleNativeError(error: Error): ErrorResponse {
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: error.message,
      error: error.name || 'Error del Sistema',
      code: 'SYSTEM_ERROR',
      timestamp: new Date().toISOString(),
      details: error.stack
    };
  }

  protected isObjectError(error: any): boolean {
    return typeof error === 'object' && error !== null && !Array.isArray(error);
  }

  protected getStatusCode(status: any): number {
    if (typeof status === 'number' && !isNaN(status)) {
      return status;
    }
    return HttpStatus.BAD_REQUEST;
  }

  protected getPath(host: ArgumentsHost): string {
    try {
      if (host.getType() === 'http') {
        const ctx = host.switchToHttp();
        const request = ctx.getRequest();
        return request.url;
      }
      return 'RPC Call';
    } catch {
      return 'Unknown Path';
    }
  }

  protected logError(error: ErrorResponse): void {
    this.logger.error('RPC Exception:', {
      ...error,
      context: 'RpcExceptionFilter'
    });
  }
}