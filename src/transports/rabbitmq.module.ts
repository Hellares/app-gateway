// import { Module } from '@nestjs/common';
// import { ClientsModule, RmqOptions, Transport } from '@nestjs/microservices';
// import {  envs } from 'src/config';
// import { QUEUES, SERVICES } from './constants';

// const serviceConfig = [
//   { name: SERVICES.COMPANY,queue: QUEUES.COMPANY },
//   { name: SERVICES.REDIS,queue: QUEUES.REDIS },
//   { name: SERVICES.FILES,queue: QUEUES.FILES },
//   { name: SERVICES.IMAGE_PROCESSOR, queue: QUEUES.IMAGES_TO_PROCESS },
// ];

// const clientsConfigArray = serviceConfig.map(service => ({
//   name: service.name,
//   transport: Transport.RMQ,
//   options: {
//     urls: envs.rabbitmqServers,
//     queue: service.queue,
//     queueOptions: {
//       durable: true,
//       arguments: {
//         'x-message-ttl': 300000, // 5 minutos
//         'x-expires': 600000      // 10 minutos
//       }
//     },
//     noAssert: false,
//     persistent: true,
//     heartbeat: 120,
//     socketOptions: {
//       heartbeatIntervalInSeconds: 120,
//         timeout: 10000,         // 10 segundos de timeout
//     },
//   }
// } as RmqOptions & { name: string; }));

// // Configuración específica para la cola de resultados
// const processedImagesConfig = {
//   name: 'PROCESSED_IMAGES_CONSUMER',
//   transport: Transport.RMQ,
//   options: {
//     urls: envs.rabbitmqServers,
//     queue: QUEUES.PROCESSED_IMAGES,
//     queueOptions: {
//       durable: true
//     },
//     noAck: false, // Importante: requiere confirmación manual
//   }
// };

// clientsConfigArray.push(processedImagesConfig as any);


// const clientsConfig = ClientsModule.register(clientsConfigArray);

// @Module({
//   imports: [clientsConfig],
//   exports: [clientsConfig]
// })
// export class RabbitMQModule { }


import { Module } from '@nestjs/common';
import { ClientsModule, RmqOptions, Transport } from '@nestjs/microservices';
import { envs } from 'src/config';
import { QUEUES, SERVICES } from './constants';

// Separamos configuraciones para colas normales y colas de procesamiento
const standardServiceConfig = [
  { name: SERVICES.COMPANY, queue: QUEUES.COMPANY },
  { name: SERVICES.REDIS, queue: QUEUES.REDIS },
  { name: SERVICES.FILES, queue: QUEUES.FILES },
];

// Configuración específica para microservicio de procesamiento de imágenes
const imageProcessingConfig = [
  { 
    name: SERVICES.IMAGE_PROCESSOR, 
    queue: QUEUES.IMAGES_TO_PROCESS,
    // Configuración compatible con el microservicio Python
    noAssert: true,  // No declarar la cola, usar lo que ya existe
    queueOptions: {
      durable: true,
      // Añadir soporte para prioridades
      arguments: {
        'x-max-priority': 10 // Habilitar prioridades del 1 al 10
      }
    },
    
  },
  { 
    // Añadir esta configuración
    name: SERVICES.PROCESSED_IMAGES, 
    queue: QUEUES.PROCESSED_IMAGES,
    noAssert: true,
    queueOptions: {
      durable: true
    }
  }
];

// Configurar clientes estándar con sus argumentos habituales
const standardClientsConfigArray = standardServiceConfig.map(service => ({
  name: service.name,
  transport: Transport.RMQ,
  options: {
    urls: envs.rabbitmqServers,
    queue: service.queue,
    queueOptions: {
      durable: true,
      arguments: {
        'x-message-ttl': 300000, // 5 minutos
        'x-expires': 600000      // 10 minutos
      }
    },
    noAssert: false,
    persistent: true,
    heartbeat: 120,
    socketOptions: {
      heartbeatIntervalInSeconds: 120,
      timeout: 10000,
    },
  }
} as RmqOptions & { name: string; }));

// Configurar clientes para procesamiento de imágenes
const imageProcessingClientsConfigArray = imageProcessingConfig.map(service => ({
  name: service.name,
  transport: Transport.RMQ,
  options: {
    urls: envs.rabbitmqServers,
    queue: service.queue,
    queueOptions: {
      durable: true,
      // Incluir los argumentos definidos en la configuración
      arguments: service.queueOptions?.arguments || {}
    },
    noAssert: service.noAssert || false,
    persistent: true,
    heartbeat: 120,
    socketOptions: {
      heartbeatIntervalInSeconds: 120,
      timeout: 30000,
    },
  }
} as RmqOptions & { name: string; }));

// Juntar ambas configuraciones
const clientsConfigArray = [
  ...standardClientsConfigArray,
  ...imageProcessingClientsConfigArray
];

const clientsConfig = ClientsModule.register(clientsConfigArray);

@Module({
  imports: [clientsConfig],
  exports: [clientsConfig]
})
export class RabbitMQModule { }