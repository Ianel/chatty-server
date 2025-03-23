import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

app.get("/", (req, res) => {
    res.send("Hello World");
});

app.post("/content", async (req, res) => {
    const { prompt } = req.body;
    const result = await model.generateContent(prompt);
    res.send(result.response.text());
});

app.listen(PORT, () => {
    console.log("Server is running on port 3000");
});
