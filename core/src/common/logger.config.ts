import { format, transports } from 'winston';
import { WinstonModuleOptions } from 'nest-winston';

export interface LoggerConfigOptions {
  appName: string;
}

// Không có transport thì winston nuốt hết log của engine (plan, evaluate, tool call...)
// nên ghi ra console, đúng dạng "thời gian LEVEL [context] message" của Nest.
export const getLoggerConfig = (appName: string): WinstonModuleOptions => ({
  transports: [
    new transports.Console({
      format: format.combine(
        format.timestamp(),
        format.printf(
          ({ timestamp, level, context, message }) =>
            `${timestamp} ${level.toUpperCase()} [${context ?? appName}] ${message}`,
        ),
      ),
    }),
  ],
});
