import { Body, Controller, Delete, Get, HttpStatus, Inject, Logger,  Param,  Post, Query,  UploadedFile, UseGuards, UseInterceptors, SetMetadata } from '@nestjs/common';
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
//@UseGuards(RateLimitGuard) !rate limit
export class RubroController {
  
  private readonly logger = new Logger(RubroController.name);
  

  constructor(
    @Inject(SERVICES.COMPANY) private readonly rubroClient: ClientProxy,  
    private readonly unifiedfilesService: UnifiedFilesService,
    private readonly redisService: RedisService,
    private readonly archivoService: ArchivoService,
  ) {}  

  // Contador de trabajos activos (para backpressure)
  private activeJobs = 0;
  private readonly MAX_CONCURRENT_JOBS = 20;

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
    let uploadedFile = null;
  
    try {
      // 1. Procesar y subir archivo si existe
      if (icono) {
        uploadedFile = await this.unifiedfilesService.uploadFile(icono, {
          provider: provider || 'firebase',
          tenantId: tenantId || '44885296',
          empresaId: empresaId,
          useAdvancedProcessing: false,
          imagePreset: 'producto',
          skipMetadataRegistration: true
        });
      }

      // 2. Crear el rubro
      createRubroDto.icono = uploadedFile?.filename || null;
      
      // Asegurar que empresaId esté en el DTO
      if (empresaId && !createRubroDto.empresaId) {
        createRubroDto.empresaId = empresaId;
      }
      
      const result = await firstValueFrom(
        this.rubroClient.send('create.Rubro', createRubroDto).pipe(
          timeout(5000)
        )
      );

      // 3. Invalidar cachés
        await this.invalidateAllCaches().catch(error => {
          this.logger.error(`Error al invalidar caches: ${error.message}`);
        });
      
      // 4. Enriquecer la respuesta con la URL
      if (uploadedFile && result.data) {
        result.data.iconoUrl = uploadedFile.url;
      }
      
      return result;
    } catch (error) {
      // Si falló la creación pero se subió el archivo, eliminarlo
      if (uploadedFile) {
        this.logger.debug(`Iniciando rollback - Eliminando icono: ${uploadedFile.filename}`);
        try {
          await this.unifiedfilesService.deleteFile(uploadedFile.filename, {
            provider: provider || 'firebase',
            tenantId: tenantId || 'admin'
          });
        } catch (deleteError) {
          this.logger.error(`Error en rollback al eliminar icono: ${deleteError.message}`);
        }
      }
  
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
      // return FileUrlHelper.transformResponse(cachedData.data);
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
    // return FileUrlHelper.transformResponse(cachedData.data);
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
      // return FileUrlHelper.transformResponse(cachedData.data);
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
    // return FileUrlHelper.transformResponse(cachedData.data);
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
    @Body('tipoEntidad') tipoEntidad?: string,
    @Body('categoria') categoria?: CategoriaArchivo,
    @Body('descripcion') descripcion?: string,
  ) {
    try {

      const fileResponse = await this.unifiedfilesService.uploadFile(file, {
        provider: provider,
        tenantId: tenantId,
        empresaId: empresaId, // Incluir empresaId en la subida del archivo
        tipoEntidad: tipoEntidad, // Incluir tipo de entidad
        entidadId: rubroId    // Incluir ID de la entidad
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
        tipoEntidad: tipoEntidad,                                           // Tipo específico para rubros
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

  @Post('/with-image/async')
  @UploadFile('icono')
  @SetMetadata('rateLimit', RATE_LIMIT_PRESETS.HIGH_TRAFFIC)
  async createAsync(
    @Body() createRubroDto: CreateRubroDto,
    @UploadedFile() icono?: Express.Multer.File,
    @Body('tenantId') tenantId?: string,
    @Body('provider') provider?: string,
    @Body('priority') priority?: string,
    @Body('empresaId') empresaId?: string,
  ) {
    // Ya no verificamos si la imagen es grande, siempre usamos Sharp para la creación inicial
    this.logger.debug(`Procesando imagen con Sharp para creación rápida del rubro`);
    
    // Usar el método sincrónico con Sharp para la creación inicial
    return this.create(createRubroDto, icono, tenantId, provider, empresaId);
  }

  /**
   * Endpoint para subir imágenes adicionales a un rubro existente
   * Utiliza el microservicio Python para procesamiento avanzado
   */
  @Post('/:id/images')
  @UploadFile('imagen')
  @SetMetadata('rateLimit', RATE_LIMIT_PRESETS.HIGH_TRAFFIC)
  async uploadAdditionalImage(
    @Param('id') rubroId: string,
    @UploadedFile() imagen: Express.Multer.File,
    @Body('provider') provider?: string,
    @Body('tenantId') tenantId?: string,
    @Body('empresaId') empresaId?: string,
    @Body('descripcion') descripcion?: string,
    @Body('priority') priority?: string,
  ) {
    // Verificar si hay demasiados trabajos activos (excepto para prioridad alta)
    if (this.activeJobs >= this.MAX_CONCURRENT_JOBS && priority !== 'alta') {
      throw new RpcException({
        message: `El sistema está procesando demasiadas imágenes (${this.activeJobs}/${this.MAX_CONCURRENT_JOBS}). Intente más tarde.`,
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        details: {
          activeJobs: this.activeJobs,
          maxJobs: this.MAX_CONCURRENT_JOBS,
          retryAfter: '30 segundos'
        }
      });
    }
    
    // 1. Generar ID único para este trabajo
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    
    // Incrementar contador de trabajos activos
    this.activeJobs++;
    
    try {
      // 2. Crear una versión de baja calidad para respuesta inmediata
      const imageProcessor = this.unifiedfilesService['imageProcessor'];
      const quickOptions = {
        maxWidth: 800,
        maxHeight: 800,
        quality: 60,
        format: 'jpeg' as 'jpeg' | 'png' | 'webp'
      };
      
      // Procesar rápidamente con Sharp
      const { buffer: quickBuffer } = await imageProcessor.processImage(
        imagen.buffer, 
        imagen.mimetype, 
        quickOptions
      );
      
      // Crear versión optimizada del archivo
      const quickFile = {
        ...imagen,
        buffer: quickBuffer,
        size: quickBuffer.length
      };
      
      // 3. Subir versión rápida
      const quickUpload = await this.unifiedfilesService.uploadFile(quickFile, {
        provider: provider || 'firebase',
        tenantId: tenantId || 'admin',
        skipImageProcessing: true, // Ya procesamos la imagen, no necesitamos procesarla de nuevo
        empresaId: empresaId, // Incluir empresaId en la subida del archivo
        tipoEntidad: 'rubro',
        entidadId: rubroId
      });
      
      // 4. Guardar trabajo en Redis con TTL escalonado para evitar expiración simultánea
      const ttl = 3600 + Math.floor(Math.random() * 300); // 3600-3900 segundos
      
      await this.redisService.set(
        `job:${jobId}`, 
        { 
          status: 'processing',
          step: 'preview_created',
          rubroId: rubroId,
          previewImage: quickUpload.filename,
          previewUrl: quickUpload.url,
          created: Date.now(),
          originalSize: imagen.size,
          previewSize: quickFile.size,
          priority: priority || 'normal',
          empresaId: empresaId,
          descripcion: descripcion || `Imagen adicional para rubro ${rubroId}`
        },
        ttl
      );
      
      // 5. Iniciar procesamiento avanzado en segundo plano
      this.processRubroImageAsync(jobId, rubroId, imagen, {
        tenantId, 
        provider,
        previewFilename: quickUpload.filename,
        priority: priority || 'normal',
        empresaId: empresaId,
        descripcion: descripcion
      }).catch(error => {
        this.logger.error(`Error en procesamiento asíncrono: ${error.message}`);
        // Decrementar contador de trabajos activos en caso de error
        this.activeJobs = Math.max(0, this.activeJobs - 1);
      });
      
      // 6. Responder inmediatamente al cliente con la versión preliminar
      return {
        success: true,
        jobId,
        status: 'processing',
        message: 'La imagen se está procesando en segundo plano.',
        data: {
          rubroId,
          imageUrl: quickUpload.url,
          isPreview: true
        },
        checkStatusUrl: `/api/rubro/job/${jobId}`,
        estimatedTime: this.getEstimatedTime(imagen.size, this.activeJobs, priority)
      };
    } catch (error) {
      this.logger.error(`Error en subida asíncrona: ${error.message}`);
      
      // Decrementar contador de trabajos activos en caso de error
      this.activeJobs = Math.max(0, this.activeJobs - 1);
      
      // Registrar el error en Redis
      await this.redisService.set(
        `job:${jobId}`,
        {
          status: 'failed',
          error: error.message,
          step: 'initial_processing',
          created: Date.now(),
          empresaId: empresaId
        },
        3600
      );
      
      throw new RpcException({
        message: `Error al subir imagen de forma asíncrona: ${error.message}`,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR
      });
    }
  }

  // Método para estimar tiempo de procesamiento basado en tamaño, carga y prioridad
  private getEstimatedTime(fileSize: number, activeJobs: number, priority?: string): string {
    const baseSizeTime = Math.ceil(fileSize / (1024 * 1024)) * 5; // 5 segundos por MB
    const queueFactor = Math.max(1, activeJobs / 5); // Factor de cola
    
    let priorityFactor = 1;
    if (priority === 'alta') priorityFactor = 0.7;
    if (priority === 'baja') priorityFactor = 1.5;
    
    const estimatedSeconds = Math.ceil(baseSizeTime * queueFactor * priorityFactor);
    
    if (estimatedSeconds < 60) {
      return `${estimatedSeconds} segundos aproximadamente`;
    } else {
      return `${Math.ceil(estimatedSeconds / 60)} minutos aproximadamente`;
    }
  }

  // Método mejorado para procesamiento en segundo plano
  private async processRubroImageAsync(
    jobId: string,
    rubroId: string,
    icono: Express.Multer.File,
    options: any
  ): Promise<void> {
    try {
      this.logger.debug(`Iniciando procesamiento avanzado para rubro ${rubroId} (Job: ${jobId})`);
      
      // 1. Actualizar estado
      await this.redisService.set(`job:${jobId}`, {
        status: 'processing',
        step: 'advanced_processing',
        rubroId,
        updated: Date.now(),
        priority: options.priority || 'normal',
        empresaId: options.empresaId
      }, 3600);
      
      // 2. Procesar imagen con el microservicio Python
      const uploadedFile = await this.unifiedfilesService.uploadFile(icono, {
        provider: options.provider || 'firebase',
        tenantId: options.tenantId || 'admin',
        useAdvancedProcessing: true, // Forzar uso del microservicio Python
        empresaId: options.empresaId, // Incluir empresaId en la subida
        tipoEntidad: 'rubro',
        entidadId: rubroId,
        descripcion: options.descripcion
      });
      
      // 3. Actualizar estado
      await this.redisService.set(`job:${jobId}`, {
        status: 'processing',
        step: 'updating_metadata',
        rubroId,
        finalImage: uploadedFile.filename,
        finalUrl: uploadedFile.url,
        updated: Date.now(),
        empresaId: options.empresaId
      }, 3600);
      
      // 4. Registrar metadatos del archivo
      await this.archivoService.createArchivo({
        nombre: icono.originalname,
        filename: this.archivoService.extractFilename(uploadedFile.filename),
        ruta: uploadedFile.filename,
        tipo: icono.mimetype,
        tamanho: uploadedFile.finalSize || icono.size,
        empresaId: options.empresaId || '8722e1ef-ee91-4c1d-9257-77f465d40fcd', // Usar empresaId proporcionado o valor por defecto
        categoria: CategoriaArchivo.PRODUCTO,
        tipoEntidad: 'rubro',
        entidadId: rubroId,
        descripcion: options.descripcion || `Imagen adicional para rubro ID: ${rubroId}`,
        esPublico: true,
        provider: options.provider
      });
      
      // 5. Eliminar la imagen preliminar si es diferente
      if (options.previewFilename && options.previewFilename !== uploadedFile.filename) {
        try {
          await this.unifiedfilesService.deleteFile(options.previewFilename, {
            provider: options.provider,
            tenantId: options.tenantId
          });
          this.logger.debug(`Imagen preliminar eliminada: ${options.previewFilename}`);
        } catch (deleteError) {
          this.logger.warn(`No se pudo eliminar la imagen preliminar: ${deleteError.message}`);
        }
      }
      
      // 6. Actualizar estado final
      const jobInfo = await this.redisService.get(`job:${jobId}`);
      const createdTime = jobInfo && typeof jobInfo === 'object' && 'created' in jobInfo 
        ? jobInfo.created as number 
        : Date.now();
        
      await this.redisService.set(`job:${jobId}`, {
        status: 'completed',
        rubroId,
        finalImage: uploadedFile.filename,
        finalUrl: uploadedFile.url,
        originalSize: icono.size,
        finalSize: uploadedFile.finalSize,
        reduction: uploadedFile.reduction,
        processingTime: `${Date.now() - createdTime}ms`,
        completed: Date.now(),
        empresaId: options.empresaId
      }, 3600);
      
      // 7. Invalidar cachés
      await this.invalidateAllCaches();
      
      this.logger.debug(`✅ Procesamiento asíncrono completado para rubro ${rubroId} (Job: ${jobId})`);
    } catch (error) {
      this.logger.error(`❌ Error en procesamiento asíncrono para rubro ${rubroId}:`, error);
      
      // Actualizar estado a fallido
      await this.redisService.set(`job:${jobId}`, {
        status: 'failed',
        rubroId,
        error: error.message,
        failedAt: Date.now(),
        empresaId: options.empresaId
      }, 3600);
    } finally {
      // Decrementar contador de trabajos activos
      this.activeJobs = Math.max(0, this.activeJobs - 1);
      this.logger.debug(`Job completado. Jobs activos restantes: ${this.activeJobs}`);
    }
  }

  // Endpoint para consultar el estado de un trabajo
  @Get('/job/:jobId')
  async getJobStatus(@Param('jobId') jobId: string) {
    const jobResponse = await this.redisService.get(`job:${jobId}`);
    
    if (!jobResponse || !jobResponse.success) {
      throw new RpcException({
        message: `No se encontró información para el trabajo ${jobId}`,
        statusCode: HttpStatus.NOT_FOUND
      });
    }
    
    const jobData = jobResponse.data as Record<string, any>;
    
    if (!jobData) {
      throw new RpcException({
        message: `Datos inválidos para el trabajo ${jobId}`,
        statusCode: HttpStatus.NOT_FOUND
      });
    }
    
    // Construir respuesta con tipado seguro
    const response: Record<string, any> = {
      jobId,
      ...jobData
    };
    
    // Añadir URL del rubro si está completado y tiene ID
    if (jobData.status === 'completed' && jobData.rubroId) {
      response.rubroUrl = `/api/rubro/${jobData.rubroId}`;
    }
    
    return response;
  }
}