import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";
const usePrettyLogs = process.env.LOG_PRETTY === "true";
const useSimpleConsoleLogger =
  process.env.NODE_ENV === "development" && process.env.LOG_PRETTY !== "true";

export const logger = useSimpleConsoleLogger
  ? pino({ level: process.env.LOG_LEVEL ?? "info" })
  : pino({
      level: process.env.LOG_LEVEL ?? "info",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers['set-cookie']",
      ],
      ...(isProduction || !usePrettyLogs
        ? {}
        : {
            transport: {
              target: "pino-pretty",
              options: { colorize: true },
            },
          }),
    });
