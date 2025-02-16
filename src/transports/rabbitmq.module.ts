import { Module } from '@nestjs/common';
import { ClientsModule, RmqOptions, Transport } from '@nestjs/microservices';
import {  envs } from 'src/config';
import { QUEUES, SERVICES } from './constants';





const serviceConfig = [
  { name: SERVICES.COMPANY,queue: QUEUES.COMPANY },
  { name: SERVICES.REDIS,queue: QUEUES.REDIS },
  { name: SERVICES.FILES,queue: QUEUES.FILES },
];

const clientsConfigArray = serviceConfig.map(service => ({
  name: service.name,
  transport: Transport.RMQ,
  options: {
    urls: envs.rabbitmqServers,
    queue: service.queue,
    queueOptions: {
      durable: true,
    },
    noAssert: false,
    persistent: true,
    heartbeat: 120,
  socketOptions: {
    heartbeatIntervalInSeconds: 120,
      timeout: 10000,         // 10 segundos de timeout
  },
  }
} as RmqOptions & { name: string; }));

const clientsConfig = ClientsModule.register(clientsConfigArray);

@Module({
  imports: [clientsConfig],
  exports: [clientsConfig]
})
export class RabbitMQModule { }

