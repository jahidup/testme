// ==================== NexGen Admin Portal ====================
const state = {
  token: localStorage.getItem('adminToken'),
  currentPage: 'dashboard',
  data: { students: [], tests: [], questions: [], results: [] },
  monitorInterval: null,
  communityInterval: null
};

if (!state.token) window.location.href = 'index.html';

// ==================== API Wrapper ====================
async function apiCall(endpoint, options = {}) {
  const defaultOptions = {
    headers: { 'Authorization': `Bearer ${state.token}` }
  };
  if (!(options.body instanceof FormData)) {
    defaultOptions.headers['Content-Type'] = 'application/json';
  }
  try {
    const response = await fetch(`/api${endpoint}`, { ...defaultOptions, ...options });
    if (response.status === 401) {
      localStorage.removeItem('adminToken');
      window.location.href = 'index.html';
      throw new Error('Unauthorized');
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  } catch (error) {
    showToast(error.message, 'error');
    throw error;
  }
}

// ==================== UI Helpers ====================
function showLoading() {
  document.getElementById('loadingOverlay').classList.remove('hidden');
  document.getElementById('loadingOverlay').classList.add('flex');
}
function hideLoading() {
  document.getElementById('loadingOverlay').classList.add('hidden');
  document.getElementById('loadingOverlay').classList.remove('flex');
}
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast-enter p-4 rounded-lg shadow-lg text-white ${
    type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-indigo-600'
  }`;
  toast.innerHTML = `<i class="fas fa-${
    type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'
  } mr-2"></i>${message}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
function showModal(title, bodyHtml, onConfirm, confirmText = 'Confirm') {
  const overlay = document.getElementById('modalOverlay');
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHtml;
  const confirmBtn = document.getElementById('modalConfirmBtn');
  const cancelBtn = document.getElementById('modalCancelBtn');
  const closeBtn = document.getElementById('closeModalBtn');
  confirmBtn.textContent = confirmText;
  const closeModal = () => {
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
  };
  const handleConfirm = async () => {
    if (onConfirm) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Processing...';
      try {
        await onConfirm();
        closeModal();
      } catch (error) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = confirmText;
      }
    } else {
      closeModal();
    }
  };
  confirmBtn.onclick = handleConfirm;
  cancelBtn.onclick = closeModal;
  closeBtn.onclick = closeModal;
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
  overlay.classList.remove('hidden');
  overlay.classList.add('flex');
}
function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
  document.getElementById('modalOverlay').classList.remove('flex');
}

// ==================== Full-Page Form System ====================
function showFullPageForm(title, contentHtml, onSave) {
  const container = document.getElementById('fullPageFormContainer');
  document.getElementById('formTitle').textContent = title;
  document.getElementById('formContent').innerHTML = contentHtml;
  container.classList.remove('hidden');
  const closeBtn = document.getElementById('closeFormBtn');
  const saveHandler = async () => {
    if (onSave) {
      try {
        await onSave();
        container.classList.add('hidden');
      } catch (e) {}
    } else {
      container.classList.add('hidden');
    }
  };
  const form = document.getElementById('formContent').querySelector('form');
  if (form) {
    const btnContainer = document.createElement('div');
    btnContainer.className = 'flex justify-end space-x-3 mt-6 pt-4 border-t';
    btnContainer.innerHTML = `
      <button type="button" class="cancelFormBtn px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
      <button type="submit" class="saveFormBtn px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Save</button>
    `;
    form.appendChild(btnContainer);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveHandler();
    });
    btnContainer.querySelector('.cancelFormBtn').addEventListener('click', () => container.classList.add('hidden'));
  }
  closeBtn.onclick = () => container.classList.add('hidden');
}

// ==================== Navigation ====================
const pages = [
  { id: 'dashboard', label: 'Dashboard', icon: 'fa-chart-pie' },
  { id: 'students', label: 'Students', icon: 'fa-users' },
  { id: 'tests', label: 'Tests', icon: 'fa-file-alt' },
  { id: 'questions', label: 'Questions', icon: 'fa-question-circle' },
  { id: 'results', label: 'Results', icon: 'fa-chart-bar' },
  { id: 'discussions', label: 'Discussions', icon: 'fa-comments' },
  { id: 'messages', label: 'Messages', icon: 'fa-envelope' },
  { id: 'blocked', label: 'Blocked Students', icon: 'fa-ban' },
  { id: 'monitor', label: 'Monitor Tests', icon: 'fa-eye' },
  { id: 'community', label: 'Community Monitor', icon: 'fa-users' },
  { id: 'settings', label: 'Settings', icon: 'fa-cog' }
];
function renderSidebar() {
  const nav = document.getElementById('sidebarNav');
  nav.innerHTML = pages.map(p => `
    <button data-page="${p.id}" class="nav-item w-full text-left px-4 py-3 rounded-lg hover:bg-white/10 transition flex items-center ${state.currentPage === p.id ? 'bg-white/20' : ''}">
      <i class="fas ${p.icon} w-6"></i><span>${p.label}</span>
    </button>
  `).join('');
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentPage = btn.dataset.page;
      renderSidebar();
      loadPage(state.currentPage);
    });
  });
}

