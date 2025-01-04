import { Module } from '@nestjs/common';
import { ClientsModule, RmqOptions, Transport } from '@nestjs/microservices';
import {  envs } from 'src/config';
import { QUEUES, SERVICES } from './constants';





const serviceConfig = [
  {
    name: SERVICES.PRODUCTS,
    queue: QUEUES.PRODUCTS
  },
  // {
  //   name: SERVICES.ORDERS,
  //   queue: QUEUES.ORDERS
  // },
  // {
  //   name: SERVICES.AUTH,
  //   queue: QUEUES.AUTH
  // }
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
  },
} as RmqOptions & { name: string; }));

const clientsConfig = ClientsModule.register(clientsConfigArray);

@Module({
  imports: [clientsConfig],
  exports: [clientsConfig]
})
export class RabbitMQModule { }