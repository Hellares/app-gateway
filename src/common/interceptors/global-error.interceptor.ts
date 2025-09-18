import { 
  Injectable, 
  NestInterceptor, 
  ExecutionContext, 
  CallHandler,
  HttpStatus,
  Logger
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { RpcException } from '@nestjs/microservices';

export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  BUSINESS_ERROR = 'BUSINESS_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  NOT_FOUND = 'NOT_FOUND',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  GATEWAY_TIMEOUT = 'GATEWAY_TIMEOUT',
  FORBIDDEN = 'FORBIDDEN',
  CONFLICT = 'CONFLICT',
  BAD_REQUEST = 'BAD_REQUEST',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR'
}

export interface StructuredError {
  message: string;
  status: number;
  code: ErrorCode;
  error?: string;
  details?: any;
  success?: boolean;
}

@Injectable()
export class GlobalErrorInterceptor implements NestInterceptor {
  private readonly logger = new Logger(GlobalErrorInterceptor.name);

  // Mapeo de errores HTTP a errores estructurados
  private readonly errorMappings = new Map<number, Partial<StructuredError>>([
    [400, { 
      status: HttpStatus.BAD_REQUEST, 
      code: ErrorCode.BAD_REQUEST,
      error: 'Solicitud Inválida'
    }],
    [401, { 
      status: HttpStatus.UNAUTHORIZED, 
      code: ErrorCode.UNAUTHORIZED,
      error: 'No Autorizado'
    }],
    [403, { 
      status: HttpStatus.FORBIDDEN, 
      code: ErrorCode.FORBIDDEN,
      error: 'Acceso Prohibido'
    }],
    [404, { 
      status: HttpStatus.NOT_FOUND, 
      code: ErrorCode.NOT_FOUND,
      error: 'Recurso No Encontrado'
    }],
    [409, { 
      status: HttpStatus.CONFLICT, 
      code: ErrorCode.CONFLICT,
      error: 'Conflicto de Negocio'
    }],
    [503, { 
      status: HttpStatus.SERVICE_UNAVAILABLE, 
      code: ErrorCode.SERVICE_UNAVAILABLE,
      error: 'Servicio No Disponible'
    }],
    [504, { 
      status: HttpStatus.GATEWAY_TIMEOUT, 
      code: ErrorCode.GATEWAY_TIMEOUT,
      error: 'Timeout del Gateway'
    }]
  ]);

  // Mensajes personalizados por servicio/módulo
  private readonly serviceErrorMessages = {
    auth: {
      401: 'Credenciales inválidas',
      403: 'No tienes permisos para realizar esta acción',
      503: 'Servicio de autenticación no disponible',
      504: 'Tiempo de conexión agotado con el servicio de autenticación'
    },
    user: {
      404: 'Usuario no encontrado',
      409: 'El usuario ya existe',
      403: 'No tienes permisos para modificar este usuario'
    },
    empresa: {
      404: 'Empresa no encontrada',
      403: 'No tienes permisos para acceder a esta empresa',
      409: 'La empresa ya existe'
    },
    rubro: {
      404: 'Rubro no encontrado',
      409: 'El rubro ya existe'
    },
    plans: {
      404: 'Plan no encontrado',
      403: 'No tienes acceso a este plan',
      409: 'Ya tienes un plan activo'
    },
    files: {
      400: 'Archivo inválido',
      413: 'El archivo excede el tamaño máximo permitido',
      415: 'Tipo de archivo no soportado'
    },
    archivos: {
      404: 'Archivo no encontrado',
      403: 'No tienes permisos para acceder a este archivo'
    }
  };

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const contextType = context.getType();
    
    // Extraer información según el tipo de contexto
    const serviceName = this.extractServiceName(context);

