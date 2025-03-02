
// export class FileUrlHelper {
//   static getFileUrl(filename: string, tenantId?: string): string | null {
//     if (!filename) return null;
  
//     const storageType = process.env.STORAGE_TYPE || 'local';
    
//     // Verificar si el filename ya incluye una ruta con tenant
//     const hasPath = filename.includes('/');
    
//     // Si el filename no tiene una ruta y se proporciona un tenantId, construir la ruta completa
//     const fullPath = hasPath ? filename : (tenantId ? `${tenantId}/${filename}` : filename);
    
//     // Determinar si es un filename de Firebase basado en el formato
//     const isFirebaseFilename = !hasPath && /^\d{13}-/.test(filename);
    
//     switch (storageType) {
//       case 'firebase':
//         // Usamos encodeURIComponent para manejar correctamente caracteres especiales en la URL
//         return `https://firebasestorage.googleapis.com/v0/b/${process.env.FIREBASE_STORAGE_BUCKET}/o/${encodeURIComponent(fullPath)}?alt=media`;
      
//       case 'cloudinary':
//         // Cloudinary tiene un formato diferente, aquí asumimos que no usamos carpetas en Cloudinary
//         return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/${filename}`;
      
//       case 's3':
//         return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fullPath}`;
      
//       case 'local':
//         return `http://localhost:${process.env.PORT}/uploads/${fullPath}`;
      
//       default:
//         return fullPath;
//     }
//   }

//   static transformResponse<T extends { icono?: string, tenantId?: string }>(response: unknown): {
//     data: (T & { iconoUrl?: string })[];
//     metadata: any;
//   } {
//     if (!response || typeof response !== 'object') {
//       throw new Error('Invalid response format');
//     }

//     const typedResponse = response as {
//       data: T[];
//       metadata: any;
//     };
    
//     const transformedData = typedResponse.data.map(item => {
//       return {
//         ...item,
//         iconoUrl: item.icono ? this.getFileUrl(item.icono, item.tenantId) : null
//       };
//     });

//     return {
//       data: transformedData,
//       metadata: typedResponse.metadata
//     };
//   }
// }

export class FileUrlHelper {
  static getFileUrl(
    filename: string, 
    options?: { 
      tenantId?: string; 
      provider?: string; // Nuevo parámetro para especificar proveedor
    }
  ): string | null {
    if (!filename) return null;
    
    // Usar el proveedor especificado o el global
    const storageType = options?.provider || process.env.STORAGE_TYPE || 'firebase';
    
    // Verificar si el filename ya incluye una ruta con tenant
    const hasPath = filename.includes('/');
    
    // Si el filename no tiene una ruta y se proporciona un tenantId, construir la ruta completa
    const fullPath = hasPath ? filename : (options?.tenantId ? `${options.tenantId}/${filename}` : filename);
    
    // Intentar detectar proveedor por formato si no se especificó
    const detectedProvider = this.detectProviderFromPath(filename);
    const effectiveProvider = options?.provider || detectedProvider || storageType;
    
    switch (effectiveProvider) {
      case 'firebase':
        // Usamos encodeURIComponent para manejar correctamente caracteres especiales en la URL
        return `https://firebasestorage.googleapis.com/v0/b/${process.env.FIREBASE_STORAGE_BUCKET}/o/${encodeURIComponent(fullPath)}?alt=media`;
      
      case 'cloudinary':
        // Cloudinary tiene un formato diferente, aquí asumimos que no usamos carpetas en Cloudinary
        return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/${filename}`;
      
      case 's3':
        return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fullPath}`;
      
      case 'local':
        return `http://localhost:${process.env.PORT}/uploads/${fullPath}`;
      
      default:
        return fullPath;
    }
  }

  // Nuevo método para intentar detectar el proveedor basado en la estructura del path
  private static detectProviderFromPath(filename: string): string | null {
    if (!filename) return null;
    
    // Firebase suele tener rutas con formato timestamp-nombre
    if (/^\d{13}-/.test(filename)) {
      return 'firebase';
    }
    
    // Cloudinary suele tener formato específico con transformaciones
    if (filename.includes('/upload/') || filename.includes('/v')) {
      return 'cloudinary';
    }

    // Amazon S3 suele usar UUIDs o tiene formato específico
    if (filename.includes('-') && filename.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/)) {
      return 's3';
    }
    
    // No se pudo detectar con certeza
    return null;
  }

  // Método mejorado para transformar respuestas incluyendo ahora el proveedor
  static transformResponse<T extends { icono?: string; tenantId?: string; provider?: string }>(
    response: unknown
  ): {
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
    
    const transformedData = typedResponse.data.map(item => {
      return {
        ...item,
        iconoUrl: item.icono ? this.getFileUrl(item.icono, {
          tenantId: item.tenantId,
          provider: item.provider
        }) : null
      };
    });

    return {
      data: transformedData,
      metadata: typedResponse.metadata
    };
  }
}