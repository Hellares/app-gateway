import { Body, Controller, Delete, Get, HttpStatus, Inject, Logger, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { FileInterceptor } from '@nestjs/platform-express';
import { catchError, firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { CACHE_KEYS } from 'src/redis/constants/redis-cache.keys.contants';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { FileUrlHelper } from 'src/files/common/helpers/file-url.helper';
import { FILE_CONFIG } from 'src/files/common/validator/file.validator';
import { RedisService } from 'src/redis/redis.service';
import { CreateRubroDto } from './dto/create-rubro.dto';
import { SERVICES } from 'src/transports/constants';
import { Rubro } from './rubro.interface';

@Controller('rubro')
export class RubroController {
  private readonly logger = new Logger(RubroController.name);
  
  // Configuración específica para el módulo de Rubros
  private readonly CACHE_CONFIG = {
    ttl: {
      list: 3600,        // 1 hora para listas
      single: 7200,      // 2 horas para registros individuales
      deleted: 1800      // 30 minutos para elementos eliminados
    },
    invalidation: {
      maxPaginationCache: 10  // Número máximo de páginas a invalidar
    }
  } as const;

  constructor(
    @Inject(SERVICES.COMPANY) private readonly rubroClient: ClientProxy,
    @Inject(SERVICES.FILES) private readonly filesClient: ClientProxy,
    private readonly redisService: RedisService,
  ) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('icono', {
      limits: {
        fileSize: FILE_CONFIG.maxSize
      },
      fileFilter: (req, file, cb) => {
        if (!FILE_CONFIG.allowedMimeTypes.includes(file.mimetype)) {
          return cb(
            new RpcException({
              message: 'Formato de archivo no permitido. Use: JPG, PNG, GIF o WEBP',
              status: HttpStatus.BAD_REQUEST
            }), 
            false
          );
        }
        cb(null, true);
      }
    })
  )
  async create(
    @Body() createRubroDto: CreateRubroDto,
    @UploadedFile() icono?: Express.Multer.File,
  ) {
    try {
      if (icono) {
        if (icono.size > FILE_CONFIG.maxSize) {
          throw new RpcException({
            message: 'El archivo excede el tamaño máximo permitido de 2MB',
            status: HttpStatus.BAD_REQUEST
          });
        }

        const fileResponse = await firstValueFrom(
          this.filesClient.send('file.upload', { 
            file: icono, 
            provider: 'cloudinary' //! Cambiar a 'firebase' para usar Firebase Storage
          }).pipe(
            timeout(5000),
            catchError(err => {
              if (err instanceof TimeoutError) {
                throw new RpcException({
                  message: 'Error al subir el archivo: Timeout',
                  status: HttpStatus.GATEWAY_TIMEOUT
                });
              }
              throw new RpcException({
                message: 'Error al subir el archivo',
                status: HttpStatus.INTERNAL_SERVER_ERROR
              });
            })
          )
        );

        if (!fileResponse?.filename) {
          throw new RpcException({
            message: 'Error al procesar el archivo',
            status: HttpStatus.INTERNAL_SERVER_ERROR
          });
        }

        if (fileResponse.provider === 'firebase') {
          const filename = fileResponse.filename.split('/').pop().split('?')[0];
          createRubroDto.icono = filename;
        } else {
          const urlParts = new URL(fileResponse.filename);
          const pathParts = urlParts.pathname.split('/');
          createRubroDto.icono = pathParts[pathParts.length - 1];
        }
      }

      const result = await firstValueFrom(
        this.rubroClient.send('create.Rubro', createRubroDto).pipe(
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

    await this.updateLocalCache();

      return result;
    } catch (error) {
      if (error instanceof RpcException) {
        throw error;
      }
      throw new RpcException({
        message: 'Error en el proceso',
        status: HttpStatus.INTERNAL_SERVER_ERROR
      });
    }
  }

  private async updateLocalCache() {
    // Limpiar la caché local
    await this.redisService.clearAll();
  
    // // Actualizar la caché local con el nuevo rubro
    // await this.redisService.set(
    //   CACHE_KEYS.RUBRO.PAGINATED(1, 10),
    //   [rubro],
    //   this.CACHE_CONFIG.ttl.list
    // );
  }

  @Get()
async findAllRubros(@Query() paginationDto: PaginationDto) {
  try {
    
    const { page = 1, limit = 10 } = paginationDto;
    const cacheKey = CACHE_KEYS.RUBRO.PAGINATED(page, limit);

    // 1. Intentar obtener de caché (Redis o local)
    this.logger.debug(`🔍 Buscando rubros en caché: ${cacheKey}`);
    const cachedData = await this.redisService.get(cacheKey);

    // 2. Si hay datos en caché, retornarlos
    if (cachedData.success && cachedData.data) {
      this.logger.debug('✅ Datos encontrados en caché');
      return FileUrlHelper.transformResponse<Rubro>(cachedData.data);
    }

    // 3. Si no hay datos en caché, obtener de la base de datos
    this.logger.debug('🔄 Caché miss - Obteniendo datos de la base de datos');
    const rubros = await firstValueFrom(
      this.rubroClient.send('findAll.Rubro', paginationDto).pipe(
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
      this.logger.debug('💾 Guardando nuevos datos en caché');
      await this.redisService.set(
        cacheKey,
        rubros,
        this.CACHE_CONFIG.ttl.list
      ).catch(error => {
        // Solo logueamos el error, no interrumpimos el flujo
        this.logger.error('❌ Error guardando en caché:', error);
      });
    }

    return FileUrlHelper.transformResponse<Rubro>(rubros);
  } catch (error) {
    this.logger.error('❌ Error en findAllRubros:', error);
    throw new RpcException(error);
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
        this.CACHE_CONFIG.ttl.deleted
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
      const invalidationPromises = [
        // Invalidar patrones completos
        this.redisService.delete(CACHE_KEYS.RUBRO.PATTERN),
        
        // Invalidar cachés paginados
        ...Array.from(
          { length: this.CACHE_CONFIG.invalidation.maxPaginationCache }, 
          (_, i) => this.redisService.delete(CACHE_KEYS.RUBRO.PAGINATED(i + 1, 20))
        )
      ];

      await Promise.all(invalidationPromises).catch(error => {
        this.logger.error('Error invalidando cachés:', error);
      });
    } catch (error) {
      this.logger.error('Error en invalidación de caché:', error);
    }
  }

  
}