import { LoggerService } from '@nestjs/common';

export interface LoggerConfigOptions {
  appName: string;
}

export const getLoggerConfig = (appName: string): any => {
  return {
    // Basic winston config fallback
  };
};
