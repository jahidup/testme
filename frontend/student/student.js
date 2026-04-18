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

// API Wrapper
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

// UI Helpers
function showLoading(){ document.body.insertAdjacentHTML('beforeend', `<div id="loadingOverlay" class="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50"><div class="bg-white p-6 rounded-2xl"><i class="fas fa-spinner fa-spin text-3xl text-indigo-600"></i></div></div>`); }
function hideLoading(){ document.getElementById('loadingOverlay')?.remove(); }
function showToast(msg, type='info'){
  const div = document.createElement('div'); div.className = 'fixed bottom-4 right-4 z-50';
  div.innerHTML = `<div class="toast-enter p-4 rounded-lg shadow-lg text-white ${type==='success'?'bg-green-500':type==='error'?'bg-red-500':'bg-indigo-600'}"><i class="fas fa-${type==='success'?'check-circle':type==='error'?'exclamation-circle':'info-circle'} mr-2"></i>${msg}</div>`;
  document.body.appendChild(div); setTimeout(()=>div.remove(), 3000);
}

// Navigation
const pages = [
  { id: 'dashboard', label: 'Dashboard', icon: 'fa-home' },
  { id: 'available', label: 'Available Tests', icon: 'fa-list' },
  { id: 'results', label: 'Previous Results', icon: 'fa-chart-bar' },
  { id: 'discussions', label: 'Discussions', icon: 'fa-comments' },
  { id: 'messages', label: 'Messages', icon: 'fa-envelope' },
  { id: 'community', label: 'Class Community', icon: 'fa-users' }
];
function renderSidebar(){
  document.getElementById('studentNameDisplay').textContent = `${state.student.fullName} (${state.student.class||'N/A'})`;
  const nav = document.getElementById('sidebarNav');
  nav.innerHTML = pages.map(p=>`<button data-page="${p.id}" class="nav-item w-full text-left px-4 py-3 rounded-lg hover:bg-white/10 transition flex items-center ${state.currentPage===p.id?'bg-white/20':''}"><i class="fas ${p.icon} w-6"></i><span>${p.label}</span></button>`).join('');
  nav.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click', ()=>{
    state.currentPage = btn.dataset.page;
    renderSidebar();
    loadPage(state.currentPage);
  }));
}

async function loadPage(pageId){
  if(state.communityInterval){ clearInterval(state.communityInterval); state.communityInterval = null; }
  showLoading();
  try {
    const titleMap = { dashboard:'Dashboard', available:'Available Tests', results:'Previous Results', discussions:'Discussions', messages:'Messages', community:'Class Community' };
    document.getElementById('pageTitle').textContent = titleMap[pageId];
    const container = document.getElementById('contentContainer');
    switch(pageId){
      case 'dashboard': await loadDashboard(container); break;
      case 'available': await loadAvailableTests(container); break;
      case 'results': await loadResults(container); break;
      case 'discussions': await loadDiscussions(container); break;
      case 'messages': await loadMessages(container); break;
      case 'community': await loadCommunity(container); break;
    }
  } catch(e){ showToast(e.message,'error'); }
  finally { hideLoading(); }
}

async function loadDashboard(container){
  const results = await apiCall(`/results/student/${state.student.studentId}`);
  const avg = results.length ? (results.reduce((a,r)=>a+r.score,0)/results.length).toFixed(1) : '0.0';
  container.innerHTML = `<div class="grid grid-cols-1 md:grid-cols-3 gap-6"><div class="bg-white p-6 rounded-xl shadow-sm border"><h3 class="text-lg font-semibold mb-4">Profile</h3><div class="space-y-2"><p><span class="font-medium">ID:</span> ${state.student.studentId}</p><p><span class="font-medium">Name:</span> ${state.student.fullName}</p><p><span class="font-medium">Class:</span> ${state.student.class||'N/A'}</p></div></div><div class="bg-white p-6 rounded-xl shadow-sm border"><h3 class="text-lg font-semibold mb-4">Statistics</h3><p class="text-4xl font-bold text-indigo-600">${results.length}</p><p class="text-gray-500">Tests Taken</p><p class="text-4xl font-bold text-green-600 mt-4">${avg}</p><p class="text-gray-500">Average Score</p></div><div class="bg-white p-6 rounded-xl shadow-sm border"><h3 class="text-lg font-semibold mb-4">Recent Activity</h3>${results.slice(0,5).map(r=>`<div class="py-2 border-b"><p class="font-medium">${r.testId}</p><p class="text-sm">Score: ${r.score} | Rank: ${r.rank||'N/A'}</p></div>`).join('')||'<p class="text-gray-500">No tests yet</p>'}</div></div>`;
}

