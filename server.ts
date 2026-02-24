import express from "express";
import { createServer as createViteServer } from "vite";
import { Server } from "socket.io";
import { createServer } from "http";

async function startServer() {
  const app = express();
  const PORT = 3000;
  const httpServer = createServer(app);
  
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Store room state
  const rooms = new Map<string, {
    users: Map<string, { id: string, name: string, color: 'w' | 'b' }>,
    fen: string
  }>();

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join-room", ({ roomId, userName }) => {
      socket.join(roomId);
      
      if (!rooms.has(roomId)) {
        rooms.set(roomId, { users: new Map(), fen: 'start' });
      }
      
      const room = rooms.get(roomId)!;
      
      // Assign color
      let color: 'w' | 'b' = 'w';
      if (room.users.size === 1) {
        const existingUser = Array.from(room.users.values())[0];
        color = existingUser.color === 'w' ? 'b' : 'w';
      } else if (room.users.size > 1) {
        // Spectator or just default to white for now
        color = 'w';
      }

      const user = { id: socket.id, name: userName, color };
      room.users.set(socket.id, user);

      // Send current state to the joining user
      socket.emit("room-state", {
        users: Array.from(room.users.values()),
        fen: room.fen,
        myColor: color
      });

      // Notify others
      socket.to(roomId).emit("user-joined", user);

      // WebRTC Signaling
      socket.on("offer", ({ targetId, offer }) => {
        socket.to(targetId).emit("offer", { senderId: socket.id, offer });
      });

      socket.on("answer", ({ targetId, answer }) => {
        socket.to(targetId).emit("answer", { senderId: socket.id, answer });
      });

      socket.on("ice-candidate", ({ targetId, candidate }) => {
        socket.to(targetId).emit("ice-candidate", { senderId: socket.id, candidate });
      });

      // Chat
      socket.on("chat-message", (message) => {
        io.to(roomId).emit("chat-message", {
          id: Date.now().toString(),
          senderId: socket.id,
          senderName: userName,
          text: message,
          timestamp: Date.now()
        });
      });

      // Chess
      socket.on("chess-move", (fen) => {
        room.fen = fen;
        socket.to(roomId).emit("chess-move", fen);
      });

      socket.on("reset-game", () => {
        room.fen = 'start';
        io.to(roomId).emit("reset-game");
      });

      socket.on("disconnect", () => {
        room.users.delete(socket.id);
        if (room.users.size === 0) {
          rooms.delete(roomId);
        } else {
          socket.to(roomId).emit("user-left", socket.id);
        }
      });
    });
  });

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
