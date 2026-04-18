require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const csv = require('csv-parser');
const compression = require('compression');
const { Readable } = require('stream');

const app = express();

app.use(compression());
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Models
const modelCache = {};
function getModel(modelName, schemaDefinition) {
  if (modelCache[modelName]) return modelCache[modelName];
  const schema = new mongoose.Schema(schemaDefinition, { timestamps: false });
  const model = mongoose.models[modelName] || mongoose.model(modelName, schema);
  modelCache[modelName] = model;
  return model;
}

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
  questionText: { en: { type: String, required: true }, hi: String },
  options: [{ en: String, hi: String }],
  correctAnswer: mongoose.Schema.Types.Mixed,
  tolerance: Number,
  marks: { correct: Number, wrong: Number, skip: Number },
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
  timestamp: { type: Date, default: Date.now }
});

const CommunityMessage = getModel('CommunityMessage', {
  studentId: { type: String, required: true },
  studentName: String,
  studentClass: String,
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
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

// Helper: verify admin token
function verifyAdminToken(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token || !token.startsWith('admin-')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ==================== Routes ====================

app.get('/api', (req, res) => res.json({ message: 'NexGen API', version: '2.1' }));

// --- Auth ---
app.post('/api/auth/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
      return res.json({ success: true, token: 'admin-' + Date.now() });
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

// --- Public endpoints for student ---
app.get('/api/public/tests', async (req, res) => {
  try {
    const tests = await Test.find({}, 'testId testName allowedClasses').lean();
    res.json(tests);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/public/questions/:testId', async (req, res) => {
  try {
    const questions = await Question.find({ testId: req.params.testId }).lean();
    // Return only question text and options, not correct answer (for security)
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

// --- Students (Admin) ---
app.get('/api/students', verifyAdminToken, async (req, res) => {
  const students = await Student.find().sort({ registeredAt: -1 }).lean();
  res.json(students);
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
  const student = await Student.findOne({ studentId: req.params.id });
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const { fullName, class: studentClass, mobile, email } = req.body;
  if (fullName) student.fullName = fullName;
  if (studentClass !== undefined) student.class = studentClass;
  if (mobile !== undefined) student.mobile = mobile;
  if (email !== undefined) student.email = email;
  await student.save();
  res.json(student);
});
app.put('/api/students/:id/block', verifyAdminToken, async (req, res) => {
  const { reason } = req.body;
  const student = await Student.findOne({ studentId: req.params.id });
  if (!student) return res.status(404).json({ error: 'Student not found' });
  student.status = 'blocked';
  student.blockReason = reason;
  student.blockedAt = new Date();
  await student.save();
  res.json(student);
});
app.put('/api/students/:id/unblock', verifyAdminToken, async (req, res) => {
  const student = await Student.findOne({ studentId: req.params.id });
  if (!student) return res.status(404).json({ error: 'Student not found' });
  student.status = 'active';
  student.blockReason = undefined;
  student.blockedAt = undefined;
  await student.save();
  res.json(student);
});

// --- Tests (Admin) ---
app.get('/api/tests', verifyAdminToken, async (req, res) => {
  const tests = await Test.find().sort({ testId: 1 }).lean();
  res.json(tests);
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
  const test = await Test.findOneAndUpdate({ testId: req.params.id }, req.body, { new: true, runValidators: true });
  if (!test) return res.status(404).json({ error: 'Test not found' });
  res.json(test);
});
app.delete('/api/tests/:id', verifyAdminToken, async (req, res) => {
  const testId = req.params.id;
  await Test.deleteOne({ testId });
  await Question.deleteMany({ testId });
  await Result.deleteMany({ testId });
  await Discussion.deleteMany({ testId });
  res.json({ success: true });
});

// --- Questions (Admin) ---
app.get('/api/questions/:testId', verifyAdminToken, async (req, res) => {
  const questions = await Question.find({ testId: req.params.testId }).lean();
  res.json(questions);
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
  const question = await Question.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!question) return res.status(404).json({ error: 'Question not found' });
  res.json(question);
});
app.delete('/api/questions/:id', verifyAdminToken, async (req, res) => {
  await Question.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});
app.post('/api/questions/upload/:testId', verifyAdminToken, upload.single('csvFile'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No CSV file' });
  const testId = req.params.testId;
  const results = [];
  const stream = Readable.from(req.file.buffer.toString());
  const rows = [];
  for await (const row of stream.pipe(csv())) rows.push(row);
  for (const row of rows) {
    const options = [];
    for (let i = 1; i <= 4; i++) {
      options.push({ en: row[`option${i}_en`] || '', hi: row[`option${i}_hi`] || '' });
    }
    const marks = {};
    if (row.marks_correct) marks.correct = parseFloat(row.marks_correct);
    if (row.marks_wrong) marks.wrong = parseFloat(row.marks_wrong);
    if (row.marks_skip) marks.skip = parseFloat(row.marks_skip);
    const correctAnswer = row.type === 'mcq' ? parseInt(row.correctAnswer) : parseFloat(row.correctAnswer);
    const questionData = {
      testId,
      questionId: row.questionId,
      type: row.type,
      questionText: { en: row.questionText_en, hi: row.questionText_hi || '' },
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
      await new Question(questionData).save();
      results.push({ questionId: row.questionId, action: 'created' });
    }
  }
  res.json({ success: true, count: results.length, results });
});

// --- Student Test Flow ---
app.get('/api/student/available-tests/:studentId', async (req, res) => {
  const student = await Student.findOne({ studentId: req.params.studentId }).lean();
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const now = new Date();
  const tests = await Test.find({
    isLive: true,
    allowedClasses: student.class,
    startTime: { $lte: now },
    endTime: { $gte: now }
  }).lean();
  const takenTests = await Result.find({ studentId: student.studentId, submittedAt: { $exists: true } }).distinct('testId');
  const available = tests.filter(t => !takenTests.includes(t.testId));
  res.json(available);
});
app.post('/api/student/start-test', async (req, res) => {
  const { studentId, testId } = req.body;
  let result = await Result.findOne({ studentId, testId });
  if (result) return res.json(result);
  result = new Result({ studentId, testId, score: 0, answers: [], paused: false, totalPausedDuration: 0 });
  await result.save();
  res.json(result);
});
app.post('/api/student/submit-test', async (req, res) => {
  const { studentId, testId, answers } = req.body;
  const test = await Test.findOne({ testId }).lean();
  if (!test) return res.status(404).json({ error: 'Test not found' });
  const questions = await Question.find({ testId }).lean();
  const qMap = new Map(questions.map(q => [q.questionId, q]));
  let score = 0;
  const evaluatedAnswers = [];
  for (const ans of answers) {
    const q = qMap.get(ans.questionId);
    if (!q) continue;
    const scheme = q.marks || test.marks;
    let isCorrect = false;
    if (q.type === 'mcq') {
      isCorrect = parseInt(ans.selectedAnswer) === q.correctAnswer;
    } else {
      const tol = q.tolerance || 0;
      isCorrect = Math.abs(parseFloat(ans.selectedAnswer) - q.correctAnswer) <= tol;
    }
    const marksAwarded = isCorrect ? scheme.correct : (ans.selectedAnswer === null ? scheme.skip : scheme.wrong);
    evaluatedAnswers.push({ questionId: ans.questionId, selectedAnswer: ans.selectedAnswer, isCorrect, marksAwarded });
    score += marksAwarded;
  }
  await Result.findOneAndUpdate({ studentId, testId }, { score, answers: evaluatedAnswers, submittedAt: new Date() }, { upsert: true });
  const allResults = await Result.find({ testId, submittedAt: { $exists: true } }).sort({ score: -1 });
  let rank = 1;
  for (const r of allResults) { r.rank = rank++; await r.save(); }
  const final = await Result.findOne({ studentId, testId }).lean();
  res.json({ score: final.score, rank: final.rank });
});

// --- Pause/Resume (Admin) ---
app.post('/api/admin/pause-test', verifyAdminToken, async (req, res) => {
  const { studentId, testId, password } = req.body;
  if (password !== process.env.PAUSE_PASSWORD) return res.status(403).json({ error: 'Invalid password' });
  const result = await Result.findOne({ studentId, testId });
  if (!result) return res.status(404).json({ error: 'Not found' });
  result.paused = true;
  result.pausedAt = new Date();
  await result.save();
  res.json({ success: true });
});
app.post('/api/admin/resume-test', verifyAdminToken, async (req, res) => {
  const { studentId, testId, password } = req.body;
  if (password !== process.env.RESUME_PASSWORD) return res.status(403).json({ error: 'Invalid password' });
  const result = await Result.findOne({ studentId, testId });
  if (!result) return res.status(404).json({ error: 'Not found' });
  if (result.paused && result.pausedAt) {
    const pausedDuration = Math.floor((new Date() - result.pausedAt) / 1000);
    result.totalPausedDuration = (result.totalPausedDuration || 0) + pausedDuration;
  }
  result.paused = false;
  result.pausedAt = undefined;
  await result.save();
  res.json({ success: true });
});
app.get('/api/admin/paused-status/:studentId/:testId', verifyAdminToken, async (req, res) => {
  const result = await Result.findOne({ studentId: req.params.studentId, testId: req.params.testId }).lean();
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json({ paused: result.paused, totalPausedDuration: result.totalPausedDuration });
});

// --- Results ---
app.get('/api/results', verifyAdminToken, async (req, res) => {
  const results = await Result.find({ submittedAt: { $exists: true } }).sort({ submittedAt: -1 }).lean();
  res.json(results);
});
app.get('/api/results/student/:studentId', async (req, res) => {
  const results = await Result.find({ studentId: req.params.studentId, submittedAt: { $exists: true } }).sort({ submittedAt: -1 }).lean();
  res.json(results);
});
app.get('/api/results/test/:testId', verifyAdminToken, async (req, res) => {
  const results = await Result.find({ testId: req.params.testId, submittedAt: { $exists: true } }).sort({ score: -1 }).lean();
  res.json(results);
});

// --- Discussions ---
app.get('/api/discussions/:testId', async (req, res) => {
  const discussions = await Discussion.find({ testId: req.params.testId }).sort({ createdAt: -1 }).lean();
  res.json(discussions);
});
app.post('/api/discussions', verifyAdminToken, async (req, res) => {
  const discussion = new Discussion(req.body);
  await discussion.save();
  res.status(201).json(discussion);
});
app.delete('/api/discussions/:id', verifyAdminToken, async (req, res) => {
  await Discussion.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// --- Messages ---
app.get('/api/messages', async (req, res) => {
  const { studentId } = req.query;
  const token = req.headers['authorization']?.replace('Bearer ', '');
  const isAdmin = token && token.startsWith('admin-');
  if (studentId) {
    return res.json(await Message.find({ studentId }).sort({ timestamp: 1 }).lean());
  } else if (isAdmin) {
    return res.json(await Message.find().sort({ timestamp: -1 }).lean());
  }
  res.status(401).json({ error: 'Unauthorized' });
});
app.post('/api/messages', async (req, res) => {
  const message = new Message(req.body);
  await message.save();
  res.status(201).json(message);
});

// --- Community ---
app.get('/api/community/:class', async (req, res) => {
  const msgs = await CommunityMessage.find({ studentClass: req.params.class }).sort({ timestamp: -1 }).limit(100).lean();
  res.json(msgs.reverse());
});
app.post('/api/community', async (req, res) => {
  const { studentId, studentName, studentClass, content } = req.body;
  const banned = await CommunityBan.findOne({ studentId, studentClass });
  if (banned) return res.status(403).json({ error: 'You are banned' });
  const msg = new CommunityMessage({ studentId, studentName, studentClass, content });
  await msg.save();
  res.status(201).json(msg);
});
// Admin community endpoints (same as before, abbreviated here for space)
app.get('/api/admin/community/:class', verifyAdminToken, async (req, res) => {
  const msgs = await CommunityMessage.find({ studentClass: req.params.class }).sort({ timestamp: -1 }).limit(200).lean();
  res.json(msgs.reverse());
});
app.post('/api/admin/community/message', verifyAdminToken, async (req, res) => {
  const { studentClass, content } = req.body;
  const msg = new CommunityMessage({ studentId: 'ADMIN', studentName: 'Admin', studentClass, content });
  await msg.save();
  res.status(201).json(msg);
});
app.post('/api/admin/community/ban', verifyAdminToken, async (req, res) => {
  const { studentId, studentClass, reason } = req.body;
  const existing = await CommunityBan.findOne({ studentId, studentClass });
  if (existing) return res.status(400).json({ error: 'Already banned' });
  await new CommunityBan({ studentId, studentClass, reason }).save();
  res.json({ success: true });
});
app.post('/api/admin/community/unban', verifyAdminToken, async (req, res) => {
  await CommunityBan.deleteOne({ studentId: req.body.studentId, studentClass: req.body.studentClass });
  res.json({ success: true });
});
app.get('/api/admin/community/banned/:class', verifyAdminToken, async (req, res) => {
  const bans = await CommunityBan.find({ studentClass: req.params.class }).lean();
  res.json(bans);
});

// --- Live Students ---
app.get('/api/admin/live-students', verifyAdminToken, async (req, res) => {
  const activeResults = await Result.find({ submittedAt: { $exists: false }, paused: false }).lean();
  const studentIds = [...new Set(activeResults.map(r => r.studentId))];
  res.json({ count: studentIds.length });
});

// --- Settings ---
app.post('/api/settings/password', verifyAdminToken, async (req, res) => {
  res.json({ success: true });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 3000;
connectToDatabase().then(() => app.listen(PORT, () => console.log(`🚀 Server on ${PORT}`)));
module.exports = app;
