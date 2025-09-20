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
import { RedisService } from 'src/redis/redis.service';
import { CACHE_KEYS } from 'src/redis/constants/redis-cache.keys.contants';
import { REDIS_AUTH_CONFIG, REDIS_GATEWAY_CONFIG } from 'src/redis/config/redis.constants';
import { createHash } from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly authServiceUrl = envs.authServiceUrl;
  
  constructor(
    private readonly httpService: HttpService,
    // private readonly configService: ConfigService,
    @Inject(SERVICES.COMPANY) private readonly companiesClient: ClientProxy,
    private readonly redisService: RedisService,
  ) {}

  // ✅ AGREGAR: Método ligero de validación que solo decodifica JWT
  validateTokenLight(token: string): any {
    try {
      return this.decodeJWTPayload(token);
    } catch (error) {
      this.logger.debug(`Token ligero inválido: ${error.message}`);
      return null;
    }
  }

  // ✅ AGREGAR: Decodificación local de JWT sin llamar al microservicio
  private decodeJWTPayload(token: string): any {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
      }
      
      const payload = parts[1];
      const decoded = Buffer.from(payload, 'base64url').toString('utf8');
      const parsed = JSON.parse(decoded);
      
      // Verificar que no esté expirado
      if (parsed.exp && Date.now() >= parsed.exp * 1000) {
        throw new Error('Token expired');
      }
      
      return {
        userId: parsed.userId || parsed.userID, // Manejar ambas variaciones
        dni: parsed.dni,
        email: parsed.email,
        empresaId: parsed.empresaId,
        roles: parsed.roles,
        principalRole: parsed.principalRole,
        permissions: parsed.permissions
      };
    } catch (error) {
      throw new Error(`Failed to decode JWT: ${error.message}`);
    }
  }

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
    const startTime = Date.now();
    this.validateLoginInput(loginDto);
    
    this.logger.debug(`Iniciando login para usuario: ${loginDto.dni}`);

    // Intentar obtener desde caché
    const loginCacheKey = CACHE_KEYS.AUTH.USER_LOGIN(loginDto.dni);
    const cachedLogin = await this.redisService.get(loginCacheKey);
    
    if (cachedLogin.success && cachedLogin.data) {
      const cacheTime = Date.now() - startTime;
      this.logger.debug(`Cache hit para login: ${loginDto.dni} (${cacheTime}ms)`);
      
      // Refresh asincrono si es necesario
      if (cachedLogin.details?.ttl && cachedLogin.details.ttl < REDIS_AUTH_CONFIG.LOGIN.REFRESH_THRESHOLD) {
        this.refreshLoginCache(loginDto, loginCacheKey).catch(err => 
          this.logger.error('Error refreshing login cache:', err)
        );
      }
      
      return cachedLogin.data;
    }

    this.logger.debug(`Cache miss para login: ${loginDto.dni}`);

    // Realizar login normal si no hay caché
    const response = await firstValueFrom(
      this.httpService
        .post(`${this.authServiceUrl}/api/auth/login`, loginDto, {
          headers: { 'Content-Type': 'application/json' },
        })
        .pipe(timeout(10000))
    );

    // Procesar respuesta
    const processedResponse = await this.processSuccessfulLogin(response.data.data);

    // Calcular TTL dinámico basado en el tipo de usuario
    const ttl = this.calculateTTLForUser(processedResponse.data);

    // Guardar en caché de forma asíncrona
    this.redisService.set(
      loginCacheKey,
      processedResponse,
      ttl
    ).catch(e => this.logger.error('Error caching login:', e));

    const totalTime = Date.now() - startTime;
    this.logger.debug(`Login completado para ${loginDto.dni}: ${totalTime}ms`);

    return processedResponse;
  }


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


// private async enrichEmpresasWithDetails(empresasAuth: EmpresaAuth[]): Promise<EmpresaEnriquecida[]> {
//     if (!empresasAuth?.length) return [];

//   const enrichStartTime = Date.now();
  
