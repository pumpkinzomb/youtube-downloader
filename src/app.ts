import dotenv from "dotenv";
dotenv.config(); // .env 파일 로드
import express from "express";
import fs, { createReadStream } from "fs";
import portfinder from "portfinder";
import mime from "mime-types";
import path from "path";
import cors from "cors";
import schedule from "node-schedule";
import { downloadVideo, cleanupOldFiles } from "./utils";
import log from "./logger";

const app = express();
const downloadDir = path.join(__dirname, "downloads");

// React 빌드 파일 경로 설정
const reactBuildPath = path.join(__dirname, "../frontend", "build");

// Ensure download directory exists
if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir, { recursive: true });
  log("info", "Default Downloads directory created");
}

app.use(express.static(reactBuildPath));
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
app.get("/api/stream/:fileName", (req, res) => {
  const fileName = decodeURIComponent(req.params.fileName);
  const filePath = path.join(downloadDir, fileName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  // MIME 타입 결정
  const mimeType = mime.lookup(filePath) || "application/octet-stream";

  // 파일 이름 인코딩
  const encodedFileName = encodeURIComponent(fileName).replace(
    /['()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16)
  );
  const contentDisposition = `attachment; filename*=UTF-8''${encodedFileName}`;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const file = createReadStream(filePath, { start, end });
    const head = {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunksize,
      "Content-Type": mimeType,
      "Content-Disposition": contentDisposition,
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      "Content-Length": fileSize,
      "Content-Type": mimeType,
      "Content-Disposition": contentDisposition,
    };
    res.writeHead(200, head);
    createReadStream(filePath).pipe(res);
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(reactBuildPath, "index.html"));
});

portfinder
  .getPortPromise()
  .then(async (emptyPort) => {
    const port = process.env.PORT || emptyPort;
    app.listen(port, () => {
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
