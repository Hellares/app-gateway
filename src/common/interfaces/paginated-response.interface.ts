export interface PaginatedResponse<T> {
  data: T[];
  metadata: {
    total: number;
    page: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}