async function loadAvailableTests(container){
  const tests = await apiCall(`/student/available-tests/${state.student.studentId}`);
  container.innerHTML = `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">${tests.map(t=>`<div class="bg-white p-6 rounded-xl shadow-sm border hover:shadow-md"><h3 class="text-xl font-bold">${t.testName}</h3><div class="space-y-2 text-gray-600 my-4"><p><i class="far fa-clock mr-2"></i>${t.duration} min</p><p><i class="far fa-calendar mr-2"></i>${new Date(t.startTime).toLocaleString()}</p><p><i class="fas fa-star mr-2"></i>+${t.marks.correct}/${t.marks.wrong}/${t.marks.skip}</p></div><button data-testid="${t.testId}" class="startTestBtn w-full py-2 bg-indigo-600 text-white rounded-lg">Start Test</button></div>`).join('')}${tests.length===0?'<p class="col-span-full text-center py-12 text-gray-500">No tests available</p>':''}</div>`;
  document.querySelectorAll('.startTestBtn').forEach(btn=>btn.addEventListener('click', ()=>startTest(btn.dataset.testid)));
}

// Test taking (similar to previous version, but ensure pause polling, timer, etc.)
async function startTest(testId){ /* ... same as before ... */ }
function renderTestInterface(){ /* ... */ }
function submitTest(){ /* ... */ }

// Results
async function loadResults(container){
  const results = await apiCall(`/results/student/${state.student.studentId}`);
  const tests = await apiCall('/tests');
  const testMap = Object.fromEntries(tests.map(t=>[t.testId,t.testName]));
  container.innerHTML = `<div class="bg-white rounded-xl shadow-sm border"><div class="p-6 border-b"><h3 class="text-lg font-semibold">Your Results</h3></div><div class="p-6"><table class="w-full"><thead><tr><th>Test</th><th>Score</th><th>Rank</th><th>Date</th><th>Actions</th></tr></thead><tbody>${results.map(r=>`<tr><td>${testMap[r.testId]||r.testId}</td><td class="font-semibold ${r.score>=0?'text-green-600':'text-red-600'}">${r.score}</td><td>${r.rank||'-'}</td><td>${new Date(r.submittedAt).toLocaleString()}</td><td><button data-test="${r.testId}" class="viewAnalysisBtn text-indigo-600">View</button></td></tr>`).join('')}</tbody></table></div></div>`;
  document.querySelectorAll('.viewAnalysisBtn').forEach(btn=>btn.addEventListener('click', ()=>showAnalysis(btn.dataset.test)));
}
async function showAnalysis(testId){ /* ... show modal with per-question breakdown ... */ }

// Discussions
async function loadDiscussions(container){
  const tests = await apiCall('/tests');
  container.innerHTML = `<div class="bg-white rounded-xl shadow-sm border"><div class="p-6 border-b"><h3 class="text-lg font-semibold mb-4">Discussions</h3><select id="discSelect" class="px-4 py-2 border rounded-lg"><option value="">Select test</option>${tests.map(t=>`<option value="${t.testId}">${t.testName}</option>`).join('')}</select></div><div id="discContainer" class="p-6"><p class="text-gray-500 text-center py-8">Select a test</p></div></div>`;
  document.getElementById('discSelect').addEventListener('change', async (e)=>{
    const tid = e.target.value;
    if(!tid) return;
    const discs = await apiCall(`/discussions/${tid}`);
    document.getElementById('discContainer').innerHTML = discs.map(d=>`<div class="border rounded-lg p-4 mb-3"><h4 class="font-semibold">${d.title}</h4><p class="text-gray-600">${d.description||''}</p>${d.link?`<a href="${d.link}" target="_blank" class="text-indigo-600 text-sm">Link</a>`:''}<p class="text-xs text-gray-400 mt-2">${new Date(d.createdAt).toLocaleString()}</p></div>`).join('')||'<p class="text-gray-500">No discussions</p>';
  });
}

// Messages
async function loadMessages(container){
  const msgs = await apiCall(`/messages?studentId=${state.student.studentId}`);
  container.innerHTML = `<div class="bg-white rounded-xl shadow-sm border flex flex-col h-[calc(100vh-200px)]"><div class="p-6 border-b"><h3 class="text-lg font-semibold">Messages with Admin</h3>${state.student.status==='blocked'?'<p class="text-red-600 text-sm">Your account is blocked.</p>':''}</div><div class="flex-1 overflow-y-auto p-6 space-y-3">${msgs.map(m=>`<div class="flex ${m.sender==='student'?'justify-end':'justify-start'}"><div class="max-w-xs px-4 py-2 rounded-lg ${m.sender==='student'?'bg-indigo-600 text-white':'bg-gray-200'}"><p>${m.content}</p><p class="text-xs mt-1">${new Date(m.timestamp).toLocaleTimeString()}</p></div></div>`).join('')}</div>${state.student.status!=='blocked'?`<div class="p-6 border-t"><div class="flex space-x-2"><input type="text" id="msgInput" placeholder="Type..." class="flex-1 px-4 py-2 border rounded-lg"><button id="sendMsgBtn" class="px-6 py-2 bg-indigo-600 text-white rounded-lg">Send</button></div></div>`:''}</div>`;
  if(state.student.status!=='blocked'){
    document.getElementById('sendMsgBtn').addEventListener('click', async ()=>{
      const input = document.getElementById('msgInput');
      const content = input.value.trim();
      if(!content) return;
      await apiCall('/messages',{method:'POST',body:JSON.stringify({studentId:state.student.studentId,sender:'student',content})});
      input.value='';
      loadPage('messages');
    });
  }
}

