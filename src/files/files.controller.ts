import { Controller, Delete, Get, Inject, Logger, Param, Post, UploadedFile, UploadedFiles, Body, Query, NotFoundException, HttpStatus, BadRequestException, HttpException } from '@nestjs/common';
import { UploadFile } from './common/decorators/file-upload.decorator';
import { UploadFileResponse, UploadMultipleResponse } from './common/interfaces/file-response.interface';
import { FileErrorCode, FileErrorHelper } from './common/helpers/file-error.helper';
import { UploadFiles } from './common/decorators/file-upload-multiple.decorator';
import { UnifiedFilesService } from './unified-files.service';
import { CategoriaArchivo } from 'src/common/enums/categoria-archivo.enum';
import { ArchivoService } from 'src/archivos/archivo.service';
import { formatFileSize } from 'src/common/util/format-file-size.util';
import { RpcException } from '@nestjs/microservices';
import { UploadFileDto } from './dto/upload-file.dto';
import { ArchivosByEmpresaDto, PaginationDto } from 'src/common/dto/pagination.dto';
import { CACHE_KEYS } from 'src/redis/constants/redis-cache.keys.contants';
import { RedisService } from 'src/redis/redis.service';
import { REDIS_GATEWAY_CONFIG } from 'src/redis/config/redis.constants';
@Controller('files')
export class FilesController {
  private readonly logger = new Logger(FilesController.name);

  constructor(
    private readonly unifiedFilesService: UnifiedFilesService,
    private readonly archivoService: ArchivoService,
    private readonly redisService: RedisService,
  ) {}

