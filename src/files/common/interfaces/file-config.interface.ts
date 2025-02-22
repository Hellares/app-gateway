// src/common/interfaces/file-config.interface.ts

import { FileType } from "../constants/file-types.constant";


export interface ImageDimensions {
  width: number;
  height: number;
  quality: number;
}

export interface FileTypeConfig {
  maxSize: number;
  dimensions?: ImageDimensions;
  processOptions?: {
    image?: {
      maxWidth: number;
      maxHeight: number;
      quality: number;
    };
  };
  allowedMimeTypes: string[];
}

export interface FileConfigurations {
  maxSize: number;
  allowedMimeTypes: string[];
  types: {
    [key in FileType]: FileTypeConfig;
  };
}