//   // ✅ CORRECCIÓN: usar empresaId en lugar de id
//   const empresasIds = empresasAuth.map(e => e.id).sort();
//   const empresasHash = this.hashIds(empresasIds);
//   const empresasCacheKey = CACHE_KEYS.AUTH.EMPRESAS_ENRICHED(empresasHash);
  
//   this.logger.debug(`Buscando empresas enriquecidas en caché: ${empresasIds.length} empresas`);
  
//   const cachedEmpresas = await this.redisService.get(empresasCacheKey);
  
//   // ✅ CORRECCIÓN: validar que sea un array válido
//   if (cachedEmpresas.success && 
//       cachedEmpresas.data && 
//       Array.isArray(cachedEmpresas.data) && 
//       cachedEmpresas.data.length > 0) {
    
//     const cacheTime = Date.now() - enrichStartTime;
//     this.logger.debug(`Cache hit para empresas enriquecidas (${cacheTime}ms)`);
    
//     // Refresh asincrono si es necesario
//     if (cachedEmpresas.details?.ttl && cachedEmpresas.details.ttl < REDIS_AUTH_CONFIG.EMPRESAS.REFRESH_THRESHOLD) {
//       this.refreshEmpresasCache(empresasAuth, empresasCacheKey).catch(err =>
//         this.logger.error('Error refreshing empresas cache:', err)
//       );
//     }
    
//     // ✅ CORRECCIÓN: asegurar tipado correcto
//     return cachedEmpresas.data as EmpresaEnriquecida[];
//   }

//   this.logger.debug(`Cache miss para empresas enriquecidas`);

//     try {
//       // Timeout dinámico basado en cantidad de empresas
//       const timeoutMs = Math.min(8000, empresasIds.length * 800);
      
//       const empresasResponse = await firstValueFrom(
//         this.companiesClient.send('empresas.by.ids', { empresasIds }).pipe(
//           timeout(timeoutMs),
//           catchError(err => {
//             this.logger.warn(`Error obteniendo detalles de empresas: ${err.message}`);
//             return of({ data: [] });
//           })
//         )
//       );

//       const empresasDetailMap = new Map<string, EmpresaDetail>(
//         empresasResponse.data?.map((empresa: EmpresaDetail) => [empresa.id, empresa]) || []
//       );

//       const empresasEnriquecidas: EmpresaEnriquecida[] = empresasAuth.map(empresaAuth => {
//         const empresaDetail = empresasDetailMap.get(empresaAuth.id);
        
//         return {
//           id: empresaAuth.id,
//           razonSocial: empresaDetail?.razonSocial || null,
//           ruc: empresaDetail?.ruc || null,
//           estado: empresaDetail?.estado,
//           rubro: empresaDetail?.rubro || null,
//           roles: empresaAuth.roles || [],
//           principalRole: empresaAuth.principalRole,
//           permissions: empresaAuth.permissions || [],
//         };
//       });

//       // Guardar en caché con TTL apropiado
//       this.redisService.set(
//         empresasCacheKey,
//         empresasEnriquecidas,
//         REDIS_AUTH_CONFIG.EMPRESAS.TTL
//       ).catch(e => this.logger.error('Error caching empresas:', e));

//       const enrichTime = Date.now() - enrichStartTime;
//       this.logger.debug(`Empresas enriquecidas procesadas: ${enrichTime}ms`);
      
//       return empresasEnriquecidas;

//     } catch (error) {
//       this.logger.error(`Error enriqueciendo empresas: ${error.message}`);
//       return this.createFallbackEmpresas(empresasAuth);
//     }
//   }

