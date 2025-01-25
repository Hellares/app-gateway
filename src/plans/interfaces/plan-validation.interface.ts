export interface ValidationResult {
  isValid: boolean;
  message?: string;
  currentUsage?: number;
  limit?: number;
}