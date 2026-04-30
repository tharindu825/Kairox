import { db } from './firebase-admin';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';

export interface SystemLog {
  message: string;
  level: LogLevel;
  source: string;
  timestamp: Date;
}

export class Logger {
  static async log(message: string, level: LogLevel = 'INFO', source: string = 'SYSTEM') {
    const logEntry: SystemLog = {
      message,
      level,
      source,
      timestamp: new Date(),
    };

    // Print to console
    const color = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : level === 'SUCCESS' ? '\x1b[32m' : '\x1b[37m';
    console.log(`${color}[${source}] [${level}] ${message}\x1b[0m`);

    try {
      // Persist to Firestore
      await db.collection('systemLogs').add({
        ...logEntry,
        timestamp: new Date(), // Firestore uses its own Timestamp
      });

      // Keep only last 100 logs (optional, for performance)
      // This could be done via a scheduled function, but let's just add for now.
    } catch (err) {
      console.error('Failed to persist log to Firestore', err);
    }
  }

  static info(message: string, source?: string) { return this.log(message, 'INFO', source); }
  static warn(message: string, source?: string) { return this.log(message, 'WARN', source); }
  static error(message: string, source?: string) { return this.log(message, 'ERROR', source); }
  static success(message: string, source?: string) { return this.log(message, 'SUCCESS', source); }
}
