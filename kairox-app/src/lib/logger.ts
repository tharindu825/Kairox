import { getDb } from './mongodb';

export enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  SUCCESS = 'SUCCESS'
}

export interface SystemLog {
  timestamp: Date;
  level: LogLevel;
  message: string;
  source: string;
  metadata?: any;
}

export class Logger {
  private static async log(level: LogLevel, message: string, source: string, metadata?: any) {
    const timestamp = new Date();
    
    // 1. Console Output
    const color = {
      [LogLevel.INFO]: '\x1b[34m',    // Blue
      [LogLevel.WARN]: '\x1b[33m',    // Yellow
      [LogLevel.ERROR]: '\x1b[31m',   // Red
      [LogLevel.SUCCESS]: '\x1b[32m', // Green
    }[level];
    
    console.log(`${color}[${timestamp.toLocaleTimeString()}] [${source}] ${level}: ${message}\x1b[0m`);

    // 2. Persist to MongoDB
    try {
      const db = await getDb();
      await db.collection('systemLogs').insertOne({
        timestamp,
        level,
        message,
        source,
        metadata
      });
    } catch (err) {
      console.error('[Logger] Failed to persist log to MongoDB:', err);
    }
  }

  static async info(message: string, source = 'System') {
    await this.log(LogLevel.INFO, message, source);
  }

  static async warn(message: string, source = 'System') {
    await this.log(LogLevel.WARN, message, source);
  }

  static async error(message: string, source = 'System', error?: any) {
    await this.log(LogLevel.ERROR, message, source, error ? { error: error.message || error } : undefined);
  }

  static async success(message: string, source = 'System') {
    await this.log(LogLevel.SUCCESS, message, source);
  }
}
