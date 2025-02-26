import { applyDecorators, UseFilters, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FILE_CONFIG } from '../constants/file.validator.constant';
import { FileErrorCode, FileErrorHelper } from '../helpers/file-error.helper';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { MulterExceptionFilter } from 'src/common/exceptions/multer-exception.filter';

type FileFilterCallback = (error: Error | null, acceptFile: boolean) => void;

export function UploadFile(fieldName: string): MethodDecorator & ClassDecorator {
  const multerOptions: MulterOptions = {
    limits: {
      fileSize: FILE_CONFIG.maxSize,
      files: 1
    },
    fileFilter: (
      req: any, 
      file: Express.Multer.File, 
      callback: FileFilterCallback
    ) => {
      try {
        if (!FILE_CONFIG.allowedMimeTypes.includes(file.mimetype)) {
          return callback(
            FileErrorHelper.createError(
              `Formato no permitido. Use: ${FILE_CONFIG.allowedMimeTypes.join(', ')}`,
              FileErrorCode.INVALID_TYPE,
              400,
              {
                allowedTypes: FILE_CONFIG.allowedMimeTypes,
                receivedType: file.mimetype,
                filename: file.originalname
              }
            ),
            false
          );
        }
        callback(null, true);
      } catch (error) {
        callback(
          FileErrorHelper.handleUploadError(error, file.originalname),
          false
        );
      }
    }
  };

  return applyDecorators(
    UseFilters(new MulterExceptionFilter()),
    UseInterceptors(FileInterceptor(fieldName, multerOptions))
  );
}