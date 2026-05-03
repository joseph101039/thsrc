'use strict';

const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'THSRC Booking API',
      version: '1.0.0',
      description: '高鐵自動訂票 API',
    },
    servers: [{ url: 'https://api.joseph101039.uk' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Passenger: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            idNumber: { type: 'string' },
            type: { type: 'string', enum: ['adult', 'student', 'senior', 'disabled', 'child'] },
            email: { type: 'string' },
            phone: { type: 'string' },
          },
        },
        PassengerInput: {
          type: 'object',
          required: ['name', 'idNumber', 'type', 'email'],
          properties: {
            id: { type: 'string', description: '有值時為更新，否則為新增' },
            name: { type: 'string' },
            idNumber: { type: 'string' },
            type: { type: 'string', enum: ['adult', 'student', 'senior', 'disabled', 'child'] },
            email: { type: 'string' },
            phone: { type: 'string' },
          },
        },
        Booking: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            passengerId: { type: 'string' },
            fromStation: { type: 'string' },
            toStation: { type: 'string' },
            date: { type: 'string', example: '2026-05-10' },
            desiredTime: { type: 'string', example: '09:00' },
            earliestTime: { type: 'string', example: '08:00' },
            latestTime: { type: 'string', example: '10:00' },
            maxRetries: { type: 'integer' },
            retryWaitValue: { type: 'integer', default: 2 },
            retryWaitUnit: { type: 'string', enum: ['minute', 'second'], default: 'minute' },
            status: { type: 'string', enum: ['pending', 'running', 'success', 'failed'] },
            retryCount: { type: 'integer' },
            trainNo: { type: 'string' },
            ticketNo: { type: 'string' },
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' },
          },
        },
        BookingInput: {
          type: 'object',
          required: ['passengerId', 'fromStation', 'toStation', 'date', 'desiredTime', 'earliestTime', 'latestTime'],
          properties: {
            passengerId: { type: 'string' },
            fromStation: { type: 'string' },
            toStation: { type: 'string' },
            date: { type: 'string', example: '2026-05-10' },
            desiredTime: { type: 'string', example: '09:00' },
            earliestTime: { type: 'string', example: '08:00' },
            latestTime: { type: 'string', example: '10:00' },
            maxRetries: { type: 'integer', default: 10 },
            retryWaitValue: { type: 'integer', default: 2, minimum: 1 },
            retryWaitUnit: { type: 'string', enum: ['minute', 'second'], default: 'minute' },
            scheduledAt: { type: 'string', description: 'ISO datetime，null 表示立即執行' },
          },
        },
        BookingAttempt: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            bookingId: { type: 'string' },
            attemptedAt: { type: 'string' },
            success: { type: 'integer', enum: [0, 1] },
            reason: { type: 'string', nullable: true },
          },
        },
        AllowedUser: {
          type: 'object',
          properties: {
            email: { type: 'string' },
            role: { type: 'string', enum: ['user', 'admin'] },
            createdAt: { type: 'string' },
          },
        },
      },
    },
  },
  apis: [path.join(__dirname, 'controllers/**/*.js')],
};

const spec = swaggerJsdoc(options);

if (require.main === module) {
  process.stdout.write(JSON.stringify(spec, null, 2));
}

module.exports = spec;
