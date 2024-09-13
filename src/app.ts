import dotenv from "dotenv";
dotenv.config(); // .env 파일 로드
import express, { ErrorRequestHandler } from "express";
import fs from "fs";
import { pipeline } from "stream";
import portfinder from "portfinder";
import mime from "mime-types";
import path from "path";
import cors from "cors";
import schedule from "node-schedule";
import { promisify } from "util";
import { downloadVideo, cleanupOldFiles } from "./utils";
import log from "./logger";

const pipelineAsync = promisify(pipeline);

const app = express();
const downloadDir = path.join(__dirname, "downloads");

const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
};

// React 빌드 파일 경로 설정
const reactBuildPath = path.join(__dirname, "../frontend", "build");

// Ensure download directory exists
if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir, { recursive: true });
  log("info", "Default Downloads directory created");
}

app.use("/api", express.json());
app.use(
  "/api",
  cors({
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.post("/api/downloads", async (req, res) => {
  try {
    const { url, format } = req.body;

    if (!url || !format) {
      return res.status(400).json({ error: "Missing URL or format" });
    }

    log("info", `Starting download for URL: ${url}`);
    const fileName = await downloadVideo(url, format);
    log("info", `Download completed: ${fileName}`);

    const filePath = path.join(downloadDir, fileName);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileUrl = `${req.protocol}://${req.get(
      "host"
    )}/api/stream/${encodeURIComponent(fileName)}`;

    res.status(200).json({
      message: "Download successful",
      fileName: fileName,
      downloadUrl: fileUrl,
    });
  } catch (error) {
    log("error", `Error: ${error}`);
    res.status(500).json({ error: "Internal server error", details: error });
  }
});

// 파일 스트리밍을 위한 엔드포인트
app.get("/api/stream/:fileName", async (req, res, next) => {
  let isStreamEnded = false;

  // 스트림 종료 이벤트 리스너
  const endListener = () => {
    isStreamEnded = true;
  };

  res.on("close", endListener);

  try {
    const fileName = decodeURIComponent(req.params.fileName);
    const filePath = path.join(downloadDir, fileName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    const stat = await fs.promises.stat(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    const mimeType = mime.lookup(filePath) || "application/octet-stream";

    const encodedFileName = encodeURIComponent(fileName).replace(
      /['()]/g,
      (c) => "%" + c.charCodeAt(0).toString(16)
    );
    const contentDisposition = `attachment; filename*=UTF-8''${encodedFileName}`;

    let start = 0;
    let end = fileSize - 1;
    let statusCode = 200;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      start = parseInt(parts[0], 10);
      end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      statusCode = 206;
    }

    const chunksize = end - start + 1;

    const headers = {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunksize,
      "Content-Type": mimeType,
      "Content-Disposition": contentDisposition,
    };

    res.writeHead(statusCode, headers);

    const streamFile = async (attempt = 0) => {
      try {
        const fileStream = fs.createReadStream(filePath, {
          start,
          end,
          highWaterMark: 64 * 1024,
        });

        await pipelineAsync(fileStream, res);
      } catch (error) {
        if (attempt < 2 && !isStreamEnded) {
          // 최대 3번 시도 (초기 + 2번 재시도)
          console.log(`Attempt ${attempt + 1} failed. Retrying...`);
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * Math.pow(2, attempt))
          );
          return streamFile(attempt + 1);
        }
        throw error;
      }
    };

    await streamFile();
  } catch (error) {
    if (!res.headersSent) {
      next(error);
    } else {
      console.error("Streaming error:", error);
      if (!isStreamEnded) {
        res.destroy();
      }
    }
  } finally {
    res.removeListener("close", endListener);
  }
});

// 에러 핸들링 미들웨어
app.use(errorHandler);

app.use(express.static(reactBuildPath));

app.get("*", (req, res) => {
  res.sendFile(path.join(reactBuildPath, "index.html"));
});

portfinder
  .getPortPromise()
  .then(async (emptyPort) => {
    const port = Number(process.env.PORT) || emptyPort;
    app.listen(port, "0.0.0.0", () => {
      log("info", `Server running at http://localhost:${port}`);
    });
  })
  .catch((err) => {
    log("error", `Failed to start server: ${err.message}`);
  });

// 서버 시작 시 즉시 정리 작업 실행
cleanupOldFiles();

// 매일 자정에 파일 정리 작업 실행
const dailyCleanupJob = schedule.scheduleJob("0 0 * * *", cleanupOldFiles);

process.on("SIGINT", () => {
  log("info", "Server is shutting down...");
  dailyCleanupJob.cancel();
  process.exit(0);
});
