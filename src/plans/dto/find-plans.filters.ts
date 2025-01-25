// src/plan/dto/find-plans-filters.dto.ts
import { IsOptional, IsBoolean, IsEnum } from 'class-validator';
import { NivelPlan } from './create-plan.dto';


export class FindPlansFiltersDto {
  @IsOptional()
  @IsBoolean()
  estado?: boolean;

  @IsOptional()
  @IsEnum(NivelPlan)
  nivelPlan?: NivelPlan;
}