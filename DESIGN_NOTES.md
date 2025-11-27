# ML Netease Music - Aura-Inspired Dark Theme

## 🎨 Design Inspiration

This redesign draws inspiration from **Aura Music** (https://dingyi222666.github.io/aura-music/) while maintaining a unique identity:

### Key Design Elements Implemented:

1. **Dynamic Animated Background**
   - Multiple animated gradient blobs (purple, pink, blue, orange)
   - Smooth, organic movement with different animation speeds
   - Pulsing glow effects for depth
   - Noise texture overlay for subtle detail

2. **Dark Theme**
   - Pure black background (#000000)
   - White text for maximum contrast
   - Glassmorphism effects with `backdrop-blur`
   - Semi-transparent cards with subtle borders

3. **Gradient Accents**
   - Purple-to-pink gradients for primary actions
   - Gradient text for branding
   - Glowing button shadows
   - Dynamic progress bars with gradients

4. **Floating Animations**
   - Lyrics have gentle floating animation
   - Staggered animation delays for organic feel
   - Smooth transitions between states

5. **Interactive Hover Effects**
   - Album covers scale and show play buttons
   - Song items highlight with gradients
   - Buttons have smooth scale transforms

## 🆕 What's Different from Aura Music

While inspired by Aura, we've created our own unique design:

- **Different color palette**: Purple/Pink/Blue vs Aura's specific gradients
- **Different layout**: Multi-tab interface vs single-page
- **Enhanced player controls**: More visual feedback and controls
- **Unique blob animations**: Custom keyframes and timing
- **Our own typography**: System fonts with enhanced weights
- **Additional features**: Search, Playlists, Albums (not just file upload)

## 🎯 Features

### Visual Design
- ✨ Animated gradient background with 4 moving blobs
- 🌙 Dark theme with glassmorphism
- 🎨 Purple/Pink gradient accents throughout
- ⚡ Smooth transitions and micro-animations
- 🎵 Floating lyrics with gradient active states

### Functionality
- 🔍 **Search**: Find songs by keywords
- 📝 **Playlists**: Browse and play entire playlists
- 💿 **Albums**: Explore album collections
- ▶️ **Music Player**: Full-featured player with progress control
- 📜 **Lyrics View**: Immersive full-screen lyrics with auto-scroll
- ⬇️ **Downloads**: One-click download with ID3 tags

## 🚀 Running the Application

1. **Start Backend**:
   ```bash
   python main.py --mode api
   ```

2. **Start Frontend**:
   ```bash
   cd frontend
   npm run dev
   ```

3. Open `http://localhost:5173` in your browser

## 🎬 Animation Details

### Background Blobs
- **Blob 1** (Purple): 20s duration, standard movement
- **Blob 2** (Pink): 25s reverse movement with rotation
- **Blob 3** (Blue): 20s duration, delayed start (4s)
- **Blob 4** (Orange): 25s reverse movement, delayed start (6s)

### Lyrics Animations
- **Float**: 3s ease-in-out infinite
- **Scale**: Active lyric scales to 110%
- **Gradient**: Active lyric uses purple-pink gradient
- **Stagger**: Each line has different animation delay

### UI Micro-interactions
- **Hover Scale**: Images scale to 110% on hover
- **Button Press**: Active scale to 95%
- **Tab Switch**: Spring animation with 0.6s duration
- **Page Transitions**: 0.4s opacity + Y-axis fade

## 📱 Responsive Design

The design is fully responsive and works on:
- Desktop (optimal experience)
- Tablets (adjusted layouts)
- Mobile (stacked components)

## 🎨 Color Palette

```css
/* Primary Gradients */
--gradient-primary: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
--gradient-accent: linear-gradient(to right, #8b5cf6, #ec4899);

/* Background Blobs */
--blob-purple: rgba(139, 92, 246, 0.8)
--blob-pink: rgba(236, 72, 153, 0.8)
--blob-blue: rgba(59, 130, 246, 0.8)
--blob-orange: rgba(249, 115, 22, 0.7)

/* UI Elements */
--glass-bg: rgba(30, 30, 30, 0.6)
--border: rgba(255, 255, 255, 0.1)
```

## 🔧 Technology Stack

- **React 19** - UI Framework
- **Vite** - Build tool
- **Tailwind CSS 3** - Styling
- **Framer Motion** - Animations
- **Lucide React** - Icons
- **Axios** - API calls
- **browser-id3-writer** - ID3 tag support

## 📝 Development Notes

- All animations use CSS keyframes for performance
- Glassmorphism uses `backdrop-filter: blur()`
- Gradient text uses `-webkit-background-clip`
- Custom scrollbar styling for dark theme
- Noise texture via SVG data URI

---

Built with ❤️ inspired by Aura Music's beautiful design philosophy
