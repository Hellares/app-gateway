// src/files/rabbitmq-consumer.service.ts
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as amqp from 'amqplib';
import { envs } from 'src/config'; // Ajusta según tu estructura
import { UnifiedFilesService } from './unified-files.service';

@Injectable()
export class RabbitMQConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQConsumerService.name);
  private connection: amqp.Connection;
  private channel: amqp.Channel;

  constructor(private readonly filesService: UnifiedFilesService) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  async connect() {
    try {
      // Usar la misma URL que usas para tus otras conexiones
      this.connection = await amqp.connect(envs.rabbitmqServers[0]);
      this.channel = await this.connection.createChannel();
      
      // No necesitas declarar la cola, ya existe
      
      // Consumir mensajes de la cola processed-images
      await this.channel.consume('processed-images', (msg) => {
        if (msg) {
          try {
            const content = msg.content.toString();
            const data = JSON.parse(content);
            
            this.logger.debug(`Mensaje recibido de processed-images: ${data.id}`);
            
            // Pasar al servicio de archivos para resolver promesas pendientes
            this.filesService.handleProcessedImageResponse(data);
            
            // Confirmar procesamiento
            this.channel.ack(msg);
          } catch (error) {
            this.logger.error(`Error procesando mensaje: ${error.message}`);
            
            // Rechazar mensaje
            this.channel.nack(msg, false, false);
          }
        }
      });
      
      this.logger.log('Consumidor conectado a la cola processed-images');
    } catch (error) {
      this.logger.error(`Error conectando al consumidor: ${error.message}`);
      
      // Reintentar después de un tiempo
      setTimeout(() => this.connect(), 5000);
    }
  }

  async disconnect() {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
      this.logger.log('Consumidor RabbitMQ desconectado');
    } catch (error) {
      this.logger.error(`Error al desconectar RabbitMQ: ${error.message}`);
    }
  }
}