    return next.handle().pipe(
      catchError(err => {
        // Si ya es una RpcException bien formada, la dejamos pasar
        if (err instanceof RpcException && this.isWellFormedRpcException(err)) {
          return throwError(() => err);
        }

        // Convertir el error a RpcException estructurada
        const structuredError = this.mapToStructuredError(err, serviceName);
        
        // Log condicional basado en la severidad
        this.logError(structuredError, err, serviceName);

        return throwError(() => new RpcException(structuredError));
      })
    );
  }

  private extractServiceName(context: ExecutionContext): string {
    const contextType = context.getType();
    
    if (contextType === 'http') {
      const request = context.switchToHttp().getRequest();
      const path = request.url || request.path || '';
      // Extraer el módulo de la ruta: /api/auth/login -> auth
      const match = path.match(/\/api\/(\w+)/);
      return match ? match[1] : 'unknown';
    } 
    
    if (contextType === 'rpc') {
      // Para microservicios RabbitMQ
      const data = context.switchToRpc().getData();
      // Puedes extraer info del pattern o cmd
      const pattern = context.switchToRpc().getContext().getPattern();
      if (typeof pattern === 'object' && pattern.cmd) {
        // Si el pattern es como { cmd: 'create-user' }
        const service = pattern.cmd.split('-')[0];
        return service || 'unknown';
      }
      return 'microservice';
    }
    
    return 'unknown';
  }

  private isWellFormedRpcException(exception: RpcException): boolean {
    const error = exception.getError();
    return typeof error === 'object' && 
           'code' in error && 
           'status' in error &&
           'message' in error;
  }

  private mapToStructuredError(error: any, serviceName: string): StructuredError {
    // 1. Si es un error de timeout
    if (error.name === 'TimeoutError') {
      return {
        success: false,
        message: this.getServiceMessage(serviceName, 504) || 'Tiempo de conexión agotado',
        status: HttpStatus.GATEWAY_TIMEOUT,
        code: ErrorCode.GATEWAY_TIMEOUT,
        error: 'Timeout Error'
      };
    }

    // 2. Si es un error de Axios (HTTP)
    if (error.response) {
      const { status, data } = error.response;
      const mapping = this.errorMappings.get(status);
      
      return {
        success: false,
        message: this.getServiceMessage(serviceName, status) || 
                 data?.message || 
                 data?.error || 
                 mapping?.error || 
                 'Error en el servicio',
        status: mapping?.status || status || HttpStatus.INTERNAL_SERVER_ERROR,
        code: mapping?.code || ErrorCode.SYSTEM_ERROR,
        error: mapping?.error || 'Error del Sistema',
        details: data?.details
      };
    }

    // 3. Si es un error de conexión
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ECONNRESET') {
      return {
        success: false,
        message: `No se puede conectar con el servicio de ${serviceName}`,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: ErrorCode.SERVICE_UNAVAILABLE,
        error: 'Error de Conexión'
      };
    }

    // 4. Si es un error de validación
    if (error.name === 'ValidationError' || error.name === 'BadRequestException') {
      return {
        success: false,
        message: error.message || 'Datos de entrada inválidos',
        status: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
        error: 'Error de Validación',
        details: error.errors || error.response
      };
    }

    // 5. Error de RabbitMQ
    if (error.message && error.message.includes('Channel closed')) {
      return {
        success: false,
        message: 'Error de comunicación con el microservicio',
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: ErrorCode.SERVICE_UNAVAILABLE,
        error: 'Error de Comunicación'
      };
    }

    // 6. Error genérico
    return {
      success: false,
      message: error.message || 'Error interno del servidor',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.SYSTEM_ERROR,
      error: 'Error del Sistema'
    };
  }

  private getServiceMessage(serviceName: string, status: number): string | null {
    return this.serviceErrorMessages[serviceName]?.[status] || null;
  }

  private logError(structuredError: StructuredError, originalError: any, serviceName: string): void {
    // Solo loguear errores importantes
    if (this.shouldLog(structuredError)) {
      const logData = {
        code: structuredError.code,
        status: structuredError.status,
        service: serviceName,
        message: structuredError.message,
        ...(process.env.NODE_ENV !== 'production' && { 
          stack: originalError.stack,
          details: structuredError.details 
        })
      };

      if (structuredError.status >= 500) {
        this.logger.error(`[${serviceName}] ${structuredError.message}`, logData);
      } else {
        this.logger.warn(`[${serviceName}] ${structuredError.message}`, logData);
      }
    }
  }

  private shouldLog(error: StructuredError): boolean {
    // Loguear errores 5xx y errores críticos de negocio
    return error.status >= 500 || 
           [
             ErrorCode.UNAUTHORIZED, 
             ErrorCode.FORBIDDEN, 
             ErrorCode.CONFLICT,
             ErrorCode.SERVICE_UNAVAILABLE
           ].includes(error.code);
  }
}