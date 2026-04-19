// Load environment variables
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const csv = require('csv-parser');
const compression = require('compression');
const { Readable } = require('stream');

const app = express();

// Middleware
app.use(compression());
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Multer memory storage for serverless (Vercel)
const upload = multer({ storage: multer.memoryStorage() });

// MongoDB connection
let cachedDb = null;
async function connectToDatabase() {
  if (cachedDb && mongoose.connection.readyState === 1) return cachedDb;
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    cachedDb = mongoose.connection;
    console.log('✅ MongoDB connected');
    return cachedDb;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error;
  }
}

// Model cache to prevent OverwriteModelError in serverless
const modelCache = {};
function getModel(modelName, schemaDefinition) {
  if (modelCache[modelName]) return modelCache[modelName];
  const schema = new mongoose.Schema(schemaDefinition, { timestamps: false });
  const model = mongoose.models[modelName] || mongoose.model(modelName, schema);
  modelCache[modelName] = model;
  return model;
}

// -------------------- Mongoose Models --------------------
const Student = getModel('Student', {
  studentId: { type: String, required: true, unique: true },
  fullName: { type: String, required: true },
  dob: { type: String, required: true },
  class: String,
  mobile: String,
  email: String,
  registeredAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['active', 'blocked'], default: 'active' },
  blockReason: String,
  blockedAt: Date
});

const Test = getModel('Test', {
  testId: { type: String, required: true, unique: true },
  testName: { type: String, required: true },
  duration: { type: Number, required: true },
  marks: {
    correct: { type: Number, default: 1 },
    wrong: { type: Number, default: 0 },
    skip: { type: Number, default: 0 }
  },
  shuffle: { type: Boolean, default: false },
  allowedClasses: [String],
  isLive: { type: Boolean, default: false },
  startTime: Date,
  endTime: Date
});

const Question = getModel('Question', {
  testId: { type: String, required: true },
  questionId: { type: String, required: true },
  type: { type: String, enum: ['mcq', 'numerical'], required: true },
  questionText: {
    en: { type: String, required: true },
    hi: String
  },
  options: [{
    en: String,
    hi: String
  }],
  correctAnswer: mongoose.Schema.Types.Mixed,
  tolerance: Number,
  marks: {
    correct: Number,
    wrong: Number,
    skip: Number
  },
  imageUrls: [String]
});
Question.collection.createIndex({ testId: 1, questionId: 1 }, { unique: true });

const Result = getModel('Result', {
  studentId: { type: String, required: true },
  testId: { type: String, required: true },
  score: { type: Number, required: true },
  rank: Number,
  submittedAt: { type: Date, default: Date.now },
  answers: [{
    questionId: String,
    selectedAnswer: mongoose.Schema.Types.Mixed,
    isCorrect: Boolean,
    marksAwarded: Number
  }],
  paused: { type: Boolean, default: false },
  pausedAt: Date,
  totalPausedDuration: { type: Number, default: 0 }
});
Result.collection.createIndex({ testId: 1, studentId: 1 }, { unique: true });

const Discussion = getModel('Discussion', {
  testId: { type: String, required: true },
  title: { type: String, required: true },
  description: String,
  link: String,
  createdAt: { type: Date, default: Date.now }
});

const Message = getModel('Message', {
  studentId: String,
  sender: { type: String, enum: ['student', 'admin'], required: true },
  content: { type: String, required: true },
  isUnblockRequest: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now },
  reactions: { type: Map, of: String, default: {} }
});

const CommunityMessage = getModel('CommunityMessage', {
  studentId: { type: String, required: true },
  studentName: String,
  studentClass: String,
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  reactions: { type: Map, of: String, default: {} }
});

const CommunityBan = getModel('CommunityBan', {
  studentId: { type: String, required: true },
  studentClass: { type: String, required: true },
  reason: String,
  bannedAt: { type: Date, default: Date.now }
});
CommunityBan.collection.createIndex({ studentId: 1, studentClass: 1 }, { unique: true });

