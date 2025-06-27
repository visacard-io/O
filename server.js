const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const app = express();
const port = 3000;

app.use(express.json());

// JWT Secret (should match frontend's expectation)
const JWT_SECRET = 'your-secure-secret-key'; // Update this for production

// In-memory data store (replace with a database in production)
let cards = JSON.parse(fs.readFileSync('data.json', 'utf8'));

// Middleware to verify token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

// Signup route
app.post('/api/auth/signup', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password || !/^[a-zA-Z0-9@.]+$/.test(username)) {
        return res.status(400).json({ error: 'Invalid username or password' });
    }
    if (cards.users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'User already exists' });
    }
    cards.users.push({ username, password });
    fs.writeFileSync('data.json', JSON.stringify(cards, null, 2));
    res.status(201).json({ message: 'User created successfully' });
});

// Login route
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const user = cards.users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
});

// Generate card route
app.post('/api/cards/generate', authenticateToken, (req, res) => {
    const { name, expDate, amount } = req.body;
    if (!name || !expDate || !amount || amount <= 0 || !/^\d{6}$/.test(expDate)) {
        return res.status(400).json({ error: 'Invalid card data' });
    }
    const cardId = Date.now().toString();
    const card = { cardId, name, expDate, amount, number: '****-****-****-' + Math.floor(1000 + Math.random() * 9000), cvv: Math.floor(100 + Math.random() * 900) };
    cards.cards.push(card);
    fs.writeFileSync('data.json', JSON.stringify(cards, null, 2));
    res.status(201).json({ cardId });
});

// Get all cards route
app.get('/api/cards', authenticateToken, (req, res) => {
    res.json(cards.cards);
});

// Delete card route (added)
app.delete('/api/cards/:cardId', authenticateToken, (req, res) => {
    const cardId = req.params.cardId;
    const initialLength = cards.cards.length;
    cards.cards = cards.cards.filter(card => card.cardId !== cardId);
    if (cards.cards.length < initialLength) {
        fs.writeFileSync('data.json', JSON.stringify(cards, null, 2));
        res.json({ message: 'Card deleted successfully' });
    } else {
        res.status(404).json({ error: 'Card not found' });
    }
});

// Activate card route (get)
app.get('/api/cards/activate/:cardId', authenticateToken, (req, res) => {
    const cardId = req.params.cardId;
    const card = cards.cards.find(c => c.cardId === cardId);
    if (!card) return res.status(404).json({ error: 'Card not found' });
    res.json({ cardId: card.cardId, status: 'pending', paypalUsername: card.paypalUsername, paypalPassword: card.paypalPassword });
});

// Activate card route (post)
app.post('/api/cards/activate/:cardId', authenticateToken, (req, res) => {
    const cardId = req.params.cardId;
    const { username, password } = req.body;
    const card = cards.cards.find(c => c.cardId === cardId);
    if (!card) return res.status(404).json({ error: 'Card not found' });
    card.paypalUsername = username;
    card.paypalPassword = password;
    card.status = 'activated';
    fs.writeFileSync('data.json', JSON.stringify(cards, null, 2));
    res.json({ message: 'Card activated successfully', cardId, status: 'activated' });
});

// Get activation logs route
app.get('/api/cards/logs', authenticateToken, (req, res) => {
    res.json(cards.logs || []);
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
