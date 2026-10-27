const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  username: { type: String, required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const photoSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  photoData: { type: String, required: true }, // Base64 image string
  uploadedBy: { type: String, required: true, default: 'Anonymous' },
  tags: [{ type: String }],
  likes: { type: Number, default: 0 },
  likedBy: [{ type: String }], // Array of usernames who liked this photo
  comments: [commentSchema],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Photo', photoSchema);