private async enrichEmpresasWithDetails(empresasAuth: EmpresaAuth[]): Promise<EmpresaEnriquecida[]> {
  if (!empresasAuth?.length) return [];

  const enrichStartTime = Date.now();
  
  // Extraer y validar IDs de empresas
  const empresasIds = empresasAuth
    .map(e => e.id || e.id)
    .filter(id => id && typeof id === 'string')
    .sort();
    
  if (empresasIds.length === 0) {
    this.logger.warn('No se encontraron IDs válidos de empresas');
    return this.createFallbackEmpresas(empresasAuth);
  }

  const empresasHash = this.hashIds(empresasIds);
  const empresasCacheKey = CACHE_KEYS.AUTH.EMPRESAS_ENRICHED(empresasHash);
  
  this.logger.debug(`Buscando empresas enriquecidas en caché: ${empresasIds.length} empresas`);
  
  // Verificar caché
  const cachedEmpresas = await this.redisService.get(empresasCacheKey);
  
  if (cachedEmpresas.success && 
      cachedEmpresas.data && 
      Array.isArray(cachedEmpresas.data) && 
      cachedEmpresas.data.length > 0) {
    
    const cacheTime = Date.now() - enrichStartTime;
    this.logger.debug(`Cache hit para empresas enriquecidas (${cacheTime}ms)`);
    
    // Refresh asíncrono si es necesario
    if (cachedEmpresas.details?.ttl && cachedEmpresas.details.ttl < REDIS_AUTH_CONFIG.EMPRESAS.REFRESH_THRESHOLD) {
      this.refreshEmpresasCache(empresasAuth, empresasCacheKey).catch(err =>
        this.logger.error('Error refreshing empresas cache:', err)
      );
    }
    
    return cachedEmpresas.data as EmpresaEnriquecida[];
  }

  this.logger.debug(`Cache miss para empresas enriquecidas`);

  try {
    // Paralelización con lotes
    const batchSize = 10; // Procesar de 10 en 10
    const batches = [];
    
    for (let i = 0; i < empresasIds.length; i += batchSize) {
      batches.push(empresasIds.slice(i, i + batchSize));
    }

    this.logger.debug(`Procesando ${empresasIds.length} empresas en ${batches.length} lotes paralelos`);

    // Procesar todos los lotes en paralelo con timeout individual
    const batchPromises = batches.map((batch, index) => 
      firstValueFrom(
        this.companiesClient.send('empresas.by.ids', { empresasIds: batch }).pipe(
          timeout(5000), // Timeout por lote
          catchError(err => {
            this.logger.warn(`Error en lote ${index + 1}: ${err.message}`);
            return of({ data: [] }); // Retornar array vacío en caso de error
          })
        )
      )
    );

    // Esperar a que todos los lotes se completen
    const batchResults = await Promise.allSettled(batchPromises);
    
    // Combinar resultados de todos los lotes
    const allEmpresas: EmpresaDetail[] = [];
    let successfulBatches = 0;
    
    batchResults.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value?.data) {
        allEmpresas.push(...result.value.data);
        successfulBatches++;
      } else {
        this.logger.warn(`Lote ${index + 1} falló o retornó datos vacíos`);
      }
    });

    this.logger.debug(`${successfulBatches}/${batches.length} lotes exitosos, ${allEmpresas.length} empresas obtenidas`);

    // Crear mapa para búsqueda O(1)
    const empresasDetailMap = new Map<string, EmpresaDetail>(
      allEmpresas.map((empresa: EmpresaDetail) => [empresa.id, empresa])
    );

    // Enriquecer datos combinando auth + detalles
    const empresasEnriquecidas: EmpresaEnriquecida[] = empresasAuth.map(empresaAuth => {
      const empresaId = empresaAuth.id || empresaAuth.id;
      const empresaDetail = empresasDetailMap.get(empresaId);
      
      return {
        id: empresaId,
        razonSocial: empresaDetail?.razonSocial || null,
        ruc: empresaDetail?.ruc || null,
        estado: empresaDetail?.estado || 'ACTIVO',
        rubro: empresaDetail?.rubro || null,
        roles: empresaAuth.roles || [],
        principalRole: empresaAuth.principalRole || 'USER',
        permissions: empresaAuth.permissions || [],
      };
    });

    // Guardar en caché solo si tenemos datos válidos
    if (empresasEnriquecidas.length > 0) {
      this.redisService.set(
        empresasCacheKey,
        empresasEnriquecidas,
        REDIS_AUTH_CONFIG.EMPRESAS.TTL
      ).catch(e => this.logger.error('Error caching empresas:', e));
    }

    const enrichTime = Date.now() - enrichStartTime;
    this.logger.debug(`Empresas enriquecidas procesadas: ${enrichTime}ms (${empresasEnriquecidas.length} empresas)`);
    
    return empresasEnriquecidas;

  } catch (error) {
    this.logger.error(`Error enriqueciendo empresas: ${error.message}`);
    return this.createFallbackEmpresas(empresasAuth);
  }
}