// ==================== Page Loader ====================
async function loadPage(pageId) {
  if (state.monitorInterval) { clearInterval(state.monitorInterval); state.monitorInterval = null; }
  if (state.communityInterval) { clearInterval(state.communityInterval); state.communityInterval = null; }
  showLoading();
  try {
    const titleMap = {
      dashboard: 'Dashboard', students: 'Student Management', tests: 'Test Management',
      questions: 'Question Bank', results: 'Exam Results', discussions: 'Discussion Forum',
      messages: 'Student Messages', blocked: 'Blocked Students', monitor: 'Test Monitoring',
      community: 'Community Monitor', settings: 'Admin Settings'
    };
    document.getElementById('pageTitle').textContent = titleMap[pageId];
    document.getElementById('pageSubtitle').textContent = '';
    const container = document.getElementById('contentContainer');
    switch(pageId) {
      case 'dashboard': await loadDashboard(container); break;
      case 'students': await loadStudents(container); break;
      case 'tests': await loadTests(container); break;
      case 'questions': await loadQuestions(container); break;
      case 'results': await loadResults(container); break;
      case 'discussions': await loadDiscussions(container); break;
      case 'messages': await loadMessages(container); break;
      case 'blocked': await loadBlockedStudents(container); break;
      case 'monitor': await loadMonitor(container); break;
      case 'community': await loadCommunityMonitor(container); break;
      case 'settings': await loadSettings(container); break;
    }
  } catch (error) {
    showToast('Error loading page: ' + error.message, 'error');
  } finally {
    hideLoading();
  }
}

