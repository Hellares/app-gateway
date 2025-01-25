import { Body, Controller, Get, HttpStatus, Inject, Param, Post, Query } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { SERVICES } from 'src/transports/constants';
import { catchError, timeout, TimeoutError } from 'rxjs';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { CreateEmpresaDto } from './dto/create-empresa.dto';

@Controller('empresa')
export class EmpresaController {
  constructor(
    @Inject(SERVICES.COMPANY) private readonly companiesClient: ClientProxy
  ) {}

  @Post()
  async create(@Body() createCompanyDto: CreateEmpresaDto) {
    return this.companiesClient.send('create.empresa', createCompanyDto).pipe(
      timeout(5000), // Timeout de 5 segundos
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
