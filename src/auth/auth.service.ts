import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { firstValueFrom, of } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import { envs } from '../config';
import { ErrorCode } from '../common/interceptors/global-error.interceptor';
import { LoginDto } from './dto/login.dto';
import { RegisterUserDto } from './dto/register-user.dto';
import axios from 'axios';
import { SERVICES } from 'src/transports/constants';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly authServiceUrl = envs.authServiceUrl;
  
  constructor(
    private readonly httpService: HttpService,
    // private readonly configService: ConfigService,
    @Inject(SERVICES.COMPANY) private readonly companiesClient: ClientProxy,
  ) {}

    async register(registerUserDto: RegisterUserDto) {
    try {
      this.logger.debug(`Intentando registrar usuario con DNI: ${registerUserDto.dni}`);
      
      // Hacemos la petición HTTP al microservicio de autenticación
      const response = await axios.post(`${this.authServiceUrl}/api/auth/register`, registerUserDto, {
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      this.logger.debug(`Usuario registrado con exito: ${registerUserDto.dni}`);
      
      // Devolvemos la respuesta del microservicio
      return response.data;
    } catch (error) {
      this.logger.error(`Error al registrar usuario: ${error.message}`, error.stack);
      
      // Si el error tiene una respuesta del servidor, extraemos esa información
      if (error.response) {
        throw new HttpException({
          message: error.response.data.error || 'Error en el servicio de autenticacion',
          statusCode: error.response.status,
        }, error.response.status);
      }
      
      // Si no hay respuesta, es un error de conexión
      throw new HttpException(
        'Error de conexion con el servicio de autenticación', 
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  async login(loginDto: LoginDto) {
    // Validación temprana
    this.validateLoginInput(loginDto);
    
    this.logger.debug(`Intentando iniciar sesion para usuario con DNI: ${loginDto.dni}`);

    // Realizar petición - El interceptor manejará TODOS los errores
    const response = await firstValueFrom(
      this.httpService
        .post(`${this.authServiceUrl}/api/auth/login`, loginDto, {
          headers: { 'Content-Type': 'application/json' },
        })
        .pipe(timeout(10000)) // El interceptor manejará el timeout
    );

    // Procesar respuesta exitosa
    return await this.processSuccessfulLogin(response.data.data);
  }

  // async selectEmpresa(selectEmpresaDto: SelectEmpresaDto) {
  //   this.validateEmpresaSelection(selectEmpresaDto);

  //   const response = await firstValueFrom(
  //     this.httpService
  //       .post(`${this.authServiceUrl}/api/auth/select-empresa`, selectEmpresaDto)
  //       .pipe(timeout(5000))
  //   );

  //   return {
  //     success: true,
  //     message: 'Empresa seleccionada exitosamente',
  //     data: response.data.data
  //   };
  // }

  // async refreshToken(refreshTokenDto: RefreshTokenDto) {
  //   const response = await firstValueFrom(
  //     this.httpService
  //       .post(`${this.authServiceUrl}/api/auth/refresh`, refreshTokenDto)
  //       .pipe(timeout(5000))
  //   );

  //   return {
  //     success: true,
  //     message: 'Token renovado exitosamente',
  //     data: response.data.data
  //   };
  // }

  // async logout(logoutDto: LogoutDto) {
  //   const response = await firstValueFrom(
  //     this.httpService
  //       .post(`${this.authServiceUrl}/api/auth/logout`, logoutDto)
  //       .pipe(timeout(3000))
  //   );

  //   return {
  //     success: true,
  //     message: 'Sesión cerrada exitosamente',
  //     data: null
  //   };
  // }

  // Métodos privados de validación
  private validateLoginInput(loginDto: LoginDto): void {
    if (!loginDto.dni || !loginDto.password) {
      throw new RpcException({
        message: 'DNI y contraseña son requeridos',
        status: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
        error: 'Error de Validación'
      });
    }

    if (!/^\d{8}$/.test(loginDto.dni)) {
      throw new RpcException({
        message: 'El DNI debe tener 8 digitos',
        status: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
        error: 'Error de Validacion'
      });
    }
  }

  // private validateEmpresaSelection(dto: SelectEmpresaDto): void {
  //   if (!dto.empresaId || !dto.token) {
  //     throw new RpcException({
  //       message: 'Empresa ID y token son requeridos',
  //       status: HttpStatus.BAD_REQUEST,
  //       code: ErrorCode.VALIDATION_ERROR,
  //       error: 'Error de Validación'
  //     });
  //   }
  // }

  private async processSuccessfulLogin(loginData: any) {
    this.logger.debug(`Login exitoso. Usuario tiene: ${loginData.empresas?.length || 0} empresas`);

    const empresasEnriquecidas = await this.enrichEmpresasIfPresent(loginData.empresas);

    return {
      success: true,
      message: 'Login inicial exitoso',
      data: {
        token: loginData.token,
        user: loginData.user,
        empresas: empresasEnriquecidas,
        isSuperAdmin: loginData.isSuperAdmin,
        needsEmpresaSelection: loginData.needsEmpresaSelection,
      },
    };
  }

  private async enrichEmpresasIfPresent(empresas: any[]): Promise<any[]> {
    if (!empresas?.length) {
      return [];
    }

    try {
      // Aquí puedes hacer llamadas a otros microservicios si necesitas
      return await this.enrichEmpresasWithDetails(empresas);
    } catch (error) {
      // El interceptor manejará este error si falla
      this.logger.warn('No se pudieron enriquecer las empresas, usando datos básicos');
      return empresas;
    }
  }


  private async enrichEmpresasWithDetails(empresasAuth: EmpresaAuth[]): Promise<EmpresaEnriquecida[]> {
  this.logger.debug(`Enriqueciendo ${empresasAuth.length} empresas con detalles...`);

  // Validar y filtrar IDs (UUIDs)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const empresasIds = empresasAuth
    .map(empresa => empresa.id)
    .filter(id => id && typeof id === 'string' && uuidRegex.test(id));

  if (empresasIds.length === 0) {
    this.logger.warn('No se encontraron IDs válidos de empresas para enriquecer');
    return this.createFallbackEmpresas(empresasAuth);
  }

  try {
    // Consultar microservicio de empresas
    const timeoutMs = Math.min(10000, empresasIds.length * 1000);
    
    const empresasResponse = await firstValueFrom(
      this.companiesClient.send('empresas.by.ids', { empresasIds }).pipe(
        timeout(timeoutMs),
        catchError(err => {
          // Log pero no lanzar - devolver respuesta vacía para manejar gracefully
          this.logger.warn(
            `No se pudieron obtener detalles de empresas: ${err.message}`,
            { empresasIds, error: err.message }
          );
          return of({ data: [], failedIds: empresasIds });
        })
      )
    );

    // Validar respuesta
    if (!empresasResponse?.data || !Array.isArray(empresasResponse.data)) {
      this.logger.warn('Respuesta inválida del servicio de empresas, usando datos básicos');
      return this.createFallbackEmpresas(empresasAuth);
    }

    // Log de IDs fallidos si los hay
    if (empresasResponse.failedIds?.length > 0) {
      this.logger.debug(
        `${empresasResponse.failedIds.length} empresas no encontradas en el servicio`,
        { failedIds: empresasResponse.failedIds }
      );
    }

    // Mapear respuestas para búsqueda rápida
    const empresasDetailMap = new Map<string, EmpresaDetail>(
      empresasResponse.data.map((empresa: EmpresaDetail) => [empresa.id, empresa])
    );

    // Combinar datos de auth con detalles de empresa
    const empresasEnriquecidas: EmpresaEnriquecida[] = empresasAuth.map(empresaAuth => {
      const empresaDetail = empresasDetailMap.get(empresaAuth.id);
      
      if (!empresaDetail) {
        this.logger.debug(`Empresa ${empresaAuth.id} no tiene detalles, usando valores por defecto`);
      }

      return {
        // Datos del auth service (siempre presentes)
        id: empresaAuth.id,
        razonSocial: empresaDetail?.razonSocial || null,
        ruc: empresaDetail?.ruc || null,
        estado: empresaDetail?.estado || 'ACTIVO', // Default más optimista
        rubro: empresaDetail?.rubro || null,
        roles: empresaAuth.roles,
        principalRole: empresaAuth.principalRole,
        permissions: empresaAuth.permissions,
      };
    });
    
    return empresasEnriquecidas;

  } catch (error) {
    // Este catch solo se ejecutará si hay un error no manejado
    // El interceptor global lo convertirá en RpcException
    this.logger.error(
      'Error crítico enriqueciendo empresas, usando fallback',
      { error: error.message, stack: error.stack }
    );
    return this.createFallbackEmpresas(empresasAuth);
  }
}

private createFallbackEmpresas(empresasAuth: EmpresaAuth[]): EmpresaEnriquecida[] {
  this.logger.debug('Creando empresas con datos mínimos (fallback)');
  
  return empresasAuth.map(empresaAuth => ({
    id: empresaAuth.id,
    razonSocial: null,
    ruc: null,
    estado: 'ACTIVO', // Asumimos activo si no podemos verificar
    rubro: null,
    roles: empresaAuth.roles,
    principalRole: empresaAuth.principalRole,
    permissions: empresaAuth.permissions,
    
    
  }));
}

  

  async validateToken(token: string) {
    try {
      this.logger.debug(`Validando token: ${token.substring(0, 10)}...`);
      const response = await axios.get(`${this.authServiceUrl}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      this.logger.debug(`Respuesta de validacion: ${JSON.stringify(response.data)}`);
      return response.data.data;
    } catch (error) {
      this.logger.error(`Error al validar token: ${error.message}`);
      return null;
    }
  }

async logout(authHeader: string) {
  try {
    this.logger.debug('Procesando logout de usuario');
    
    // Validar formato del header
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Formato de Authorization header inválido');
    }
    
    // Hacer petición al microservicio - CORREGIDO
    const response = await firstValueFrom(
      this.httpService.post(
        `${this.authServiceUrl}/api/auth/logout`, 
        {}, // ← Body vacío
        {   // ← Headers como TERCER parámetro
          headers: {
            'Authorization': authHeader, // Usar header completo
            'Content-Type': 'application/json'
          }
        }
      ).pipe(timeout(5000))
    );

    this.logger.debug('Logout exitoso');
    
    return {
      success: true,
      message: 'Sesión cerrada exitosamente',
      data: null
    };
    
  } catch (error) {
    this.logger.error(`Error en logout: ${error.message}`, error.stack);
    
    if (error.response) {
      throw new HttpException({
        message: error.response.data.error || 'Error al cerrar sesión',
        statusCode: error.response.status,
      }, error.response.status);
    }
    
    throw new HttpException(
      'Error de conexión con el servicio de autenticación', 
      HttpStatus.SERVICE_UNAVAILABLE
    );
  }
}

async logoutAll(authHeader: string) {
  try {
    this.logger.debug('Procesando logout de todas las sesiones del usuario');
    
    // Validar que el header existe
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new RpcException({
        message: 'Token de autorización requerido',
        status: HttpStatus.UNAUTHORIZED,
        code: ErrorCode.VALIDATION_ERROR,
        error: 'Error de Autenticación'
      });
    }

    // Hacer petición al microservicio de autenticación
    const response = await firstValueFrom(
      this.httpService
        .post(`${this.authServiceUrl}/api/auth/logout-all`, {}, {
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
          }
        })
        .pipe(timeout(5000))
    );

    this.logger.debug('Logout de todas las sesiones exitoso');
    
    return {
      success: true,
      message: 'Todas las sesiones han sido cerradas exitosamente',
      data: null
    };
    
  } catch (error) {
    this.logger.error(`Error en logout all: ${error.message}`, error.stack);
    
    // Si el error viene del microservicio de auth
    if (error.response) {
      throw new HttpException({
        message: error.response.data.error || 'Error al cerrar sesiones',
        statusCode: error.response.status,
      }, error.response.status);
    }
    
    // Si es un error de conexión
    throw new HttpException(
      'Error de conexión con el servicio de autenticación', 
      HttpStatus.SERVICE_UNAVAILABLE
    );
  }
}

}
