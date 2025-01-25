// src/plan/dto/create-plan.dto.ts
import { IsString, IsNumber, IsEnum, IsBoolean, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';


class PlanFeaturesDto implements Record<string, boolean> {
  @IsBoolean()
  canUploadImages: boolean;

  @IsBoolean()
  canExportData: boolean;

  @IsBoolean()
  canCreateMultipleLocations: boolean;

  @IsBoolean()
  hasAdvancedAnalytics: boolean;

  @IsBoolean()
  hasCustomBranding: boolean;

  @IsBoolean()
  hasApiAccess: boolean;

  @IsBoolean()
  hasPrioritySupport: boolean;

  [key: string]: boolean;
}

class PlanLimitsDto implements Record<string, number> {
  @IsNumber()
  maxSeats: number;

  @IsNumber()
  maxLocations: number;

  @IsNumber()
  maxStorageGB: number;

  @IsNumber()
  maxProductsPerLocation: number;

  @IsNumber()
  maxMonthlyOrders: number;

  @IsNumber()
  maxCustomers: number;

  @IsNumber()
  maxImagesPerProduct: number;

  [key: string]: number;
}

export enum NivelPlan {
  BASICO = 'BASICO',
  ESTANDAR = 'ESTANDAR',
}

export class CreatePlanDto {
  @IsString()
  nombre: string;

  @IsString()
  descripcion: string;

  @IsNumber()
  @Min(0, { message: 'El precio no puede ser negativo' })
  precio: number;

  @IsNumber()
  @Min(1, { message: 'La duración mínima del plan debe ser 1 día' })
  duracionDias: number;

  @IsEnum(NivelPlan)
  nivelPlan: NivelPlan;

  @ValidateNested()
  @Type(() => PlanFeaturesDto)
  caracteristicas: PlanFeaturesDto;

  @ValidateNested()
  @Type(() => PlanLimitsDto)
  limites: PlanLimitsDto;

  @IsBoolean()
  estado: boolean = true;
}

