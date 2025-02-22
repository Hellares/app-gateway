// src/common/interfaces/error-response.interface.ts
export interface ErrorResponse {
  status: number;
  message: string;
  error?: string;
  code: string;
  timestamp: string;
  details?: any;
}