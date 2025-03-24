import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";
import pkg from "pg";
import { v4 as uuidv4 } from "uuid"; // Pour générer des session_id uniques

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

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

app.get("/", (req, res) => {
    res.send("Hello World");
});

// Nouvelle route pour récupérer l'historique des sessions
app.get("/sessions", async (req, res) => {
    try {
        const query = `
            SELECT session_id, created_at
            FROM sessions
            ORDER BY created_at DESC;
        `;
        const result = await pool.query(query);
        res.send({
            success: true,
            sessions: result.rows,
        });
    } catch (error) {
        console.error("Error fetching sessions:", error);
        res.status(500).send({
            success: false,
            message: "An error occurred while fetching sessions.",
        });
    }
});

// Nouvelle route pour récupérer les messages d'une session
app.get("/sessions/:sessionId/messages", async (req, res) => {
    const { sessionId } = req.params;

    try {
        const query = `
            SELECT sender, message, created_at
            FROM conversations
            WHERE session_id = $1
            ORDER BY created_at ASC;
        `;
        const result = await pool.query(query, [sessionId]);
        res.send({
            success: true,
            messages: result.rows,
        });
    } catch (error) {
        console.error("Error fetching messages:", error);
        res.status(500).send({
            success: false,
            message: "An error occurred while fetching messages.",
        });
    }
});

// Ajuster la route POST /content pour enregistrer les sessions
app.post("/content", async (req, res) => {
    const { prompt, sessionId } = req.body;

    if (!prompt) {
        return res.status(400).send({
            success: false,
            message: "Prompt is required",
        });
    }

    try {
        // Si aucun sessionId n'est fourni, en générer un nouveau
        const session_id = sessionId || uuidv4();

        // Créer une nouvelle session si elle n'existe pas
        if (!sessionId) {
            const insertSessionQuery = `
                INSERT INTO sessions (session_id)
                VALUES ($1)
                ON CONFLICT DO NOTHING;
            `;
            await pool.query(insertSessionQuery, [session_id]);
        }

        // Récupérer l'historique des messages pour cette session
        const historyQuery = `
            SELECT sender, message
            FROM conversations
            WHERE session_id = $1
            ORDER BY created_at ASC;
        `;
        const historyResult = await pool.query(historyQuery, [session_id]);
        const history = historyResult.rows
            .map((row) => `${row.sender}: ${row.message}`)
            .join("\n");

        // Ajouter le nouveau prompt à l'historique
        const fullPrompt = `${history}\nuser: ${prompt}`;

        // Générer la réponse avec l'IA
        const result = await model.generateContent(fullPrompt);
        const generatedText = result.response.text();

        // Enregistrer le prompt et la réponse dans la base de données
        const insertQuery = `
            INSERT INTO conversations (session_id, sender, message, created_at)
            VALUES ($1, $2, $3, NOW()), ($1, $4, $5, NOW());
        `;
        const values = [session_id, "user", prompt, "bot", generatedText];
        await pool.query(insertQuery, values);

        // Retourner la réponse et le sessionId au client
        res.send({
            success: true,
            sessionId: session_id,
            response: generatedText,
        });
    } catch (error) {
        console.error("Error:", error);
        res.status(500).send({
            success: false,
            message: "An error occurred",
        });
    }
});

app.listen(PORT, () => {
    console.log("Server is running on port 3000");
});
