import { Body, Controller, Delete, Get, HttpStatus, Inject, Logger,  Param,  Post, Query,  UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { catchError, firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { CACHE_KEYS } from 'src/redis/constants/redis-cache.keys.contants';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { FileUrlHelper } from 'src/files/common/helpers/file-url.helper';
import { FILE_VALIDATION } from 'src/files/common/constants/file.validator.constant';
import { RedisService } from 'src/redis/redis.service';
import { CreateRubroDto } from './dto/create-rubro.dto';
import { SERVICES } from 'src/transports/constants';
import { Rubro } from './rubro.interface';
import { REDIS_GATEWAY_CONFIG } from 'src/redis/config/redis.constants';
import { RateLimitGuard } from 'src/common/guards/rate-limit.guard';
import { RATE_LIMIT_PRESETS } from 'src/common/guards/rate-limit.config';
import { UploadFile } from 'src/files/common/decorators/file-upload.decorator';
import { ArchivoService } from 'src/archivos/archivo.service';
import { CategoriaArchivo } from 'src/common/enums/categoria-archivo.enum';
import { UnifiedFilesService } from 'src/files/unified-files.service';


@Controller('rubro')
// @UseGuards(RateLimitGuard)
export class RubroController {
  
  private readonly logger = new Logger(RubroController.name);
  

  constructor(
    @Inject(SERVICES.COMPANY) private readonly rubroClient: ClientProxy,  
    private readonly unifiedfilesService: UnifiedFilesService,
    private readonly redisService: RedisService,
    private readonly archivoService: ArchivoService,
  ) {}  



  @Post()
  async createSimple(@Body() createRubroDto: CreateRubroDto) {
    const { nombre, descripcion } = createRubroDto;
    this.logger.debug(`📝 Creando rubro simple: ${nombre}`);
    
    const result = await firstValueFrom(
      this.rubroClient.send('create.Rubro', { nombre, descripcion }).pipe(
        timeout(10000), // Usar un valor constante o configuración adecuada
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
    await this.invalidateAllCaches();
    return result;
  }

  
@Post('/with-image')
@UploadFile('icono')
async create(
  @Body() createRubroDto: CreateRubroDto,
  @UploadedFile() icono?: Express.Multer.File,
  @Body('tenantId') tenantId?: string,
  @Body('provider') provider?: string,
  @Body('empresaId') empresaId?: string,
) {
  const startTime = Date.now();
  let uploadedFile = null;

  try {
    // 1. Subir archivo si existe
    if (icono) {
      uploadedFile = await this.unifiedfilesService.uploadFile(icono, {
        provider: provider || 'firebase',
        tenantId: tenantId || 'admin',
        // No pasamos el resto de información porque aún no tenemos el ID del rubro
      });
      
      // Asignamos solo el nombre del archivo al DTO
      createRubroDto.icono = uploadedFile.filename;
    }

    // 2. Crear el rubro
    this.logger.debug(`📝 Creando rubro: ${createRubroDto.nombre}`);
    
    try {
      const result = await firstValueFrom(
        this.rubroClient.send('create.Rubro', createRubroDto).pipe(
          timeout(FILE_VALIDATION.TIMEOUT)
        )
      );

      //! Guardar registro de metadatos en base de datos, es que fuera necesario
      if (uploadedFile && result.id) {
        this.archivoService.createArchivo({
          nombre: icono.originalname,
          filename: this.archivoService.extractFilename(uploadedFile.filename),
          ruta: uploadedFile.filename,
          tipo: icono.mimetype,
          tamanho: icono.size,
          empresaId: empresaId,
          categoria: CategoriaArchivo.LOGO,
          tipoEntidad: createRubroDto.nombre,
          entidadId: result.id,
          descripcion: `Icono del rubro ${createRubroDto.nombre}`,
          esPublico: true
        });
      }

      await this.invalidateAllCaches();
      
      const duration = Date.now() - startTime;
      this.logger.debug(`✅ Rubro creado: ${createRubroDto.nombre} en ${duration}ms`);
      
      // Enriquecer la respuesta con la URL
      if (uploadedFile && result.data) {
        result.data.iconoUrl = uploadedFile.url;
      }
      
      return result;
    } catch (error) {
      // Si falló la creación pero se subió el archivo, eliminarlo
      if (uploadedFile) {
        this.logger.debug(`🗑️ Iniciando rollback - Eliminando icono: ${uploadedFile.filename}`);
        try {
          await this.unifiedfilesService.deleteFile(uploadedFile.filename, {
            provider: provider || 'firebase',
            tenantId: tenantId || 'admin'
          });
          this.logger.debug(`✅ Rollback completado - Icono eliminado`);
        } catch (deleteError) {
          this.logger.error(`❌ Error en rollback al eliminar icono`, {
            filename: uploadedFile.filename,
            error: deleteError.message
          });
        }
      }

      throw error;
    }
  } catch (error) {
    throw new RpcException({
      message: `Error al crear rubro: ${error.message}`,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR
    });
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

  //! Nuevo método para subir archivos a un rubro específico y registrarlos en la base de datos de archivos 
  @Post(':id/files') 
  @UploadFile('file')
  async uploadRubroFile(
    @Param('id') rubroId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('provider') provider?: string,
    @Body('tenantId') tenantId?: string,
    @Body('empresaId') empresaId?: string,
    @Body('categoria') categoria?: CategoriaArchivo,
    @Body('descripcion') descripcion?: string,
  ) {
    try {
      // 1. Verificar que el rubro existe
      // const rubroExistente = await firstValueFrom(
      //   this.rubroClient.send('find.RubroById', rubroId).pipe(
      //     timeout(5000),
      //     // catchError(err => {
      //     //   // this.logger.error(`Error al verificar rubro ${rubroId}:`, error);
      //     //   // throw new NotFoundException(`Rubro con ID ${rubroId} no encontrado`);
      //     //   throw new RpcException({
      //     //     message: 'El servicio no está respondiendo',
      //     //     status: HttpStatus.GATEWAY_TIMEOUT
      //     //   });
      //     // })
      //     catchError(err => {
      //       if (err instanceof TimeoutError) {
      //         throw new RpcException({
      //           message: 'El servicio no está respondiendo',
      //           status: HttpStatus.GATEWAY_TIMEOUT
      //         });
      //       }
      //       throw new RpcException(err);
      //     })
      //   )
      // );
  
      // if (!rubroExistente || !rubroExistente.id) {
      //   throw new RpcException(`Rubro con ID ${rubroId} no encontrado`);
      // }
  
      // 2. Subir el archivo
      // const fileResponse = await firstValueFrom(
      //   this.filesService.send('file.upload', { 
      //     file, 
      //     provider: provider || 'firebase',
      //     tenantId: tenantId || 'admin'
      //   }).pipe(
      //     timeout(FILE_VALIDATION.TIMEOUT),
      //     catchError(error => {
      //       throw FileErrorHelper.handleUploadError(error, file.originalname);
      //     })
      //   )
      // );

      const fileResponse = await this.unifiedfilesService.uploadFile(file, {
        provider: provider || 'firebase',
        tenantId: tenantId || 'admin',
        // No pasamos el resto de información porque aún no tenemos el ID del rubro
      });
  
      // 3. Registrar los metadatos del archivo
      await this.archivoService.createArchivo({
        nombre: file.originalname,
        filename: this.archivoService.extractFilename(fileResponse.filename),
        ruta: fileResponse.filename,
        tipo: file.mimetype,
        tamanho: file.size,
        empresaId: empresaId || '8722e1ef-ee91-4c1d-9257-77f465d40fcd',  // Usar un valor por defecto o el proporcionado
        categoria: categoria || CategoriaArchivo.LOGO,                 // Por defecto es IMAGEN pero puede ser LOGO u otro
        tipoEntidad: 'rubro',                                           // Tipo específico para rubros
        entidadId: rubroId,                                             // ID del rubro
        descripcion: descripcion, //|| `Archivo adicional para el rubro ${rubroExistente.nombre || rubroId}`,
        esPublico: true
      });
  
      // 4. Opcionalmente, invalidar caché
      await this.invalidateAllCaches();
  
      // 5. Devolver respuesta
      return {
        success: true,
        file: {
          filename: fileResponse.filename,
          originalName: file.originalname,
          size: file.size,
          url: this.archivoService.buildFileUrl(fileResponse.filename) || fileResponse.url,
          type: file.mimetype,
          categoria: categoria || CategoriaArchivo.LOGO
        },
        message: `Archivo subido exitosamente para el rubro ${rubroId}`
      };
  
    } catch (error) {
      this.logger.error(`❌ Error al subir archivo para rubro ${rubroId}:`, {
        error: error.message,
        stack: error.stack
      });
      
      if (error instanceof RpcException) {
        throw error;
      }
      
      throw new RpcException({
        message: `Error al subir archivo para el rubro: ${error.message}`,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR
      });
    }
  }

  
}