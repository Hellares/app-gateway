import { BadRequestException, Body, Controller, Delete, Get, Inject, InternalServerErrorException, NotFoundException, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { catchError, firstValueFrom } from 'rxjs';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { SERVICES } from 'src/transports/constants';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Controller('products')
export class ProductsController {
  constructor(
    @Inject( SERVICES.PRODUCTS) private readonly productsClient: ClientProxy
  ) {}

  @Post()
  createProduct(@Body() createProductDto: CreateProductDto) {
    return this.productsClient.send({ cmd: 'create_product'}, createProductDto);
  }

  @Get()
  findAllProducts(
    @Query() paginationDto: PaginationDto
  ){
    return this.productsClient.send({ cmd: 'find_all_products'}, paginationDto);
  }

  // @Get(':id')
  // async findOneProduct(@Param('id') id: string) {

  //   try {

  //     const product = await firstValueFrom(
  //       this.productsClient.send({ cmd: 'find_one_product'}, { id })
  //     );
  //     return product;
      
  //   } catch (error) {
      
  //       throw new RpcException(`error: ${error.message}`);
  //   }
  // }

  @Get(':identifier')
async findOneProduct(@Param('identifier') identifier: string) {
  try {
    const isNumeric = /^\d+$/.test(identifier);
    
    const product = await firstValueFrom(
      this.productsClient.send(
        { cmd: 'find_one_product' }, 
        isNumeric ? parseInt(identifier) : identifier
      )
    );
    
    return product;
    
  } catch (error) {
    // Usamos RpcException para que el filter lo maneje
    throw new RpcException(error.message);
  }
}

  @Delete(':id')
  deleteProduct(@Param('id', ParseIntPipe) id: number) {
    return this.productsClient.send({ cmd: 'delete_product' }, { id }).pipe(
      catchError(err => { 
        throw new RpcException(err) 
      })
    );
  }

  @Patch(':id')
  updateProduct(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateProductDto: UpdateProductDto
  ){
    return this.productsClient.send({ cmd: 'update_product'}, { id, ...updateProductDto })
    .pipe(
      catchError( err => { throw new RpcException(err.message) })
    )
  }
}
