// src/files/services/image-processor.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as sharp from 'sharp';

interface ImageProcessOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: 'jpeg' | 'png' | 'webp';
  preserveAspectRatio?: boolean;
}

@Injectable()
export class ImageProcessorService {
  private readonly logger = new Logger(ImageProcessorService.name);
  
  // Opciones predeterminadas
  private readonly defaultOptions: ImageProcessOptions = {
    maxWidth: 1920,      // Máximo ancho (HD)
    maxHeight: 1080,     // Máximo alto (HD)
    quality: 80,         // Calidad de compresión (0-100)
    format: 'jpeg',      // Formato de salida
    preserveAspectRatio: true // Mantener proporción de aspecto
  };

  /**
   * Determina si un archivo es una imagen basado en su tipo MIME
   */
  isImage(mimetype: string): boolean {
    return /^image\/(jpeg|png|gif|webp|svg\+xml)$/i.test(mimetype);
  }

  /**
   * Procesa una imagen para reducir su tamaño
   */
  async processImage(
    buffer: Buffer, 
    mimetype: string,
    customOptions?: Partial<ImageProcessOptions>
  ): Promise<{ buffer: Buffer; info: any }> {
    if (!this.isImage(mimetype)) {
      return { buffer, info: { processed: false, reason: 'not-an-image' } };
    }

    const options = { ...this.defaultOptions, ...customOptions };
    const startTime = Date.now();

    try {
      let transformer = sharp(buffer);
      const metadata = await transformer.metadata();
      
      // Solo redimensionar si la imagen es más grande que los límites
      const needsResize = 
        (options.maxWidth && metadata.width && metadata.width > options.maxWidth) ||
        (options.maxHeight && metadata.height && metadata.height > options.maxHeight);
      
      if (needsResize) {
        transformer = transformer.resize({
          width: options.maxWidth,
          height: options.maxHeight,
          fit: options.preserveAspectRatio ? 'inside' : 'fill',
          withoutEnlargement: true
        });
      }

      // Configurar el formato de salida
      if (options.format === 'jpeg') {
        transformer = transformer.jpeg({ quality: options.quality });
      } else if (options.format === 'png') {
        transformer = transformer.png({ quality: options.quality });
      } else if (options.format === 'webp') {
        transformer = transformer.webp({ quality: options.quality });
      }

      // Procesar la imagen
      const processedBuffer = await transformer.toBuffer();
      const duration = Date.now() - startTime;
      
      // Calcular reducción en tamaño
      const originalSize = buffer.length;
      const newSize = processedBuffer.length;
      const reduction = ((originalSize - newSize) / originalSize * 100).toFixed(2);
      
      const info = {
        processed: true,
        originalSize,
        newSize,
        reduction: `${reduction}%`,
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        newFormat: options.format,
        duration: `${duration}ms`
      };
      
      this.logger.debug({ 
        originalSize: originalSize / 1024, 
        newSize: newSize / 1024, 
        reduction 
      }, `Imagen procesada: ${reduction}% de reducción en ${duration}ms`);
      
      return { buffer: processedBuffer, info };
    } catch (error) {
      this.logger.error(`Error procesando imagen: ${error.message}`, error.stack);
      // Devolver la imagen original en caso de error
      return { 
        buffer, 
        info: { 
          processed: false, 
          reason: 'error', 
          message: error.message 
        } 
      };
    }
  }
  
  /**
   * Determina si una imagen debe ser procesada basada en su tamaño y tipo
   */
  shouldProcess(file: Express.Multer.File, sizeThreshold: number = 1024 * 1024): boolean {
    // Procesar si es una imagen Y es más grande que el umbral (por defecto 1MB)
    return this.isImage(file.mimetype) && file.size > sizeThreshold;
  }
}