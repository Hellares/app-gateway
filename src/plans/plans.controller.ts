// src/plan/plan.controller.ts
import { Body, Controller, HttpStatus, Inject, Post } from '@nestjs/common';
import { CreatePlanDto } from './dto/create-plan.dto';
import { SERVICES } from 'src/transports/constants';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { catchError, firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { RedisService } from 'src/redis/redis.service';
import { CACHE_KEYS } from 'src/redis/constants/redis-cache.keys.contants';


@Controller('planes')
export class PlanController {
  constructor(
      @Inject(SERVICES.COMPANY) private readonly planClient: ClientProxy,
      private readonly redisService: RedisService,
    ) {}

  @Post()
    async create(@Body() createPlanDto: CreatePlanDto) {
      try {
        // Crear el rubro en la base de datos
        const result = await firstValueFrom(
          this.planClient.send('create.plan', createPlanDto).pipe(
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
  
        // Invalidación asíncrona de cachés
        Promise.all([
          this.redisService.delete(CACHE_KEYS.PLAN.ALL_ACTIVE),
          this.redisService.delete(CACHE_KEYS.PLAN.ALL_DELETED)
        ]).catch(error => {
          // Solo loggeamos el error de caché, no afectamos la operación principal
          console.error('Error invalidating cache after create:', error);
        });
  
        return result;
      } catch (error) {
        if (error instanceof RpcException) {
          throw error;
        }
        throw new RpcException(error);
      }
    }
}