// ==================== Dashboard ====================
async function loadDashboard(container) {
  const [students, tests, results, liveData] = await Promise.all([
    apiCall('/students'), apiCall('/tests'), apiCall('/results'), apiCall('/admin/live-students')
  ]);
  const liveTests = tests.filter(t => t.isLive).length;
  const activeStudents = students.filter(s => s.status === 'active').length;
  container.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <div class="bg-white p-6 rounded-xl shadow-sm border"><div class="flex justify-between"><div><p class="text-gray-500 text-sm">Total Students</p><p class="text-3xl font-bold">${students.length}</p><p class="text-xs text-green-600">Active: ${activeStudents}</p></div><div class="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center"><i class="fas fa-users text-indigo-600"></i></div></div></div>
      <div class="bg-white p-6 rounded-xl shadow-sm border"><div class="flex justify-between"><div><p class="text-gray-500 text-sm">Total Tests</p><p class="text-3xl font-bold">${tests.length}</p><p class="text-xs text-green-600">Live: ${liveTests}</p></div><div class="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center"><i class="fas fa-file-alt text-purple-600"></i></div></div></div>
      <div class="bg-white p-6 rounded-xl shadow-sm border"><div class="flex justify-between"><div><p class="text-gray-500 text-sm">Tests Taken</p><p class="text-3xl font-bold">${results.length}</p></div><div class="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center"><i class="fas fa-chart-bar text-orange-600"></i></div></div></div>
      <div class="bg-white p-6 rounded-xl shadow-sm border"><div class="flex justify-between"><div><p class="text-gray-500 text-sm">Live Students</p><p class="text-3xl font-bold">${liveData.count}</p></div><div class="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center relative"><i class="fas fa-users text-green-600"></i><span class="absolute top-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-white"></span></div></div></div>
    </div>
    <div class="bg-white p-6 rounded-xl shadow-sm border mt-6"><h3 class="text-lg font-semibold mb-4">Recent Results</h3><div class="overflow-x-auto"><table class="w-full"><thead><tr class="border-b"><th class="text-left py-3 px-4">Student ID</th><th>Test</th><th>Score</th><th>Rank</th><th>Submitted</th></tr></thead><tbody>${results.slice(0,5).map(r => `<tr class="border-b hover:bg-gray-50"><td class="py-3 px-4">${r.studentId}</td><td>${r.testId}</td><td class="font-semibold">${r.score}</td><td>${r.rank||'-'}</td><td class="text-sm text-gray-500">${new Date(r.submittedAt).toLocaleString()}</td></tr>`).join('')}</tbody></table></div></div>
  `;
}

// ==================== Students Page ====================
async function loadStudents(container) {
  const students = await apiCall('/students');
  state.data.students = students;
  container.innerHTML = `
    <div class="bg-white rounded-xl shadow-sm border overflow-hidden">
      <div class="p-6 border-b flex justify-between"><h3 class="text-lg font-semibold">Student List</h3><button id="addStudentBtn" class="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"><i class="fas fa-plus mr-2"></i>Add Student</button></div>
      <div class="p-6"><input type="text" id="studentSearch" placeholder="Search..." class="w-full px-4 py-2 border rounded-lg mb-4"><div class="overflow-x-auto"><table class="w-full"><thead><tr class="border-b"><th class="text-left py-3 px-4">ID</th><th>Name</th><th>Class</th><th>Mobile</th><th>Status</th><th>Actions</th></tr></thead><tbody id="studentsTableBody">${students.map(s => `<tr class="border-b hover:bg-gray-50"><td class="py-3 px-4 font-mono">${s.studentId}</td><td>${s.fullName}</td><td>${s.class||'-'}</td><td>${s.mobile||'-'}</td><td><span class="px-2 py-1 rounded-full text-xs ${s.status==='active'?'bg-green-100 text-green-800':'bg-red-100 text-red-800'}">${s.status}</span></td><td><button data-id="${s.studentId}" class="editStudentBtn text-indigo-600 mr-3">Edit</button>${s.status==='active'?`<button data-id="${s.studentId}" class="blockBtn text-red-600">Block</button>`:`<button data-id="${s.studentId}" class="unblockBtn text-green-600">Unblock</button>`}</td></tr>`).join('')}</tbody></table></div></div>
    </div>
  `;
  document.getElementById('studentSearch').addEventListener('input', e => {
    const term = e.target.value.toLowerCase();
    document.querySelectorAll('#studentsTableBody tr').forEach(row => row.style.display = row.textContent.toLowerCase().includes(term) ? '' : 'none');
  });
  document.getElementById('addStudentBtn').addEventListener('click', () => showStudentForm());
  document.querySelectorAll('.editStudentBtn').forEach(btn => btn.addEventListener('click', () => {
    const student = students.find(s => s.studentId === btn.dataset.id);
    showStudentForm(student);
  }));
  document.querySelectorAll('.blockBtn').forEach(btn => btn.addEventListener('click', () => showBlockModal(btn.dataset.id)));
  document.querySelectorAll('.unblockBtn').forEach(btn => btn.addEventListener('click', async () => {
    if(confirm('Unblock?')){ await apiCall(`/students/${btn.dataset.id}/unblock`,{method:'PUT'}); showToast('Unblocked','success'); loadPage('students'); }
  }));
}
function showStudentForm(student=null){
  const isEdit = !!student;
  const content = `
    <form id="studentForm" class="space-y-6"><div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div><label class="block text-sm font-medium mb-1">Student ID *</label><input type="text" name="studentId" value="${student?.studentId||''}" ${isEdit?'readonly':''} required class="w-full px-4 py-2 border rounded-lg"></div>
      <div><label class="block text-sm font-medium mb-1">Full Name *</label><input type="text" name="fullName" value="${student?.fullName||''}" required class="w-full px-4 py-2 border rounded-lg"></div>
      <div><label class="block text-sm font-medium mb-1">DOB (DDMMYYYY)*</label><input type="text" name="dob" value="${student?.dob||''}" required pattern="\\d{8}" class="w-full px-4 py-2 border rounded-lg"></div>
      <div><label class="block text-sm font-medium mb-1">Class</label><input type="text" name="class" value="${student?.class||''}" class="w-full px-4 py-2 border rounded-lg"></div>
      <div><label class="block text-sm font-medium mb-1">Mobile</label><input type="text" name="mobile" value="${student?.mobile||''}" class="w-full px-4 py-2 border rounded-lg"></div>
      <div><label class="block text-sm font-medium mb-1">Email</label><input type="email" name="email" value="${student?.email||''}" class="w-full px-4 py-2 border rounded-lg"></div>
    </div></form>
  `;
  showFullPageForm(isEdit?'Edit Student':'Add Student', content, async ()=>{
    const form = document.getElementById('studentForm');
    const data = Object.fromEntries(new FormData(form));
    showLoading();
    try {
      if(isEdit){
        await apiCall(`/students/${student.studentId}`,{method:'PUT',body:JSON.stringify(data)});
      }else{
        await apiCall('/students',{method:'POST',body:JSON.stringify(data)});
      }
      showToast(isEdit?'Updated':'Created','success');
      loadPage('students');
    }catch(e){ showToast(e.message,'error'); throw e; }
    finally{ hideLoading(); }
  });
}
function showBlockModal(studentId){
  const body = `<div><label class="block text-sm font-medium mb-1">Reason</label><textarea id="blockReason" rows="3" class="w-full px-3 py-2 border rounded-lg"></textarea></div>`;
  showModal('Block Student', body, async ()=>{
    const reason = document.getElementById('blockReason').value;
    if(!reason) throw new Error('Reason required');
    await apiCall(`/students/${studentId}/block`,{method:'PUT',body:JSON.stringify({reason})});
    showToast('Blocked','success');
    loadPage('students');
  },'Block');
}

// ==================== Tests Page ====================
async function loadTests(container) {
  const tests = await apiCall('/tests');
  state.data.tests = tests;
  container.innerHTML = `
    <div class="bg-white rounded-xl shadow-sm border overflow-hidden"><div class="p-6 border-b flex justify-between"><h3 class="text-lg font-semibold">Test List</h3><button id="addTestBtn" class="px-4 py-2 bg-indigo-600 text-white rounded-lg"><i class="fas fa-plus mr-2"></i>Create Test</button></div>
    <div class="p-6"><div class="overflow-x-auto"><table class="w-full"><thead><tr class="border-b"><th>ID</th><th>Name</th><th>Duration</th><th>Marks</th><th>Classes</th><th>Status</th><th>Schedule</th><th>Actions</th></tr></thead><tbody>${tests.map(t=>`<tr class="border-b hover:bg-gray-50"><td class="py-3 px-4 font-mono">${t.testId}</td><td>${t.testName}</td><td>${t.duration} min</td><td>+${t.marks.correct}/${t.marks.wrong}/${t.marks.skip}</td><td>${t.allowedClasses.join(',')}</td><td><span class="px-2 py-1 rounded-full text-xs ${t.isLive?'bg-green-100 text-green-800':'bg-gray-100'}">${t.isLive?'Live':'Draft'}</span></td><td class="text-sm">${t.startTime?new Date(t.startTime).toLocaleString():'-'}<br>${t.endTime?new Date(t.endTime).toLocaleString():'-'}</td><td><button data-id="${t.testId}" class="editTestBtn text-indigo-600 mr-2">Edit</button><button data-id="${t.testId}" class="deleteTestBtn text-red-600">Delete</button></td></tr>`).join('')}</tbody></table></div></div></div>
  `;
  document.getElementById('addTestBtn').addEventListener('click', ()=>showTestForm());
  document.querySelectorAll('.editTestBtn').forEach(btn=>btn.addEventListener('click', ()=>{
    const test = tests.find(t=>t.testId===btn.dataset.id);
    showTestForm(test);
  }));
  document.querySelectorAll('.deleteTestBtn').forEach(btn=>btn.addEventListener('click', async ()=>{
    if(confirm('Delete test? All questions & results will be lost.')){
      await apiCall(`/tests/${btn.dataset.id}`,{method:'DELETE'});
      showToast('Deleted','success');
      loadPage('tests');
    }
  }));
}
function showTestForm(test=null){
  const isEdit = !!test;
  const content = `
    <form id="testForm" class="space-y-6">
      <div class="grid grid-cols-2 gap-4">
        <div><label>Test ID *</label><input type="text" name="testId" value="${test?.testId||''}" ${isEdit?'readonly':''} required class="w-full px-4 py-2 border rounded-lg"></div>
        <div><label>Test Name *</label><input type="text" name="testName" value="${test?.testName||''}" required class="w-full px-4 py-2 border rounded-lg"></div>
        <div><label>Duration (min)*</label><input type="number" name="duration" value="${test?.duration||''}" required class="w-full px-4 py-2 border rounded-lg"></div>
        <div><label>Allowed Classes (comma)</label><input type="text" name="allowedClasses" value="${test?.allowedClasses?.join(',')||''}" class="w-full px-4 py-2 border rounded-lg"></div>
        <div><label>Correct Marks</label><input type="number" step="0.5" name="marks.correct" value="${test?.marks?.correct||1}" class="w-full px-4 py-2 border rounded-lg"></div>
        <div><label>Wrong Marks</label><input type="number" step="0.5" name="marks.wrong" value="${test?.marks?.wrong||0}" class="w-full px-4 py-2 border rounded-lg"></div>
        <div><label>Skip Marks</label><input type="number" step="0.5" name="marks.skip" value="${test?.marks?.skip||0}" class="w-full px-4 py-2 border rounded-lg"></div>
        <div><label>Start Time</label><input type="datetime-local" name="startTime" value="${test?.startTime?new Date(test.startTime).toISOString().slice(0,16):''}" class="w-full px-4 py-2 border rounded-lg"></div>
        <div><label>End Time</label><input type="datetime-local" name="endTime" value="${test?.endTime?new Date(test.endTime).toISOString().slice(0,16):''}" class="w-full px-4 py-2 border rounded-lg"></div>
      </div>
      <div class="flex items-center space-x-6">
        <label class="flex items-center"><input type="checkbox" name="shuffle" ${test?.shuffle?'checked':''}> Shuffle</label>
        <label class="flex items-center"><input type="checkbox" name="isLive" ${test?.isLive?'checked':''}> Live</label>
      </div>
    </form>
  `;
  showFullPageForm(isEdit?'Edit Test':'Create Test', content, async ()=>{
    const form = document.getElementById('testForm');
    const fd = new FormData(form);
    const data = {};
    for(let [k,v] of fd.entries()){
      if(k.includes('.')){ const [p,c]=k.split('.'); if(!data[p])data[p]={}; data[p][c]=parseFloat(v)||v; }
      else if(k==='allowedClasses') data[k]=v.split(',').map(s=>s.trim()).filter(s=>s);
      else if(k==='shuffle'||k==='isLive') data[k]=v==='on';
      else if(k==='duration') data[k]=parseInt(v);
      else data[k]=v;
    }
    if(isEdit) await apiCall(`/tests/${test.testId}`,{method:'PUT',body:JSON.stringify(data)});
    else await apiCall('/tests',{method:'POST',body:JSON.stringify(data)});
    showToast(isEdit?'Updated':'Created','success');
    loadPage('tests');
  });
}

// ==================== Questions Page ====================
async function loadQuestions(container) {
  const tests = await apiCall('/tests');
  container.innerHTML = `
    <div class="bg-white rounded-xl shadow-sm border"><div class="p-6 border-b"><h3 class="text-lg font-semibold mb-4">Question Management</h3>
      <div class="flex space-x-4"><select id="testSelect" class="px-4 py-2 border rounded-lg flex-1"><option value="">Select test</option>${tests.map(t=>`<option value="${t.testId}">${t.testName}</option>`).join('')}</select>
      <button id="addQuestionBtn" class="px-4 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-50" disabled><i class="fas fa-plus mr-2"></i>Add</button>
      <button id="uploadCsvBtn" class="px-4 py-2 border border-indigo-600 text-indigo-600 rounded-lg disabled:opacity-50" disabled><i class="fas fa-upload mr-2"></i>Upload CSV</button></div>
    </div><div class="p-6" id="questionsContainer"><p class="text-gray-500 text-center py-8">Select a test</p></div></div>
  `;
  const testSelect = document.getElementById('testSelect');
  const addBtn = document.getElementById('addQuestionBtn');
  const uploadBtn = document.getElementById('uploadCsvBtn');
  testSelect.addEventListener('change', async ()=>{
    const tid = testSelect.value;
    if(!tid){ addBtn.disabled=uploadBtn.disabled=true; document.getElementById('questionsContainer').innerHTML='<p class="text-gray-500 text-center py-8">Select a test</p>'; return; }
    addBtn.disabled=uploadBtn.disabled=false;
    showLoading();
    try {
      const questions = await apiCall(`/questions/${tid}`);
      renderQuestionsTable(questions, tid);
    } finally { hideLoading(); }
  });
  addBtn.addEventListener('click', ()=>{ if(testSelect.value) showQuestionForm(testSelect.value); });
  uploadBtn.addEventListener('click', ()=>{ if(testSelect.value) showCsvUploadForm(testSelect.value); });
}
function renderQuestionsTable(questions, testId){
  const container = document.getElementById('questionsContainer');
  container.innerHTML = `
    <div class="mb-4"><input type="text" id="questionSearch" placeholder="Search..." class="w-full px-4 py-2 border rounded-lg"></div>
    <div class="overflow-x-auto"><table class="w-full"><thead><tr class="border-b"><th>QID</th><th>Type</th><th>Question</th><th>Answer</th><th>Actions</th></tr></thead>
    <tbody id="questionsTableBody">${questions.map(q=>`<tr class="border-b hover:bg-gray-50"><td class="py-3 px-4 font-mono">${q.questionId}</td><td><span class="uppercase text-xs font-semibold px-2 py-1 bg-gray-100 rounded">${q.type}</span></td><td>${q.questionText.en.substring(0,50)}...</td><td>${q.type==='mcq'?`Option ${q.correctAnswer}`:q.correctAnswer}</td><td><button data-id="${q._id}" class="editQuestionBtn text-indigo-600 mr-2">Edit</button><button data-id="${q._id}" class="deleteQuestionBtn text-red-600">Delete</button></td></tr>`).join('')}</tbody></table></div>
  `;
  document.getElementById('questionSearch').addEventListener('input', e=>{
    const term = e.target.value.toLowerCase();
    document.querySelectorAll('#questionsTableBody tr').forEach(row=>row.style.display=row.textContent.toLowerCase().includes(term)?'':'none');
  });
  document.querySelectorAll('.editQuestionBtn').forEach(btn=>btn.addEventListener('click', ()=>{
    const q = questions.find(q=>q._id===btn.dataset.id);
    showQuestionForm(testId, q);
  }));
  document.querySelectorAll('.deleteQuestionBtn').forEach(btn=>btn.addEventListener('click', async ()=>{
    if(confirm('Delete question?')){ await apiCall(`/questions/${btn.dataset.id}`,{method:'DELETE'}); showToast('Deleted','success'); const updated = await apiCall(`/questions/${testId}`); renderQuestionsTable(updated, testId); }
  }));
}
function showQuestionForm(testId, question=null){
  const isEdit = !!question;
  const content = `
    <form id="questionForm" class="space-y-6 max-h-[70vh] overflow-y-auto">
      <input type="hidden" name="testId" value="${testId}">
      <div class="grid grid-cols-2 gap-4">
        <div><label>Question ID *</label><input type="text" name="questionId" value="${question?.questionId||''}" ${isEdit?'readonly':''} required class="w-full px-4 py-2 border rounded-lg"></div>
        <div><label>Type *</label><select name="type" id="qType" class="w-full px-4 py-2 border rounded-lg"><option value="mcq" ${question?.type==='mcq'?'selected':''}>MCQ</option><option value="numerical" ${question?.type==='numerical'?'selected':''}>Numerical</option></select></div>
      </div>
      <div><label>Question (EN)*</label><textarea name="questionText.en" rows="3" required class="w-full px-4 py-2 border rounded-lg">${question?.questionText?.en||''}</textarea></div>
      <div><label>Question (HI)</label><textarea name="questionText.hi" rows="3" class="w-full px-4 py-2 border rounded-lg">${question?.questionText?.hi||''}</textarea></div>
      <div id="optionsSection" style="display:${(!question||question.type==='mcq')?'block':'none'}">
        <label class="block font-medium mb-2">Options</label>
        ${[1,2,3,4].map(i=>`<div class="grid grid-cols-2 gap-2 mb-2"><input type="text" name="options[${i-1}].en" placeholder="Option ${i} (EN)" value="${question?.options?.[i-1]?.en||''}" class="px-3 py-2 border rounded-lg"><input type="text" name="options[${i-1}].hi" placeholder="Option ${i} (HI)" value="${question?.options?.[i-1]?.hi||''}" class="px-3 py-2 border rounded-lg"></div>`).join('')}
      </div>
      <div><label>Correct Answer *</label><input type="text" name="correctAnswer" value="${question?.correctAnswer||''}" required class="w-full px-4 py-2 border rounded-lg"><p id="answerHint" class="text-xs text-gray-500 mt-1">For MCQ, enter option number (1-4).</p></div>
      <div id="toleranceField" style="display:${question?.type==='numerical'?'block':'none'}"><label>Tolerance</label><input type="number" step="0.01" name="tolerance" value="${question?.tolerance||''}" class="w-full px-4 py-2 border rounded-lg"></div>
      <div class="grid grid-cols-3 gap-3"><div><label>Marks (Correct)</label><input type="number" step="0.5" name="marks.correct" value="${question?.marks?.correct||''}" class="w-full px-4 py-2 border rounded-lg"></div><div><label>Marks (Wrong)</label><input type="number" step="0.5" name="marks.wrong" value="${question?.marks?.wrong||''}" class="w-full px-4 py-2 border rounded-lg"></div><div><label>Marks (Skip)</label><input type="number" step="0.5" name="marks.skip" value="${question?.marks?.skip||''}" class="w-full px-4 py-2 border rounded-lg"></div></div>
      <div><label>Image URLs (semicolon)</label><input type="text" name="imageUrls" value="${question?.imageUrls?.join(';')||''}" class="w-full px-4 py-2 border rounded-lg"></div>
    </form>
  `;
  showFullPageForm(isEdit?'Edit Question':'Add Question', content, async ()=>{
    const form = document.getElementById('questionForm');
    const fd = new FormData(form);
    const data = { testId };
    for(let [k,v] of fd.entries()){
      if(k==='questionText.en'){ if(!data.questionText)data.questionText={}; data.questionText.en=v; }
      else if(k==='questionText.hi'){ if(!data.questionText)data.questionText={}; data.questionText.hi=v; }
      else if(k.startsWith('options[')){ const m = k.match(/options\[(\d+)\]\.(\w+)/); if(m){ const idx=parseInt(m[1]), lang=m[2]; if(!data.options)data.options=[{},{},{},{}]; data.options[idx][lang]=v; } }
      else if(k.includes('.')){ const [p,c]=k.split('.'); if(!data[p])data[p]={}; data[p][c]=parseFloat(v)||v; }
      else if(k==='type') data.type=v;
      else if(k==='correctAnswer') data.correctAnswer = data.type==='mcq'?parseInt(v):parseFloat(v);
      else if(k==='tolerance'&&v) data.tolerance=parseFloat(v);
      else if(k==='imageUrls') data.imageUrls=v.split(';').map(u=>u.trim()).filter(u=>u);
      else data[k]=v;
    }
    if(data.options) data.options = data.options.filter(opt=>opt.en||opt.hi);
    if(isEdit) await apiCall(`/questions/${question._id}`,{method:'PUT',body:JSON.stringify(data)});
    else await apiCall('/questions',{method:'POST',body:JSON.stringify(data)});
    showToast(isEdit?'Updated':'Added','success');
    const updated = await apiCall(`/questions/${testId}`);
    renderQuestionsTable(updated, testId);
  });
  const typeSelect = document.getElementById('qType');
  typeSelect.addEventListener('change', ()=>{
    document.getElementById('optionsSection').style.display = typeSelect.value==='mcq'?'block':'none';
    document.getElementById('toleranceField').style.display = typeSelect.value==='numerical'?'block':'none';
    document.getElementById('answerHint').textContent = typeSelect.value==='mcq'?'For MCQ, enter option number (1-4).':'For numerical, enter exact value.';
  });
}
function showCsvUploadForm(testId){
  const content = `
    <div class="space-y-6"><p class="text-gray-600">Upload CSV file. <a href="#" class="text-indigo-600">Download template</a></p>
    <div class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center"><input type="file" id="csvFileInput" accept=".csv" class="hidden"><label for="csvFileInput" class="cursor-pointer"><i class="fas fa-cloud-upload-alt text-4xl text-gray-400 mb-2"></i><p>Click to select CSV</p><p id="fileSelectedName" class="text-sm text-indigo-600 mt-1"></p></label></div>
    <div id="uploadProgress" class="hidden"><div class="flex items-center"><i class="fas fa-spinner fa-spin mr-2"></i>Uploading...</div></div></div>
  `;
  showFullPageForm('Upload Questions CSV', content, async ()=>{
    const file = document.getElementById('csvFileInput').files[0];
    if(!file) throw new Error('No file selected');
    document.getElementById('uploadProgress').classList.remove('hidden');
    const fd = new FormData(); fd.append('csvFile', file);
    try {
      const resp = await fetch(`/api/questions/upload/${testId}`,{method:'POST',headers:{'Authorization':`Bearer ${state.token}`},body:fd});
      const result = await resp.json();
      if(!resp.ok) throw new Error(result.error);
      showToast(`Processed ${result.count} questions`,'success');
      if(state.currentPage==='questions'){
        const ts = document.getElementById('testSelect');
        if(ts.value===testId){ const updated = await apiCall(`/questions/${testId}`); renderQuestionsTable(updated, testId); }
      }
    }catch(e){ showToast(e.message,'error'); throw e; }
    finally{ document.getElementById('uploadProgress').classList.add('hidden'); }
  });
  document.getElementById('csvFileInput').addEventListener('change', e=>{
    document.getElementById('fileSelectedName').textContent = e.target.files[0]?.name || '';
  });
}

// ==================== Results, Discussions, Messages, Blocked, Monitor, Community, Settings ====================
// (Due to length, the remaining functions are identical to the previously provided full admin.js.
// They include: loadResults, loadDiscussions, loadMessages, loadBlockedStudents, loadMonitor, loadCommunityMonitor, loadSettings,
// and all helper functions like showResultAnalysis, showBanModal, formatStudentName, etc.)
// Please use the complete versions from the earlier "all js ke code do" response.
// I'll include a condensed but functional version of Community Monitor here for completeness.

async function loadCommunityMonitor(container){
  const students = await apiCall('/students');
  const classes = [...new Set(students.map(s=>s.class).filter(c=>c))].sort();
  container.innerHTML = `<div class="bg-white rounded-xl shadow-sm border flex h-[calc(100vh-200px)]"><div class="w-80 border-r"><div class="p-4 border-b"><h4 class="font-semibold">Select Class</h4></div><div class="p-2"><select id="classSelect" class="w-full px-3 py-2 border rounded-lg"><option value="">Choose...</option>${classes.map(c=>`<option value="${c}">Class ${c}</option>`).join('')}</select></div><div class="p-4 border-t mt-2"><h5 class="font-medium text-sm mb-2">Banned Students</h5><div id="bannedList" class="text-sm"></div></div></div><div class="flex-1 flex flex-col"><div id="communityHeader" class="p-4 border-b"><p class="text-gray-500">Select a class</p></div><div id="communityMessages" class="flex-1 overflow-y-auto p-4"></div><div id="communityInput" class="p-4 border-t hidden"><div class="flex space-x-2"><input type="text" id="adminCommunityMsg" placeholder="Type as Admin..." class="flex-1 px-4 py-2 border rounded-lg"><button id="sendAdminCommunityMsg" class="px-4 py-2 bg-indigo-600 text-white rounded-lg">Send</button></div></div></div></div>`;
  const select = document.getElementById('classSelect');
  let currentClass = null;
  let interval = null;
  select.addEventListener('change', async ()=>{
    currentClass = select.value;
    if(!currentClass) return;
    document.getElementById('communityHeader').innerHTML = `<h3 class="font-semibold">Class ${currentClass} Community</h3><p class="text-sm text-gray-500">Admin view</p>`;
    document.getElementById('communityInput').classList.remove('hidden');
    await loadCommunityMsgs(currentClass);
    await loadBanned(currentClass);
    if(interval) clearInterval(interval);
    interval = setInterval(()=>loadCommunityMsgs(currentClass), 3000);
    state.communityInterval = interval;
  });
  async function loadCommunityMsgs(cls){
    const msgs = await apiCall(`/admin/community/${cls}`);
    const container = document.getElementById('communityMessages');
    container.innerHTML = msgs.map(m=>{
      const isAdmin = m.studentId==='ADMIN';
      const displayName = isAdmin ? 'Admin' : formatStudentName(m.studentName, m.studentId);
      return `<div class="flex ${isAdmin?'justify-center':'justify-start'}"><div class="max-w-xs md:max-w-md ${isAdmin?'w-full':''}">${!isAdmin?`<p class="text-xs text-gray-500 ml-1 mb-1">${displayName}</p>`:''}<div class="px-4 py-2 rounded-lg ${isAdmin?'bg-purple-100 text-purple-800 border border-purple-200':'bg-gray-200 text-gray-800'}"><p>${m.content}</p><div class="flex justify-between items-center mt-1"><p class="text-xs ${isAdmin?'text-purple-600':'text-gray-500'}">${new Date(m.timestamp).toLocaleTimeString()}</p>${!isAdmin?`<button data-student="${m.studentId}" class="banBtn text-red-500 text-xs">Ban</button>`:''}</div></div></div></div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
    document.querySelectorAll('.banBtn').forEach(btn=>btn.addEventListener('click', ()=>showBanModal(btn.dataset.student, currentClass)));
  }
  async function loadBanned(cls){
    const bans = await apiCall(`/admin/community/banned/${cls}`);
    const list = document.getElementById('bannedList');
    if(!bans.length) list.innerHTML = '<p class="text-gray-500">No banned students</p>';
    else list.innerHTML = bans.map(b=>`<div class="flex justify-between py-1 border-b"><span>${b.studentId}</span><button data-id="${b.studentId}" class="unbanBtn text-green-600 text-xs">Unban</button></div>`).join('');
    document.querySelectorAll('.unbanBtn').forEach(btn=>btn.addEventListener('click', async ()=>{
      await apiCall('/admin/community/unban',{method:'POST',body:JSON.stringify({studentId:btn.dataset.id,studentClass:currentClass})});
      showToast('Unbanned','success');
      loadBanned(currentClass);
    }));
  }
  document.getElementById('sendAdminCommunityMsg').addEventListener('click', async ()=>{
    const input = document.getElementById('adminCommunityMsg');
    const content = input.value.trim();
    if(!content||!currentClass) return;
    await apiCall('/admin/community/message',{method:'POST',body:JSON.stringify({studentClass:currentClass,content})});
    input.value='';
    await loadCommunityMsgs(currentClass);
  });
}
function formatStudentName(fullName, studentId){
  const parts = fullName.split(' ');
  const first = parts[0];
  const lastInit = parts.length>1 ? parts[parts.length-1].charAt(0)+'.' : '';
  return `${first} ${lastInit} (${studentId.slice(-2)})`;
}
function showBanModal(studentId, studentClass){
  const body = `<div><label class="block text-sm font-medium mb-1">Reason</label><textarea id="banReason" rows="2" class="w-full px-3 py-2 border rounded-lg"></textarea></div>`;
  showModal('Ban Student', body, async ()=>{
    const reason = document.getElementById('banReason').value;
    await apiCall('/admin/community/ban',{method:'POST',body:JSON.stringify({studentId,studentClass,reason})});
    showToast('Banned','success');
    document.getElementById('classSelect').dispatchEvent(new Event('change'));
  },'Ban');
}

// ==================== Initialization ====================
document.addEventListener('DOMContentLoaded', ()=>{
  renderSidebar();
  loadPage('dashboard');
  document.getElementById('logoutBtn').addEventListener('click', ()=>{
    localStorage.removeItem('adminToken');
    window.location.href = 'index.html';
  });
  document.getElementById('refreshBtn').addEventListener('click', ()=>loadPage(state.currentPage));
});
window.addEventListener('beforeunload', ()=>{
  if(state.monitorInterval) clearInterval(state.monitorInterval);
  if(state.communityInterval) clearInterval(state.communityInterval);
});
