// En user.controller.ts
import { Body, Controller, Get, Post, Put, Delete, Param, Query, Req, UseGuards, HttpStatus, Inject, Logger } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { catchError, firstValueFrom, timeout, TimeoutError } from 'rxjs';
import axios from 'axios';
import { envs } from 'src/config';
import { SERVICES } from 'src/transports/constants';
import { RegisterUserDto } from 'src/auth/dto/register-user.dto';

@Controller('users')
export class UserController {
  private readonly logger = new Logger(UserController.name);
  private readonly authServiceUrl: string;

  constructor(
    @Inject(SERVICES.COMPANY) private readonly companiesClient: ClientProxy,
  ) {
    this.authServiceUrl = envs.authServiceUrl || 'http://127.0.0.1:3007';
  }

  // Obtener roles del usuario actual (con opción de filtrar por empresa)
  @Get('/me/roles')
  @UseGuards(JwtAuthGuard)
  async getCurrentUserRoles(@Req() req, @Query('empresaId') empresaId?: string) {
    try {
      const userData = req.user;
      const token = req.headers.authorization.split(' ')[1];
      
      this.logger.debug(`Solicitando roles para el usuario: ${userData.dni}`);
      
      let authUrl = `${this.authServiceUrl}/api/auth/users/${userData.id}/roles`;
      if (empresaId) {
        authUrl += `?empresaId=${empresaId}`;
      }
      
      const response = await axios.get(authUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      return {
        success: true,
        data: response.data.data,
      };
    } catch (error) {
      this.logger.error(`Error al obtener roles del usuario: ${error.message}`);
      throw new RpcException({
        message: error.response?.data?.error || 'Error al obtener roles del usuario',
        status: error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      });
    }
  }

  // Obtener permisos del usuario actual
  @Get('/me/all-permissions')
  @UseGuards(JwtAuthGuard)
  async getCurrentUserAllPermissions(@Req() req, @Query('empresaId') empresaId: string) {
    try {
      const userData = req.user;
      const token = req.headers.authorization.split(' ')[1];
      
      if (!empresaId) {
        throw new RpcException({
          message: 'ID de empresa requerido',
          status: HttpStatus.BAD_REQUEST,
        });
      }
      
      this.logger.debug(`Solicitando todos los permisos para el usuario: ${userData.dni} en empresa: ${empresaId}`);
      
      const authUrl = `${this.authServiceUrl}/api/auth/users/me/all-permissions?empresaId=${empresaId}`;
      
      const response = await axios.get(authUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      return {
        success: true,
        data: response.data.data,
      };
    } catch (error) {
      this.logger.error(`Error al obtener permisos del usuario: ${error.message}`);
      throw new RpcException({
        message: error.response?.data?.error || 'Error al obtener permisos del usuario',
        status: error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      });
    }
  }

  // Obtener permisos de un usuario específico (con opción de filtrar por empresa)
  @Get('/:userId/all-permissions')
  @UseGuards(JwtAuthGuard)
  async getUserAllPermissions(
    @Param('userId') userId: string, 
    @Query('empresaId') empresaId: string,
    @Req() req
  ) {
    try {
      const token = req.headers.authorization.split(' ')[1];
      const userData = req.user;
      
      if (!empresaId) {
        throw new RpcException({
          message: 'ID de empresa requerido',
          status: HttpStatus.BAD_REQUEST,
        });
      }
      
      this.logger.debug(`Solicitando todos los permisos para el usuario ID: ${userId} en empresa: ${empresaId}`);
      
      // Verificar si el usuario actual tiene permisos para ver esta información
      // Solo puede ver sus propios permisos o si es un admin
      if (userId !== userData.id) {
        this.logger.debug(`Usuario ${userData.id} intentando ver permisos de ${userId}`);
        
        // Aquí podrías agregar una verificación de permisos administrativos
        // Por ejemplo, verificar si es SUPER_ADMIN o EMPRESA_ADMIN
        const adminCheckUrl = `${this.authServiceUrl}/api/auth/users/${userData.id}/permissions?empresaId=${empresaId}&permission=SUPER_ADMIN&permission=EMPRESA_ADMIN`;
        
        try {
          const adminResponse = await axios.get(adminCheckUrl, {
            headers: { Authorization: `Bearer ${token}` }
          });
          
          const hasAdminPermission = adminResponse.data.data?.SUPER_ADMIN || adminResponse.data.data?.EMPRESA_ADMIN;
          
          if (!hasAdminPermission) {
            throw new RpcException({
              message: 'No tienes permisos para ver los permisos de otro usuario',
              status: HttpStatus.FORBIDDEN,
            });
          }
        } catch (adminError) {
          if (adminError instanceof RpcException) {
            throw adminError;
          }
          this.logger.error(`Error verificando permisos de admin: ${adminError.message}`);
        }
      }
      
      // Construir URL para el microservicio de autenticación
      const authUrl = `${this.authServiceUrl}/api/auth/users/${userId}/all-permissions?empresaId=${empresaId}`;
      
      const response = await axios.get(authUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      return {
        success: true,
        data: response.data.data,
      };
    } catch (error) {
      this.logger.error(`Error al obtener todos los permisos del usuario: ${error.message}`);
      throw new RpcException({
        message: error.response?.data?.error || error.message || 'Error al obtener permisos del usuario',
        status: error.response?.status || error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      });
    }
}

  

  // Obtener empresas del usuario actual
  @Get('/me/empresas')
  @UseGuards(JwtAuthGuard)
  async getCurrentUserEmpresas(@Req() req) {
    try {
      const userData = req.user;
      const token = req.headers.authorization.split(' ')[1];
      
      this.logger.debug(`Solicitando empresas para el usuario: ${userData.dni}`);
      
      // 1. Obtener IDs de empresas desde el microservicio de autenticación
      const authResponse = await axios.get(
        `${this.authServiceUrl}/api/auth/users/me/empresas`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      const empresasIds = authResponse.data.data;
      
      if (!empresasIds || empresasIds.length === 0) {
        return {
          success: true,
          data: [],
          message: 'No se encontraron empresas para este usuario'
        };
      }
      
      // 2. Obtener detalles de empresas del microservicio de empresas
      const empresasResponse = await firstValueFrom(
        this.companiesClient.send('empresas.by.ids', { empresasIds })
          .pipe(
            timeout(10000),
            catchError(err => {
              if (err instanceof TimeoutError) {
                throw new RpcException({
                  message: 'El servicio no está respondiendo',
                  status: HttpStatus.GATEWAY_TIMEOUT
                });
              }
              throw new RpcException(err);
            })
          )
      );
      
      return {
        success: true,
        data: empresasResponse.data,
      };
    } catch (error) {
      this.logger.error(`Error al obtener empresas del usuario: ${error.message}`);
      throw new RpcException({
        message: error.message || 'Error al obtener empresas del usuario',
        status: error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      });
    }
  }

  @Get('/search') //! Endpoint para buscar usuarios por identificador (DNI, email o teléfono)
@UseGuards(JwtAuthGuard)
async searchUser(@Query('identifier') identifier: string, @Req() req) {
  try {
    const token = req.headers.authorization.split(' ')[1];
    
    this.logger.debug(`Buscando usuario con identificador: ${identifier}`);
    
    const authUrl = `${this.authServiceUrl}/api/auth/users/search?identifier=${encodeURIComponent(identifier)}`;
    
    const response = await axios.get(authUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    return {
      success: true,
      data: response.data.data,
      message: response.data.message || 'Búsqueda completada',
    };
  } catch (error) {
    this.logger.error(`Error al buscar usuario: ${error.message}`);
    throw new RpcException({
      message: error.response?.data?.error || 'Error al buscar usuario',
      status: error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
    });
  }
}

// Añadir un usuario existente como cliente a una empresa
@Post('/:userId/empresas/:empresaId/add-as-client')
@UseGuards(JwtAuthGuard)
async addUserAsClient(
  @Param('userId') userId: string,
  @Param('empresaId') empresaId: string,
  @Req() req
) {
  try {
    const token = req.headers.authorization.split(' ')[1];
    
    this.logger.debug(`Añadiendo usuario ${userId} como cliente a empresa ${empresaId}`);
    
    const authUrl = `${this.authServiceUrl}/api/auth/users/${userId}/empresas/${empresaId}/add-as-client`;
    
     await axios.post(authUrl, {}, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    // Opcionalmente, notificar al cliente por email
    
    return {
      success: true,
      message: 'Usuario añadido como cliente exitosamente',
    };
  } catch (error) {
    this.logger.error(`Error al añadir cliente: ${error.message}`);
    throw new RpcException({
      message: error.response?.data?.error || 'Error al añadir cliente',
      status: error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
    });
  }
}

// Endpoint para registrar un nuevo cliente y añadirlo a una empresa en un solo paso
@Post('/register-client/:empresaId')
@UseGuards(JwtAuthGuard)
async registerClientForEmpresa(
  @Param('empresaId') empresaId: string,
  @Body() createClientDto: RegisterUserDto,
  @Req() req
) {
  try {
    const userData = req.user;
    const token = req.headers.authorization.split(' ')[1];
    
    this.logger.debug(`Registrando nuevo cliente para empresa ${empresaId}`);
    
    // 1. Primero intentar encontrar si el usuario ya existe
    const searchUrl = `${this.authServiceUrl}/api/auth/users/find?identifier=${encodeURIComponent(createClientDto.dni || createClientDto.email || createClientDto.phone)}`;
    
    let userId = null;
    try {
      const searchResponse = await axios.get(searchUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (searchResponse.data.data) {
        // Usuario ya existe
        userId = searchResponse.data.data.id;
        this.logger.debug(`Usuario encontrado con ID: ${userId}`);
      }
    } catch (error) {
      // Ignorar error, asumimos que no existe
      this.logger.debug(`Usuario no encontrado, procediendo a crear nuevo`);
    }
    
    // 2. Si no existe, registrar nuevo usuario
    if (!userId) {
      // Registrar usuario
      const registerResponse = await axios.post(
        `${this.authServiceUrl}/api/auth/register`,
        {
          dni: createClientDto.dni,
          email: createClientDto.email,
          password: this.generateTemporaryPassword(), // Función para generar contraseña aleatoria
          firstName: createClientDto.firstName,
          lastName: createClientDto.lastName,
          phone: createClientDto.phone
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      userId = registerResponse.data.data.id;
      this.logger.debug(`Nuevo usuario registrado con ID: ${userId}`);
    }
    
    // 3. Añadir como cliente a la empresa
    const addClientUrl = `${this.authServiceUrl}/api/auth/users/${userId}/empresas/${empresaId}/add-as-client`;
    
    await axios.post(addClientUrl, {}, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    return {
      success: true,
      message: 'Cliente registrado y añadido exitosamente',
      data: { userId }
    };
  } catch (error) {
    this.logger.error(`Error al registrar cliente: ${error.message}`);
    throw new RpcException({
      message: error.response?.data?.error || 'Error al registrar cliente',
      status: error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
    });
  }
}

// Método auxiliar para generar contraseña temporal
private generateTemporaryPassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

  
  // Listar usuarios de una empresa
  @Get('/empresa/:empresaId')
@UseGuards(JwtAuthGuard)
async listUsersForEmpresa(
  @Param('empresaId') empresaId: string, 
  @Query('page') page = '1', 
  @Query('limit') limit = '10',
  @Query('role') role?: string,
  @Req() req?
) {
  try {
    const userData = req.user;
    const token = req.headers.authorization.split(' ')[1];
    
    this.logger.debug(`Listando usuarios para empresa ${empresaId}`);
    
    
    this.logger.debug(`Solicitando roles para el usuario: ${userData.dni}`);
      
    let authUrl = `${this.authServiceUrl}/api/auth/users/${userData.id}/roles`;

      if (empresaId) {
        authUrl += `?empresaId=${empresaId}`;
      }
      
      ;
      
      const rolesResponse = await axios.get(authUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });

            
    // Solo administradores o usuarios con permisos específicos pueden ver usuarios
    const roles = rolesResponse.data.data;
    
    const hasPermission = roles.some(role => 
      ['EMPRESA_ADMIN', 'ADMIN_USERS', 'VIEW_USERS', 'SUPER_ADMIN'].includes(role.name)
    );   
    
    
    
    if (!hasPermission) {
      throw new RpcException({
        message: 'No tienes permisos para ver usuarios de esta empresa',
        status: HttpStatus.FORBIDDEN,
      });
    }
   
    
    // Obtener usuarios del microservicio de autenticación
    let usersUrl = `${this.authServiceUrl}/api/auth/users/empresa/${empresaId}?page=${page}&limit=${limit}`;
    
  
    if (role) {
      usersUrl += `&role=${encodeURIComponent(role)}`;
    }
;
    
    const usersResponse = await axios.get(usersUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
  
    
    return {
      success: true,
      data: usersResponse.data.data,
      pagination: usersResponse.data.pagination || {
        page: parseInt(page),
        limit: parseInt(limit),
        total: usersResponse.data.data.length
      }
    };
  } catch (error) {
    this.logger.error(`Error al listar usuarios: ${error.message}`);
    throw new RpcException({
      message: error.response?.data?.error || error.message || 'Error al listar usuarios',
      status: error.response?.status || error.status || HttpStatus.INTERNAL_SERVER_ERROR,
    });
  }
}

// Listar todos los usuarios (solo para SUPER_ADMIN)
@Get('/all') 
@UseGuards(JwtAuthGuard)
async listAllUsers(
  @Query('page') page = '1',
  @Query('limit') limit = '10',
  @Query('status') status?: string,
  @Query('search') search?: string,
  @Req() req?
) {
  try {
    const userData = req.user;
    const token = req.headers.authorization.split(' ')[1];
    
    this.logger.debug(`Usuario ${userData.dni} solicitando lista de todos los usuarios`);
    
    // Construir URL con los parámetros
    let authUrl = `${this.authServiceUrl}/api/auth/users?page=${page}&limit=${limit}`;
    
    // Añadir filtros opcionales
    if (status) {
      authUrl += `&status=${encodeURIComponent(status)}`;
    }
    
    if (search) {
      authUrl += `&search=${encodeURIComponent(search)}`;
    }
    
    // Realizar la petición al microservicio de autenticación
    const response = await axios.get(authUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    // El endpoint ya verifica si el usuario es SUPER_ADMIN en el microservicio
    
    return {
      success: true,
      data: response.data.data,
      pagination: response.data.pagination || {
        page: parseInt(page),
        limit: parseInt(limit),
        total: (response.data.data || []).length
      }
    };
  } catch (error) {
    this.logger.error(`Error al listar todos los usuarios: ${error.message}`);
    
    // Si el error es de permisos (403), dar un mensaje más claro
    if (error.response?.status === 403) {
      throw new RpcException({
        message: 'No tienes permiso para acceder a la lista de todos los usuarios. Se requiere rol SUPER_ADMIN.',
        status: HttpStatus.FORBIDDEN
      });
    }
    
    throw new RpcException({
      message: error.response?.data?.error || error.message || 'Error al listar usuarios',
      status: error.response?.status || error.status || HttpStatus.INTERNAL_SERVER_ERROR,
    });
  }
}

// Listar usuarios por empresa (accesible para SUPER_ADMIN y usuarios con permisos en esa empresa)
@Get('/empresa/:empresaId/all')
@UseGuards(JwtAuthGuard)
async listAllUsersInEmpresa(
  @Param('empresaId') empresaId: string,
  @Query('page') page = '1',
  @Query('limit') limit = '10',
  @Query('role') role?: string,
  @Query('status') status?: string,
  @Query('search') search?: string,
  @Req() req?
) {
  try {
    const userData = req.user;
    const token = req.headers.authorization.split(' ')[1];
    
    this.logger.debug(`Usuario ${userData.dni} solicitando lista completa de usuarios para empresa ${empresaId}`);
    
    // Verificar primero si el usuario es SUPER_ADMIN
    let isSuperAdmin = false;
    try {
      // Consultamos si el usuario tiene el rol SUPER_ADMIN
      const checkUrl = `${this.authServiceUrl}/api/auth/users/me/all-permissions?empresaId=${empresaId}`;
      const permResponse = await axios.get(checkUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      // Verificar si tiene el rol SUPER_ADMIN en los datos devueltos
      if (permResponse.data?.data?.roles?.includes('SUPER_ADMIN')) {
        isSuperAdmin = true;
      }
    } catch (error) {
      // Si hay error, asumimos que no es SUPER_ADMIN
      this.logger.warn(`Error verificando si es SUPER_ADMIN: ${error.message}`);
    }
    
    // Construir URL con los parámetros
    let authUrl;
    
    if (isSuperAdmin) {
      // Si es SUPER_ADMIN, usar el endpoint especial que muestra todos los usuarios
      authUrl = `${this.authServiceUrl}/api/auth/empresa/${empresaId}/all-users?page=${page}&limit=${limit}`;
    } else {
      // Si no es SUPER_ADMIN, usar el endpoint normal que filtra según permisos
      authUrl = `${this.authServiceUrl}/api/auth/users/empresa/${empresaId}?page=${page}&limit=${limit}`;
    }
    
    // Añadir filtros opcionales
    if (role) {
      authUrl += `&role=${encodeURIComponent(role)}`;
    }
    
    if (status) {
      authUrl += `&status=${encodeURIComponent(status)}`;
    }
    
    if (search) {
      authUrl += `&search=${encodeURIComponent(search)}`;
    }
    
    // Realizar la petición al microservicio de autenticación
    const response = await axios.get(authUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    return {
      success: true,
      data: response.data.data,
      pagination: response.data.pagination || {
        page: parseInt(page),
        limit: parseInt(limit),
        total: (response.data.data || []).length
      }
    };
  } catch (error) {
    this.logger.error(`Error al listar usuarios de empresa: ${error.message}`);
    
    // Si el error es de permisos (403), dar un mensaje más claro
    if (error.response?.status === 403) {
      throw new RpcException({
        message: 'No tienes permiso para acceder a la lista de usuarios de esta empresa.',
        status: HttpStatus.FORBIDDEN
      });
    }
    
    throw new RpcException({
      message: error.response?.data?.error || error.message || 'Error al listar usuarios de empresa',
      status: error.response?.status || error.status || HttpStatus.INTERNAL_SERVER_ERROR,
    });
  }
}

  // Más métodos que podrías implementar:
  // - Actualizar usuario
  // - Eliminar usuario
  // - Cambiar rol de usuario
  // - Obtener permisos de usuario
  // - etc.
}