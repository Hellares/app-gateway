// src/auth/auth.service.ts
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';
import { envs } from '../config';
import { LoginDto } from './dto/login.dto';
import { RegisterUserDto } from './dto/register-user.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly authServiceUrl: string;

  constructor(private readonly jwtService: JwtService) {
    this.authServiceUrl = envs.authServiceUrl || 'http://127.0.0.1:3007';
  }

  async register(registerUserDto: RegisterUserDto) {
    try {
      this.logger.debug(`Intentando registrar usuario con DNI: ${registerUserDto.dni}`);
      
      // Hacemos la petición HTTP al microservicio de autenticación
      const response = await axios.post(`${this.authServiceUrl}/api/auth/register`, registerUserDto, {
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      this.logger.debug(`Usuario registrado con exito: ${registerUserDto.dni}`);
      
      // Devolvemos la respuesta del microservicio
      return response.data;
    } catch (error) {
      this.logger.error(`Error al registrar usuario: ${error.message}`, error.stack);
      
      // Si el error tiene una respuesta del servidor, extraemos esa información
      if (error.response) {
        throw new HttpException({
          message: error.response.data.error || 'Error en el servicio de autenticacion',
          statusCode: error.response.status,
        }, error.response.status);
      }
      
      // Si no hay respuesta, es un error de conexión
      throw new HttpException(
        'Error de conexion con el servicio de autenticación', 
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  async login(loginDto: LoginDto) {
    try {
      this.logger.debug(`Intentando iniciar sesion para usuario con DNI: ${loginDto.dni}`);
      
      const response = await axios.post(`${this.authServiceUrl}/api/auth/login`, loginDto);
      
      // El microservicio devuelve un token JWT directamente
      const authToken = response.data.data.token;
      
      this.logger.debug(`Inicio de sesion exitoso para usuario con DNI: ${loginDto.dni}`);
      
      // Obtener información de usuario actual con el token
      const userResponse = await axios.get(`${this.authServiceUrl}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });
      
      return {
        success: true,
        message: 'Inicio de sesion exitoso',
        data: {
          user: userResponse.data.data,
          token: authToken
        }
      };
    } catch (error) {
      this.logger.error(`Error al iniciar sesion: ${error.message}`, error.stack);
      
      if (error.response) {
        throw new HttpException({
          message: error.response.data.error || 'Error en el servicio de autenticacion',
          statusCode: error.response.status,
        }, error.response.status);
      }
      
      throw new HttpException(
        'Error de conexion con el servicio de autenticacion', 
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  

  

  // Método para validar tokens del microservicio de autenticación
  async validateToken(token: string) {
    try {
      this.logger.debug(`Validando token: ${token.substring(0, 10)}...`);
      const response = await axios.get(`${this.authServiceUrl}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      this.logger.debug(`Respuesta de validacion: ${JSON.stringify(response.data)}`);
      return response.data.data;
    } catch (error) {
      this.logger.error(`Error al validar token: ${error.message}`);
      return null;
    }
  }
}