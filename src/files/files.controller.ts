import { Controller, Delete, Get, Inject, Logger, Param, Post, UploadedFile, UploadedFiles, Body } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { SERVICES } from '../transports/constants';
import { catchError, firstValueFrom, timeout } from 'rxjs';
import { FILE_VALIDATION } from './common/constants/file.validator.constant';
import { UploadFile } from './common/decorators/file-upload.decorator';
import { UploadFileResponse, UploadMultipleResponse } from './common/interfaces/file-response.interface';
import { FileErrorHelper } from './common/helpers/file-error.helper';
import { UploadFiles } from './common/decorators/file-upload-multiple.decorator';

@Controller('files')
export class FilesController {
  private readonly logger = new Logger(FilesController.name);

  constructor(
    @Inject(SERVICES.FILES) private readonly filesClient: ClientProxy,
  ) {}

  @Post('upload')
  @UploadFile('file')
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('provider') provider?: string,
  ): Promise<UploadFileResponse> {
    try {
      const response = await firstValueFrom(
        this.filesClient.send('file.upload', { 
          file,
          provider
        }).pipe(
          timeout(FILE_VALIDATION.TIMEOUT),
          catchError(error => {
            throw FileErrorHelper.handleUploadError(error, file.originalname);
          })
        )
      );

      return {
        success: true,
        file: {
          filename: response.filename,
          originalName: response.originalName || file.originalname,
          size: response.size || file.size,
          processedInfo: response.processedInfo
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
  ): Promise<UploadMultipleResponse> {
    try {
      const uploadPromises = files.map(async file => {
        try {
          const response = await firstValueFrom(
            this.filesClient.send('file.upload', { 
              file, 
              provider
            }).pipe(
              timeout(FILE_VALIDATION.TIMEOUT),
              catchError(error => {
                throw FileErrorHelper.handleUploadError(error, file.originalname);
              })
            )
          );

          return {
            filename: response.filename,
            originalName: response.originalName || file.originalname,
            size: response.size || file.size,
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
  ) {
    try {
      await firstValueFrom(
        this.filesClient.send('file.delete', { filename, provider }).pipe(
          timeout(FILE_VALIDATION.TIMEOUT),
          catchError(error => {
            throw FileErrorHelper.handleDeleteError(error, filename);
          })
        )
      );

      return {
        success: true,
        message: `Archivo ${filename} eliminado correctamente`
      };
    } catch (error) {
      throw FileErrorHelper.handleDeleteError(error, filename);
    }
  }

  @Get(':filename')
  async getFile(
    @Param('filename') filename: string,
    @Body('provider') provider?: string,
  ) {
    try {
      return await firstValueFrom(
        this.filesClient.send('file.get', { filename, provider }).pipe(
          timeout(FILE_VALIDATION.TIMEOUT),
          catchError(error => {
            throw FileErrorHelper.handleUploadError(error, filename);
          })
        )
      );
    } catch (error) {
      throw FileErrorHelper.handleUploadError(error, filename);
    }
  }
}