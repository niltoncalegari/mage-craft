import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { signAccessToken } from '../middleware/auth.js';
import { User } from '../models/User.js';

export const authRouter = Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_ROUNDS = 10;

authRouter.post('/register', async (req, res) => {
  const { username, email, password } = req.body as Record<string, unknown>;

  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    res.status(400).json({ error: 'username must be 3-20 alphanumeric/underscore characters' });
    return;
  }
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'email is invalid' });
    return;
  }
  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'password must be at least 8 characters' });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await User.findOne({ $or: [{ email: normalizedEmail }, { username }] });
  if (existing) {
    res.status(409).json({ error: 'username or email already in use' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await User.create({ username, email: normalizedEmail, passwordHash });

  const token = signAccessToken(user._id.toString());
  res.status(201).json({ token, user: { id: user._id.toString(), username: user.username } });
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body as Record<string, unknown>;
  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user) {
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }

  const token = signAccessToken(user._id.toString());
  res.status(200).json({ token, user: { id: user._id.toString(), username: user.username } });
});
