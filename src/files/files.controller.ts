import { Controller, Delete, Get, Inject, Logger, Param, Post, UploadedFile, UploadedFiles, Body, Query, NotFoundException } from '@nestjs/common';
import { UploadFile } from './common/decorators/file-upload.decorator';
import { UploadFileResponse, UploadMultipleResponse } from './common/interfaces/file-response.interface';
import { FileErrorHelper } from './common/helpers/file-error.helper';
import { UploadFiles } from './common/decorators/file-upload-multiple.decorator';
import { UnifiedFilesService } from './unified-files.service';
import { CategoriaArchivo } from 'src/common/enums/categoria-archivo.enum';
import { ArchivoService } from 'src/archivos/archivo.service';
import { FileUrlHelper } from './common/helpers/file-url.helper';

@Controller('files')
export class FilesController {
  private readonly logger = new Logger(FilesController.name);

  constructor(
    private readonly filesService: UnifiedFilesService,
    private readonly archivoService: ArchivoService
  ) {}

  @Post('upload')
  @UploadFile('file')
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('provider') provider?: string,
    @Body('tenantId') tenantId?: string,
  ): Promise<UploadFileResponse> {
    try {
      const response = await this.filesService.uploadFile(file, {
        provider,
        tenantId
      });

      return {
        success: true,
        file: {
          filename: response.filename,
          originalName: response.originalName || file.originalname,
          size: response.size || file.size,
          url: response.url,
          tenantId: response.tenantId,
        }
      };
    } catch (error) {
      throw FileErrorHelper.handleUploadError(error, file?.originalname);
    }
  }

  @Post('upload-multiple')
  @UploadFiles('files')
  async uploadMultipleFiles(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('provider') provider?: string,
    @Body('tenantId') tenantId?: string,
  ): Promise<UploadMultipleResponse> {
    try {
      this.logger.debug(`📤 Iniciando upload múltiple: ${files.length} archivos`);
      
      const uploadPromises = files.map(async file => {
        try {
          const response = await this.filesService.uploadFile(file, {
            provider,
            tenantId
          });

          return {
            filename: response.filename,
            originalName: response.originalName || file.originalname,
            size: response.size || file.size,
            url: response.url,
            tenantId: response.tenantId,
            success: true
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

      this.logger.debug(`✅ Upload múltiple completado: ${successful.length} exitosos, ${failed.length} fallidos`);

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

  @Delete(':filename')
  async deleteFile(
    @Param('filename') filename: string,
    @Body('provider') provider?: string,
    @Body('tenantId') tenantId?: string,
  ) {
    try {
      return await this.filesService.deleteFile(filename, {
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
      return await this.filesService.getFile(filename, {
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