// Community Chat
async function loadCommunity(container){
  const cls = state.student.class;
  if(!cls){ container.innerHTML = '<p class="text-gray-500 text-center py-8">Class not set. Contact admin.</p>'; return; }
  container.innerHTML = `<div class="bg-white rounded-xl shadow-sm border flex flex-col h-[calc(100vh-200px)]"><div class="p-6 border-b"><h3 class="text-lg font-semibold">Class ${cls} Community</h3><p class="text-sm text-gray-500">Chat with classmates</p></div><div class="flex-1 overflow-y-auto p-6 space-y-3" id="communityMessages"><p class="text-center text-gray-500">Loading...</p></div><div class="p-6 border-t"><div class="flex space-x-2"><input type="text" id="communityMsgInput" placeholder="Type..." class="flex-1 px-4 py-2 border rounded-lg"><button id="sendCommunityMsgBtn" class="px-6 py-2 bg-indigo-600 text-white rounded-lg">Send</button></div></div></div>`;
  await loadCommunityMessages(cls);
  if(state.communityInterval) clearInterval(state.communityInterval);
  state.communityInterval = setInterval(()=>loadCommunityMessages(cls), 3000);
  document.getElementById('sendCommunityMsgBtn').addEventListener('click', sendCommunityMessage);
  document.getElementById('communityMsgInput').addEventListener('keypress', e=>{ if(e.key==='Enter') sendCommunityMessage(); });
}
async function loadCommunityMessages(cls){
  try {
    const msgs = await apiCall(`/community/${cls}`);
    const container = document.getElementById('communityMessages');
    container.innerHTML = msgs.map(m=>{
      const isMe = m.studentId === state.student.studentId;
      const displayName = formatDisplayName(m.studentName, m.studentId);
      return `<div class="flex ${isMe?'justify-end':'justify-start'}"><div class="max-w-xs md:max-w-md">${!isMe?`<p class="text-xs text-gray-500 ml-1 mb-1">${displayName}</p>`:''}<div class="px-4 py-2 rounded-lg ${isMe?'bg-indigo-600 text-white':'bg-gray-200 text-gray-800'}"><p>${m.content}</p><p class="text-xs mt-1 ${isMe?'text-indigo-200':'text-gray-500'}">${new Date(m.timestamp).toLocaleTimeString()}</p></div></div></div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
  } catch(e){ document.getElementById('communityMessages').innerHTML = '<p class="text-red-500">Failed to load messages</p>'; }
}
function formatDisplayName(fullName, studentId){
  const parts = fullName.split(' ');
  const first = parts[0];
  const lastInit = parts.length>1 ? parts[parts.length-1].charAt(0)+'.' : '';
  return `${first} ${lastInit} (${studentId.slice(-2)})`;
}
async function sendCommunityMessage(){
  const input = document.getElementById('communityMsgInput');
  const content = input.value.trim();
  if(!content) return;
  input.disabled = true;
  try {
    await apiCall('/community',{method:'POST',body:JSON.stringify({studentId:state.student.studentId,studentName:state.student.fullName,studentClass:state.student.class,content})});
    input.value='';
    await loadCommunityMessages(state.student.class);
  } catch(e){
    if(e.message.includes('banned')) showToast('You are banned from community chat','error');
    else showToast('Failed to send','error');
  } finally { input.disabled = false; input.focus(); }
}

// Initialize
renderSidebar();
loadPage('dashboard');
document.getElementById('logoutBtn').addEventListener('click', ()=>{
  localStorage.removeItem('studentData');
  window.location.href = 'index.html';
});
document.getElementById('refreshBtn').addEventListener('click', ()=>loadPage(state.currentPage));
window.addEventListener('beforeunload', ()=>{
  if(state.timerInterval) clearInterval(state.timerInterval);
  if(state.pauseInterval) clearInterval(state.pauseInterval);
  if(state.communityInterval) clearInterval(state.communityInterval);
});
