import { Catch, ArgumentsHost, ExceptionFilter, Logger, HttpStatus } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Observable, throwError } from 'rxjs';

export interface RpcErrorResponse {
  status?: number;
  message?: string;
  error?: string;
  timestamp?: string;
  path?: string;
  code?: string;
  details?: any;
}

@Catch(RpcException)
export class RpcCustomExceptionFilter implements ExceptionFilter {
  protected readonly logger = new Logger('RpcExceptionFilter');

  catch(exception: RpcException, host: ArgumentsHost): Observable<any> {
    const rpcError = exception.getError();
    let errorResponse: RpcErrorResponse = {
      timestamp: new Date().toISOString(),
      path: this.getPath(host)
    };

    try {
      if (typeof rpcError === 'string') {
        errorResponse = this.handleStringError(rpcError, errorResponse);
      } else if (this.isObjectError(rpcError)) {
        errorResponse = this.handleObjectError(rpcError, errorResponse);
      } else if (rpcError instanceof Error) {
        errorResponse = this.handleNativeError(rpcError, errorResponse);
      }

      this.logError(errorResponse);

      if (host.getType() === 'http') {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        return response.status(errorResponse.status).json(errorResponse);
      }

      return throwError(() => errorResponse);

    } catch (error) {
      this.logger.error('Error inesperado en el filtro de excepciones:', error);
      return throwError(() => ({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Error interno del servidor',
        timestamp: new Date().toISOString()
      }));
    }
  }

  protected handleStringError(error: string, baseResponse: RpcErrorResponse): RpcErrorResponse {
    if (error.includes('Empty response')) {
      return {
        ...baseResponse,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: error.substring(0, error.indexOf('(') - 1),
        code: 'EMPTY_RESPONSE'
      };
    }

    return {
      ...baseResponse,
      status: HttpStatus.BAD_REQUEST,
      message: error,
      code: 'RPC_ERROR'
    };
  }

  protected handleObjectError(error: any, baseResponse: RpcErrorResponse): RpcErrorResponse {
    return {
      ...baseResponse,
      status: this.getStatusCode(error.status),
      message: error.message || 'Error desconocido',
      //error: error.error,
      code: error.code || 'UNKNOWN_ERROR',
      details: error.details
    };
  }

  protected handleNativeError(error: Error, baseResponse: RpcErrorResponse): RpcErrorResponse {
    return {
      ...baseResponse,
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: error.message,
      //error: error.name,
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

  protected logError(error: RpcErrorResponse): void {
    this.logger.error('RPC Exception:', {
      ...error,
      context: 'RpcExceptionFilter'
    });
  }
}