// ==================== NexGen Student Portal ====================
const studentData = JSON.parse(localStorage.getItem('studentData'));
if (!studentData) window.location.href = 'index.html';

const state = {
  student: studentData,
  currentPage: 'dashboard',
  currentTest: null,
  testAnswers: {},
  flaggedQuestions: new Set(),
  testStartTime: null,
  timerInterval: null,
  pauseInterval: null,
  autoSaveInterval: null,
  communityInterval: null,
  tabSwitchCount: 0,
  language: localStorage.getItem('preferredLanguage') || 'en'
};

// API Wrapper – no auth headers
async function apiCall(endpoint, options = {}) {
  const defaultOptions = { headers: { 'Content-Type': 'application/json' } };
  try {
    const response = await fetch(`/api${endpoint}`, { ...defaultOptions, ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  } catch (error) {
    showToast(error.message, 'error');
    throw error;
  }
}

function showLoading() {
  const overlay = document.createElement('div');
  overlay.id = 'loadingOverlay';
  overlay.className = 'fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50';
  overlay.innerHTML = `<div class="bg-white p-6 rounded-2xl"><i class="fas fa-spinner fa-spin text-3xl text-indigo-600"></i></div>`;
  document.body.appendChild(overlay);
}
function hideLoading() { document.getElementById('loadingOverlay')?.remove(); }
function showToast(msg, type = 'info') {
  const div = document.createElement('div');
  div.className = 'fixed bottom-4 right-4 z-50';
  div.innerHTML = `<div class="toast-enter p-4 rounded-lg shadow-lg text-white ${type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-indigo-600'}"><i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'} mr-2"></i>${msg}</div>`;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

const pages = [
  { id: 'dashboard', label: 'Dashboard', icon: 'fa-home' },
  { id: 'available', label: 'Available Tests', icon: 'fa-list' },
  { id: 'results', label: 'Previous Results', icon: 'fa-chart-bar' },
  { id: 'discussions', label: 'Discussions', icon: 'fa-comments' },
  { id: 'messages', label: 'Messages', icon: 'fa-envelope' },
  { id: 'community', label: 'Class Community', icon: 'fa-users' }
];
function renderSidebar() {
  document.getElementById('studentNameDisplay').textContent = `${state.student.fullName} (${state.student.class || 'N/A'})`;
  const nav = document.getElementById('sidebarNav');
  nav.innerHTML = pages.map(p => `
    <button data-page="${p.id}" class="nav-item w-full text-left px-4 py-3 rounded-lg hover:bg-white/10 transition flex items-center ${state.currentPage === p.id ? 'bg-white/20' : ''}">
      <i class="fas ${p.icon} w-6"></i><span>${p.label}</span>
    </button>
  `).join('');
  nav.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => {
    state.currentPage = btn.dataset.page;
    renderSidebar();
    loadPage(state.currentPage);
  }));
}

async function loadPage(pageId) {
  if (state.communityInterval) { clearInterval(state.communityInterval); state.communityInterval = null; }
  showLoading();
  try {
    const titleMap = {
      dashboard: 'Dashboard', available: 'Available Tests', results: 'Previous Results',
      discussions: 'Discussions', messages: 'Messages', community: 'Class Community'
    };
    document.getElementById('pageTitle').textContent = titleMap[pageId];
    const container = document.getElementById('contentContainer');
    switch (pageId) {
      case 'dashboard': await loadDashboard(container); break;
      case 'available': await loadAvailableTests(container); break;
      case 'results': await loadResults(container); break;
      case 'discussions': await loadDiscussions(container); break;
      case 'messages': await loadMessages(container); break;
      case 'community': await loadCommunity(container); break;
    }
  } catch (e) {
    showToast(e.message, 'error');
    container.innerHTML = `<p class="text-red-500 text-center py-8">Failed to load: ${e.message}</p>`;
  } finally { hideLoading(); }
}

async function loadDashboard(container) {
  const results = await apiCall(`/results/student/${state.student.studentId}`);
  const avg = results.length ? (results.reduce((a, r) => a + r.score, 0) / results.length).toFixed(1) : '0.0';
  container.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div class="bg-white p-6 rounded-xl shadow-sm border"><h3 class="text-lg font-semibold mb-4">Profile</h3><p>ID: ${state.student.studentId}</p><p>Name: ${state.student.fullName}</p><p>Class: ${state.student.class || 'N/A'}</p></div>
      <div class="bg-white p-6 rounded-xl shadow-sm border"><h3 class="text-lg font-semibold mb-4">Statistics</h3><p class="text-4xl font-bold text-indigo-600">${results.length}</p><p>Tests Taken</p><p class="text-4xl font-bold text-green-600 mt-4">${avg}</p><p>Average Score</p></div>
      <div class="bg-white p-6 rounded-xl shadow-sm border"><h3 class="text-lg font-semibold mb-4">Recent Activity</h3>${results.slice(0, 5).map(r => `<div class="py-2"><p>${r.testId}</p><p class="text-sm">Score: ${r.score} | Rank: ${r.rank || 'N/A'}</p></div>`).join('') || '<p class="text-gray-500">No tests yet</p>'}</div>
    </div>
  `;
}

async function loadAvailableTests(container) {
  try {
    const tests = await apiCall(`/student/available-tests/${state.student.studentId}`);
    if (!tests.length) {
      container.innerHTML = '<p class="text-gray-500 text-center py-8">No tests available at the moment.</p>';
      return;
    }
    container.innerHTML = `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">${tests.map(t => `
      <div class="bg-white p-6 rounded-xl shadow-sm border hover:shadow-md">
        <h3 class="text-xl font-bold">${t.testName}</h3>
        <div class="space-y-2 text-gray-600 my-4">
          <p><i class="far fa-clock mr-2"></i>${t.duration} min</p>
          <p><i class="far fa-calendar mr-2"></i>${new Date(t.startTime).toLocaleString()}</p>
          <p><i class="fas fa-star mr-2"></i>+${t.marks.correct}/${t.marks.wrong}/${t.marks.skip}</p>
        </div>
        <button data-testid="${t.testId}" class="startTestBtn w-full py-2 bg-indigo-600 text-white rounded-lg">Start Test</button>
      </div>
    `).join('')}</div>`;
    document.querySelectorAll('.startTestBtn').forEach(btn => btn.addEventListener('click', () => startTest(btn.dataset.testid)));
  } catch (e) {
    container.innerHTML = `<p class="text-red-500">Error: ${e.message}</p>`;
  }
}

