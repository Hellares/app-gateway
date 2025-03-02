import { Body, Controller, Get, HttpException, HttpStatus, Inject, Logger, Param, Post, Query } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { SERVICES } from 'src/transports/constants';
import { catchError, firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { ArchivosByEmpresaDto, PaginationDto } from 'src/common/dto/pagination.dto';
import { CreateEmpresaDto } from './dto/create-empresa.dto';
import { CategoriaArchivo } from 'src/common/enums/categoria-archivo.enum';
import { ArchivoService } from 'src/archivos/archivo.service';
import { FileUrlHelper } from 'src/files/common/helpers/file-url.helper';
import { UnifiedFilesService } from 'src/files/unified-files.service';
import { RedisService } from 'src/redis/redis.service';
import { CACHE_KEYS } from 'src/redis/constants/redis-cache.keys.contants';
import { REDIS_GATEWAY_CONFIG } from 'src/redis/config/redis.constants';

import { url } from 'inspector';

@Controller('empresa')
export class EmpresaController {
  private readonly logger = new Logger(EmpresaController.name);
  constructor(
    @Inject(SERVICES.COMPANY) private readonly companiesClient: ClientProxy,
    private readonly archivoService: ArchivoService,
    private readonly redisService: RedisService,
  ) {}

  @Post()
  async create(@Body() createCompanyDto: CreateEmpresaDto) {
    return this.companiesClient.send('create.empresa', createCompanyDto).pipe(
      timeout(5000), // Timeout de 5 segundos
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
  }


@Get(':id/archivos')
async getEmpresaArchivos(
  @Param('id') empresaId: string,
  @Query() archivosByEmpresaDto: ArchivosByEmpresaDto
) {
  const { page = 1, limit = 10, categoria, provider } = archivosByEmpresaDto;
  const cacheKey = CACHE_KEYS.ARCHIVO.PAGINATED_BY_EMPRESA(empresaId, page, limit, categoria);
  
  try {
    // Verificar cache primero
    const cachedData = await this.redisService.get(cacheKey);
    if (cachedData.success) {
      // Si los datos están próximos a expirar (menos de 1 minuto)
      // refrescar asincrónicamente para el siguiente request
      if (cachedData.details?.ttl && cachedData.details.ttl < 60) {
        this.refreshArchivoCache(cacheKey, archivosByEmpresaDto, empresaId)
          .catch(err => this.logger.error('Error refreshing archivos cache:', err));
      }
      // Directamente devolver los datos cacheados
      return cachedData.data;
    }

    // Si no hay en caché, obtener de microservicio
    const payload = { 
      paginationDto: { page, limit }, 
      empresaId, 
      categoria 
    };
    
    const response = await firstValueFrom(
      this.companiesClient.send('archivo.findByEmpresa', payload)
    );

    // Verificar si hay datos
    if (!response || !response.data || !Array.isArray(response.data)) {
      const emptyResponse = {
        data: [],
        metadata: {
          total: 0,
          page,
          limit,
          totalPages: 0
        }
      };
      
      // Guardar en caché el resultado vacío
      this.redisService.set(
        cacheKey,
        emptyResponse,
        REDIS_GATEWAY_CONFIG.LOCAL_CACHE.TTL
      ).catch(e => this.logger.error('Error caching empty archivos:', e));
      
      return emptyResponse;
    }

    // Generar URLs para los archivos 
    const archivosConUrl = response.data.map(archivo => ({
      ...archivo,
      url: FileUrlHelper.getFileUrl(archivo.ruta || archivo.filename, {
        tenantId: archivo.tenantId,
        provider
      })
    }));

    // Preparar respuesta final
    const formattedResponse = {
      data: archivosConUrl,
      metadata: response.metadata
    };
    
    // Guardar en caché
    this.redisService.set(
      cacheKey,
      formattedResponse,
      REDIS_GATEWAY_CONFIG.LOCAL_CACHE.TTL
    ).catch(e => this.logger.error('Error caching archivos:', e));
    
    return formattedResponse;
  } catch (error) {
    this.logger.error(`Error al obtener archivos de empresa ${empresaId}:`, {
      error: error.message,
      stack: error.stack
    });
    throw new RpcException(error);
  }
}

private async refreshArchivoCache(
  key: string, 
  archivosByEmpresaDto: ArchivosByEmpresaDto,
  empresaId: string
): Promise<void> {
  try {
    const { page = 1, limit = 10, categoria, provider } = archivosByEmpresaDto;
    const payload = { 
      paginationDto: { page, limit }, 
      empresaId, 
      categoria 
    };
    
    const response = await firstValueFrom(
      this.companiesClient.send('archivo.findByEmpresa', payload)
    );

    if (response && response.data) {
      // Generar URLs para los archivos
      const archivosConUrl = response.data.map(archivo => ({
        ...archivo,
        url: FileUrlHelper.getFileUrl(archivo.ruta || archivo.filename, {
          tenantId: archivo.tenantId,
          provider
        })
      }));

      // Preparar respuesta
      const formattedResponse = {
        data: archivosConUrl,
        metadata: response.metadata
      };

      // Actualizar la caché
      await this.redisService.set(
        key,
        formattedResponse,
        REDIS_GATEWAY_CONFIG.LOCAL_CACHE.TTL
      );
    }
  } catch (error) {
    this.logger.error(`Error al refrescar caché de archivos:`, error);
    throw error;
  }
}

}
