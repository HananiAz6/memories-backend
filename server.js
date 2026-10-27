const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const Photo = require('./models/Photo');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' })); // Allows Base64 image payload handling

// Connect to MongoDB Atlas
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch((err) => console.error('❌ MongoDB Connection Error:', err));

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Backend is running smoothly!' });
});

// 1. Fetch All Photos
app.get('/api/photos', async (req, res) => {
  try {
    const photos = await Photo.find().sort({ createdAt: -1 });
    res.json(photos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Upload / Create a Photo
app.post('/api/photos', async (req, res) => {
  try {
    const { title, description, photoData, uploadedBy, tags } = req.body;
    const newPhoto = new Photo({ title, description, photoData, uploadedBy, tags });
    await newPhoto.save();
    res.status(201).json(newPhoto);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 3. Like a Photo
app.post('/api/photos/:id/like', async (req, res) => {
  try {
    const photo = await Photo.findById(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    
    photo.likes += 1;
    await photo.save();
    res.json(photo);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 4. Add Comment to a Photo
app.post('/api/photos/:id/comment', async (req, res) => {
  try {
    const { username, text } = req.body;
    const photo = await Photo.findById(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });

    photo.comments.push({ username, text });
    await photo.save();
    res.json(photo);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 5. Search & Filter Photos (Bonus Feature Requirement)
app.get('/api/photos/search', async (req, res) => {
  try {
    const { q, uploader, tag } = req.query;
    let queryFilter = {};

    if (q) {
      queryFilter.$or = [
        { title: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } }
      ];
    }
    if (uploader) queryFilter.uploadedBy = { $regex: uploader, $options: 'i' };
    if (tag) queryFilter.tags = tag;

    const results = await Photo.find(queryFilter).sort({ createdAt: -1 });
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));