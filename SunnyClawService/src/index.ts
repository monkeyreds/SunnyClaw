import express from 'express'
import cors from 'cors'

const app = express()
const PORT = 3000
const HOST = '127.0.0.1'

app.use(cors())
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.listen(PORT, HOST, () => {
  console.log(`SunnyClaw service running at http://${HOST}:${PORT}`)
})