// ==================== FIXED: startTest ====================
async function startTest(testId) {
  showLoading();
  try {
    const result = await apiCall('/student/start-test', {
      method: 'POST',
      body: JSON.stringify({ studentId: state.student.studentId, testId })
    });

    const [testsList, questions] = await Promise.all([
      apiCall('/public/tests'),
      apiCall(`/public/questions/${testId}`)
    ]);

    const test = testsList.find(t => t.testId === testId);
    if (!test) throw new Error('Test not found or no longer available.');
    if (!Array.isArray(questions) || questions.length === 0) throw new Error('No questions found for this test.');

    state.currentTest = {
      testId,
      test,
      questions: test.shuffle ? shuffleArray(questions) : questions,
      result,
      currentIndex: 0
    };
    state.testAnswers = {};
    state.flaggedQuestions.clear();
    state.testStartTime = Date.now();
    state.tabSwitchCount = 0;

    renderTestInterface();
    startTestTimer();
    startPausePolling();      // now calls public endpoint
    startAutoSave();
    document.addEventListener('visibilitychange', handleVisibilityChange);
  } catch (e) {
    showToast(e.message, 'error');
    console.error('Start test error:', e);
  } finally {
    hideLoading();
  }
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function renderTestInterface() {
  const modal = document.getElementById('testModal');
  const q = state.currentTest.questions[state.currentTest.currentIndex];
  if (!q) { showToast('Error: Question not found', 'error'); exitTest(false); return; }
  const currentAnswer = state.testAnswers[q.questionId];
  const isFlagged = state.flaggedQuestions.has(q.questionId);
  modal.innerHTML = `
    <div class="min-h-screen flex flex-col bg-gray-50">
      <div class="bg-white border-b p-4 flex justify-between items-center sticky top-0 z-10 shadow-sm">
        <div><h2 class="text-xl font-bold text-gray-800">${state.currentTest.test.testName}</h2><p class="text-gray-600">Question ${state.currentTest.currentIndex + 1} of ${state.currentTest.questions.length}</p></div>
        <div class="flex items-center space-x-4">
          <div id="timer" class="text-2xl font-mono font-bold px-4 py-2 rounded-lg bg-gray-100 text-gray-800"></div>
          <button id="toggleLanguageBtn" class="px-3 py-2 border rounded-lg hover:bg-gray-50"><i class="fas fa-language mr-1"></i>${state.language === 'en' ? 'हिंदी' : 'English'}</button>
          <button id="closeTestBtn" class="text-gray-500 hover:text-gray-700 p-2"><i class="fas fa-times text-xl"></i></button>
        </div>
      </div>
      <div class="flex-1 flex overflow-hidden">
        <div class="flex-1 p-6 overflow-y-auto"><div class="max-w-3xl mx-auto"><div class="bg-white rounded-xl shadow-sm border p-6">
          <div class="prose max-w-none mb-6"><p class="text-lg font-medium">${q.questionText[state.language] || q.questionText.en}</p>${q.imageUrls?.length ? q.imageUrls.map(url => `<img src="${url}" class="my-4 max-w-full rounded-lg">`).join('') : ''}</div>
          <div class="space-y-3" id="optionsContainer">${renderOptions(q, currentAnswer)}</div>
          <div class="mt-6 flex space-x-3">
            <button id="clearAnswerBtn" class="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"><i class="far fa-times-circle mr-2"></i>Clear</button>
            <button id="flagQuestionBtn" class="px-4 py-2 border rounded-lg hover:bg-gray-50 ${isFlagged ? 'border-yellow-500 bg-yellow-50 text-yellow-700' : 'border-gray-300'}"><i class="far fa-flag mr-2"></i>${isFlagged ? 'Unflag' : 'Flag'}</button>
          </div>
        </div></div></div>
        <div class="w-80 bg-white border-l p-4 overflow-y-auto">
          <h3 class="font-semibold text-gray-700 mb-3">Question Palette</h3>
          <div class="grid grid-cols-5 gap-2">${state.currentTest.questions.map((ques, idx) => {
            const qid = ques.questionId;
            let cls = 'not-visited';
            if (state.testAnswers[qid] !== undefined) cls = 'answered';
            if (state.flaggedQuestions.has(qid)) cls = 'flagged';
            if (idx === state.currentTest.currentIndex) cls += ' current';
            return `<div data-index="${idx}" class="question-palette-btn ${cls}">${idx + 1}</div>`;
          }).join('')}</div>
          <div class="mt-6 space-y-2 text-sm"><div class="flex items-center"><span class="w-3 h-3 bg-green-500 rounded mr-2"></span>Answered</div><div class="flex items-center"><span class="w-3 h-3 bg-yellow-500 rounded mr-2"></span>Flagged</div><div class="flex items-center"><span class="w-3 h-3 bg-gray-300 rounded mr-2"></span>Not Visited</div></div>
          <button id="submitTestBtn" class="w-full mt-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold">Submit Test</button>
        </div>
      </div>
      <div class="bg-white border-t p-4 flex justify-between">
        <button id="prevBtn" class="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50" ${state.currentTest.currentIndex === 0 ? 'disabled' : ''}><i class="fas fa-chevron-left mr-2"></i>Previous</button>
        <span class="text-gray-500">${state.currentTest.currentIndex + 1} / ${state.currentTest.questions.length}</span>
        <button id="nextBtn" class="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">${state.currentTest.currentIndex === state.currentTest.questions.length - 1 ? 'Finish' : 'Next'} <i class="fas fa-chevron-right ml-2"></i></button>
      </div>
    </div>
  `;
  modal.classList.remove('hidden');
  attachTestEventListeners(q);
}

function renderOptions(q, ans) {
  if (q.type === 'mcq') {
    return q.options.map((opt, idx) => `<label class="flex items-center p-4 border rounded-lg cursor-pointer transition ${ans == idx + 1 ? 'border-indigo-500 bg-indigo-50' : 'hover:bg-gray-50'}"><input type="radio" name="mcq" value="${idx + 1}" ${ans == idx + 1 ? 'checked' : ''} class="mr-3"><span class="flex-1">${opt[state.language] || opt.en}</span>${ans == idx + 1 ? '<i class="fas fa-check-circle text-indigo-600"></i>' : ''}</label>`).join('');
  } else {
    return `<input type="number" step="any" id="numericalAnswer" value="${ans || ''}" class="w-full px-4 py-3 border rounded-lg text-lg" placeholder="Enter numerical answer">`;
  }
}

function attachTestEventListeners(currentQ) {
  const modal = document.getElementById('testModal');
  modal.querySelectorAll('input[name="mcq"]').forEach(r => r.addEventListener('change', e => {
    state.testAnswers[currentQ.questionId] = parseInt(e.target.value);
    renderTestInterface();
  }));
  const num = modal.querySelector('#numericalAnswer');
  if (num) {
    num.addEventListener('input', e => { state.testAnswers[currentQ.questionId] = parseFloat(e.target.value) || e.target.value; });
    num.focus();
  }
  modal.querySelector('#clearAnswerBtn')?.addEventListener('click', () => { delete state.testAnswers[currentQ.questionId]; renderTestInterface(); });
  modal.querySelector('#flagQuestionBtn')?.addEventListener('click', () => {
    state.flaggedQuestions.has(currentQ.questionId) ? state.flaggedQuestions.delete(currentQ.questionId) : state.flaggedQuestions.add(currentQ.questionId);
    renderTestInterface();
  });
  modal.querySelector('#prevBtn')?.addEventListener('click', () => { if (state.currentTest.currentIndex > 0) { state.currentTest.currentIndex--; renderTestInterface(); } });
  modal.querySelector('#nextBtn')?.addEventListener('click', () => {
    if (state.currentTest.currentIndex < state.currentTest.questions.length - 1) { state.currentTest.currentIndex++; renderTestInterface(); } else { showSubmitConfirmation(); }
  });
  modal.querySelectorAll('[data-index]').forEach(b => b.addEventListener('click', () => { state.currentTest.currentIndex = parseInt(b.dataset.index); renderTestInterface(); }));
  modal.querySelector('#toggleLanguageBtn')?.addEventListener('click', () => { state.language = state.language === 'en' ? 'hi' : 'en'; localStorage.setItem('preferredLanguage', state.language); renderTestInterface(); });
  modal.querySelector('#submitTestBtn')?.addEventListener('click', showSubmitConfirmation);
  modal.querySelector('#closeTestBtn')?.addEventListener('click', () => { if (confirm('Exit test? Progress will be lost.')) exitTest(true); });
}

function showSubmitConfirmation() {
  const answered = Object.keys(state.testAnswers).length;
  const total = state.currentTest.questions.length;
  const body = `<div class="space-y-2"><p>Submit test?</p><div class="bg-gray-50 p-4 rounded"><p>Total: ${total}</p><p>Answered: ${answered}</p><p>Unanswered: ${total - answered}</p></div></div>`;
  showModal('Confirm Submission', body, submitTest, 'Submit');
}

function showModal(title, body, onConfirm, confirmText = 'Confirm') {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
  overlay.innerHTML = `<div class="bg-white p-6 rounded-2xl max-w-md w-full"><h3 class="text-xl font-bold mb-4">${title}</h3>${body}<div class="flex justify-end space-x-3 mt-6"><button class="cancelBtn px-4 py-2 border rounded-lg">Cancel</button><button class="confirmBtn px-4 py-2 bg-indigo-600 text-white rounded-lg">${confirmText}</button></div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.cancelBtn').addEventListener('click', () => overlay.remove());
  overlay.querySelector('.confirmBtn').addEventListener('click', async () => { await onConfirm(); overlay.remove(); });
}

function startTestTimer() {
  const timerEl = document.getElementById('timer');
  if (!timerEl) return;
  const update = () => {
    if (!state.testStartTime) return;
    const elapsed = Math.floor((Date.now() - state.testStartTime) / 1000) - (state.currentTest.result.totalPausedDuration || 0);
    const remaining = state.currentTest.test.duration * 60 - elapsed;
    if (remaining <= 0) { clearInterval(state.timerInterval); submitTest(true); return; }
    const m = Math.floor(remaining / 60), s = remaining % 60;
    timerEl.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    if (remaining <= 60) timerEl.className = 'text-2xl font-mono font-bold px-4 py-2 rounded-lg bg-red-100 text-red-700';
  };
  update();
  state.timerInterval = setInterval(update, 1000);
}

function startPausePolling() {
  state.pauseInterval = setInterval(async () => {
    if (!state.currentTest) return;
    try {
      // ✅ Use public endpoint
      const status = await apiCall(`/student/pause-status/${state.student.studentId}/${state.currentTest.testId}`);
      const overlay = document.getElementById('pauseOverlay');
      if (status.paused) {
        overlay.classList.add('flex');
        overlay.classList.remove('hidden');
        state.currentTest.result.totalPausedDuration = status.totalPausedDuration;
      } else {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
      }
    } catch (e) { /* ignore polling errors */ }
  }, 2000);
}

function startAutoSave() { state.autoSaveInterval = setInterval(() => { if (state.currentTest) console.log('Auto-saved'); }, 30000); }

function handleVisibilityChange() {
  if (document.hidden && state.currentTest) {
    state.tabSwitchCount++;
    if (state.tabSwitchCount >= 3) {
      showToast('Tab switch limit exceeded. Submitting...', 'error');
      submitTest(true);
    } else {
      showToast(`Warning: Tab switch (${state.tabSwitchCount}/3)`, 'error');
    }
  }
}

async function submitTest(isAuto = false) {
  clearInterval(state.timerInterval);
  clearInterval(state.pauseInterval);
  clearInterval(state.autoSaveInterval);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  const answers = Object.entries(state.testAnswers).map(([qid, ans]) => ({ questionId: qid, selectedAnswer: ans }));
  showLoading();
  try {
    const result = await apiCall('/student/submit-test', { method: 'POST', body: JSON.stringify({ studentId: state.student.studentId, testId: state.currentTest.testId, answers }) });
    document.getElementById('testModal').classList.add('hidden');
    document.getElementById('pauseOverlay').classList.add('hidden');
    showScoreModal(result);
    state.currentTest = null;
    loadPage('available');
  } catch (e) { showToast('Error submitting test', 'error'); }
  finally { hideLoading(); }
}

function showScoreModal(result) {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
  modal.innerHTML = `<div class="bg-white p-8 rounded-2xl max-w-md w-full text-center"><div class="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fas fa-check-circle text-5xl text-green-600"></i></div><h2 class="text-2xl font-bold mb-2">Test Completed!</h2><div class="bg-gray-50 rounded-lg p-6 mb-6"><p class="text-sm text-gray-500">Your Score</p><p class="text-5xl font-bold text-indigo-600 my-2">${result.score}</p><p class="text-gray-700">Rank: ${result.rank}</p></div><button class="closeModalBtn w-full py-3 bg-indigo-600 text-white rounded-lg">Continue</button></div>`;
  document.body.appendChild(modal);
  modal.querySelector('.closeModalBtn').addEventListener('click', () => modal.remove());
}

function exitTest(confirm = true) {
  if (confirm && !window.confirm('Exit test?')) return;
  clearInterval(state.timerInterval);
  clearInterval(state.pauseInterval);
  clearInterval(state.autoSaveInterval);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  document.getElementById('testModal').classList.add('hidden');
  state.currentTest = null;
}

// ==================== Results ====================
async function loadResults(container) {
  const results = await apiCall(`/results/student/${state.student.studentId}`);
  const tests = await apiCall('/public/tests');
  const testMap = Object.fromEntries(tests.map(t => [t.testId, t.testName]));
  container.innerHTML = `<div class="bg-white rounded-xl shadow-sm border"><div class="p-6 border-b"><h3 class="text-lg font-semibold">Your Results</h3></div><div class="p-6"><table class="w-full"><thead><tr><th>Test</th><th>Score</th><th>Rank</th><th>Date</th></tr></thead><tbody>${results.map(r => `<tr><td>${testMap[r.testId] || r.testId}</td><td class="font-semibold ${r.score >= 0 ? 'text-green-600' : 'text-red-600'}">${r.score}</td><td>${r.rank || '-'}</td><td>${new Date(r.submittedAt).toLocaleString()}</td></tr>`).join('')}</tbody></table></div></div>`;
}

// ==================== Discussions ====================
async function loadDiscussions(container) {
  const tests = await apiCall('/public/tests');
  container.innerHTML = `<div class="bg-white rounded-xl shadow-sm border"><div class="p-6 border-b"><h3 class="text-lg font-semibold mb-4">Discussions</h3><select id="discSelect" class="px-4 py-2 border rounded-lg"><option value="">Select test</option>${tests.map(t => `<option value="${t.testId}">${t.testName}</option>`).join('')}</select></div><div id="discContainer" class="p-6"><p class="text-gray-500 text-center py-8">Select a test</p></div></div>`;
  document.getElementById('discSelect').addEventListener('change', async (e) => {
    const tid = e.target.value;
    if (!tid) return;
    const discs = await apiCall(`/discussions/${tid}`);
    document.getElementById('discContainer').innerHTML = discs.map(d => `<div class="border rounded-lg p-4 mb-3"><h4 class="font-semibold">${d.title}</h4><p class="text-gray-600">${d.description || ''}</p>${d.link ? `<a href="${d.link}" target="_blank" class="text-indigo-600 text-sm">Link</a>` : ''}<p class="text-xs text-gray-400 mt-2">${new Date(d.createdAt).toLocaleString()}</p></div>`).join('') || '<p class="text-gray-500">No discussions</p>';
  });
}

// ==================== Messages ====================
async function loadMessages(container) {
  const msgs = await apiCall(`/messages?studentId=${state.student.studentId}`);
  container.innerHTML = `<div class="bg-white rounded-xl shadow-sm border flex flex-col h-[calc(100vh-200px)]"><div class="p-6 border-b"><h3 class="text-lg font-semibold">Messages with Admin</h3>${state.student.status === 'blocked' ? '<p class="text-red-600 text-sm">Your account is blocked.</p>' : ''}</div><div class="flex-1 overflow-y-auto p-6 space-y-3">${msgs.map(m => `<div class="flex ${m.sender === 'student' ? 'justify-end' : 'justify-start'}"><div class="max-w-xs px-4 py-2 rounded-lg ${m.sender === 'student' ? 'bg-indigo-600 text-white' : 'bg-gray-200'}"><p>${m.content}</p><p class="text-xs mt-1">${new Date(m.timestamp).toLocaleTimeString()}</p></div></div>`).join('')}</div>${state.student.status !== 'blocked' ? `<div class="p-6 border-t"><div class="flex space-x-2"><input type="text" id="msgInput" placeholder="Type..." class="flex-1 px-4 py-2 border rounded-lg"><button id="sendMsgBtn" class="px-6 py-2 bg-indigo-600 text-white rounded-lg">Send</button></div></div>` : ''}</div>`;
  if (state.student.status !== 'blocked') {
    document.getElementById('sendMsgBtn').addEventListener('click', async () => {
      const input = document.getElementById('msgInput');
      const content = input.value.trim();
      if (!content) return;
      await apiCall('/messages', { method: 'POST', body: JSON.stringify({ studentId: state.student.studentId, sender: 'student', content }) });
      input.value = '';
      loadPage('messages');
    });
  }
}

// ==================== Community ====================
async function loadCommunity(container) {
  const cls = state.student.class;
  if (!cls) { container.innerHTML = '<p class="text-gray-500 text-center py-8">Class not set.</p>'; return; }
  container.innerHTML = `<div class="bg-white rounded-xl shadow-sm border flex flex-col h-[calc(100vh-200px)]"><div class="p-6 border-b"><h3 class="text-lg font-semibold">Class ${cls} Community</h3></div><div class="flex-1 overflow-y-auto p-6 space-y-3" id="communityMessages"><p>Loading...</p></div><div class="p-6 border-t"><div class="flex space-x-2"><input type="text" id="communityMsgInput" placeholder="Type..." class="flex-1 px-4 py-2 border rounded-lg"><button id="sendCommunityMsgBtn" class="px-6 py-2 bg-indigo-600 text-white rounded-lg">Send</button></div></div></div>`;
  await loadCommunityMessages(cls);
  state.communityInterval = setInterval(() => loadCommunityMessages(cls), 3000);
  document.getElementById('sendCommunityMsgBtn').addEventListener('click', sendCommunityMessage);
  document.getElementById('communityMsgInput').addEventListener('keypress', e => e.key === 'Enter' && sendCommunityMessage());
}

async function loadCommunityMessages(cls) {
  const msgs = await apiCall(`/community/${cls}`);
  const container = document.getElementById('communityMessages');
  container.innerHTML = msgs.map(m => {
    const isMe = m.studentId === state.student.studentId;
    const displayName = formatName(m.studentName, m.studentId);
    return `<div class="flex ${isMe ? 'justify-end' : 'justify-start'}"><div class="max-w-xs"><div class="px-4 py-2 rounded-lg ${isMe ? 'bg-indigo-600 text-white' : 'bg-gray-200'}"><p>${m.content}</p><p class="text-xs mt-1">${new Date(m.timestamp).toLocaleTimeString()}</p></div></div></div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

function formatName(full, id) {
  const p = full.split(' ');
  return `${p[0]} ${p.length > 1 ? p[p.length - 1].charAt(0) + '.' : ''} (${id.slice(-2)})`;
}

async function sendCommunityMessage() {
  const input = document.getElementById('communityMsgInput');
  const content = input.value.trim();
  if (!content) return;
  input.disabled = true;
  try {
    await apiCall('/community', { method: 'POST', body: JSON.stringify({ studentId: state.student.studentId, studentName: state.student.fullName, studentClass: state.student.class, content }) });
    input.value = '';
    await loadCommunityMessages(state.student.class);
  } catch (e) { showToast(e.message, 'error'); }
  finally { input.disabled = false; input.focus(); }
}

// ==================== Initialization ====================
renderSidebar();
loadPage('dashboard');
document.getElementById('logoutBtn').addEventListener('click', () => { localStorage.removeItem('studentData'); location.href = 'index.html'; });
document.getElementById('refreshBtn').addEventListener('click', () => loadPage(state.currentPage));
window.addEventListener('beforeunload', () => {
  if (state.timerInterval) clearInterval(state.timerInterval);
  if (state.pauseInterval) clearInterval(state.pauseInterval);
  if (state.communityInterval) clearInterval(state.communityInterval);
});
