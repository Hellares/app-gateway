import { Body, Controller, Delete, Get, HttpStatus, Inject, Logger,  Param,  Post, Query,  UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { FileInterceptor } from '@nestjs/platform-express';
import { catchError, firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { CACHE_KEYS } from 'src/redis/constants/redis-cache.keys.contants';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { FileUrlHelper } from 'src/files/common/helpers/file-url.helper';
import { FILE_CONFIG, FILE_VALIDATION } from 'src/files/common/constants/file.validator.constant';
import { RedisService } from 'src/redis/redis.service';
import { CreateRubroDto } from './dto/create-rubro.dto';
import { SERVICES } from 'src/transports/constants';
import { Rubro } from './rubro.interface';
import { REDIS_GATEWAY_CONFIG } from 'src/redis/config/redis.constants';
import { RateLimitGuard } from 'src/common/guards/rate-limit.guard';
import { RATE_LIMIT_PRESETS } from 'src/common/guards/rate-limit.config';

import { FileErrorCode, FileErrorHelper } from 'src/files/common/helpers/file-error.helper';
import { UploadFile } from 'src/files/common/decorators/file-upload.decorator';
import { formatFileSize } from 'src/common/util/format-file-size.util';


@Controller('rubro')
// @UseGuards(RateLimitGuard)
export class RubroController {
  
  private readonly logger = new Logger(RubroController.name);
  

  constructor(
    @Inject(SERVICES.COMPANY) private readonly rubroClient: ClientProxy,
    @Inject(SERVICES.FILES) private readonly filesClient: ClientProxy,
    private readonly redisService: RedisService,
  ) {}  


  @Post()
@UploadFile('icono')
async create(
  @Body() createRubroDto: CreateRubroDto,
  @UploadedFile() icono?: Express.Multer.File,
) {
  let uploadedFileName: string | null = null;
  const startTime = Date.now();

  try {
    // 1. Subir archivo si existe
    if (icono) {
      this.logger.debug(`📤 Subiendo icono para rubro: ${icono.originalname} (${formatFileSize(icono.size)})`);
      
      try {
        const fileResponse = await firstValueFrom(
          this.filesClient.send('file.upload', { 
            file: icono, 
            provider: 'firebase'
          }).pipe(
            timeout(FILE_VALIDATION.TIMEOUT),
            catchError(error => {
              throw FileErrorHelper.handleUploadError(error, icono.originalname);
            })
          )
        );

        uploadedFileName = fileResponse.filename;
        createRubroDto.icono = uploadedFileName;
        
        this.logger.debug(`✅ Icono subido: ${uploadedFileName}`);
      } catch (error) {
        const duration = Date.now() - startTime;
        this.logger.error(`❌ Error al subir icono`, {
          filename: icono.originalname,
          error: error.message,
          duration: `${duration}ms`
        });
        throw error;
      }
    }

    // 2. Crear el rubro
    this.logger.debug(`📝 Creando rubro: ${createRubroDto.nombre}`);
    
    try {
      const result = await firstValueFrom(
        this.rubroClient.send('create.Rubro', createRubroDto).pipe(
          timeout(FILE_VALIDATION.TIMEOUT)
        )
      );

      await this.invalidateAllCaches();
      
      const duration = Date.now() - startTime;
      this.logger.debug(`✅ Rubro creado: ${createRubroDto.nombre} en ${duration}ms`);
      
      return result;

    } catch (error) {
      // Si falló la creación del rubro pero se subió el archivo, eliminarlo
      if (uploadedFileName) {
        this.logger.debug(`🗑️ Iniciando rollback - Eliminando icono: ${uploadedFileName}`);
        try {
          await firstValueFrom(
            this.filesClient.send('file.delete', { 
              filename: uploadedFileName,
              provider: 'firebase' 
            }).pipe(timeout(FILE_VALIDATION.TIMEOUT))
          );
          this.logger.debug(`✅ Rollback completado - Icono eliminado`);
        } catch (deleteError) {
          this.logger.error(`❌ Error en rollback al eliminar icono`, {
            filename: uploadedFileName,
            error: deleteError.message
          });
        }
      }

      const duration = Date.now() - startTime;
      this.logger.error(`❌ Error al crear rubro`, {
        rubro: createRubroDto.nombre,
        error: error.message,
        duration: `${duration}ms`
      });

      throw new RpcException({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Error al crear el rubro',
        error: 'Error de Validación',
        code: 'RUBRO_CREATION_ERROR',
        timestamp: new Date().toISOString(),
        details: {
          originalError: error.message,
          duration: `${duration}ms`
        }
      });
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    throw error; // Re-lanzar el error original sin crear logs adicionales
  }
}

  private extractFileName(fileResponse: any): string {
    try {
      if (!fileResponse?.filename) {
        throw new Error('Respuesta de archivo inválida');
      }

      return fileResponse.filename;

    } catch (error) {
      throw FileErrorHelper.createError(
        'Error al procesar nombre de archivo',
        FileErrorCode.PROCESSING_ERROR,
        HttpStatus.INTERNAL_SERVER_ERROR,
        { 
          response: fileResponse,
          originalError: error.message 
        }
      );
    }
  }


  

  @Get()
  // @UseGuards(RateLimitGuard)
  // @SetMetadata('rateLimit', RATE_LIMIT_PRESETS.CRITICAL)
  async findAllRubros(@Query() paginationDto: PaginationDto) {
  const { page = 1, limit = 10 } = paginationDto;
  const cacheKey = CACHE_KEYS.RUBRO.PAGINATED(page, limit);
  
  try {
    
    // Agregar un lock para prevenir cache stampede
    const cachedData = await this.redisService.get(cacheKey);
    if (cachedData.success) {
      // Si los datos están próximos a expirar (ej: menos de 1 minuto)
      // refrescar asincrónicamente para el siguiente request
      if (cachedData.details?.ttl && cachedData.details.ttl < 60) {
        this.refreshCache(cacheKey, paginationDto).catch(err => 
          this.logger.error('Error refreshing cache:', err)
        );
      }
      return FileUrlHelper.transformResponse<Rubro>(cachedData.data);
    }

    const rubros = await firstValueFrom(
      this.rubroClient.send('findAll.Rubro', paginationDto)
    );

    if(rubros) {
      // Guardar en caché de forma asíncrona
      this.redisService.set(
        cacheKey,
        rubros,
        REDIS_GATEWAY_CONFIG.LOCAL_CACHE.TTL
      ).catch(e => this.logger.error('Error caching:', e));
    }

    return FileUrlHelper.transformResponse<Rubro>(rubros);
  } catch (error) {
    this.logger.error('Error en findAllRubros:', error);

    throw new RpcException(error);
  }
}

private async refreshCache(key: string, params: PaginationDto): Promise<void> {
  const data = await firstValueFrom(
    this.rubroClient.send('findAll.Rubro', params)
  );
  
  if(data) {
    await this.redisService.set(
      key,
      data,
      //this.CACHE_CONFIG.ttl.list
      REDIS_GATEWAY_CONFIG.LOCAL_CACHE.TTL
    );
  }
}


 


@Get('/deleted')
async findDeletedRubros(@Query() paginationDto: PaginationDto) {
  try {
    const { page = 1, limit = 10 } = paginationDto;
    const cacheKey = CACHE_KEYS.RUBRO.PAGINATED(page, limit);

    // 1. Intentar obtener de caché
    this.logger.debug(`🔍 Buscando rubros eliminados en caché: ${cacheKey}`);
    const cachedData = await this.redisService.get(cacheKey);

    // 2. Si hay datos en caché, retornarlos
    if (cachedData.success && cachedData.data) {
      this.logger.debug('✅ Datos eliminados encontrados en caché');
      return FileUrlHelper.transformResponse<Rubro>(cachedData.data);
    }

    // 3. Si no hay datos en caché, obtener de la base de datos
    this.logger.debug('🔄 Caché miss - Obteniendo datos eliminados de la base de datos');
    const rubros = await firstValueFrom(
      this.rubroClient.send('findDeleted.Rubro', paginationDto).pipe(
        timeout(5000),
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

    // 4. Si obtuvimos datos de la BD, guardarlos en caché
    if (rubros) {
      this.logger.debug('💾 Guardando nuevos datos eliminados en caché');
      await this.redisService.set(
        cacheKey,
        rubros,
        // this.CACHE_CONFIG.ttl.deleted
      ).catch(error => {
        this.logger.error('❌ Error guardando en caché:', error);
      });
    }

    return FileUrlHelper.transformResponse<Rubro>(rubros);
  } catch (error) {
    this.logger.error('❌ Error en findDeletedRubros:', error);
    throw new RpcException(error);
  }
}

  @Delete(':id')
  async deleteRubro(@Param('id') id: string) {
    try {
      const result = await firstValueFrom(
        this.rubroClient.send('remove.Rubro', id).pipe(
          timeout(5000),
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

      // Invalidar cachés después de eliminar
      await this.invalidateAllCaches();

      return result;
    } catch (error) {
      this.logger.error('❌ Error en deleteRubro:', error);
      throw new RpcException(error);
    }
  }

  @Post('restore/:id')
  async restoreRubro(@Param('id') id: string) {
    try {
      const result = await firstValueFrom(
        this.rubroClient.send('restore.Rubro', id).pipe(
          timeout(5000),
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

      // Invalidar cachés después de restaurar
      await this.invalidateAllCaches();

      return result;
    } catch (error) {
      this.logger.error('❌ Error en restoreRubro:', error);
      throw new RpcException(error);
    }
  }

  @Post('reorder')
  async reorderRubros(@Body() data: { rubroIds: string; newPosition: number }) {
    try {
      const result = await firstValueFrom(
        this.rubroClient.send('reorder.Rubro', data).pipe(
          timeout(5000),
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

      // Invalidar cachés después de reordenar
      await this.invalidateAllCaches();

      return result;
    } catch (error) {
      this.logger.error('❌ Error en reorderRubros:', error);
      throw new RpcException(error);
    }
  }


  private async invalidateAllCaches(): Promise<void> {
    try {
      // Usar pattern matching de Redis en lugar de múltiples deletes
      await this.redisService.delete(CACHE_KEYS.RUBRO.PATTERN);
      
      // Limpiar caché local
      await this.redisService.clearAll();
    } catch (error) {
      this.logger.error('Error en invalidación:', error);
    }
  }


  
}