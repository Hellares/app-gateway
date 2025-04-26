import { Type } from "class-transformer";
import { IsEnum, IsOptional, IsPositive, IsString } from "class-validator";
import { CategoriaArchivo } from "../enums/categoria-archivo.enum";

export class PaginationDto {
    
  @IsPositive()
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;
  
  @IsPositive()
  @IsOptional()
  @Type(() => Number)
  limit?: number = 10;

}

export class ArchivosByEmpresaDto extends PaginationDto {
 
  @IsOptional()
  @IsEnum(CategoriaArchivo)
  categoria?: CategoriaArchivo;

  @IsOptional()
  @IsString()
  empresaId?: string;
}