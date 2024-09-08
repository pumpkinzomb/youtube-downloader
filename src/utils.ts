import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { differenceInHours, parseISO } from "date-fns";
import { promisify } from "util";
import log from "./logger";

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);

const downloadDir = path.join(__dirname, "downloads");
const metadataFile = path.join(downloadDir, ".metadata.json");
const validVideoFormats = ["mp4", "webm", "flv", "ogg", "mkv"];
const validAudioFormats = ["mp3", "m4a", "wav", "aac"];
const validFormats = [...validVideoFormats, ...validAudioFormats];

interface FileMetadata {
  [filename: string]: string; // ISO 8601 date string
}

// 메타데이터 파일 읽기
export async function readMetadata(): Promise<FileMetadata> {
  try {
    const data = await readFile(metadataFile, "utf8");
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

// 메타데이터 파일 쓰기
export async function writeMetadata(metadata: FileMetadata): Promise<void> {
  await writeFile(metadataFile, JSON.stringify(metadata, null, 2));
}

export async function cleanupOldFiles() {
  try {
    log("info", "Starting cleanup of old files...");
    const files = await readdir(downloadDir);
    const now = new Date();
    let deletedCount = 0;
    const metadata = await readMetadata();

    for (const file of files) {
      if (file === ".metadata.json") continue; // 메타데이터 파일 무시

      const filePath = path.join(downloadDir, file);
      const stats = await stat(filePath);
      const fileModTime = metadata[file]
        ? parseISO(metadata[file])
        : stats.mtime;
      const hoursDifference = differenceInHours(now, fileModTime);

      if (hoursDifference >= 24) {
        await unlink(filePath);
        delete metadata[file];
        deletedCount++;
        log("info", `Deleted old file: ${file}`);
      }
    }

    await writeMetadata(metadata);
    log("info", `Cleanup completed. Deleted ${deletedCount} file(s).`);
  } catch (error) {
    log("error", `Error cleaning up old files: ${error}`);
  }
}

export async function downloadVideo(
  url: string,
  format: string
): Promise<string> {
  const lowerFormat = format.toLowerCase();
  if (!validFormats.includes(lowerFormat)) {
    throw new Error(
      `Invalid format: ${format}. Supported formats are: ${validFormats.join(
        ", "
      )}`
    );
  }

  const outputTemplate = path.join(downloadDir, "%(title)s.%(ext)s");
  let formatOption: string[];

  if (validAudioFormats.includes(lowerFormat)) {
    formatOption = ["-x", `--audio-format`, lowerFormat];
  } else {
    formatOption = [
      "-f",
      "bestvideo+bestaudio",
      `--merge-output-format`,
      lowerFormat,
    ];
  }

  const userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";

  const args = [
    ...formatOption,
    "--user-agent",
    userAgent,
    "-o",
    outputTemplate,
    "--no-overwrites",
    "--no-playlist", // 이 옵션을 추가하여 단일 비디오만 다운로드
    url,
  ];

  return new Promise((resolve, reject) => {
    const ytDlp = spawn("yt-dlp", args);
    let fileName: string | null = null;

    ytDlp.stdout.on("data", (data) => {
      const output = data.toString();
      // console.log(output);

      // Extract filename
      const audioExtractionRegex = /\[ExtractAudio\] Destination: (.+)/;
      const mergeRegex = /\[Merger\] Merging formats into "(.+)"/;
      const downloadRegex = /\[download\] Destination: (.+)/;
      const alreadyDownloadedRegex =
        /\[download\] (.+) has already been downloaded/;

      const audioMatch = output.match(audioExtractionRegex);
      const mergeMatch = output.match(mergeRegex);
      const downloadMatch = output.match(downloadRegex);
      const alreadyDownloadedMatch = output.match(alreadyDownloadedRegex);

      if (audioMatch && audioMatch[1]) {
        fileName = path.basename(audioMatch[1]);
      } else if (mergeMatch && mergeMatch[1]) {
        fileName = path.basename(mergeMatch[1]);
      } else if (downloadMatch && downloadMatch[1]) {
        fileName = path.basename(downloadMatch[1]);
      } else if (alreadyDownloadedMatch && alreadyDownloadedMatch[1]) {
        fileName = path.basename(alreadyDownloadedMatch[1]);
      }
    });

    ytDlp.stderr.on("data", (data) => {
      log("error", `yt-dlp stderr: ${data}`);
    });

    ytDlp.on("close", async (code) => {
      if (code === 0 && fileName) {
        const metadata = await readMetadata();
        metadata[fileName] = new Date().toISOString();
        await writeMetadata(metadata);
        resolve(fileName);
      } else {
        reject(new Error(`yt-dlp process exited with code ${code}`));
      }
    });
  });
}
