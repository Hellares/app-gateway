import { Body, Controller, Delete, Get, HttpStatus, Inject, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { SERVICES } from '../transports/constants';
import { catchError, timeout, TimeoutError } from 'rxjs';

@Controller('files')
export class FilesController {
  constructor(
    @Inject(SERVICES.FILES) private readonly filesClient: ClientProxy,
  ) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('provider') provider?: string,
  ) {
    return this.filesClient.send('file.upload', { file, provider }).pipe(
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

  @Delete(':filename')
  async deleteFile(
    @Param('filename') filename: string,
    @Body('provider') provider?: string,
  ) {
    return this.filesClient.send('file.delete', { filename, provider }).pipe(
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