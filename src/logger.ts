import dotenv from "dotenv";
dotenv.config(); // .env 파일 로드
import winston from "winston";
import fs from "fs";
import path from "path";
import { format } from "date-fns";
import { PapertrailTransport } from "winston-papertrail-transport";
import os from "os";

const { combine, timestamp, printf } = winston.format;
const originalHostname = os.hostname();

// 커스텀 이름과 원래 호스트네임 결합
const combinedHostname = `${originalHostname}`;
const port = Number(process.env.PAPERTRAIL_PORT);

const papertrailTransport = new PapertrailTransport({
  host: "logs.papertrailapp.com",
  port: port,
  hostname: combinedHostname,
  program: "youtube-downloader",
});

// 'logs' 폴더가 없으면 생성
const logsDirectory = path.join("logs", format(new Date(), "yyyy-MM-dd"));

// 로그 포맷 정의
const logFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} ${level}: ${message}`;
});

// 파일 로거 설정
const fileLogger = winston.createLogger({
  level: "info",
  format: combine(timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), logFormat),
  transports: [
    new winston.transports.File({
      filename: path.join(
        logsDirectory,
        `logfile-${format(new Date(), "yyyy-MM-dd")}.log`
      ),
      level: "info",
    }),
    papertrailTransport,
  ],
});

// 'logs' 폴더 및 날짜별 폴더 생성 (로거 설정 후에 호출)
if (!fs.existsSync(logsDirectory)) {
  fs.mkdirSync(logsDirectory, { recursive: true });
}

// 콘솔에 로그 출력
const consoleLogger = winston.createLogger({
  level: "info",
  format: combine(timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), logFormat),
  transports: [new winston.transports.Console()],
});

// 로그 함수 (info, error, 등)
const log = (level: "info" | "error", message: string) => {
  fileLogger.log(level, message);
  consoleLogger.log(level, message);
};

export default log;
