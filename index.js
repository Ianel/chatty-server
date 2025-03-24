import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";
import pkg from "pg";
import { v4 as uuidv4 } from "uuid";

const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

app.use(cors());
app.use(bodyParser.json());
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*"); // Ou spécifie ton domaine
    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
    );
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
    );
    res.setHeader("Access-Control-Allow-Credentials", "true"); // Si besoin
    next();
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

app.get("/", (req, res) => {
    res.send("Hello World");
});

// Récupérer l'historique des sessions
app.get("/sessions", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT session_id, created_at FROM sessions ORDER BY created_at DESC;"
        );
        res.send({ success: true, sessions: result.rows });
    } catch (error) {
        console.error("Erreur lors de la récupération des sessions:", error);
        res.status(500).send({
            success: false,
            message: `Erreur serveur: ${error}`,
        });
    }
});

// Récupérer les messages d'une session
app.get("/sessions/:sessionId/messages", async (req, res) => {
    const { sessionId } = req.params;

    try {
        const result = await pool.query(
            "SELECT sender, message, created_at FROM conversations WHERE session_id = $1 ORDER BY created_at ASC;",
            [sessionId]
        );
        res.send({ success: true, messages: result.rows });
    } catch (error) {
        console.error("Erreur lors de la récupération des messages:", error);
        res.status(500).send({
            success: false,
            message: `Erreur serveur: ${error}`,
        });
    }
});

// Gérer les messages et stocker les sessions
app.post("/content", async (req, res) => {
    const { prompt, sessionId } = req.body;

    if (!prompt || typeof prompt !== "string") {
        return res
            .status(400)
            .send({ success: false, message: "Prompt invalide" });
    }

    try {
        const session_id = sessionId || uuidv4();

        if (!sessionId) {
            await pool.query(
                "INSERT INTO sessions (session_id, created_at) VALUES ($1, NOW()) ON CONFLICT DO NOTHING;",
                [session_id]
            );
        }

        const historyResult = await pool.query(
            "SELECT sender, message FROM conversations WHERE session_id = $1 ORDER BY created_at ASC;",
            [session_id]
        );

        const history = historyResult.rows
            .map((row) => `${row.sender}: ${row.message}`)
            .join("\n");

        const fullPrompt = `${history}\nuser: ${prompt}`;

        console.log("Envoi à l'IA:", fullPrompt);

        const result = await model.generateContent(fullPrompt);
        const generatedText = await result.response.text();

        await pool.query(
            `INSERT INTO conversations (session_id, sender, message, created_at) 
             VALUES ($1, $2, $3, NOW()), ($1, $4, $5, NOW());`,
            [session_id, "user", prompt, "bot", generatedText]
        );

        res.send({
            success: true,
            sessionId: session_id,
            response: generatedText,
        });
    } catch (error) {
        console.error("Erreur lors du traitement du message:", error);
        res.status(500).send({
            success: false,
            message: `Erreur serveur: ${error}`,
        });
    }
});

app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});
