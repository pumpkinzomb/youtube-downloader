import React, { useState } from "react";
import {
  TextField,
  Button,
  Typography,
  Box,
  Card,
  CardMedia,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Stack,
} from "@mui/material";
import axios from "axios";
import { ReactComponent as Logo } from "../assets/YouTubeDownloaderLogo.svg";

const validFormats = [
  "mp4",
  "webm",
  "flv",
  "ogg",
  "mkv",
  "mp3",
  "m4a",
  "wav",
  "aac",
];

const YouTubeDownloader: React.FC = () => {
  const [url, setUrl] = useState("");
  const [thumbnail, setThumbnail] = useState("");
  const [format, setFormat] = useState("mp4");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [downloadLink, setDownloadLink] = useState("");

  const getDownloadUrl = async (url: string, format: string) => {
    const response = await axios.post(
      `${process.env.REACT_APP_API_ENDPOINT}/download`,
      {
        url,
        format,
      }
    );
    return response.data;
  };

  const extractVideoId = (url: string) => {
    const urlObj = new URL(url);
    return urlObj.searchParams.get("v");
  };

  const isValidYouTubeUrl = (url: string): boolean => {
    try {
      const urlObj = new URL(url);
      return (
        (urlObj.hostname === "www.youtube.com" ||
          urlObj.hostname === "youtube.com") &&
        urlObj.pathname === "/watch" &&
        urlObj.searchParams.has("v")
      );
    } catch (error) {
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    setDownloadLink("");

    if (!isValidYouTubeUrl(url)) {
      setError("Invalid YouTube URL. Please enter a valid YouTube video URL.");
      setIsLoading(false);
      return;
    }

    const videoId = extractVideoId(url);
    setThumbnail(videoId ? `https://img.youtube.com/vi/${videoId}/0.jpg` : "");

    try {
      const { downloadUrl } = await getDownloadUrl(url, format);
      setDownloadLink(downloadUrl);
    } catch (err) {
      setError("An error occurred while processing your request.");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Stack
      sx={{
        width: "100vw",
        height: "100vh",
        padding: 2,
      }}
      justifyContent={"center"}
      alignItems={"center"}
    >
      <Box sx={{ maxWidth: "400px", width: "100%" }}>
        <Logo
          style={{ maxWidth: "400px", width: "100%", marginBottom: "20px" }}
        />
        <form onSubmit={handleSubmit}>
          <Stack flexDirection={"row"} gap={1}>
            <TextField
              fullWidth
              label="YouTube URL"
              variant="outlined"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              margin="normal"
              sx={{
                maxWidth: "400px",
                minWidth: "280px",
                width: "100%",
              }}
            />
            <FormControl fullWidth margin="normal">
              <InputLabel>Format</InputLabel>
              <Select
                value={format}
                label="Format"
                onChange={(e) => setFormat(e.target.value)}
              >
                {validFormats.map((fmt) => (
                  <MenuItem key={fmt} value={fmt}>
                    {fmt}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={isLoading}
            sx={{
              mt: 1,
              height: "60px",
              backgroundColor: "#000000",
              fontWeight: "700",
              fontSize: "16px",
            }}
          >
            {isLoading ? "Processing..." : "Download"}
          </Button>
        </form>
        <Stack
          flexDirection={"row"}
          gap={2}
          alignItems={"center"}
          sx={{ marginTop: 2 }}
        >
          {thumbnail && (
            <Card sx={{ m: "auto", width: "320px" }}>
              <CardMedia component="img" image={thumbnail} />
            </Card>
          )}
          {downloadLink && (
            <Button
              href={downloadLink}
              variant="contained"
              color="secondary"
              fullWidth
              sx={{
                height: "60px",
                backgroundColor: "#000000",
                fontWeight: "700",
                fontSize: "16px",
              }}
            >
              {`Download ${format}`}
            </Button>
          )}
        </Stack>
        {error && (
          <Typography color="error" sx={{ mt: 2, textAlign: "center" }}>
            {error}
          </Typography>
        )}
      </Box>
    </Stack>
  );
};

export default YouTubeDownloader;
