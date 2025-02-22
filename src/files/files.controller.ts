import { Body, Controller, Delete, Get, HttpStatus, Inject, Logger, Param, Post, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { SERVICES } from '../transports/constants';
import { catchError, firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { FILE_CONFIG, FILE_VALIDATION } from './common/constants/file.validator.constant';
import { UploadFile } from './common/decorators/file-upload.decorator';
import { FileType } from './common/constants/file-types.constant';
import { UploadFileResponse, UploadMultipleResponse } from './common/interfaces/file-response.interface';
import { FileErrorHelper } from './common/helpers/file-error.helper';
import { UploadFiles } from './common/decorators/file-upload-multiple.decorator';

@Controller('files')
export class FilesController {
  private readonly logger = new Logger(FilesController.name);
  constructor(
    @Inject(SERVICES.FILES) private readonly filesClient: ClientProxy,
  ) {}


 
//   @Post('upload')
// @UploadFile('file', FileType.CATEGORY)
// async uploadFile(
//   @UploadedFile() file: Express.Multer.File,
//   @Body('provider') provider?: string,
//   @Body('type') type?: string,
// ): Promise<UploadFileResponse> {
//   try {
//     // La validación ya se realizó en el decorator
//     const response = await firstValueFrom(
//       this.filesClient.send('file.upload', { 
//         file, 
//         provider,
//         type: type || FileType.CATEGORY
//       }).pipe(
//         timeout(FILE_VALIDATION.TIMEOUT),
//         catchError(error => {
//           throw FileErrorHelper.handleUploadError(error, file?.originalname);
//         })
//       )
//     );

//     return {
//       success: true,
//       file: {
//         filename: response.filename,
//         originalName: response.originalName,
//         size: response.size,
//         url: response.url, // Usar la URL que viene del microservicio
//         type: response.type,
//         processedInfo: response.processedInfo
//       }
//     };
//   } catch (error) {
//     if (error instanceof RpcException) {
//       throw error;
//     }
//     throw FileErrorHelper.handleUploadError(error, file?.originalname);
//   }
// }

@Post('upload')
@UploadFile('file', FileType.CATEGORY)
async uploadFile(
  @UploadedFile() file: Express.Multer.File,
  @Body('provider') provider?: string,
  @Body('type') type?: string,
): Promise<UploadFileResponse> {
  try {
    // Optimizar el buffer antes de enviarlo
    const optimizedFile = {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    };

    const response = await firstValueFrom(
      this.filesClient.send('file.upload', { 
        file: optimizedFile, 
        provider,
        type: type || FileType.CATEGORY
      }).pipe(
        timeout(30000), // Aumentar timeout a 30 segundos
        catchError(error => {
          if (error instanceof TimeoutError) {
            this.logger.error(`Timeout al procesar archivo: ${file.originalname}`);
          }
          throw FileErrorHelper.handleUploadError(error, file.originalname);
        })
      )
    );

    return {
      success: true,
      file: {
        filename: response.filename,
        originalName: response.originalName,
        size: response.size,
        url: response.url,
        type: response.type,
        processedInfo: response.processedInfo
      }
    };
  } catch (error) {
    this.logger.error(`Error al procesar archivo: ${file.originalname}`, error);
    throw FileErrorHelper.handleUploadError(error, file.originalname);
  }
}

  @Post('upload-multiple')
@UploadFiles('files', FileType.CATEGORY)
async uploadMultipleFiles(
  @UploadedFiles() files: Express.Multer.File[],
  @Body('provider') provider?: string,
  @Body('type') type?: string,
): Promise<UploadMultipleResponse> {
  try {
    const uploadPromises = files.map(async file => {
      try {
        const response = await firstValueFrom(
          this.filesClient.send('file.upload', { 
            file, 
            provider,
            type: type || FileType.CATEGORY
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
          // url: this.fileUrlHelper.getFileUrl(response.filename),
          type: response.type,
          success: true,
          processedInfo: response.processedInfo
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
    const result = await firstValueFrom(
      this.filesClient.send('file.delete', { filename, provider }).pipe(
        timeout(FILE_VALIDATION.TIMEOUT),
        catchError(error => {
          throw FileErrorHelper.handleDeleteError(error, filename);
        })
      )
    );

    this.logger.debug(`✅ Archivo ${filename} eliminado correctamente de ${provider || 'almacenamiento'}`);
    return {
      success: true,
      message: `Archivo ${filename} eliminado correctamente`,
      details: { filename, provider }
    };
  } catch (error) {
    this.logger.error(`❌ Error al eliminar archivo ${filename}:`, error);
    throw FileErrorHelper.handleDeleteError(error, filename);
  }
}

  @Get(':filename')
  async getFile(
    @Param('filename') filename: string,
    @Body('provider') provider?: string,
  ) {
    return this.filesClient.send('file.get', { filename, provider }).pipe(
      timeout(5000),
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
}