// Método de refresh también con paralelización
private async refreshEmpresasCache(empresasAuth: EmpresaAuth[], cacheKey: string): Promise<void> {
  try {
    this.logger.debug(`Refrescando caché de empresas para ${empresasAuth.length} empresas`);
    
    const empresasIds = empresasAuth
      .map(e => e.id || e.id)
      .filter(id => id && typeof id === 'string');

    // Paralelización también en el refresh
    const batchSize = 10;
    const batches = [];
    
    for (let i = 0; i < empresasIds.length; i += batchSize) {
      batches.push(empresasIds.slice(i, i + batchSize));
    }

    const batchPromises = batches.map(batch => 
      firstValueFrom(
        this.companiesClient.send('empresas.by.ids', { empresasIds: batch }).pipe(
          timeout(4000), // Timeout más corto para refresh
          catchError(err => {
            this.logger.warn(`Error en refresh de lote: ${err.message}`);
            return of({ data: [] });
          })
        )
      )
    );

    const batchResults = await Promise.allSettled(batchPromises);
    
    // Combinar resultados
    const allEmpresas: EmpresaDetail[] = [];
    batchResults.forEach(result => {
      if (result.status === 'fulfilled' && result.value?.data) {
        allEmpresas.push(...result.value.data);
      }
    });

    const empresasDetailMap = new Map<string, EmpresaDetail>(
      allEmpresas.map((empresa: EmpresaDetail) => [empresa.id, empresa])
    );

    const empresasEnriquecidas = empresasAuth.map(empresaAuth => {
      const empresaId = empresaAuth.id || empresaAuth.id;
      const empresaDetail = empresasDetailMap.get(empresaId);
      
      return {
        id: empresaId,
        razonSocial: empresaDetail?.razonSocial || null,
        ruc: empresaDetail?.ruc || null,
        estado: empresaDetail?.estado || 'ACTIVO',
        rubro: empresaDetail?.rubro || null,
        roles: empresaAuth.roles || [],
        principalRole: empresaAuth.principalRole || 'USER',
        permissions: empresaAuth.permissions || [],
      };
    });

    await this.redisService.set(cacheKey, empresasEnriquecidas, REDIS_AUTH_CONFIG.EMPRESAS.TTL);
    
    this.logger.debug(`Caché de empresas refrescado exitosamente`);
    
  } catch (error) {
    this.logger.error(`Error refrescando caché de empresas: ${error.message}`);
  }
}

