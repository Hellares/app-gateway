// processing-manager.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Subject } from 'rxjs';
import * as crypto from 'crypto';

interface ProcessingJobInfo {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'timeout';
  startTime: number;
  endTime?: number;
  error?: string;
  resolve?: (value: any) => void;
  reject?: (error: Error) => void;
  timeoutId?: NodeJS.Timeout;
  fileInfo: {
    name: string;
    size: number;
    type: string;
  };
  options?: any;
  result?: any;
}

@Injectable()
export class ProcessingManagerService {
  private readonly logger = new Logger(ProcessingManagerService.name);
  private readonly isDevelopment = process.env.NODE_ENV !== 'production';
  
  // Mapa único para todas las tareas de procesamiento
  private processingJobs = new Map<string, ProcessingJobInfo>();
  
  // Evento para notificar cuando se completa una tarea
  private jobCompletedSubject = new Subject<{ id: string, result: any }>();
  
  // Observable público para suscribirse a eventos de finalización
  public jobCompleted$ = this.jobCompletedSubject.asObservable();

  // Estadísticas de procesamiento
  private processingStats = {
    totalProcessed: 0,
    pythonProcessed: 0,
    sharpProcessed: 0,
    failedProcessing: 0,
    averageProcessingTime: 0
  };

  constructor() {}

  /**
   * Registra una nueva tarea de procesamiento
   */
  registerProcessingJob(
    file: Express.Multer.File, 
    options?: any
  ): string {
    // Generar ID único para este procesamiento
    const processingId = this.generateJobId(file);
    
    // Establecer un tiempo de espera basado en el tamaño del archivo (más grande = más tiempo)
    const timeoutMs = Math.min(60000, 20000 + Math.floor(file.size / (50 * 1024)));
    
    // Crear una promesa que se resolverá cuando se complete la tarea
    let resolveCallback: (value: any) => void;
    let rejectCallback: (error: any) => void;
    
    const resultPromise = new Promise<any>((resolve, reject) => {
      resolveCallback = resolve;
      rejectCallback = reject;
    });
    
    // Configurar timeout
    const timeoutId = setTimeout(() => {
      const job = this.processingJobs.get(processingId);
      if (job && job.status === 'processing') {
        this.logger.warn(`Timeout para procesamiento: ${processingId} (${timeoutMs}ms)`);
        job.status = 'timeout';
        job.endTime = Date.now();
        job.error = 'Tiempo de espera agotado';
        
        if (job.reject) {
          job.reject(new Error('Timeout procesando imagen'));
        }
        
        // No eliminamos el trabajo, solo lo marcamos como timeout para tener historial
        this.updateProcessingStats('failed');
      }
    }, timeoutMs);

    // Registrar el trabajo
    this.processingJobs.set(processingId, {
      id: processingId,
      status: 'pending',
      startTime: Date.now(),
      resolve: resolveCallback,
      reject: rejectCallback,
      timeoutId: timeoutId,
      fileInfo: {
        name: file.originalname,
        size: file.size,
        type: file.mimetype
      },
      options
    });

    if (this.isDevelopment) {
      this.logger.debug(`Tarea de procesamiento registrada: ${processingId}`);
    }

    return processingId;
  }

  /**
   * Marca una tarea como en procesamiento
   */
  startProcessing(jobId: string): void {
    const job = this.processingJobs.get(jobId);
    if (job) {
      job.status = 'processing';
      
      if (this.isDevelopment) {
        this.logger.debug(`Iniciando procesamiento para tarea: ${jobId}`);
      }
    }
  }

  /**
   * Completa una tarea de procesamiento exitosamente
   */
  completeJob(jobId: string, result: any): void {
    const job = this.processingJobs.get(jobId);
    if (job) {
      // Limpiar el timeout si existe
      if (job.timeoutId) {
        clearTimeout(job.timeoutId);
      }
      
      // Actualizar el estado del trabajo
      job.status = 'completed';
      job.endTime = Date.now();
      job.result = result;
      
      // Calcular la duración y actualizar estadísticas
      const duration = job.endTime - job.startTime;
      this.updateProcessingStats('success', result.pythonProcessed ? 'python' : 'sharp', duration);
      
      // Resolver la promesa
      if (job.resolve) {
        job.resolve(result);
      }
      
      // Notificar a través del observable
      this.jobCompletedSubject.next({ id: jobId, result });
      
      if (this.isDevelopment) {
        this.logger.debug(`Tarea completada: ${jobId} en ${duration}ms`);
      }
    }
  }
  
