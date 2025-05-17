import { Body, Controller, Get, HttpStatus, Inject, Logger, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { SERVICES } from 'src/transports/constants';
import { catchError, firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { ArchivosByEmpresaDto } from 'src/common/dto/pagination.dto';
import { CreateEmpresaDto } from './dto/create-empresa.dto';
import { ArchivoService } from 'src/archivos/archivo.service';
import { FileUrlHelper } from 'src/files/common/helpers/file-url.helper';
import { RedisService } from 'src/redis/redis.service';
import { CACHE_KEYS } from 'src/redis/constants/redis-cache.keys.contants';
import { REDIS_GATEWAY_CONFIG } from 'src/redis/config/redis.constants';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import axios from 'axios';
import { envs } from 'src/config';

@Controller('empresa')
export class EmpresaController {
  private readonly logger = new Logger(EmpresaController.name);
  private readonly authServiceUrl: string; 
  constructor(
    @Inject(SERVICES.COMPANY) private readonly companiesClient: ClientProxy,
    private readonly archivoService: ArchivoService,
    private readonly redisService: RedisService,
  ) {
    this.authServiceUrl = envs.authServiceUrl || 'http://127.0.0.1:3007';
  }

  // @Post()
  // @UseGuards(JwtAuthGuard) // Asegúrate de que el guardia JWT esté importado y configurado correctamente
  // async create(@Body() createCompanyDto: CreateEmpresaDto) {
  //   return this.companiesClient.send('create.empresa', createCompanyDto).pipe(
  //     timeout(10000),
  //     catchError(err => {
  //       if (err instanceof TimeoutError) {
  //         throw new RpcException({
  //           message: 'El servicio no está respondiendo',
  //           status: HttpStatus.GATEWAY_TIMEOUT
  //         });
  //       }
  //       throw new RpcException(err);
  //     }),
  //   );
  // }

  @Post()
  @UseGuards(JwtAuthGuard) // Proteger con autenticación
  async create(@Body() createCompanyDto: CreateEmpresaDto, @Req() req) {
    try {
      // Obtener datos del usuario autenticado
      const userData = req.user;
      
      this.logger.debug(`Solicitud de creación de empresa recibida: ${createCompanyDto.nombreComercial} por usuario: ${userData.dni}`);
      
      // Añadir información del creador al DTO
      const completeDto = {
        ...createCompanyDto,
        creadorId: userData.id,
        creadorDni: userData.dni,
        creadorEmail: userData.email,
        creadorNombre: userData.firstName,
        creadorApellido: userData.lastName,
        creadorTelefono: userData.phone || '',
      };
      
      // Enviar al microservicio de empresa
      return this.companiesClient.send('create.empresa', completeDto).pipe(
        timeout(30000),
        catchError(err => {
          if (err instanceof TimeoutError) {
            throw new RpcException({
              message: 'El servicio no está respondiendo',
              status: HttpStatus.GATEWAY_TIMEOUT
            });
          }
          throw new RpcException(err);
        }),
      );
    } catch (error) {
      this.logger.error(`Error al crear empresa: ${error.message}`, error.stack);
      throw new RpcException({
        message: error.message || 'Error al crear empresa',
        status: error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      });
    }
  }

  @Get('/mis-empresas')
@UseGuards(JwtAuthGuard)
async getCompaniesByUser(@Req() req) {
  try {
    // Obtener datos del usuario autenticado
    const userData = req.user;
    const token = req.headers.authorization.split(' ')[1]; // Extraer el token
    
    this.logger.debug(`Solicitando empresas para el usuario: ${userData.dni}`);
    
    // 1. Obtener IDs de empresas del usuario desde el microservicio de autenticación
    const authUrl = `${this.authServiceUrl}/api/auth/users/me/empresas`;
    
    try {
      const authResponse = await axios.get(authUrl, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      
      const empresasIds = authResponse.data.data;
      
      if (!empresasIds || empresasIds.length === 0) {
        return {
          success: true,
          data: [],
          message: 'No se encontraron empresas para este usuario'
        };
      }
      
      // 2. Obtener detalles de las empresas desde el microservicio de empresas
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
      // Si el error proviene del microservicio de autenticación
      if (error.response) {
        throw new RpcException({
          message: error.response.data.error || 'Error al obtener empresas del usuario',
          status: error.response.status,
        });
      }
      throw error;
    }
  } catch (error) {
    this.logger.error(`Error al obtener empresas del usuario: ${error.message}`, error.stack);
    throw new RpcException({
      message: error.message || 'Error al obtener empresas del usuario',
      status: error.status || HttpStatus.INTERNAL_SERVER_ERROR,
    });
  }
}



  @Get('/:empresaId/storage/stats')
  async getStorageStats(@Param('empresaId') empresaId: string) {
    try {
      // Obtener estadísticas de uso y plan en paralelo
      const [usage, planResponse] = await Promise.all([
        firstValueFrom(
          this.companiesClient.send('storage.usage', { empresaId }).pipe(
            timeout(5000)
          )
        ),
        firstValueFrom(
          this.companiesClient.send('empresa.get-plan', { empresaId }).pipe(
            timeout(5000)
          )
        )
      ]);

      // Extraer la información correcta del nuevo formato de respuesta
      // Ahora la información del plan está en empresaPlan
      const empresaPlan = planResponse.empresaPlan;
      
      // Extraer información del plan
      const planInfo = {
        nombre: empresaPlan.plan.nombre,
        nivel: empresaPlan.plan.nivelPlan,
        estado: empresaPlan.estado,
        message: planResponse.message,
        canUploadFiles: planResponse.canUploadFiles
      };

      // Extraer el valor correcto de maxStorageGB
      // Acceder al valor dentro del objeto limites
      const limites = empresaPlan.plan.limites;
      const maxStorageGB = limites.maxStorageGB || 5; // Valor por defecto si no existe
      
      const percentUsed = (usage.usedGB / maxStorageGB) * 100;

      return {
        plan: planInfo,
        storage: {
          used: {
            bytes: usage.usedBytes,
            MB: usage.usedMB.toFixed(2),
            GB: usage.usedGB.toFixed(2),
          },
          limit: {
            GB: maxStorageGB,
            MB: maxStorageGB * 1024,
          },
          percentUsed: percentUsed.toFixed(2) || '0.00',
          fileCount: usage.fileCount,
        },
        estadoPlan: planResponse.status,
        isDefaultPlan: planResponse.isDefault
      };
    } catch (error) {
      this.logger.error(`Error al obtener estadísticas de almacenamiento: ${error.message}:`, {
        error: error.message,
        stack: error.stack
      });
      throw new RpcException(error);
    }
  }
}
