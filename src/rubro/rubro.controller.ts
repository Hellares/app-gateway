import { Body, Controller, Delete, Get, HttpStatus, Inject, InternalServerErrorException, Logger, NotFoundException, Param, ParseBoolPipe, ParseIntPipe, Post, Query, SetMetadata, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
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
import { FileValidator } from 'src/files/common/validator/file.validator';
import { FileType } from 'src/files/common/constants/file-types.constant';
import { FileErrorCode, FileErrorHelper } from 'src/files/common/helpers/file-error.helper';
import { UploadFile } from 'src/files/common/decorators/file-upload.decorator';


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
@UploadFile('icono', FileType.CATEGORY) //! aqui se asigna el tipo de archivo y se evalua su tamaño
async create(
  @Body() createRubroDto: CreateRubroDto,
  @UploadedFile() icono?: Express.Multer.File,
) {
  let uploadedFileName: string | null = null;

  try {
    // Subir archivo si existe
    if (icono) {
      try {
        const fileResponse = await firstValueFrom(
          this.filesClient.send('file.upload', { 
            file: icono, 
            provider: 'firebase', //! Usar cloudinary - firebase
            type: FileType.CATEGORY //! Usar la categoria o tipo de archivo segun validacion de FILE_CONFIG.types.category
          }).pipe(
            timeout(FILE_VALIDATION.TIMEOUT), // Usar constante de timeout
            catchError(error => {
              throw FileErrorHelper.handleUploadError(error, icono.originalname);
            })
          )
        );

        uploadedFileName = this.extractFileName(fileResponse);
        createRubroDto.icono = uploadedFileName;
      } catch (error) {
        throw FileErrorHelper.handleUploadError(error, icono.originalname);
      }
    }

    // Crear el rubro
    try {
      const result = await firstValueFrom(
        this.rubroClient.send('create.Rubro', createRubroDto).pipe(
          timeout(FILE_VALIDATION.TIMEOUT),
          catchError(async error => {
            // Si falló la creación del rubro pero se subió el archivo, eliminarlo
            if (uploadedFileName) {
              try {
                await firstValueFrom(
                  this.filesClient.send('file.delete', { 
                    filename: uploadedFileName,
                    provider: 'firebase' 
                  }).pipe(timeout(FILE_VALIDATION.TIMEOUT))
                );
              } catch (deleteError) {
                this.logger.error('Error al eliminar archivo después de fallo:', deleteError);
              }
            }
            throw error;
          })
        )
      );

      await this.invalidateAllCaches();

      // Agregar URL del icono a la respuesta
      return {
        ...result,
        // iconoUrl: uploadedFileName ? this.fileUrlHelper.getFileUrl(uploadedFileName) : null
      };

    } catch (error) {
      throw FileErrorHelper.createError(
        'Error al crear el rubro',
        FileErrorCode.PROCESSING_ERROR,
        HttpStatus.INTERNAL_SERVER_ERROR,
        { originalError: error.message }
      );
    }

  } catch (error) {
    // Asegurarse de manejar tanto errores de archivo como de creación
    if (error instanceof RpcException) {
      throw error;
    }
    throw FileErrorHelper.handleUploadError(error, icono?.originalname);
  }
}

private extractFileName(fileResponse: any): string {
  try {
    if (!fileResponse?.filename) {
      throw new Error('Respuesta de archivo inválida');
    }

    if (fileResponse.provider === 'firebase') {
      const parts = fileResponse.filename.split('/').pop()?.split('?');
      if (!parts?.[0]) {
        throw new Error('Nombre de archivo inválido');
      }
      return parts[0];
    }

    const url = new URL(fileResponse.filename);
    const fileName = url.pathname.split('/').pop();
    if (!fileName) {
      throw new Error('No se pudo extraer el nombre del archivo');
    }
    return fileName;

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