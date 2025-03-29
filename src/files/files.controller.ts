import { Controller, Delete, Get, Inject, Logger, Param, Post, UploadedFile, UploadedFiles, Body, Query, NotFoundException, HttpStatus } from '@nestjs/common';
import { UploadFile } from './common/decorators/file-upload.decorator';
import { UploadFileResponse, UploadMultipleResponse } from './common/interfaces/file-response.interface';
import { FileErrorCode, FileErrorHelper } from './common/helpers/file-error.helper';
import { UploadFiles } from './common/decorators/file-upload-multiple.decorator';
import { UnifiedFilesService } from './unified-files.service';
import { CategoriaArchivo } from 'src/common/enums/categoria-archivo.enum';
import { ArchivoService } from 'src/archivos/archivo.service';
import { FileUrlHelper } from './common/helpers/file-url.helper';
import { formatFileSize } from 'src/common/util/format-file-size.util';
import { RpcException } from '@nestjs/microservices';

@Controller('files')
export class FilesController {
  private readonly logger = new Logger(FilesController.name);

  constructor(
    private readonly unifiedFilesService: UnifiedFilesService,
    private readonly archivoService: ArchivoService
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

  //! Nuevo método para subir archivos a un Entidad específico y registrarlos en la base de datos de archivos 
  @Post('upload-advanced')
  @UploadFile('file')
  async uploadFileAdvanced(
    @UploadedFile() file: Express.Multer.File,
    @Body('empresaId') empresaId: string,
    @Body('tipoEntidad') tipoEntidad: string,
    @Body('entidadId') entidadId: string,
    @Body('categoria') categoria?: CategoriaArchivo,
    @Body('descripcion') descripcion?: string,
    @Body('esPublico') esPublico?: boolean,
    @Body('provider') provider?: string,
    @Body('tenantId') tenantId?: string,
    @Body('useAdvancedProcessing') useAdvancedProcessing?: boolean,
    @Body('imagePreset') imagePreset?: 'profile' | 'PRODUCTO' | 'banner' | 'thumbnail' | 'default',
    @Body('async') async?: boolean,
    @Body('skipMetadataRegistration') skipMetadataRegistration?: boolean,
    @Body('skipImageProcessing') skipImageProcessing?: boolean
  ) {
    try {
      this.logger.debug(`Procesando imagen: ${file.originalname} (${file.size} bytes)`);
      
      // Forzar el uso del microservicio Python
      const fileResponse = await this.unifiedFilesService.uploadFile(file, {
        empresaId,
        tipoEntidad,
        entidadId,
        categoria: categoria || CategoriaArchivo.LOGO,
        descripcion: descripcion || `Archivo para ${tipoEntidad} ${entidadId}`,
        esPublico: esPublico !== undefined ? esPublico : true,
        provider: provider || 'firebase',
        tenantId: tenantId || 'admin',
        useAdvancedProcessing: true, // Forzar Python
        imagePreset: imagePreset || 'default',
        async: async === true,
        skipMetadataRegistration: skipMetadataRegistration === true, // Importante: respeta el valor que llega
        skipImageProcessing: skipImageProcessing === true
      });
      
      this.logger.debug(`Imagen procesada: ${file.originalname}`);
      
      return {
        success: true,
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
          processedWith: 'python',
          processingDetails: {
            preset: imagePreset || 'default',
          }
        },
        metadata: {
          empresaId,
          tipoEntidad,
          entidadId,
          categoria: categoria || CategoriaArchivo.LOGO
        }
      };
    } catch (error) {
      //this.logger.error(`Error en procesamiento: ${file.originalname}`, error.message);
      //throw FileErrorHelper.handleUploadError(error, file.originalname);
      // Verificar si es un error de cuota
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
  

  

  @Post('upload-multiple')
  @UploadFiles('files')
  async uploadMultipleFiles(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('provider') provider?: string,
    @Body('tenantId') tenantId?: string,
    @Body('skipProcessing') skipProcessing?: string,
    @Body('imagePreset') imagePreset?: string,
  ): Promise<UploadMultipleResponse> {
    try {
      this.logger.debug(`Iniciando upload multiple: ${files.length} archivos`);
      
      const uploadPromises = files.map(async file => {
        try {
          const response = await this.unifiedFilesService.uploadFile(file, {
            provider,
            tenantId,
            skipImageProcessing: skipProcessing === 'true',
            imagePreset: imagePreset as any
          });

          return {
            filename: response.filename,
            originalName: response.originalName || file.originalname,
            size: response.size || file.size,
            url: response.url,
            tenantId: response.tenantId,
            success: true,
            // Agregar información de procesamiento si existe
            ...(response.processed && {
              processed: response.processed,
              originalSize: response.originalSize,
              finalSize: response.finalSize,
              reduction: response.reduction
            })
          };
        } catch (error) {
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

      this.logger.debug(`Upload multiple completado: ${successful.length} exitosos, ${failed.length} fallidos`);

      return {
        success: failed.length === 0,
        totalProcessed: results.length,
        successful: successful.length,
        failed: failed.length,
        files: results
      };
    } catch (error) {
      throw FileErrorHelper.handleUploadError(error);
    }
  }

  // Método específico para optimizar imágenes sin subirlas
  @Post('optimize-image')
  @UploadFile('image')
  async optimizeImage(
    @UploadedFile() file: Express.Multer.File,
    @Body('imagePreset') imagePreset?: string,
    @Body('maxWidth') maxWidth?: string,
    @Body('maxHeight') maxHeight?: string,
    @Body('quality') quality?: string,
    @Body('format') format?: string,
  ) {
    try {
      // Verificar que el archivo es una imagen
      if (!file.mimetype.startsWith('image/')) {
        throw new Error('El archivo no es una imagen');
      }
      
      // Crear un servicio del procesador de imágenes temporal
      const imageProcessor = this.unifiedFilesService['imageProcessor'];
      
      // Configurar opciones personalizadas si se proporcionan
      const options: any = {};
      if (imagePreset) {
        options.imagePreset = imagePreset;
      } else {
        if (maxWidth) options.maxWidth = parseInt(maxWidth);
        if (maxHeight) options.maxHeight = parseInt(maxHeight);
        if (quality) options.quality = parseInt(quality);
        if (format) options.format = format;
      }
      
      // Procesar la imagen
      const { buffer, info } = await imageProcessor.processImage(
        file.buffer, 
        file.mimetype, 
        options
      );
      
      // Devolver la imagen optimizada como un buffer Base64
      return {
        success: true,
        original: {
          size: file.size,
          format: info.format,
          width: info.width,
          height: info.height
        },
        optimized: {
          size: buffer.length,
          format: info.newFormat || info.format,
          reduction: info.reduction,
          dataUrl: `data:image/${info.newFormat || info.format};base64,${buffer.toString('base64')}`
        }
      };
    } catch (error) {
      throw FileErrorHelper.handleUploadError(error, file?.originalname);
    }
  }

  @Delete(':filename')
  async deleteFile(
    @Param('filename') filename: string,
    @Body('provider') provider?: string,
    @Body('tenantId') tenantId?: string,
  ) {
    try {
      return await this.unifiedFilesService.deleteFile(filename, {
        provider,
        tenantId
      });
    } catch (error) {
      throw FileErrorHelper.handleDeleteError(error, filename);
    }
  }

  @Get(':filename')
  async getFile(
    @Param('filename') filename: string,
    @Query('provider') provider?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    try {
      return await this.unifiedFilesService.getFile(filename, {
        provider,
        tenantId
      });
    } catch (error) {
      throw FileErrorHelper.handleUploadError(error, filename);
    }
  }  

  @Get(':filename/url')
  async getFileUrl(
    @Param('filename') filename: string,
    @Query('provider') provider?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    try {
      // Usar el helper mejorado
      const url = FileUrlHelper.getFileUrl(filename, { 
        provider, 
        tenantId 
      });
      
      if (!url) {
        throw new NotFoundException(`No se pudo generar URL para ${filename}`);
      }
      
      return {
        filename,
        tenantId,
        provider: provider || process.env.STORAGE_TYPE || 'firebase',
        url
      };
    } catch (error) {
      throw FileErrorHelper.handleUploadError(error, filename);
    }
  }

  
}