// Método auxiliar mejorado para fallback
private createFallbackEmpresas(empresasAuth: EmpresaAuth[]): EmpresaEnriquecida[] {
  this.logger.debug('Creando empresas con datos mínimos (fallback)');
  
  return empresasAuth.map(empresaAuth => ({
    id: empresaAuth.id || empresaAuth.id || 'unknown',
    razonSocial: null,
    ruc: null,
    estado: 'ACTIVO',
    rubro: null,
    roles: empresaAuth.roles || [],
    principalRole: empresaAuth.principalRole || 'USER',
    permissions: empresaAuth.permissions || [],
  }));
}

  // Refresh asíncrono del caché de login
  private async refreshLoginCache(loginDto: LoginDto, cacheKey: string): Promise<void> {
    try {
      this.logger.debug(`Refrescando caché de login para: ${loginDto.dni}`);
      
      const response = await firstValueFrom(
        this.httpService.post(`${this.authServiceUrl}/api/auth/login`, loginDto, {
          headers: { 'Content-Type': 'application/json' },
        }).pipe(
          timeout(REDIS_GATEWAY_CONFIG.TIMEOUTS.OPERATION)
        )
      );
      
      const processedResponse = await this.processSuccessfulLogin(response.data.data);
      const ttl = this.calculateTTLForUser(processedResponse.data);
      
      await this.redisService.set(cacheKey, processedResponse, ttl);
      
      this.logger.debug(`Caché de login refrescado para: ${loginDto.dni}`);
    } catch (error) {
      this.logger.error(`Error refrescando caché de login: ${error.message}`);
    }
  }

  // Refresh asíncrono del caché de empresas
  // private async refreshEmpresasCache(empresasAuth: EmpresaAuth[], cacheKey: string): Promise<void> {
  //   try {
  //     this.logger.debug(`Refrescando caché de empresas para ${empresasAuth.length} empresas`);
      
  //     const empresasIds = empresasAuth.map(e => e.id);
  //     const empresasResponse = await firstValueFrom(
  //       this.companiesClient.send('empresas.by.ids', { empresasIds }).pipe(
  //         timeout(REDIS_GATEWAY_CONFIG.TIMEOUTS.OPERATION)
  //       )
  //     );

  //     const empresasDetailMap = new Map<string, EmpresaDetail>(
  //       empresasResponse.data?.map((empresa: EmpresaDetail) => [empresa.id, empresa]) || []
  //     );

  //     const empresasEnriquecidas = empresasAuth.map(empresaAuth => {
  //       const empresaDetail = empresasDetailMap.get(empresaAuth.id);
  //       return {
  //         id: empresaAuth.id,
  //         razonSocial: empresaDetail?.razonSocial || null,
  //         ruc: empresaDetail?.ruc || null,
  //         estado: empresaDetail?.estado,
  //         rubro: empresaDetail?.rubro || null,
  //         roles: empresaAuth.roles || [],
  //         permissions: empresaAuth.permissions || [],
  //       };
  //     });

  //     await this.redisService.set(cacheKey, empresasEnriquecidas, REDIS_AUTH_CONFIG.EMPRESAS.TTL);
      
  //   } catch (error) {
  //     this.logger.error(`Error refrescando caché de empresas: ${error.message}`);
  //   }
  // }

  // Calcular TTL dinámico basado en el usuario
  private calculateTTLForUser(loginData: any): number {
    const baseTTL = REDIS_AUTH_CONFIG.LOGIN.TTL;
    
    // Super admins -> TTL más corto (permisos críticos)
    if (loginData.isSuperAdmin) {
      return Math.floor(baseTTL * 0.5); // 5 minutos
    }
    
    // Usuarios con múltiples empresas -> TTL medio
    if (loginData.needsEmpresaSelection) {
      return Math.floor(baseTTL * 0.7); // 7 minutos
    }
    
    // Usuarios normales -> TTL completo
    return baseTTL; // 10 minutos
  }

  // Invalidación inteligente de caché
  async invalidateUserCache(dni?: string, userId?: string): Promise<void> {
    try {
      const operations = [];
      
      if (dni) {
        operations.push(this.redisService.delete(CACHE_KEYS.AUTH.USER_LOGIN(dni)));
      }
      
      if (userId) {
        operations.push(this.redisService.delete(CACHE_KEYS.AUTH.USER_EMPRESAS(userId)));
      }
      
      // Invalidar patrón de empresas enriquecidas
      operations.push(this.redisService.delete(CACHE_KEYS.AUTH.PATTERN));
      
      await Promise.allSettled(operations);
      
      this.logger.debug(`Caché invalidado para usuario: ${dni || userId}`);
    } catch (error) {
      this.logger.error('Error invalidando caché de usuario:', error);
    }
  }

  // Función auxiliar para crear hash de IDs
  private hashIds(ids: string[]): string {
  return createHash('md5')
    .update(ids.sort().join(','))
    .digest('hex')
    .substring(0, 16);
}