  /**
   * Marca una tarea como fallida
   */
  failJob(jobId: string, error: Error): void {
    const job = this.processingJobs.get(jobId);
    if (job) {
      // Limpiar el timeout si existe
      if (job.timeoutId) {
        clearTimeout(job.timeoutId);
      }
      
      // Actualizar el estado del trabajo
      job.status = 'failed';
      job.endTime = Date.now();
      job.error = error.message;
      
      // Actualizar estadísticas
      this.updateProcessingStats('failed');
      
      // Rechazar la promesa
      if (job.reject) {
        job.reject(error);
      }
      
      if (this.isDevelopment) {
        this.logger.error(`Tarea fallida: ${jobId} - ${error.message}`);
      }
    }
  }
  
  /**
   * Obtiene el estado de una tarea
   */
  getJobStatus(jobId: string): { status: string; progress?: number; } | null {
    const job = this.processingJobs.get(jobId);
    if (!job) {
      return null;
    }
    
    return {
      status: job.status,
      // Simulamos el progreso basado en el tiempo transcurrido (en una implementación real
      // obtendríamos el progreso actual del servicio de procesamiento)
      progress: job.status === 'processing' 
        ? Math.min(95, Math.floor((Date.now() - job.startTime) / 1000 * 10))
        : job.status === 'completed' ? 100 : 0
    };
  }
  
  /**
   * Obtiene estadísticas de procesamiento
   */
  getProcessingStats() {
    return {
      ...this.processingStats,
      pythonPercentage: this.processingStats.totalProcessed > 0 
        ? (this.processingStats.pythonProcessed / this.processingStats.totalProcessed * 100).toFixed(2) + '%'
        : '0%',
      sharpPercentage: this.processingStats.totalProcessed > 0
        ? (this.processingStats.sharpProcessed / this.processingStats.totalProcessed * 100).toFixed(2) + '%'
        : '0%',
      successRate: this.processingStats.totalProcessed > 0
        ? ((this.processingStats.totalProcessed - this.processingStats.failedProcessing) / this.processingStats.totalProcessed * 100).toFixed(2) + '%'
        : '0%',
      averageProcessingTimeMs: Math.round(this.processingStats.averageProcessingTime) + 'ms'
    };
  }
  
  /**
   * Maneja respuestas de procesamiento de imágenes
   */
  handleProcessedImageResponse(data: any): void {
    if (!data || !data.id) {
      this.logger.warn('Mensaje recibido sin ID');
      return;
    }
    
    // Buscar el trabajo por ID
    const job = this.processingJobs.get(data.id);
    
    if (job) {
      this.completeJob(data.id, data);
    } else {
      // Si no encontramos el trabajo por ID exacto, podría ser un mensaje
      // con ID desconocido. Intentamos resolver la primera tarea pendiente.
      if (data.id === 'unknown' && this.processingJobs.size > 0) {
        // Buscar el primer trabajo pendiente o en procesamiento
        for (const [jobId, jobInfo] of this.processingJobs.entries()) {
          if (jobInfo.status === 'pending' || jobInfo.status === 'processing') {
            this.logger.debug(`Recibido mensaje con ID 'unknown', asignado a: ${jobId}`);
            this.completeJob(jobId, data);
            return;
          }
        }
      }
      
      this.logger.warn(`No se encontró tarea para el ID: ${data.id}`);
    }
  }
  
  /**
   * Actualiza las estadísticas de procesamiento
   */
  private updateProcessingStats(
    result: 'success' | 'failed',
    processor?: 'python' | 'sharp',
    duration?: number
  ): void {
    this.processingStats.totalProcessed++;
    
    if (result === 'failed') {
      this.processingStats.failedProcessing++;
    } else if (processor === 'python') {
      this.processingStats.pythonProcessed++;
    } else if (processor === 'sharp') {
      this.processingStats.sharpProcessed++;
    }
    
    // Actualizar tiempo promedio si se proporciona la duración
    if (duration) {
      const oldAvg = this.processingStats.averageProcessingTime;
      const totalProcessed = this.processingStats.totalProcessed;
      
      // Fórmula para actualizar promedio incremental
      const newAvg = oldAvg + (duration - oldAvg) / totalProcessed;
      this.processingStats.averageProcessingTime = newAvg;
    }
  }
  
  /**
   * Genera un ID único para una tarea de procesamiento
   */
  private generateJobId(file: Express.Multer.File): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    const hash = crypto.createHash('md5')
      .update(`${file.originalname}-${file.size}-${timestamp}-${random}`)
      .digest('hex')
      .substring(0, 10);
    
    return `img_${timestamp}_${hash}`;
  }
}