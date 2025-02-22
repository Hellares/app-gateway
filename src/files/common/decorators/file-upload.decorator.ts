// src/common/decorators/file-upload.decorator.ts
import { applyDecorators, UseFilters, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FileType } from '../constants/file-types.constant';
import { FILE_CONFIG } from '../constants/file.validator.constant';
import { FileErrorCode, FileErrorHelper } from '../helpers/file-error.helper';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { RpcException } from '@nestjs/microservices';
import { MulterExceptionFilter } from 'src/common/exceptions/multer-exception.filter';


// export function UploadFile(fieldName: string, fileType: FileType): MethodDecorator & ClassDecorator {
//   const config = FILE_CONFIG.types[fileType];
  
//   const multerOptions: MulterOptions = {
//     limits: {
//       fileSize: config.maxSize,
//       files: 1
//     },
//     fileFilter: (
//       req: any, 
//       file: Express.Multer.File, 
//       callback: (error: Error | null, acceptFile: boolean) => void
//     ) => {
//       if (!config.allowedMimeTypes.includes(file.mimetype)) {
//         callback(null, false);
//         return;
//       }
//       callback(null, true);
//     }
//   };

//   return applyDecorators(
//     UseFilters(new MulterExceptionFilter()),
//     UseInterceptors(FileInterceptor(fieldName, multerOptions))
//   );
// }

type FileFilterCallback = (error: Error | null, acceptFile: boolean) => void;

export function UploadFile(fieldName: string, fileType: FileType): MethodDecorator & ClassDecorator {
  const config = FILE_CONFIG.types[fileType];
  
  const multerOptions: MulterOptions = {
    limits: {
      fileSize: config.maxSize,
      files: 1
    },
    fileFilter: (
      req: any, 
      file: Express.Multer.File, 
      callback: FileFilterCallback
    ) => {
      try {
        if (!config.allowedMimeTypes.includes(file.mimetype)) {
          return callback(
            FileErrorHelper.createError(
              `Formato no permitido. Use: ${config.allowedMimeTypes.join(', ')}`,
              FileErrorCode.INVALID_TYPE,
              400,
              {
                allowedTypes: config.allowedMimeTypes,
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