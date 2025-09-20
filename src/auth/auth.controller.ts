// src/auth/auth.controller.ts
import { Body, Controller, Post, Logger, Headers, UseGuards, Req, HttpStatus, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterUserDto } from './dto/register-user.dto';
// import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { SelectEmpresaDto } from './interfaces/empresa.interfaces';
import { GetEmpresaContext } from './decorators/empresa-context.decorator';
import { EmpresaContext } from 'src/types/express-extension';
import axios from 'axios';
import { HybridAuthGuard } from './guards/hybrid-auth.guard';
import { EmpresaGuard } from './guards/empresa.guard';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() registerUserDto: RegisterUserDto) {
    this.logger.debug(`Recibida solicitud para registrar usuario: ${registerUserDto.email}`);
    
    // Llamamos al servicio para registrar el usuario
    const result = await this.authService.register(registerUserDto);
    
    // Devolvemos el resultado
    return result;
  }


  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('logout')
  async logout(@Headers('authorization') authorization: string) {
    return await this.authService.logout(authorization);
  }

  @Post('logout-all')
  async logoutAll(@Headers('authorization') authorization: string) {
    return await this.authService.logoutAll(authorization);
  }

  /**
   * Endpoint para seleccionar/cambiar empresa
   * Genera un nuevo token con información específica de la empresa seleccionada
   */
  @Post('select-empresa')
  @UseGuards(HybridAuthGuard)
  async selectEmpresa(
    @Body() selectEmpresaDto: SelectEmpresaDto,
    @Req() req
  ) {
    try {
      const { empresaId } = selectEmpresaDto;
      const authHeader = req.headers.authorization;

      if (!empresaId) {
        return {
          success: false,
          message: 'ID de empresa es requerido',
          statusCode: HttpStatus.BAD_REQUEST
        };
      }

      // const result = await this.authService.selectEmpresa(empresaId, authHeader);
      return await this.authService.selectEmpresa(empresaId, authHeader);
      
      // return {
      //   success: true,
      //   message: 'Empresa seleccionada exitosamente',
      //   data: result.data
      // };

    } catch (error) {
      return {
        success: false,
        message: error.message || 'Error al seleccionar empresa',
        statusCode: error.status || HttpStatus.INTERNAL_SERVER_ERROR
      };
    }
  }

   /**
   * ✅ AGREGAR: Endpoint para obtener empresas básicas
   */
  @Get('mis-empresas-basicas')
  // @UseGuards(JwtAuthGuard)
  async getMisEmpresasBasicas(@Req() req) {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return {
          success: false,
          message: 'Token de autorización requerido',
          statusCode: HttpStatus.UNAUTHORIZED
        };
      }

      const response = await axios.get(
        `${this.authService}/api/auth/users/me/empresas-optimized`,
        {
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
          },
          timeout: 8000
        }
      );

      return {
        success: true,
        message: 'Empresas básicas obtenidas exitosamente',
        data: response.data.data
      };

    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.error || 'Error al obtener empresas básicas',
        statusCode: error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR
      };
    }
  }

  /**
   * ✅ AGREGAR: Endpoint para obtener empresas completas
   */
  @Get('mis-empresas-completas')
  // @UseGuards(JwtAuthGuard)
  async getMisEmpresasCompletas(@Req() req) {
    try {
      const authHeader = req.headers.authorization;
      const result = await this.authService.getUserEmpresasEnriquecidas(authHeader);
      
      return {
        success: true,
        message: 'Empresas obtenidas exitosamente',
        data: result
      };

    } catch (error) {
      return {
        success: false,
        message: error.message || 'Error al obtener empresas',
        statusCode: error.status || HttpStatus.INTERNAL_SERVER_ERROR
      };
    }
  }

  /**
   * ✅ AGREGAR: Endpoint para probar el contexto de empresa
   */
  @Get('test-contexto')
@UseGuards(HybridAuthGuard)
async testContexto(
  @Req() req,
  @GetEmpresaContext() empresaContext: EmpresaContext
) {
  return {
    success: true,
    message: 'Contexto simplificado funcionando',
    data: {
      // ✅ Datos del usuario autenticado (desde HybridAuthGuard)
      user: {
        id: req.user?.id,
        dni: req.user?.dni,
        empresaId: req.user?.empresaId,
        roles: req.user?.roles,
        principalRole: req.user?.principalRole,
        permissions: req.user?.permissions,
        tokenType: req.user?.tokenType
      },
      // ✅ Datos del contexto de empresa (desde Middleware)
      empresaContext: {
        hasContext: !!empresaContext,
        empresaId: empresaContext?.empresaId,
        roles: empresaContext?.roles,
        principalRole: empresaContext?.principalRole,
        permissions: empresaContext?.permissions
      },
      // ✅ Verificación: ambos deberían tener la misma información
      dataConsistency: {
        sameEmpresaId: req.user?.empresaId === empresaContext?.empresaId,
        samePrincipalRole: req.user?.principalRole === empresaContext?.principalRole,
        sameRolesCount: req.user?.roles?.length === empresaContext?.roles?.length,
        samePermissionsCount: req.user?.permissions?.length === empresaContext?.permissions?.length
      }
    }
  };
}
}