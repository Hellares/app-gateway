import { Body, Controller, Delete, Get, HttpStatus, Inject, Logger, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { FileInterceptor } from '@nestjs/platform-express';
import { catchError, firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { CACHE_KEYS } from 'src/common/constants/redis-cache.keys.contants';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { FileUrlHelper } from 'src/common/helpers/file-url.helper';
import { FILE_CONFIG } from 'src/files/common/validator/file.validator';
import { RedisService } from 'src/redis/redis.service';
import { CreateRubroDto } from 'src/rubro/dto/create-rubro.dto';
import { SERVICES } from 'src/transports/constants';
import { Rubro } from './rubro.interface';

@Controller('rubro')
export class RubroController {
  constructor(
    @Inject(SERVICES.COMPANY) private readonly rubroClient: ClientProxy,
    @Inject(SERVICES.FILES) private readonly filesClient: ClientProxy,
    private readonly redisService: RedisService,
  ) {}

  private readonly logger = new Logger(RubroController.name);
  private readonly CACHE_TTL = 3600; // 1 hora
  private readonly CACHE_KEYS = {
    ALL_ACTIVE: 'rubroactive:all',
    ALL_DELETED: 'rubrodeleted:all'
  };

//   @Post()
// @UseInterceptors(
//   FileInterceptor('icono', {
//     limits: {
//       fileSize: FILE_CONFIG.maxSize
//     },
//     fileFilter: (req, file, cb) => {
//       if (!FILE_CONFIG.allowedMimeTypes.includes(file.mimetype)) {
//         return cb(
//           new RpcException({
//             message: 'Formato de archivo no permitido. Use: JPG, PNG, GIF o WEBP',
//             status: HttpStatus.BAD_REQUEST
//           }), 
//           false
//         );
//       }
//       cb(null, true);
//     }
//   })
// )
// async create(
//   @Body() createRubroDto: CreateRubroDto,
//   @UploadedFile() icono?: Express.Multer.File,
// ) {
//   try {
//     if (icono) {
//       if (icono.size > FILE_CONFIG.maxSize) {
//         throw new RpcException({
//           message: 'El archivo excede el tamaño máximo permitido de 2MB',
//           status: HttpStatus.BAD_REQUEST
//         });
//       }

//       const fileResponse = await firstValueFrom(
//         this.filesClient.send('file.upload', { 
//           file: icono, 
//           provider: 'cloudinary' //! Cambiar por local, cloudinary, firebase.
//         }).pipe(
//           timeout(5000),
//           catchError(err => {
//             if (err instanceof TimeoutError) {
//               throw new RpcException({
//                 message: 'Error al subir el archivo: Timeout',
//                 status: HttpStatus.GATEWAY_TIMEOUT
//               });
//             }
//             throw new RpcException({
//               message: 'Error al subir el archivo',
//               status: HttpStatus.INTERNAL_SERVER_ERROR
//             });
//           })
//         )
//       );

//       if (!fileResponse?.filename) {
//         throw new RpcException({
//           message: 'Error al procesar el archivo',
//           status: HttpStatus.INTERNAL_SERVER_ERROR
//         });
//       }

//       // Manejar la URL según el proveedor
//       if (fileResponse?.filename) {
//         if (fileResponse.provider === 'firebase') {
//           // Para Firebase, solo guardamos el nombre del archivo
//           const filename = fileResponse.filename.split('/').pop().split('?')[0];
//           createRubroDto.icono = filename;
//         } else {
//           // Para otros proveedores
//           const urlParts = new URL(fileResponse.filename);
//           const pathParts = urlParts.pathname.split('/');
//           createRubroDto.icono = pathParts[pathParts.length - 1];
//         }
//       }
//     }

//     const result = await firstValueFrom(
//       this.rubroClient.send('create.Rubro', createRubroDto).pipe(
//         timeout(5000),
//         catchError(err => {
//           if (err instanceof TimeoutError) {
//             throw new RpcException({
//               message: 'El servicio no está respondiendo',
//               status: HttpStatus.GATEWAY_TIMEOUT
//             });
//           }
//           throw new RpcException(err);
//         })
//       )
//     );

    // Invalidar caché
//     await Promise.all([
//       this.redisService.delete(CACHE_KEYS.RUBRO.ALL_ACTIVE),
//       this.redisService.delete(CACHE_KEYS.RUBRO.ALL_DELETED)

//     ]).catch(error => {
//       this.logger.error('Error invalidating cache after create:', error);
//     });
    


//     return result;
//   } catch (error) {
//     if (error instanceof RpcException) {
//       throw error;
//     }
//     throw new RpcException({
//       message: 'Error en el proceso',
//       status: HttpStatus.INTERNAL_SERVER_ERROR
//     });
//   }
// }

@Post()
@UseInterceptors(
  FileInterceptor('icono', {
    limits: {
      fileSize: FILE_CONFIG.maxSize
    },
    fileFilter: (req, file, cb) => {
      if (!FILE_CONFIG.allowedMimeTypes.includes(file.mimetype)) {
        return cb(
          new RpcException({
            message: 'Formato de archivo no permitido. Use: JPG, PNG, GIF o WEBP',
            status: HttpStatus.BAD_REQUEST
          }), 
          false
        );
      }
      cb(null, true);
    }
  })
)
async create(
  @Body() createRubroDto: CreateRubroDto,
  @UploadedFile() icono?: Express.Multer.File,
) {
  try {
    if (icono) {
      if (icono.size > FILE_CONFIG.maxSize) {
        throw new RpcException({
          message: 'El archivo excede el tamaño máximo permitido de 2MB',
          status: HttpStatus.BAD_REQUEST
        });
      }

      const fileResponse = await firstValueFrom(
        this.filesClient.send('file.upload', { 
          file: icono, 
          provider: 'cloudinary' //! Cambiar por local, cloudinary, firebase.
        }).pipe(
          timeout(5000),
          catchError(err => {
            if (err instanceof TimeoutError) {
              throw new RpcException({
                message: 'Error al subir el archivo: Timeout',
                status: HttpStatus.GATEWAY_TIMEOUT
              });
            }
            throw new RpcException({
              message: 'Error al subir el archivo',
              status: HttpStatus.INTERNAL_SERVER_ERROR
            });
          })
        )
      );

      if (!fileResponse?.filename) {
        throw new RpcException({
          message: 'Error al procesar el archivo',
          status: HttpStatus.INTERNAL_SERVER_ERROR
        });
      }

      if (fileResponse.provider === 'firebase') {
        const filename = fileResponse.filename.split('/').pop().split('?')[0];
        createRubroDto.icono = filename;
      } else {
        const urlParts = new URL(fileResponse.filename);
        const pathParts = urlParts.pathname.split('/');
        createRubroDto.icono = pathParts[pathParts.length - 1];
      }
    }

    const result = await firstValueFrom(
      this.rubroClient.send('create.Rubro', createRubroDto).pipe(
        timeout(5000),
        catchError(err => {
          if (err instanceof TimeoutError) {
            throw new RpcException({
              message: 'El servicio no está respondiendo',
              status: HttpStatus.GATEWAY_TIMEOUT
            });
          }
          throw new RpcException(err);
        })
      )
    );

    // Invalidar cachés
    await this.invalidateAllCaches();

    return result;
  } catch (error) {
    if (error instanceof RpcException) {
      throw error;
    }
    throw new RpcException({
      message: 'Error en el proceso',
      status: HttpStatus.INTERNAL_SERVER_ERROR
    });
  }
}

private async invalidateAllCaches(): Promise<void> {
  try {
    // Invalidar caché de listado activo
    await this.redisService.delete(CACHE_KEYS.RUBRO.ALL_ACTIVE);
    // Invalidar caché de listado eliminado
    await this.redisService.delete(CACHE_KEYS.RUBRO.ALL_DELETED);
    
    // Invalidar cachés paginados
    // Aquí manejamos la paginación base (primeras 10 páginas como ejemplo)
    const paginationPromises = [];
    for (let page = 1; page <= 10; page++) {
      const cacheKey = this.getCacheKey(this.CACHE_KEYS.ALL_ACTIVE, page, 10);
      paginationPromises.push(this.redisService.delete(cacheKey));
    }

    await Promise.all(paginationPromises).catch(error => {
      this.logger.error('Error invalidating paginated caches:', error);
    });
  } catch (error) {
    this.logger.error('Error in cache invalidation:', error);
  }
}


  @Delete(':id')
  async deleteRubro(@Param('id') id: string) {
    try {
      const result = await firstValueFrom(
        this.rubroClient.send('remove.Rubro', id)
      );

      // Invalidación asíncrona del caché
      Promise.all([
        this.redisService.delete(CACHE_KEYS.RUBRO.ALL_ACTIVE),
        this.redisService.delete(CACHE_KEYS.RUBRO.ALL_DELETED)
      ]).catch(error => console.error('Error invalidating cache:', error));

      return result;
    } catch (error) {
      throw new RpcException(error);
    }
  }

  @Post('restore/:id')
  async restoreRubro(@Param('id') id: string) {
    try {
      const result = await firstValueFrom(
        this.rubroClient.send('restore.Rubro', id)
      );

      // Invalidación asíncrona del caché
      Promise.all([
        this.redisService.delete(CACHE_KEYS.RUBRO.ALL_ACTIVE),
        this.redisService.delete(CACHE_KEYS.RUBRO.ALL_DELETED)
      ]).catch(error => console.error('Error invalidating cache:', error));

      return result;
    } catch (error) {
      throw new RpcException(error);
    }
  }

  // Método para generar clave de caché única por parámetros de paginación
  private getCacheKey(prefix: string, page: number, limit: number): string {
    return `${prefix}:page${page}:limit${limit}`;
  }
  
  @Get()
  async findAllRubros(
    @Query() paginationDto: PaginationDto
  ) {
    try {
      const { page = 1, limit = 10 } = paginationDto;
      const cacheKey = this.getCacheKey(this.CACHE_KEYS.ALL_ACTIVE, page, limit);

      this.logger.debug(`🔍 Buscando rubros en caché: ${cacheKey }`);
      
      const cachedData = await this.redisService.get(cacheKey);

      if (cachedData.success && cachedData.data) {
        this.logger.debug('✅ Datos encontrados en caché');
        //return cachedData.data;
        return FileUrlHelper.transformResponse<Rubro>(cachedData.data);
      }

      this.logger.debug('🔄 Obteniendo datos de la base de datos');
      const rubros = await firstValueFrom(
        this.rubroClient.send('findAll.Rubro', paginationDto).pipe(
          timeout(5000),
          catchError(err => {
            if (err instanceof TimeoutError) {
              throw new RpcException({
                message: 'El servicio no está respondiendo',
                status: HttpStatus.GATEWAY_TIMEOUT
              });
            }
            throw new RpcException(err);
          })
        )
      );

      // Guardar en caché
      if (rubros) {
        await this.redisService.set(
          //this.CACHE_KEYS.ALL_ACTIVE,
          cacheKey,
          rubros,
          this.CACHE_TTL
        ).catch(error => {
          this.logger.error('❌ Error guardando en caché:', error);
        });
      }

      return FileUrlHelper.transformResponse<Rubro>(rubros);

    } catch (error) {
      this.logger.error('❌ Error en findAllRubros:', error);
      throw new RpcException(error);
    }
  }


  @Get('/deleted')
  async findDeletedRubros(
    @Query() paginationDto: PaginationDto
  ) {
    try {
      this.logger.debug(`🔍 Buscando rubros en caché: ${this.CACHE_KEYS.ALL_DELETED}`);
      
      const cachedData = await this.redisService.get(this.CACHE_KEYS.ALL_DELETED);

      if (cachedData.success && cachedData.data) {
        this.logger.debug('✅ Datos encontrados en caché');
        return cachedData.data;
      }

      this.logger.debug('🔄 Obteniendo datos de la base de datos');
      const rubros = await firstValueFrom(
        this.rubroClient.send('findDeleted.Rubro', paginationDto).pipe(
          timeout(5000),
          catchError(err => {
            if (err instanceof TimeoutError) {
              throw new RpcException({
                message: 'El servicio no está respondiendo',
                status: HttpStatus.GATEWAY_TIMEOUT
              });
            }
            throw new RpcException(err);
          })
        )
      );

      // Guardar en caché
      if (rubros) {
        await this.redisService.set(
          this.CACHE_KEYS.ALL_DELETED,
          rubros,
          this.CACHE_TTL
        ).catch(error => {
          this.logger.error('❌ Error guardando en caché:', error);
        });
      }

      return rubros;
    } catch (error) {
      this.logger.error('❌ Error en findAllRubros:', error);
      throw new RpcException(error);
    }
  }

  @Post('reorder')
  async reorderRubros(
    @Body() data: { rubroIds: string; newPosition: number }
  ) {
    return this.rubroClient.send('reorder.Rubro', data).pipe(
      catchError(err => { 
        if( err instanceof TimeoutError) {
          throw new RpcException({
            message: 'El servicio no está respondiendo',
            status: HttpStatus.GATEWAY_TIMEOUT
          });
        }
        throw new RpcException(err);
      })
    );
  }  

  
}
