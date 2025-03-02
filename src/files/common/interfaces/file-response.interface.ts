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
  file: FileInfo;
}

export interface UploadMultipleResponse {
  success: boolean;
  totalProcessed: number;
  successful: number;
  failed: number;
  files: FileInfo[];
}