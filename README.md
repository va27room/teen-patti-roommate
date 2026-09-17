# Teen Patti Roommate — Production Build

A real-time multiplayer Teen Patti (Indian poker) game built with React, Vite, Express, and Socket.IO. Play privately with your roommates using virtual chips.

## Features

- **2–8 players** per private room
- **Virtual chips only** (no real money)
- **Real-time gameplay** via Socket.IO
- **Teen Patti hand rankings**: Dunka/Trail, Pure Sequence, Normal Sequence, Custom Sequence, Color, Pair, High Card
- **Game features**:
  - ₹5 ante at the start of each round
  - See Cards option
  - Custom blind/seen betting (₹1–₹3× base blind)
  - Drop to exit the round
  - Side Show (₹2 fee, 40 seconds) to compare cards with left player
  - Automatic winner when one player remains
  - Rebuy/add virtual chips mid-game
- **Responsive UI** optimized for mobile and desktop

## Architecture

This is a single Node.js web service:

- **Frontend**: React + Vite (compiled to static files)
- **Backend**: Express.js + Socket.IO
- **Deployment**: Runs as one service; Express serves the React frontend and the Socket.IO server handles multiplayer

### Project Structure

```
teen-patti-roommate/
├── client/                 # React/Vite frontend
│   ├── src/
│   │   ├── index.html
│   │   ├── src.jsx
│   │   └── style.css
│   ├── package.json
│   └── vite.config.js
├── server/                 # Express + Socket.IO backend
│   ├── src/
│   │   └── src.js
│   └── package.json
├── package.json            # Root package for orchestration
├── render.yaml             # Render deployment config
└── README.md
```

## Local Development

### Prerequisites

- Node.js 20+ and npm

### Installation & Running

```bash
# Install and build everything
npm run build

# Start the production server
npm start
```

The server will run on `http://localhost:3001` (or the PORT environment variable).

### For Development (with hot reload)

```bash
# Terminal 1: Start the Vite dev server
cd client
npm install
npm run dev

# Terminal 2: Start the Socket.IO server
cd server
npm install
node src.js

# Then open http://localhost:5173 (or your Vite port)
```

When using the Vite dev server locally, update `client/src.jsx` to connect to the correct backend:

```javascript
const socket = io('http://localhost:3001');
```

## Deployment on Render

### Step-by-Step Setup

1. **Push this repository to GitHub** (ensure it's at the repository root, not nested).

2. **Create a Web Service on Render**:
   - Go to [render.com](https://render.com)
   - Click **New → Web Service**
   - Select this GitHub repository
   - Fill in the settings:
     - **Name**: `teen-patti-roommate`
     - **Runtime**: Node
     - **Root Directory**: (leave empty)
     - **Build Command**: `npm run build`
     - **Start Command**: `npm start`
     - **Environment**: Node 20
     - **Plan**: Free or Paid (your choice)

3. **Environment Variables** (if needed):
   - `NODE_VERSION`: `20` (usually set automatically)
   - `ALLOWED_ORIGIN`: (Leave empty or set to your Render URL for CORS if frontend/server are ever separated)

4. **Deploy**:
   - Click **Create Web Service**
   - Render will automatically build and deploy
   - Once running, you'll get a public HTTPS URL (e.g., `https://teen-patti-roommate.onrender.com`)

5. **Access the Game**:
   - Open the URL on your phone or browser
   - Share the URL privately with friends
   - Create or join a room via the code system

### Important Notes for Production

- **In-Memory Rooms**: Rooms and games are stored in memory. When the service restarts, all active games are lost. Reconnect tokens recover a player only while that service instance remains running.
- **CORS**: If you later split the frontend and backend into separate services, set `ALLOWED_ORIGIN` environment variable to the exact frontend origin.
- **Rate Limiting & Security**: Before public use, add:
  - Room password protection or session tokens
  - Rate limiting on room creation and betting
  - Input validation & sanitization
- **Virtual Chips Only**: This build includes no payment system and is for recreational use only.
- **Free Tier Limitations**: Render's free tier will spin down after 15 minutes of inactivity. Upgrade to Paid for always-on service.

## Game Rules

### Objective
Win chips from other players by having the best three-card hand or by convincing them to drop.

### Hand Ranking (Highest to Lowest)
1. **Dunka / Trail / Trio** (3 cards of same rank)
2. **Pure Sequence** (consecutive ranks, all same suit)
3. **Normal Sequence** (consecutive ranks, all suits different)
4. **Custom Sequence** (consecutive ranks, exactly two suits alike)
5. **Color / Flush** (all same suit but not consecutive)
6. **Pair** (2 cards of same rank)
7. **High Card** (Three unrelated cards, ranked by highest card)

### Game Flow
1. Each player antes ₹5
2. The host starts the round; players take turns
3. On your turn, you can:
   - **See Cards**: Pay 1× the blind to look at your cards
   - **Bet**: Wager ₹1–₹3× base blind (or custom if blind is lower)
   - **Drop**: Forfeit the round
   - **Side Show**: Challenge the left player to compare cards privately (₹2 fee, both must be seen)
4. Round ends when only one player remains or all but one have folded
5. Final comparison determines the winner; winner takes the pot
6. Rebuy virtual chips and play again

## Development & Contributing

- Frontend code: `client/src.jsx` (React), `client/src.css` (styling)
- Backend code: `server/src.js` (Express + Socket.IO + game logic)
- Game logic: Hand evaluation, betting, sideshow timer, player elimination
- Socket events: `createRoom`, `joinRoom`, `startGame`, `bet`, `drop`, `seeCards`, `requestSideShow`, `respondSideShow`, `rebuy`

## License

This project is private. 

## Support & Troubleshooting

**Game won't load:**
- Check that `npm run build` completed without errors
- Verify `npm start` is running on the correct port
- Check browser console for Socket.IO connection errors

**Socket.IO connection fails:**
- Ensure backend is running (`npm start`)
- Check ALLOWED_ORIGIN environment variable on production
- Verify no firewall is blocking WebSocket connections

**Players disconnect unexpectedly:**
- Free tier Render instances spin down after 15 minutes of inactivity
- Upgrade to paid plan for always-on service

---

**Made with ♠ for Teen Patti enthusiasts.**
