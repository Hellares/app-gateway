import 'dotenv/config';
import * as joi from 'joi';

interface EnvVars {
    PORT: number;
    NODE_ENV: 'development' | 'production' | 'test';
    RABBITMQ_SERVERS: string[];
}

const envsSchema = joi.object({
    PORT: joi.number().required(),
    NODE_ENV: joi.string()
        .valid('development', 'production', 'test')
        .default('development'),
    RABBITMQ_SERVERS: joi.array().items(joi.string()).required(),
})
.unknown(true);

const { error, value } = envsSchema.validate({
    ...process.env,
    RABBITMQ_SERVERS: process.env.RABBITMQ_SERVERS?.split(','),
    NODE_ENV: process.env.NODE_ENV || 'development'
});

if (error) {
    throw new Error(`Config validation error: ${error.message}`);
}

const envVars: EnvVars = value;

export const envs = {
    port: envVars.PORT,
    environment: envVars.NODE_ENV,
    isProduction: envVars.NODE_ENV === 'production',
    isDevelopment: envVars.NODE_ENV === 'development',
    rabbitmqServers: envVars.RABBITMQ_SERVERS,
}