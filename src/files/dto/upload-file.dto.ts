// upload-file.dto.ts
import { CategoriaArchivo } from 'src/common/enums/categoria-archivo.enum';
import { IsString, IsOptional, IsBoolean, IsEnum, IsNotEmpty } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { FileUploadOptions } from '../interfaces/file-upload-options.interface';


export class UploadFileDto implements FileUploadOptions {
  @IsString()
  @IsNotEmpty()
  empresaId: string;

  @IsString()
  @IsNotEmpty()
  tipoEntidad: string;

  @IsString()
  @IsNotEmpty()
  entidadId: string;

  @IsOptional()
  @IsEnum(CategoriaArchivo)
  categoria?: CategoriaArchivo;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  esPublico?: boolean;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  useAdvancedProcessing?: boolean;

  @IsOptional()
  @IsEnum(['profile', 'PRODUCTO', 'banner', 'thumbnail', 'default'])
  imagePreset?: 'profile' | 'PRODUCTO' | 'banner' | 'thumbnail' | 'default';

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  async?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  skipMetadataRegistration?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  skipImageProcessing?: boolean;
}