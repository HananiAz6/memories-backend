const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  userId: { type: String },
  username: { type: String, required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const photoSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  photoData: { type: String, required: true }, // Base64 image
  uploadedBy: { type: String, required: true },          // display name
  uploaderId: { type: String, required: true, index: true },
  tags: [{ type: String }],
  
  // Add the missing fields here:
  location: { type: String, default: 'Somewhere on the road' },
  country: { type: String, default: 'Global' },
  travelStyle: { type: String, default: 'Slow Travel' },

  likedBy: [{ type: String }],                           // user ids
  sharedWith: { type: [String], index: true },           // user ids
  comments: [commentSchema],
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Photo', photoSchema);