  @Post('upload') //! Sube una imagen sin registros de metadata
  @UploadFile('file')
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('provider') provider?: string,
    @Body('tenantId') tenantId?: string,
    @Body('skipProcessing') skipProcessing?: string, // Nuevo: opción para omitir procesamiento
    @Body('imagePreset') imagePreset?: string, // Nuevo: preset para procesamiento de imágenes
  ): Promise<UploadFileResponse> {
    try {
      const response = await this.unifiedFilesService.uploadFile(file, {
        provider,
        tenantId,
        skipImageProcessing: skipProcessing === 'true',
        imagePreset: imagePreset as any // Convertir string a enum
      });

      return {
        success: true,
        totalProcessed: 1,
        successful: 1,
        failed: 0,
        file: {
          filename: response.filename,
          originalName: response.originalName || file.originalname,
          size: response.size || file.size,
          url: response.url,
          tenantId: response.tenantId,
          // Agregar información de procesamiento si existe
          ...(response.processed && {
            processed: response.processed,
            originalSize: response.originalSize,
            finalSize: response.finalSize,
            reduction: response.reduction
          })
        }
      };
    } catch (error) {
      throw FileErrorHelper.handleUploadError(error, file?.originalname);
    }
  }

  
  // //! Nuevo método para subir archivos a un Entidad específico y registrarlos en la base de datos de archivos 
  @Post('upload-advanced')
  @UploadFile('file')
  async uploadFileAdvanced(
    @UploadedFile() file: Express.Multer.File,
    @Body() uploadFileDto: UploadFileDto,
  ) {
    try {
      this.logger.debug(`Procesando imagen: ${file.originalname} (${file.size} bytes)`);
      
      // Forzar el uso del microservicio Python
      const fileResponse = await this.unifiedFilesService.uploadFile(file, {
        empresaId: uploadFileDto.empresaId,
        tipoEntidad: uploadFileDto.tipoEntidad,
        entidadId: uploadFileDto.entidadId,
        categoria: uploadFileDto.categoria || CategoriaArchivo.LOGO,
        descripcion: uploadFileDto.descripcion || `Archivo para ${uploadFileDto.tipoEntidad} ${uploadFileDto.entidadId}`,
        esPublico: uploadFileDto.esPublico !== undefined ? uploadFileDto.esPublico : true,
        provider: uploadFileDto.provider || 'firebase',
        tenantId: uploadFileDto.tenantId || 'admin',
        useAdvancedProcessing: uploadFileDto.useAdvancedProcessing,
        imagePreset: uploadFileDto.imagePreset || 'default',
        async: uploadFileDto.async === true,
        skipMetadataRegistration: uploadFileDto.skipMetadataRegistration === true, // Importante: respeta el valor que llega
        skipImageProcessing: uploadFileDto.skipImageProcessing === true
      });
      
      this.logger.debug(`Imagen procesada: ${file.originalname}`);

      /*
      this.redisService.clearArchivoCache()
      limpiar caché de archivos local y de redis  por pattern evitando eliminar todas las cache después de la subida
      */
      //this.redisService.clearArchivoCache();//! Limpiar caché de archivos después de la subida
      this.redisService.clearByEntities(uploadFileDto.tipoEntidad, uploadFileDto.entidadId);//! Limpiar caché de archivos después de la subida

      
      return {
        success: true,
        totalProcessed: 1,
        successful: 1,
        failed: 0,
        file: {
          filename: fileResponse.filename,
          originalName: file.originalname,
          size: fileResponse.finalSize || file.size,
          url: fileResponse.url,
          type: file.mimetype,
          processed: fileResponse.processed,
          originalSize: file.size,
          finalSize: fileResponse.finalSize,
          reduction: fileResponse.reduction,
          processingTime: fileResponse.processingTime,
          processedWith: fileResponse.processedMicroservice ? 'GOLAND' : 'sharp',
          processingDetails: {
            preset: uploadFileDto.imagePreset || 'default',
          }
        },
        metadata: {
          empresaId: uploadFileDto.empresaId,
          tipoEntidad: uploadFileDto.tipoEntidad,
          entidadId: uploadFileDto.entidadId,
          categoria: uploadFileDto.categoria || CategoriaArchivo.LOGO
        }
      };
    } catch (error) {
      // Verificar si es un error de cuota
      if (error instanceof RpcException) {
        const errorData = error.getError ? error.getError() : error.message;

        if (typeof errorData === 'object' && 
            errorData !== null && 
            'code' in errorData && 
            errorData.code === 'STORAGE_QUOTA_EXCEEDED') {
            
          // Usar una aserción de tipo para indicar la estructura esperada
          const typedError = errorData as { 
            code: string; 
            message: string; 
            details?: any 
          };

          this.logger.warn({
            file: file.originalname,
            size: file.size,
            empresaId: typedError.details?.empresaId,
            error: 'Cuota excedida'
          }, `Subida rechazada: cuota excedida`);

          // Re-lanzar el error con el helper para mantener el formato adecuado
          throw FileErrorHelper.createError(
            typedError.message || 'Cuota de almacenamiento excedida',
            FileErrorCode.QUOTA_EXCEEDED,
            HttpStatus.FORBIDDEN,
            typedError.details
          );
        }
      }
    }
  }
  

  @Post('upload-multiple-advanced')
  @UploadFiles('files')
  async uploadMultipleFilesAdvanced(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() uploadMultipleDto: UploadFileDto
  ): Promise<UploadMultipleResponse> {
    try {
      this.logger.debug(`Iniciando upload multiple avanzado: ${files.length} archivos`);    

      const uploadPromises = files.map(async file => {
        try {
          const response = await this.unifiedFilesService.uploadFile(file, {
            empresaId: uploadMultipleDto.empresaId,
            tipoEntidad: uploadMultipleDto.tipoEntidad,
            entidadId: uploadMultipleDto.entidadId,
            categoria: uploadMultipleDto.categoria || CategoriaArchivo.LOGO,
            descripcion: uploadMultipleDto.descripcion || `Archivo para ${uploadMultipleDto.tipoEntidad} ${uploadMultipleDto.entidadId}`,
            esPublico: uploadMultipleDto.esPublico !== undefined ? uploadMultipleDto.esPublico : true,
            provider: uploadMultipleDto.provider || 'firebase',
            tenantId: uploadMultipleDto.tenantId || 'admin',
            useAdvancedProcessing: uploadMultipleDto.useAdvancedProcessing,
            imagePreset: uploadMultipleDto.imagePreset || 'default',
            async: uploadMultipleDto.async === true,
            skipMetadataRegistration: uploadMultipleDto.skipMetadataRegistration === true,
            skipImageProcessing: uploadMultipleDto.skipImageProcessing === true
          });

          /*
          this.redisService.clearArchivoCache()
          limpiar caché de archivos local y de redis  por pattern evitando eliminar todas las cache después de la subida
          */
          // this.redisService.clearArchivoCache();//! Limpiar caché de archivos después de la subida

          this.redisService.clearByEntities(uploadMultipleDto.tipoEntidad, uploadMultipleDto.entidadId);//! Limpiar caché de archivos después de la subida
          

          return {
            filename: response.filename,
            originalName: response.originalName || file.originalname,
            size: response.finalSize || file.size,
            url: response.url,
            tenantId: response.tenantId,
            type: file.mimetype,
            success: true,           
           
            // Agregar información de procesamiento si existe
            ...(response.processed && {
              processed: response.processed,
              originalSize: response.originalSize,
              finalSize: response.finalSize,
              reduction: response.reduction,
              processingTime: response.processingTime,
              processedWith: response.processedMicroservice ? 'Go' : 'Sharp',
            })
            
          };
          
        } catch (error) {
          this.logger.error(`Error al procesar archivo: ${file.originalname}`, error);
          return {
            filename: file.originalname,
            originalName: file.originalname,
            size: file.size,
            error: error.message,
            success: false
          };
        }
      });

      const results = await Promise.all(uploadPromises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      this.logger.debug(`Upload multiple avanzado completado: ${successful.length} exitosos, ${failed.length} fallidos`);

      return {
        success: failed.length === 0,
        totalProcessed: results.length,
        successful: successful.length,
        failed: failed.length,
        files: results,
        metadata: {
          empresaId: uploadMultipleDto.empresaId,
          tipoEntidad: uploadMultipleDto.tipoEntidad,
          entidadId: uploadMultipleDto.entidadId,
          categoria: uploadMultipleDto.categoria || CategoriaArchivo.LOGO
        }
      };
    } catch (error) {
      throw FileErrorHelper.handleUploadError(error);
    }
  }

  @Delete('/delete/:filename(*)')
  async deleteFile(
    @Param('filename') filename: string,
    @Query('provider') provider?: string,
    @Query('tenantId') tenantId?: string, 
    @Query('tipoEntidad') tipoEntidad?: string,
    @Query('entidadId') entidadId?: string,
    @Query('eliminarMetadatos') eliminarMetadatos?: boolean
  ) {
    try {
      const result = await this.unifiedFilesService.deleteFile(filename,{
        provider,
        tenantId,
        eliminarMetadatos: eliminarMetadatos !== false
      });
      
      this.redisService.clearByEntities(tipoEntidad,entidadId);//! Limpiar caché de archivos después eliminar
      
      return {
        success: true,
        deletedCount: 1,
        message: `Archivo eliminado correctamente`
      };
        
    } catch (error) {
      throw FileErrorHelper.handleDeleteError(error, filename);
    }
  }

  @Delete('/delete-multiple')
async deleteMultipleFiles(
  @Body() data: { 
    filenames: string[],
    provider?: string,
    tenantId?: string,
    tipoEntidad?: string,
    entidadId?: string,
    eliminarMetadatos?: boolean
  }
) {
  try {
    // Validar entrada
    if (!Array.isArray(data.filenames) || data.filenames.length === 0) {
      throw new BadRequestException('Se requiere un array de nombres de archivos');
    }
    
    const result = await this.unifiedFilesService.deleteMultipleFiles(data.filenames, {
      provider: data.provider,
      tenantId: data.tenantId,
      eliminarMetadatos: data.eliminarMetadatos !== false
    });
    
    

    // Si hay archivos que fallaron, lanzar un error
    if (result.failedFiles && result.failedFiles.length > 0) {
      throw FileErrorHelper.createError(
        `Error al eliminar archivos`,
        FileErrorCode.DELETE_ERROR,
        HttpStatus.BAD_REQUEST,
        { 
          deletedCount: result.deletedFiles.length,
          failedCount: result.failedFiles.length
        }
      );
    }

    // Limpiar caché después de eliminar
    if (data.tipoEntidad && data.entidadId) {
      this.redisService.clearByEntities(data.tipoEntidad, data.entidadId);
    }
    
    return {
      success: true,
      deletedCount: result.deletedFiles.length,
      message: `${result.deletedFiles.length} archivos eliminados correctamente`
    };
  } catch (error) {
    
    if (error instanceof BadRequestException) {
      throw error;
    }
    
    throw FileErrorHelper.handleBatchDeleteError(error, data.filenames);
  }
}


  
  // @Get(':filename')//!descargar el archivo
  // async getFile(
  //   @Param('filename') filename: string,
  //   @Query('provider') provider?: string,
  //   @Query('tenantId') tenantId?: string,
  // ) {
  //   try {
  //     return await this.unifiedFilesService.getFile(filename, {
  //       provider,
  //       tenantId
  //     });
  //   } catch (error) {
  //     throw FileErrorHelper.handleUploadError(error, filename);
  //   }
  // }
  
  @Get('list') //! Listar imagenes directamente del vps
  async listFiles(
    @Query('tenantId') tenantId: string,
    @Query('provider') provider?: string,
  ) {
    try {
      if (!tenantId) {
        throw new BadRequestException('El parámetro tenantId es requerido');
      }

      // Llamar al servicio unificado para obtener la lista de archivos
      const result = await this.unifiedFilesService.listFiles(tenantId, {
        provider
      });

      return {
        success: true,
        files: result.files,
        count: result.summary.count,
        tenantId: result.summary.tenantId
      };
    } catch (error) {
      throw FileErrorHelper.handleUploadError(error);
    }
  }


  //! Obtener archivos BD
  /**
   * Desde aqui los endpoints son para obtener archivos de la base de datos
   * y no del vps
   */
  @Get('archivo/:id')
  async getArchivoById(
    @Param('id') id: string,
  ) {
    try {
      const archivo = await this.archivoService.findArchivoById(id);

      if (!archivo) {
        throw new NotFoundException(`Archivo con ID ${id} no encontrado`);
      }

      return {
        success: true,
        archivo: {
          id: archivo.id,
          modulo: archivo.entidadId, //! id del servicio al que pertenece el archivo
          nombre: archivo.filename,
          categoria: archivo.categoria,
          // tamanho: archivo.tamanho,
          size: formatFileSize(archivo.tamanho),
          url: archivo.url,
          esPublico: archivo.esPublico,
          createdAt: archivo.createdAt
        }
      };
    } catch (error) {
      throw FileErrorHelper.handleUploadError(error, id);
    }
  }

  @Get('entidad/:tipoEntidad/:entidadId')
  async findByEntidad(
    @Param('tipoEntidad') tipoEntidad: string,
    @Param('entidadId') entidadId: string,
    @Query() queryDto: ArchivosByEmpresaDto
  ) {

      const { page = 1, limit = 10, categoria, empresaId } = queryDto;
      const cacheKey = CACHE_KEYS.ARCHIVO.PAGINATED_BY_ENTIDAD(
        tipoEntidad, 
        entidadId, 
        page, 
        limit, 
        categoria || 'all'
      );
    try {

      // Intentar obtener de caché
      const cachedData = await this.redisService.get(cacheKey);    

      if(cachedData.success){

        return cachedData.data;
      }

      // Si no está en caché, obtener de la fuente
      const archivos = await this.archivoService.findArchivosByEntidad(
        tipoEntidad,
        entidadId,
        queryDto,
        queryDto.empresaId,
        queryDto.categoria
      );

      // Si no hay datos, guardar respuesta vacía en caché
      if (!archivos || !archivos.data || !Array.isArray(archivos.data)) {
        const emptyResponse = {
          success: true,
          data: [],
          metadata: {
            total: 0,
            page,
            limit,
            totalPages: 0,
            tipoEntidad,
            entidadId
          }
        };

        this.redisService.set(
          cacheKey,
          emptyResponse,
          REDIS_GATEWAY_CONFIG.LOCAL_CACHE.TTL
        ).catch(e => this.logger.error('Error caching empty archivos:', e));

        return emptyResponse;
      }

      const formattedData = archivos.data.map(archivo => ({
        id: archivo.id,
        nombre: archivo.filename,
        categoria: archivo.categoria,
        tipo: archivo.tipo,
        size: formatFileSize(archivo.tamanho),
        url: this.archivoService.buildFileUrl(archivo.ruta, { provider: archivo.provider }),
        esPublico: archivo.esPublico,
        createdAt: archivo.createdAt
      }));

      // Formatear la respuesta
      const formattedResponse = {
        success: true,
        data: formattedData,
        metadata: archivos.metadata
      };
      // Guardar en caché
      this.redisService.set(
        cacheKey,
        formattedResponse,
        REDIS_GATEWAY_CONFIG.LOCAL_CACHE.TTL

      ).catch(e => this.logger.error('Error caching archivos:', e));
      return formattedResponse;

    } catch (error) {
      throw FileErrorHelper.handleUploadError(error);;
    }
  }


 

//   private async refreshArchivoCache(
//   key: string, 
//   archivosByEmpresaDto: ArchivosByEmpresaDto,
//   empresaId: string
// ): Promise<void> {
//   try {
//     const { page = 1, limit = 10, categoria, provider } = archivosByEmpresaDto;
//     const payload = { 
//       paginationDto: { page, limit }, 
//       empresaId, 
//       categoria 
//     };
    
//     const response = await firstValueFrom(
//       this.companiesClient.send('archivo.findByEmpresa', payload)
//     );

//     if (response && response.data) {
//       // Generar URLs para los archivos
//       const archivosConUrl = response.data.map(archivo => ({
//         ...archivo,
//         url: FileUrlHelper.getFileUrl(archivo.ruta || archivo.filename, {
//           tenantId: archivo.tenantId,
//           provider
//         })
//       }));

//       // Preparar respuesta
//       const formattedResponse = {
//         data: archivosConUrl,
//         metadata: response.metadata
//       };

//       // Actualizar la caché
//       await this.redisService.set(
//         key,
//         formattedResponse,
//         REDIS_GATEWAY_CONFIG.LOCAL_CACHE.TTL
//       );
//     }
//   } catch (error) {
//     this.logger.error(`Error al refrescar caché de archivos:`, error);
//     throw error;
//   }
// }
}