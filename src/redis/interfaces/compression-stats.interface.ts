export interface CompressionMetrics {
  totalCompressed: number;
  totalBytesSaved: number;
  averageCompressionRatio: number;
  lastOperations: Array<{
    key: string;
    originalSize: number;
    compressedSize: number;
    ratio: number;
    timestamp: string;
  }>;
  hourlyStats: {
    [hour: string]: {
      totalBytes: number;
      compressedBytes: number;
      operationsCount: number;
      averageRatio: number;
      timestamp: string;
    }
  };
}