// private isValidUUID(uuid: string): boolean {
//   const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
//   return uuidRegex.test(uuid);
// }

// private createFallbackEmpresas(empresasAuth: EmpresaAuth[]): EmpresaEnriquecida[] {
//   return empresasAuth.map(empresaAuth => ({
//     id: empresaAuth.id,
//     razonSocial: null,
//     ruc: null,
//     estado: 'ACTIVO',
//     rubro: null,
//     roles: empresaAuth.roles,
//     principalRole: empresaAuth.principalRole,
//     permissions: empresaAuth.permissions || [],
//   }));
// }

  

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

    // ✅ AGREGAR: Invalidar caché después del logout
    const claims = this.decodeJWTPayload(authHeader.replace('Bearer ', ''));
    if (claims?.dni) {
      await this.invalidateUserCache(claims.dni, claims.userId);
    }
    
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

/*
  ***************************************************************************************
  Metodo: selectEmpresa
  Descripcion: Permite a un usuario seleccionar una empresa específica después de iniciar sesión.
  Esto es útil para usuarios que tienen acceso a múltiples empresas y necesitan cambiar su contexto.
  Fecha: 17-09-2025
  Autor: James Torres
  ***************************************************************************************
*/

async selectEmpresa(empresaId: string, authHeader: string) {
  try {
    this.logger.debug(`Procesando selección de empresa: ${empresaId}`);
    
    // Validar formato del header
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new HttpException('Formato de Authorization header inválido', HttpStatus.BAD_REQUEST);
    }
    
    // Preparar el payload para el microservicio
    const selectEmpresaDto = { empresaId: empresaId };
    
    // Hacer petición al microservicio de autenticación
    const response = await axios.post(
      `${this.authServiceUrl}/api/auth/select-empresa`, 
      selectEmpresaDto,
      {
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    // ✅ AGREGAR: Invalidar caché después de cambiar empresa
    const claims = this.decodeJWTPayload(authHeader.replace('Bearer ', ''));
    if (claims?.dni) {
      await this.invalidateUserCache(claims.dni, claims.userId);
    }
    
    // ✅ SIMPLIFICAR: El microservicio ya retorna todo correctamente
    // No necesitamos mapear ni procesar nada, solo retornar la respuesta
    return response.data;
    
  } catch (error) {
    this.logger.error(`Error al seleccionar empresa: ${error.message}`, error.stack);
    
    if (error.response) {
      const statusCode = error.response.status;
      const errorMessage = error.response.data?.error || error.response.data?.message || 'Error al seleccionar empresa';
      
      switch (statusCode) {
        case 400:
          throw new HttpException(errorMessage, HttpStatus.BAD_REQUEST);
        case 401:
          throw new HttpException('Token inválido o expirado', HttpStatus.UNAUTHORIZED);
        case 403:
          throw new HttpException('No tienes acceso a esta empresa', HttpStatus.FORBIDDEN);
        case 404:
          throw new HttpException('Empresa no encontrada', HttpStatus.NOT_FOUND);
        default:
          throw new HttpException(errorMessage, statusCode);
      }
    }
    
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      throw new HttpException('El servicio de autenticación no está respondiendo', HttpStatus.GATEWAY_TIMEOUT);
    }
    
    throw new HttpException('Error interno del servidor', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

// Método auxiliar para extraer nombres de roles
// public extractRoleNames(roles: any[]): string[] {
//   if (!roles || !Array.isArray(roles)) return [];
  
//   return roles.map(role => {
//     if (typeof role === 'string') return role;
//     if (typeof role === 'object' && role.name) return role.name;
//     return 'UNKNOWN_ROLE';
//   });
// }

// // Método auxiliar para determinar rol principal
// public determinePrincipalRole(roles: any[]): string {
//   if (!roles || !Array.isArray(roles) || roles.length === 0) return 'USER';
  
//   const roleNames = this.extractRoleNames(roles);
  
//   // Jerarquía de roles (del más alto al más bajo)
//   const hierarchy = ['SUPER_ADMIN', 'EMPRESA_ADMIN', 'ADMIN_USERS', 'EMPLEADO', 'CLIENTE'];
  
//   for (const hierarchyRole of hierarchy) {
//     if (roleNames.includes(hierarchyRole)) {
//       return hierarchyRole;
//     }
//   }
  
//   // Si no encuentra un rol conocido, retornar el primero
//   return roleNames[0] || 'USER';
// }
// Método auxiliar para obtener empresas del usuario con información enriquecida
async getUserEmpresasEnriquecidas(authHeader: string) {
  try {
    this.logger.debug('Obteniendo empresas enriquecidas del usuario');
    
    // Validar formato del header
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new HttpException('Formato de Authorization header inválido', HttpStatus.BAD_REQUEST);
    }
    
    // Obtener empresas con roles del microservicio de auth
    const authResponse = await axios.get(
      `${this.authServiceUrl}/api/auth/users/me/empresas-optimized`,
      {
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    
    const empresasAuth: EmpresaAuth[] = authResponse.data.data;
    
    if (!empresasAuth || empresasAuth.length === 0) {
      return {
        success: true,
        data: [],
        message: 'No se encontraron empresas para este usuario'
      };
    }
    
    // Obtener detalles adicionales de las empresas desde el microservicio de empresas
    try {
      const empresasIds = empresasAuth.map(emp => emp.id);
      
      const empresasDetailsResponse = await firstValueFrom(
        this.companiesClient.send('empresas.by.ids', { empresasIds })
          .pipe(
            timeout(8000),
            catchError(err => {
              this.logger.warn('Error obteniendo detalles de empresas, usando datos básicos', err.message);
              return of({ data: [] }); // Retornar array vacío en caso de error
            })
          )
      );
      
      const empresasDetails: EmpresaDetail[] = empresasDetailsResponse.data || [];
      
      // Combinar información de auth con detalles de empresa
      const empresasEnriquecidas: EmpresaEnriquecida[] = empresasAuth.map(empresaAuth => {
        const empresaDetail = empresasDetails.find(detail => detail.id === empresaAuth.id);
        
        return {
          id: empresaAuth.id,
          razonSocial: empresaDetail?.razonSocial || null,
          ruc: empresaDetail?.ruc || null,
          estado: empresaDetail?.estado || 'ACTIVO',
          rubro: empresaDetail?.rubro || null,
          roles: empresaAuth.roles,
          principalRole: empresaAuth.principalRole,
          permissions: empresaAuth.permissions
        };
      });
      
      return {
        success: true,
        data: empresasEnriquecidas
      };
      
    } catch (empresasError) {
      this.logger.error('Error obteniendo detalles de empresas, usando fallback', empresasError.message);
      return this.createFallbackEmpresas(empresasAuth);
    }
    
  } catch (error) {
    this.logger.error(`Error al obtener empresas enriquecidas: ${error.message}`, error.stack);
    
    if (error.response) {
      const statusCode = error.response.status;
      const errorMessage = error.response.data?.error || 'Error al obtener empresas del usuario';
      throw new HttpException(errorMessage, statusCode);
    }
    
    throw new HttpException('Error interno del servidor', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

// private createFallbackEmpresas(empresasAuth: EmpresaAuth[]): { success: boolean; data: EmpresaEnriquecida[] } {
//   this.logger.debug('Creando empresas con datos mínimos (fallback)');
  
//   const empresasFallback: EmpresaEnriquecida[] = empresasAuth.map(empresaAuth => ({
//     id: empresaAuth.id,
//     razonSocial: null,
//     ruc: null,
//     estado: 'ACTIVO',
//     rubro: null,
//     roles: empresaAuth.roles,
//     principalRole: empresaAuth.principalRole,
//     permissions: empresaAuth.permissions
//   }));
  
//   return {
//     success: true,
//     data: empresasFallback
//   };

// }


}
