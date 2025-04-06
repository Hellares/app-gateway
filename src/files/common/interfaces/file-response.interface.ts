import { CategoriaArchivo } from "src/common/enums/categoria-archivo.enum";

export interface FileInfo {
  filename: string;
  originalName: string;
  size: number;
  url?: string;
  type?: string;
  tenantId?: string;
  error?: string;
  success?: boolean;
}

export interface UploadFileResponse {
  success: boolean;
  totalProcessed: number;
  successful: number;
  failed: number;
  file: FileInfo;
}

export interface UploadMultipleResponse {
  success: boolean;
  totalProcessed: number;
  successful: number;
  failed: number;
  files: FileInfo[];
  metadata?: {
    empresaId?: string;
    tipoEntidad?: string;
    entidadId?: string;
    categoria?: CategoriaArchivo;
  };
}