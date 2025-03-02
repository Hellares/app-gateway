// src/common/interfaces/error-response.interface.ts
export interface ErrorResponse {
  success: boolean;
  status: number;
  message: string;
  error?: string;
  code: string;
  timestamp: string;
  // details?: any;
}