const Config = getModel('Config', {
  key: { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed
});

// -------------------- Middleware --------------------
function verifyAdminToken(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token || !token.startsWith('admin-')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ==================== API ROUTES ====================

app.get('/api', (req, res) => {
  res.json({ message: 'NexGen Exam Portal API', version: '2.3' });
});

// -------------------- Authentication --------------------
app.post('/api/auth/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
      const token = 'admin-' + Date.now();
      return res.json({ success: true, token });
    }
    res.status(401).json({ success: false, error: 'Invalid credentials' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/student/login', async (req, res) => {
  try {
    const { studentId, dob } = req.body;
    const student = await Student.findOne({ studentId, dob }).lean();
    if (!student) return res.status(401).json({ success: false, error: 'Invalid credentials' });
    if (student.status === 'blocked') {
      return res.status(403).json({ blocked: true, reason: student.blockReason });
    }
    res.json({ success: true, student });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------- Public Endpoints (for Student Portal) --------------------
app.get('/api/public/tests', async (req, res) => {
  try {
    const tests = await Test.find({}, 'testId testName allowedClasses duration marks startTime endTime isLive').lean();
    res.json(tests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/public/questions/:testId', async (req, res) => {
  try {
    const questions = await Question.find({ testId: req.params.testId }).lean();
    // Remove correct answers and marks for security
    const safeQuestions = questions.map(q => ({
      ...q,
      correctAnswer: undefined,
      tolerance: undefined,
      marks: undefined
    }));
    res.json(safeQuestions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------- Student Management (Admin Only) --------------------
app.get('/api/students', verifyAdminToken, async (req, res) => {
  try {
    const students = await Student.find().sort({ registeredAt: -1 }).lean();
    res.json(students);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/students', verifyAdminToken, async (req, res) => {
  try {
    const student = new Student(req.body);
    await student.save();
    res.status(201).json(student);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/students/:id', verifyAdminToken, async (req, res) => {
  try {
    const student = await Student.findOne({ studentId: req.params.id });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const { fullName, class: studentClass, mobile, email } = req.body;
    if (fullName) student.fullName = fullName;
    if (studentClass !== undefined) student.class = studentClass;
    if (mobile !== undefined) student.mobile = mobile;
    if (email !== undefined) student.email = email;
    await student.save();
    res.json(student);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/students/:id/block', verifyAdminToken, async (req, res) => {
  try {
    const { reason } = req.body;
    const student = await Student.findOne({ studentId: req.params.id });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    student.status = 'blocked';
    student.blockReason = reason;
    student.blockedAt = new Date();
    await student.save();
    res.json(student);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/students/:id/unblock', verifyAdminToken, async (req, res) => {
  try {
    const student = await Student.findOne({ studentId: req.params.id });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    student.status = 'active';
    student.blockReason = undefined;
    student.blockedAt = undefined;
    await student.save();
    res.json(student);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------- Test Management (Admin Only) --------------------
app.get('/api/tests', verifyAdminToken, async (req, res) => {
  try {
    const tests = await Test.find().sort({ testId: 1 }).lean();
    res.json(tests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tests', verifyAdminToken, async (req, res) => {
  try {
    const test = new Test(req.body);
    await test.save();
    res.status(201).json(test);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/tests/:id', verifyAdminToken, async (req, res) => {
  try {
    const test = await Test.findOneAndUpdate(
      { testId: req.params.id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!test) return res.status(404).json({ error: 'Test not found' });
    res.json(test);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/tests/:id', verifyAdminToken, async (req, res) => {
  try {
    const testId = req.params.id;
    await Test.deleteOne({ testId });
    await Question.deleteMany({ testId });
    await Result.deleteMany({ testId });
    await Discussion.deleteMany({ testId });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------- Question Management (Admin Only) --------------------
app.get('/api/questions/:testId', verifyAdminToken, async (req, res) => {
  try {
    const questions = await Question.find({ testId: req.params.testId }).lean();
    res.json(questions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/questions', verifyAdminToken, async (req, res) => {
  try {
    const question = new Question(req.body);
    await question.save();
    res.status(201).json(question);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/questions/:id', verifyAdminToken, async (req, res) => {
  try {
    const question = await Question.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!question) return res.status(404).json({ error: 'Question not found' });
    res.json(question);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/questions/:id', verifyAdminToken, async (req, res) => {
  try {
    await Question.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CSV Bulk Upload
app.post('/api/questions/upload/:testId', verifyAdminToken, upload.single('csvFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file uploaded' });
    }

    const testId = req.params.testId;
    const results = [];
    const stream = Readable.from(req.file.buffer.toString());
    const rows = [];
    const parser = stream.pipe(csv());

    for await (const row of parser) rows.push(row);

    for (const row of rows) {
      const options = [];
      for (let i = 1; i <= 4; i++) {
        options.push({
          en: row[`option${i}_en`] || '',
          hi: row[`option${i}_hi`] || ''
        });
      }

      const marks = {};
      if (row.marks_correct) marks.correct = parseFloat(row.marks_correct);
      if (row.marks_wrong) marks.wrong = parseFloat(row.marks_wrong);
      if (row.marks_skip) marks.skip = parseFloat(row.marks_skip);

      let correctAnswer;
      if (row.type === 'mcq') {
        correctAnswer = parseInt(row.correctAnswer);
      } else {
        correctAnswer = parseFloat(row.correctAnswer);
      }

      const questionData = {
        testId,
        questionId: row.questionId,
        type: row.type,
        questionText: {
          en: row.questionText_en,
          hi: row.questionText_hi || ''
        },
        options: row.type === 'mcq' ? options : [],
        correctAnswer,
        tolerance: row.tolerance ? parseFloat(row.tolerance) : undefined,
        marks: Object.keys(marks).length ? marks : undefined,
        imageUrls: row.imageUrls ? row.imageUrls.split(';').filter(u => u.trim()) : []
      };

      const existing = await Question.findOne({ testId, questionId: row.questionId });
      if (existing) {
        await Question.updateOne({ _id: existing._id }, questionData);
        results.push({ questionId: row.questionId, action: 'updated' });
      } else {
        const q = new Question(questionData);
        await q.save();
        results.push({ questionId: row.questionId, action: 'created' });
      }
    }

    res.json({ success: true, count: results.length, results });
  } catch (error) {
    console.error('CSV upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// -------------------- Student Test Flow (Public) --------------------
app.get('/api/student/available-tests/:studentId', async (req, res) => {
  try {
    const student = await Student.findOne({ studentId: req.params.studentId }).lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const now = new Date();
    const tests = await Test.find({
      isLive: true,
      allowedClasses: student.class,
      startTime: { $lte: now },
      endTime: { $gte: now }
    }).lean();

    // Only exclude tests that have been SUBMITTED
    const takenTests = await Result.find({
      studentId: student.studentId,
      submittedAt: { $exists: true }
    }).distinct('testId');

    const available = tests.filter(t => !takenTests.includes(t.testId));
    res.json(available);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/student/start-test', async (req, res) => {
  try {
    const { studentId, testId } = req.body;
    let result = await Result.findOne({ studentId, testId }).lean();
    if (result) {
      return res.json(result);
    }

    result = new Result({
      studentId,
      testId,
      score: 0,
      answers: [],
      paused: false,
      totalPausedDuration: 0
    });
    await result.save();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/student/submit-test', async (req, res) => {
  try {
    const { studentId, testId, answers } = req.body;
    const test = await Test.findOne({ testId }).lean();
    if (!test) return res.status(404).json({ error: 'Test not found' });

    const questions = await Question.find({ testId }).lean();
    const questionMap = new Map(questions.map(q => [q.questionId, q]));

    let score = 0;
    const evaluatedAnswers = [];

    for (const ans of answers) {
      const q = questionMap.get(ans.questionId);
      if (!q) continue;

      // Use question marks if present, otherwise fallback to test marks
      const marksScheme = {
        correct: q.marks?.correct ?? test.marks.correct,
        wrong: q.marks?.wrong ?? test.marks.wrong,
        skip: q.marks?.skip ?? test.marks.skip
      };

      let isCorrect = false;
      const selected = ans.selectedAnswer;

      if (q.type === 'mcq') {
        isCorrect = (parseInt(selected) === q.correctAnswer);
      } else {
        const tolerance = q.tolerance || 0;
        const numericAnswer = parseFloat(selected);
        isCorrect = !isNaN(numericAnswer) && Math.abs(numericAnswer - q.correctAnswer) <= tolerance;
      }

      let marksAwarded = 0;
      if (selected === null || selected === undefined || selected === '') {
        marksAwarded = marksScheme.skip;
      } else {
        marksAwarded = isCorrect ? marksScheme.correct : marksScheme.wrong;
      }

      evaluatedAnswers.push({
        questionId: ans.questionId,
        selectedAnswer: selected,
        isCorrect,
        marksAwarded
      });

      score += marksAwarded;
    }

    const result = await Result.findOneAndUpdate(
      { studentId, testId },
      { score, answers: evaluatedAnswers, submittedAt: new Date() },
      { new: true, upsert: true }
    );

    // Recalculate ranks for this test
    const allResults = await Result.find({ testId, submittedAt: { $exists: true } }).sort({ score: -1 });
    let rank = 1;
    for (const r of allResults) {
      r.rank = rank++;
      await r.save();
    }

    const finalResult = await Result.findOne({ studentId, testId }).lean();
    res.json({ score: finalResult.score, rank: finalResult.rank });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------- Pause / Resume (Admin Only) --------------------
app.post('/api/admin/pause-test', verifyAdminToken, async (req, res) => {
  try {
    const { studentId, testId, password } = req.body;
    if (password !== process.env.PAUSE_PASSWORD) {
      return res.status(403).json({ error: 'Invalid pause password' });
    }

    const result = await Result.findOne({ studentId, testId });
    if (!result) return res.status(404).json({ error: 'Result not found' });

    result.paused = true;
    result.pausedAt = new Date();
    await result.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/resume-test', verifyAdminToken, async (req, res) => {
  try {
    const { studentId, testId, password } = req.body;
    if (password !== process.env.RESUME_PASSWORD) {
      return res.status(403).json({ error: 'Invalid resume password' });
    }

    const result = await Result.findOne({ studentId, testId });
    if (!result) return res.status(404).json({ error: 'Result not found' });

    if (result.paused && result.pausedAt) {
      const pausedDuration = Math.floor((new Date() - result.pausedAt) / 1000);
      result.totalPausedDuration = (result.totalPausedDuration || 0) + pausedDuration;
    }
    result.paused = false;
    result.pausedAt = undefined;
    await result.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Pause status for admin
app.get('/api/admin/paused-status/:studentId/:testId', verifyAdminToken, async (req, res) => {
  try {
    const result = await Result.findOne({
      studentId: req.params.studentId,
      testId: req.params.testId
    }).lean();
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json({ paused: result.paused, totalPausedDuration: result.totalPausedDuration });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------- Pause Status for Student (Public) --------------------
app.get('/api/student/pause-status/:studentId/:testId', async (req, res) => {
  try {
    const result = await Result.findOne({
      studentId: req.params.studentId,
      testId: req.params.testId
    }).lean();
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json({ paused: result.paused, totalPausedDuration: result.totalPausedDuration });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------- Results --------------------
app.get('/api/results', verifyAdminToken, async (req, res) => {
  try {
    const results = await Result.find({ submittedAt: { $exists: true } })
      .sort({ submittedAt: -1 })
      .lean();
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/results/student/:studentId', async (req, res) => {
  try {
    const results = await Result.find({
      studentId: req.params.studentId,
      submittedAt: { $exists: true }
    })
      .sort({ submittedAt: -1 })
      .lean();
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/results/test/:testId', verifyAdminToken, async (req, res) => {
  try {
    const results = await Result.find({
      testId: req.params.testId,
      submittedAt: { $exists: true }
    })
      .sort({ score: -1 })
      .lean();
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------- Discussions --------------------
app.get('/api/discussions/:testId', async (req, res) => {
  try {
    const discussions = await Discussion.find({ testId: req.params.testId })
      .sort({ createdAt: -1 })
      .lean();
    res.json(discussions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/discussions', verifyAdminToken, async (req, res) => {
  try {
    const discussion = new Discussion(req.body);
    await discussion.save();
    res.status(201).json(discussion);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/discussions/:id', verifyAdminToken, async (req, res) => {
  try {
    await Discussion.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------- Messages --------------------
app.get('/api/messages', async (req, res) => {
  try {
    const { studentId } = req.query;
    const token = req.headers['authorization']?.replace('Bearer ', '');
    const isAdmin = token && token.startsWith('admin-');

    if (studentId) {
      const messages = await Message.find({ studentId }).sort({ timestamp: 1 }).lean();
      return res.json(messages);
    } else if (isAdmin) {
      const messages = await Message.find().sort({ timestamp: -1 }).lean();
      return res.json(messages);
    } else {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/messages', async (req, res) => {
  try {
    const message = new Message(req.body);
    await message.save();
    res.status(201).json(message);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Add reaction to a message
app.post('/api/messages/:id/react', async (req, res) => {
  try {
    const { reaction, studentId } = req.body;
    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (!message.reactions) message.reactions = new Map();
    message.reactions.set(studentId, reaction);
    await message.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a message (student can delete own, admin can delete any)
app.delete('/api/messages/:id', async (req, res) => {
  try {
    const { studentId, isAdmin } = req.query;
    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (!isAdmin && message.studentId !== studentId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    await Message.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear all messages for a student
app.delete('/api/messages/clear/:studentId', async (req, res) => {
  try {
    await Message.deleteMany({ studentId: req.params.studentId });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------- Community Chat (Student) --------------------
app.get('/api/community/:class', async (req, res) => {
  try {
    const messages = await CommunityMessage.find({ studentClass: req.params.class })
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();
    res.json(messages.reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/community', async (req, res) => {
  try {
    const { studentId, studentName, studentClass, content } = req.body;

    const banned = await CommunityBan.findOne({ studentId, studentClass });
    if (banned) {
      return res.status(403).json({ error: 'You are banned from community chat' });
    }

    const message = new CommunityMessage({ studentId, studentName, studentClass, content });
    await message.save();
    res.status(201).json(message);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Community message reactions
app.post('/api/community/:id/react', async (req, res) => {
  try {
    const { reaction, studentId } = req.body;
    const message = await CommunityMessage.findById(req.params.id);
    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (!message.reactions) message.reactions = new Map();
    message.reactions.set(studentId, reaction);
    await message.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete community message (student can delete own, admin can delete any)
app.delete('/api/community/:id', async (req, res) => {
  try {
    const { studentId, isAdmin } = req.query;
    const message = await CommunityMessage.findById(req.params.id);
    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (!isAdmin && message.studentId !== studentId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    await CommunityMessage.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------- Community Chat (Admin) --------------------
app.get('/api/admin/community/:class', verifyAdminToken, async (req, res) => {
  try {
    const messages = await CommunityMessage.find({ studentClass: req.params.class })
      .sort({ timestamp: -1 })
      .limit(200)
      .lean();
    res.json(messages.reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/community/message', verifyAdminToken, async (req, res) => {
  try {
    const { studentClass, content } = req.body;
    const message = new CommunityMessage({
      studentId: 'ADMIN',
      studentName: 'Admin',
      studentClass,
      content
    });
    await message.save();
    res.status(201).json(message);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/admin/community/ban', verifyAdminToken, async (req, res) => {
  try {
    const { studentId, studentClass, reason } = req.body;
    const existing = await CommunityBan.findOne({ studentId, studentClass });
    if (existing) {
      return res.status(400).json({ error: 'Student already banned' });
    }
    const ban = new CommunityBan({ studentId, studentClass, reason });
    await ban.save();
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/admin/community/unban', verifyAdminToken, async (req, res) => {
  try {
    const { studentId, studentClass } = req.body;
    await CommunityBan.deleteOne({ studentId, studentClass });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/community/banned/:class', verifyAdminToken, async (req, res) => {
  try {
    const bans = await CommunityBan.find({ studentClass: req.params.class }).lean();
    res.json(bans);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------- Live Students Indicator --------------------
app.get('/api/admin/live-students', verifyAdminToken, async (req, res) => {
  try {
    const activeResults = await Result.find({
      submittedAt: { $exists: false },
      paused: false
    }).lean();
    const studentIds = [...new Set(activeResults.map(r => r.studentId))];
    res.json({ count: studentIds.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------- Settings --------------------
app.post('/api/settings/password', verifyAdminToken, async (req, res) => {
  res.json({ success: true, message: 'Password updated (simulated)' });
});

// -------------------- Error Handling --------------------
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// -------------------- Start Server --------------------
const PORT = process.env.PORT || 3000;
connectToDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
});

module.exports = app;
