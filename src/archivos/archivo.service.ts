// src/archivos/archivo.service.ts
import { Injectable, Logger, Inject } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';

import { firstValueFrom, timeout, catchError } from 'rxjs';
import { CategoriaArchivo } from '../common/enums/categoria-archivo.enum';
import { SERVICES } from 'src/transports/constants';
import { PaginationDto } from 'src/common/dto/pagination.dto';

@Injectable()
export class ArchivoService {
  private readonly logger = new Logger(ArchivoService.name);

  constructor(
    @Inject(SERVICES.COMPANY) private readonly empresaClient: ClientProxy,
  ) {}

  async createArchivo(data: {
    nombre: string;
    filename: string;
    ruta: string;
    tipo: string;
    tamanho: number;
    empresaId?: string;
    categoria: CategoriaArchivo;
    entidadId?: string;
    tipoEntidad?: string;
    descripcion?: string;
    orden?: number;
    esPublico?: boolean;
    provider?: string;
  }): Promise<any> {
    try {
      this.logger.debug(`Creando registro de archivo: ${data.nombre}`);
      
      const result = await firstValueFrom(
        this.empresaClient.send('archivo.create', data).pipe(
          timeout(3000),
          catchError(error => {
            this.logger.error(`Error al crear archivo en microservicio:`, {
              error: error.message,
              filename: data.nombre
            });
            // throw error;
            // En lugar de lanzar el error, devolvemos un objeto de error
          return [{ 
            success: false, 
            error: error.message,
            message: 'Error al crear archivo en microservicio'
          }];
          })
        )
      );

      // Si es un array con un objeto de error, extraerlo
    if (Array.isArray(result) && result[0]?.error) {
      this.logger.warn(`Archivo no registrado debido a error: ${result[0].error}`);
      return result[0];
    }
      
      this.logger.debug(`Archivo registrado con ID: ${result.id}`);
      return result;
    } catch (error) {
      this.logger.error(`Error al crear archivo:`, {
        error: error.message,
        data
      });
      // En lugar de lanzar el error, devolvemos un objeto
    return {
      success: false,
      error: error.message,
      message: 'Error al crear archivo'
    };
    }
  }

  async findArchivoById(id: string) {
   
    try {
      const archivo = await firstValueFrom(
        this.empresaClient.send('archivo.findById', id).pipe(
          timeout(5000),
          catchError(error => {
            this.logger.error(`Error al buscar archivo por ID ${id}:`, error);
            throw new RpcException(error);
          })
        )
      );
      
      if (archivo) {
        // Enriquecer con URL usando el proveedor del archivo
        archivo.url = this.buildFileUrl(archivo.ruta, { provider: archivo.provider });
      }
      console.log(archivo.url);
      return archivo;
    } catch (error) {
      this.logger.error(`Error al buscar archivo por ID ${id}:`, error);
      throw error;
    }
  }

  async findArchivosByEntidad(
    tipoEntidad: string, 
    entidadId: string, 
    paginationDto: PaginationDto = { page: 1, limit: 10 },
    empresaId?: string, 
    categoria?: CategoriaArchivo
  ) {
    try {
      // Construir el payload para el microservicio
      const payload = {
        tipoEntidad,
        entidadId,
        paginationDto,
        empresaId,
        categoria
      };
      
      // Llamar al microservicio
      const result = await firstValueFrom(
        this.empresaClient.send('archivo.findByEntidadFiltrado', payload).pipe(
          timeout(5000),
          catchError(error => {
            this.logger.error(`Error al buscar archivos por entidad:`, error);
            throw error;
          })
        )
      );
      
      return result;
    } catch (error) {
      this.logger.error(`Error al buscar archivos para ${tipoEntidad}:${entidadId}`, error);
      throw error;
    }
  }

  // async findArchivosByEntidad(tipoEntidad: string, entidadId: string) {
  //   try {
  //     return await firstValueFrom(
  //       this.empresaClient.send('archivo.findByEntidad', { tipoEntidad, entidadId }).pipe(
  //         timeout(5000)
  //       )
  //     );
  //   } catch (error) {
  //     this.logger.error(`Error al buscar archivos por entidad ${tipoEntidad}:${entidadId}:`, error);
  //     throw error;
  //   }
  // }

  async findArchivosByEmpresa( paginationDto: PaginationDto,empresaId: string, categoria?: CategoriaArchivo) {
    try {
      return await firstValueFrom(
        this.empresaClient.send('archivo.findByEmpresa', { paginationDto, empresaId, categoria }).pipe(
          timeout(5000)
        )
      );
    } catch (error) {
      this.logger.error(`Error al buscar archivos por empresa ${empresaId}:`, error);
      throw new RpcException(error);
    }
  }

  async updateArchivo(id: string, updateData: any) {
    try {
      return await firstValueFrom(
        this.empresaClient.send('archivo.update', { id, updateData }).pipe(
          timeout(5000)
        )
      );
    } catch (error) {
      this.logger.error(`Error al actualizar archivo ${id}:`, error);
      throw error;
    }
  }

  async deleteArchivo(id: string) {
    try {
      return await firstValueFrom(
        this.empresaClient.send('archivo.deleteByFilename', id).pipe(
          timeout(5000)
        )
      );
    } catch (error) {
      this.logger.error(`Error al eliminar archivo ${id}:`, error);
      throw error;
    }
  }

  // Métodos utilitarios para trabajar con rutas y URLs
  extractFilename(path: string): string {
    if (!path) return null;
    return path.split('/').pop();
  }
 
  buildFileUrl(ruta: string, storageOptions?: {
    provider?: string;
    tenantId?: string;
  }): string {
    if (!ruta) return null;
    
    // Usar el proveedor proporcionado o recurrir a la variable de entorno como fallback
    const storageType = storageOptions?.provider; //|| process.env.STORAGE_TYPE || 'firebase';
    
    switch (storageType) {
      case 'firebase':
        return `https://firebasestorage.googleapis.com/v0/b/${process.env.FIREBASE_STORAGE_BUCKET}/o/${encodeURIComponent(ruta)}?alt=media`;
      case 'cloudinary':
        return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/${ruta}`;
      case 's3':
        return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${ruta}`;
      case 'elastika':
        // Si hay tenantId, lo incluimos en la URL para Elastika
        const tenantPath = storageOptions?.tenantId ? `/${storageOptions.tenantId}` : '';
        return `${process.env.ELASTIKA_BASE_URL}/files${tenantPath}/${ruta}`;
      default:
        return `${process.env.API_URL}/uploads/${ruta}`;
    }
  }
}