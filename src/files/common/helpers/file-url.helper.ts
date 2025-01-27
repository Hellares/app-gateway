export class FileUrlHelper {
  static getFileUrl(filename: string): string | null {
    if (!filename) return null;
  
    const storageType = process.env.STORAGE_TYPE || 'local';

    const isFirebaseFilename = /^\d{13}-/.test(filename);
    
  
    switch (storageType) {
      case 'firebase':
        if (isFirebaseFilename) {
          return `https://firebasestorage.googleapis.com/v0/b/${process.env.FIREBASE_STORAGE_BUCKET}/o/${filename}?alt=media`;
        }
      case 'cloudinary':
          return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/${filename}`;
      case 's3':
        return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${filename}`;
      case 'local':
        return `http://localhost:${process.env.PORT}/uploads/${filename}`;
      default:
        return filename;
    }
  }

  static transformResponse<T extends { icono?: string }>(response: unknown): {
    data: (T & { iconoUrl?: string })[];
    metadata: any;
  } {
    if (!response || typeof response !== 'object') {
      throw new Error('Invalid response format');
    }

    const typedResponse = response as {
      data: T[];
      metadata: any;
    };
    
    const transformedData = typedResponse.data.map(item => ({
      ...item,
      iconoUrl: item.icono ? this.getFileUrl(item.icono) : null
    }));
  
    return {
      data: transformedData,
      metadata: typedResponse.metadata
    };
  }
}