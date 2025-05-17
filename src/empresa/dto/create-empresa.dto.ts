import { IsOptional, IsString, IsUUID, Matches } from "class-validator";

export class CreateEmpresaDto {
  @IsString()
  nombreComercial: string;

  @IsString()
  razonSocial: string;

  @IsString()
  //@Matches(/^\d{11}$/, { message: 'El RUC debe tener 11 dígitos numéricos' })
  ruc: string;

  @IsString()
  @IsOptional()
  slug: string;

  @IsUUID()
  rubroId: string;

  @IsOptional()
  @IsString()
  logoId?: string;

  @IsOptional()
  @IsString()
  portadaId?: string;

  @IsOptional()
  @IsString()
  creadorId?: string;

  @IsOptional()
  @IsString()
  creadorDni?: string;

  @IsOptional()
  @IsString()
  creadorEmail?: string;

  @IsOptional()
  @IsString()
  creadorNombre?: string;

  @IsOptional()
  @IsString()
  creadorApellido?: string;

  @IsOptional()
  @IsString()
  creadorTelefono?: string;
}