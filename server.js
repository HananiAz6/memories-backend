const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const Photo = require('./models/Photo');
const User = require('./models/User');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch((err) => console.error('❌ MongoDB Connection Error:', err));

// ---------- helpers ----------
const publicUser = (u) => ({ id: u._id.toString(), name: u.name, email: u.email, avatar: u.avatar });
const signToken = (u) =>
  jwt.sign({ id: u._id.toString(), name: u.name }, process.env.JWT_SECRET, { expiresIn: '7d' });
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please log in' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

// A user sees a photo if they uploaded it or it was shared with them
const visibleTo = (id) => ({ $or: [{ uploaderId: id }, { sharedWith: id }] });

// ---------- health ----------
app.get('/api/health', (req, res) => res.json({ status: 'OK' }));

// ---------- auth ----------
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6)
    return res.status(400).json({ error: 'Name, email and a password of 6+ characters are required' });

  const exists = await User.findOne({ $or: [{ email: email.toLowerCase().trim() }, { name: name.trim() }] });
  if (exists) return res.status(409).json({ error: 'Name or email already in use' });

  const user = await User.create({
    name: name.trim(),
    email,
    passwordHash: await bcrypt.hash(password, 10)
  });
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: (email || '').toLowerCase().trim() });
  if (!user || !(await bcrypt.compare(password || '', user.passwordHash)))
    return res.status(401).json({ error: 'Wrong email or password' });
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.get('/api/auth/me', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(401).json({ error: 'User no longer exists' });
  res.json(publicUser(user));
});

// Friends list (everyone else who has an account)
app.get('/api/users', auth, async (req, res) => {
  const users = await User.find({ _id: { $ne: req.user.id } }).select('name email avatar').sort({ name: 1 });
  res.json(users.map(publicUser));
});

// ---------- photos ----------
app.get('/api/photos', auth, async (req, res) => {
  res.json(await Photo.find(visibleTo(req.user.id)).sort({ createdAt: -1 }));
});

app.post('/api/photos', auth, async (req, res) => {
  const { title, description, photoData, tags } = req.body;
  const photo = await Photo.create({
    title, description, photoData, tags,
    uploadedBy: req.user.name,
    uploaderId: req.user.id
  });
  res.status(201).json(photo);
});

// Search & filter (bonus): ?q=&uploader=&tag=&from=&to=
app.get('/api/photos/search', auth, async (req, res) => {
  const { q, uploader, tag, from, to } = req.query;
  const filter = { $and: [visibleTo(req.user.id)] };
  if (q) {
    const rx = { $regex: esc(q), $options: 'i' };
    filter.$and.push({ $or: [{ title: rx }, { description: rx }, { tags: rx }, { 'comments.text': rx }] });
  }
  if (uploader) filter.$and.push({ uploadedBy: { $regex: esc(uploader), $options: 'i' } });
  if (tag) filter.$and.push({ tags: tag });
  if (from || to) {
    const range = {};
    if (from) range.$gte = new Date(from);
    if (to) range.$lte = new Date(to);
    filter.$and.push({ createdAt: range });
  }
  res.json(await Photo.find(filter).sort({ createdAt: -1 }));
});

// Like / unlike (atomic, safe under concurrent users)
app.post('/api/photos/:id/like', auth, async (req, res) => {
  const me = req.user.id;
  const scope = { _id: req.params.id, ...visibleTo(me) };
  let photo = await Photo.findOneAndUpdate(
    { ...scope, likedBy: { $ne: me } }, { $addToSet: { likedBy: me } }, { new: true });
  if (!photo) photo = await Photo.findOneAndUpdate(scope, { $pull: { likedBy: me } }, { new: true });
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  res.json(photo);
});

// Comment (atomic push)
app.post('/api/photos/:id/comment', auth, async (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Comment cannot be empty' });
  const photo = await Photo.findOneAndUpdate(
    { _id: req.params.id, ...visibleTo(req.user.id) },
    { $push: { comments: { userId: req.user.id, username: req.user.name, text } } },
    { new: true }
  );
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  res.json(photo);
});

// Share with friends (owner only)
app.post('/api/photos/:id/share', auth, async (req, res) => {
  const ids = [...new Set(req.body.userIds || [])].filter((id) => id !== req.user.id);
  const friends = await User.find({ _id: { $in: ids } }).select('_id');
  const photo = await Photo.findOneAndUpdate(
    { _id: req.params.id, uploaderId: req.user.id },
    { $addToSet: { sharedWith: { $each: friends.map((f) => f._id.toString()) } } },
    { new: true }
  );
  if (!photo) return res.status(404).json({ error: 'Photo not found (only the owner can share)' });
  res.json(photo);
});

// Update a memory (Owner only)
app.put('/api/photos/:id', auth, async (req, res) => {
  try {
    // Only allow updates if the user is the uploader
    const photo = await Photo.findOne({ _id: req.params.id, uploaderId: req.user.id });
    if (!photo) return res.status(404).json({ error: 'Photo not found or unauthorized to edit' });

    // Update allowed fields
    const { title, description, location, country, tags, travelStyle } = req.body;
    if (title !== undefined) photo.title = title;
    if (description !== undefined) photo.description = description;
    if (location !== undefined) photo.location = location;
    if (country !== undefined) photo.country = country;
    if (tags !== undefined) photo.tags = tags;
    if (travelStyle !== undefined) photo.travelStyle = travelStyle;

    await photo.save();
    res.json(photo);
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ error: 'Failed to update memory' });
  }
});

// Delete a memory (Owner only)
app.delete('/api/photos/:id', auth, async (req, res) => {
  try {
    // Find and delete in one step, ensuring only the owner can delete
    const photo = await Photo.findOneAndDelete({ _id: req.params.id, uploaderId: req.user.id });
    if (!photo) return res.status(404).json({ error: 'Photo not found or unauthorized to delete' });
    
    res.json({ message: 'Memory deleted successfully', id: req.params.id });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete memory' });
  }
});

// JSON error handler
app.use((err, req, res, next) => {
  res.status(err.name === 'ValidationError' ? 400 : 500).json({ error: err.message });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));