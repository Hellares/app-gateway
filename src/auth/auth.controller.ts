// src/auth/auth.controller.ts
import { Body, Controller, Post, Logger } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterUserDto } from './dto/register-user.dto';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() registerUserDto: RegisterUserDto) {
    this.logger.debug(`Recibida solicitud para registrar usuario: ${registerUserDto.email}`);
    
    // Llamamos al servicio para registrar el usuario
    const result = await this.authService.register(registerUserDto);
    
    // Devolvemos el resultado
    return result;
  }


  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }
}