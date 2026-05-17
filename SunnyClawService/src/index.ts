import express from 'express'
import cors from 'cors'
import chatRouter from './routes/chat.js'
import { resolveChatModel } from './services/ollama.js'

const app = express()
const PORT = 3000
const HOST = '127.0.0.1'

app.use(cors())
app.use(express.json({ limit: '15mb' }))

app.get('/api/health', async (_req, res) => {
  const ollamaModel = await resolveChatModel()
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    ollamaBase: process.env.OLLAMA_BASE || 'http://127.0.0.1:11434',
    ollamaModel,
    ollamaModelPreferred: process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct'
  })
})

app.use('/api', chatRouter)

app.listen(PORT, HOST, () => {
  console.log(`SunnyClaw service running at http://${HOST}:${PORT}`)
})
