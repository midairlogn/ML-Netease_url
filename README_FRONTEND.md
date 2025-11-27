# New Apple-Style Frontend

This directory contains the new frontend rewritten using React, Vite, and Tailwind CSS, featuring an Apple-inspired design with glassmorphism and smooth animations.

## Prerequisites

- Node.js installed.

## Setup

1. Open a terminal in the `frontend` directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Running Development Server

To run the frontend in development mode (with hot reload):

1. Make sure the Python backend is running in a separate terminal:
   ```bash
   python main.py --mode api
   ```
   (Or just `python main.py` if it defaults to API/GUI. The original code has `--mode api` or `gui`. You likely want `api` mode or ensure the Flask app is running).

2. Start the frontend:
   ```bash
   npm run dev
   ```

3. Open the URL shown (usually `http://localhost:5173`).

## Building for Production

To build the frontend for production:

```bash
npm run build
```

The output will be in `frontend/dist`.

## Features

- **Apple Design Style**: Clean interface, blur effects, smooth transitions.
- **Search**: Search for songs, artists, albums.
- **Player**: Custom music player with progress bar, volume control, and lyrics.
- **Lyrics**: Beautiful full-screen lyrics view with auto-scroll.
- **Downloads**: Download music with ID3 tags (Cover, Artist, Album, Lyrics).
- **Playlists/Albums**: View and play/download entire playlists or albums.
