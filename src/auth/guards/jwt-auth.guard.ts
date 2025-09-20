
// import { Injectable, Logger } from '@nestjs/common';
// import { AuthGuard } from '@nestjs/passport';

// @Injectable()
// export class JwtAuthGuard extends AuthGuard('jwt') {
//   private readonly logger = new Logger(JwtAuthGuard.name);
  
//   constructor() {
//     super();
//     this.logger.debug('JwtAuthGuard inicializado');
//   }
  
//   // Opcional: sobrescribir métodos para añadir logs
//   handleRequest(err, user, info) {
//     if (err || !user) {
//       this.logger.error(`Error autenticando: ${err ? err.message : 'Usuario no encontrado'}`);
//       this.logger.error(`Info: ${JSON.stringify(info)}`);
//     } else {
//       this.logger.debug(`Usuario autenticado: ${user.id}`);
//     }
//     return super.handleRequest(err, user, info, info); // Llama al método padre
//   }
// }