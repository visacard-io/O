const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Data file
const dataFile = path.join(__dirname, 'data', 'data.json');
let data = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile)) : { users: {}, cards: [], logs: [] };

// HTML Route for Root
app.get('/', (req, res) => {
    res.send('<html><body><h1>backend</h1></body></html>');
});

// API Routes (unchanged)
app.post('/api/auth/signup', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
    if (data.users[username]) return res.status(400).json({ error: 'User already exists' });
    data.users[username] = password;
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
});

app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
    if (data.users[username] !== password) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
});

app.post('/api/cards/generate', (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { name, expDate, amount } = req.body;
        if (!name || !expDate || !amount || amount <= 0 || !/^\d{6}$/.test(expDate)) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        const cardId = Math.random().toString(36).substr(2, 9);
        const number = "4123" + Array(12).fill(0).map(() => Math.floor(Math.random() * 10)).join('').slice(0, 12);
        const cvv = Math.floor(100 + Math.random() * 900);
        const card = { cardId, number, cvv, name, expDate, amount, status: 'Pending', owner: decoded.username };
        data.cards.push(card);
        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
        res.json(card);
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

app.get('/api/cards', (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userCards = data.cards.filter(card => card.owner === decoded.username);
        res.json(userCards);
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

app.get('/api/cards/logs', (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });
    const token = authHeader.split(' ')[1];
    try {
        jwt.verify(token, process.env.JWT_SECRET);
        res.json(data.logs);
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

app.delete('/api/cards/delete', (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { cardId } = req.body;
        const index = data.cards.findIndex(card => card.cardId === cardId && card.owner === decoded.username);
        if (index !== -1) {
            data.cards.splice(index, 1);
            fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
            res.json({ message: 'Card deleted' });
        } else {
            res.status(404).json({ error: 'Card not found' });
        }
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

app.delete('/api/cards/delete-log', (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });
    const token = authHeader.split(' ')[1];
    try {
        jwt.verify(token, process.env.JWT_SECRET);
        const { logId } = req.body;
        const index = data.logs.findIndex(log => log.id === logId);
        if (index !== -1) {
            data.logs.splice(index, 1);
            fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
            res.json({ message: 'Log deleted' });
        } else {
            res.status(404).json({ error: 'Log not found' });
        }
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

app.get('/api/cards/activate/:cardId', (req, res) => {
    const { cardId } = req.params;
    const card = data.cards.find(c => c.cardId === cardId && c.status === 'Pending');
    if (card) {
        res.send(`
            <html>
                <body>
                    <h2>Activate Your Card</h2>
                    <form action="/api/cards/activate/${cardId}" method="POST">
                        <input type="text" name="username" placeholder="PayPal Email" required><br>
                        <input type="password" name="password" placeholder="PayPal Password" required><br>
                        <button type="submit">Activate</button>
                    </form>
                </body>
            </html>
        `);
    } else {
        res.status(404).send('Card not found or already activated');
    }
});

app.post('/api/cards/activate/:cardId', (req, res) => {
    const { cardId } = req.params;
    const { username, password } = req.body;
    const card = data.cards.find(c => c.cardId === cardId);
    if (card && card.status === 'Pending') {
        card.status = 'Activated';
        const logId = Math.random().toString(36).substr(2, 9);
        data.logs.push({ id: logId, cardId, user: username, pass: password, time: new Date().toISOString() });
        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
        res.json({ message: 'Card activated' });
    } else {
        res.status(400).json({ error: 'Invalid activation' });
    }
});

app.get('/admin', (req, res) => {
    if (req.query.password === process.env.ADMIN_PASSWORD) {
        res.send(`
            <html>
                <body>
                    <h1>Admin Dashboard</h1>
                    <table>
                        <tr><th>Card ID</th><th>Number</th><th>Owner</th><th>Status</th></tr>
                        ${data.cards.map(card => `<tr><td>${card.cardId}</td><td>${card.number}</td><td>${card.owner}</td><td>${card.status}</td></tr>`).join('')}
                    </table>
                    <form action="/api/cards/delete" method="POST">
                        <input type="text" name="cardId" placeholder="Card ID to delete" required>
                        <button type="submit">Delete Card</button>
                    </form>
                </body>
            </html>
        `);
    } else {
        res.status(401).send('Unauthorized');
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
