import { IsInt, IsOptional, IsString, Min } from "class-validator";

export class CreateRubroDto {

  @IsString()
  nombre: string;

  @IsString()
  descripcion: string;

  @IsString()
  @IsOptional()
  slug?: string;

  @IsString()
  @IsOptional()
  icono?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  orden: number;


  //! Propiedades para crear el registro de la imagen en la bd

  @IsString()
  @IsOptional()
  tenantId?: string;

  @IsString()
  @IsOptional()
  provider?: string;

  @IsString()
  @IsOptional()
  empresaId?: string;
 
}