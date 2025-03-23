// src/files/processing-status.controller.ts

import { Controller, Get, Param, NotFoundException, Logger, Post, Inject } from '@nestjs/common';
import { UnifiedFilesService } from './unified-files.service';
import { firstValueFrom } from 'rxjs';
import { SERVICES } from 'src/transports/constants';
import { ClientProxy } from '@nestjs/microservices';

@Controller('files/processing')
export class ProcessingStatusController {
  private readonly logger = new Logger(ProcessingStatusController.name);
  
  constructor(
    @Inject(SERVICES.IMAGE_PROCESSOR) private readonly imageProcessorClient: ClientProxy,
    private readonly filesService: UnifiedFilesService
  ) {
    
  }
  
  @Get('status/:id')
  async getProcessingStatus(@Param('id') id: string) {
    const status = await this.filesService.getProcessingStatus(id);
    
    if (!status) {
      throw new NotFoundException(`No se encontró procesamiento con ID: ${id}`);
    }
    
    return {
      id: status.id,
      filename: status.filename,
      status: status.status,
      startTime: status.startTime,
      elapsedTime: `${Date.now() - status.startTime}ms`,
      ...(status.completedAt && {
        completedAt: status.completedAt,
        processingTime: `${status.completedAt - status.startTime}ms`
      }),
      ...(status.result && {
        result: {
          processed: status.result.processed,
          reduction: status.result.reduction,
          originalSize: status.result.originalSize,
          finalSize: status.result.finalSize
        }
      }),
      ...(status.uploaded && {
        uploaded: true,
        url: status.fileResponse?.url
      })
    };
  }
  
  @Get('stats')
  getProcessingStats() {
    return this.filesService.getProcessingStats();
  }

  @Post('test-message')
async testMessage() {
  const testId = `test_${Date.now()}`;
  
  // Crear un mensaje simple
  const testMessage = {
    id: testId,
    filename: 'test.jpg',
    data: 'SGVsbG8gV29ybGQ=', // "Hello World" en base64
    mimetype: 'image/jpeg',
    companyId: 'test',
    userId: 'test',
    module: 'test',
    options: {
      imagePreset: 'default',
      maxWidth: 100,
      maxHeight: 100,
      quality: 80,
      format: 'jpeg'
    }
  };
  
  try {
    // Enviar mensaje a la cola
    await firstValueFrom(
      this.imageProcessorClient.emit('images-to-process', testMessage)
    );
    
    return {
      success: true,
      message: 'Mensaje de prueba enviado',
      testId
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

@Post('test-image-processing')
async testImageProcessing() {
  // Base64 de una imagen JPEG 1x1 pixel (extremadamente pequeña pero válida)
  const minimalJpegBase64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==';

  const testId = `test_${Date.now()}`;
  
  // Crear mensaje con una imagen real
  const testMessage = {
    id: testId,
    filename: 'test.jpg',
    data: minimalJpegBase64,
    mimetype: 'image/jpeg',
    companyId: 'test',
    userId: 'test',
    module: 'test',
    options: {
      imagePreset: 'default',
      maxWidth: 100,
      maxHeight: 100,
      quality: 80,
      format: 'jpeg'
    }
  };
  
  try {
    // Enviar mensaje a la cola
    await firstValueFrom(
      this.imageProcessorClient.emit('images-to-process', testMessage)
    );
    
    return {
      success: true,
      message: 'Mensaje con imagen de prueba enviado',
      testId
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}
}