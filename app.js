/* =========================================================
   سنتري - نظام إدارة السنتر
   تخزين كامل محلي (IndexedDB) - يعمل بدون إنترنت
   ========================================================= */

let db;
const DB_NAME = 'sentryDB';
const DB_VERSION = 1;

let state = {
  students: [],
  groups: [],
  attendance: [],
  payments: [],
  expenses: [],
  quizzes: [],
  questions: [],
  results: []
};

let currentQuizId = null;
let payTab = 'income';
let numpadValue = '';

/* ---------------- INIT DB ---------------- */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      const stores = ['students','groups','attendance','payments','expenses','quizzes','questions','results'];
      stores.forEach(name => {
        if (!d.objectStoreNames.contains(name)) {
          d.createObjectStore(name, { keyPath: 'id' });
        }
      });
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(); };
    req.onerror = (e) => reject(e);
  });
}

/* مسح شامل لكل بيانات النظام - بتأكيد مزدوج لمنع أي حذف بالغلط
   لأن العملية دي نهائية ومش قابلة للتراجع */
async function resetAllData() {
  const ok1 = window.confirm(
    'تحذير: هذا الإجراء سيمسح كل بيانات النظام نهائياً (الطلاب، الحضور، الدفعات، الكويزات، كل شيء).\n\n' +
    'لا يمكن التراجع عن هذه الخطوة. هل أخذت نسخة احتياطية بالفعل؟\n\n' +
    'اضغط "موافق" فقط لو متأكد ومعاك نسخة احتياطية محفوظة.'
  );
  if (!ok1) return;

  const confirmText = window.prompt('للتأكيد النهائي، اكتب كلمة "مسح" بالعربي في الخانة دي ثم اضغط موافق:');
  if (confirmText !== 'مسح') {
    showToast('تم إلغاء العملية - لم يتم مسح أي شيء');
    return;
  }

  const stores = ['students','groups','attendance','payments','expenses','quizzes','questions','results'];
  try {
    await Promise.all(stores.map(name => new Promise((resolve, reject) => {
      const tx = db.transaction(name, 'readwrite');
      tx.objectStore(name).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    })));
    try { localStorage.removeItem('sentry_last_backup'); } catch(e) {}
    showToast('تم مسح كل البيانات بنجاح');
    setTimeout(() => location.reload(), 1200);
  } catch (e) {
    showToast('⚠️ حدث خطأ أثناء المسح - حاول مرة أخرى');
  }
}

function txStore(name, mode='readonly') {
  return db.transaction(name, mode).objectStore(name);
}

function getAll(storeName) {
  return new Promise((resolve) => {
    const store = txStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

function putItem(storeName, item) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => { showToast('⚠️ فشل حفظ البيانات - تأكد من توافر مساحة تخزين'); reject(tx.error); };
    tx.onabort = () => { showToast('⚠️ فشل حفظ البيانات - تأكد من توافر مساحة تخزين'); reject(tx.error); };
  });
}

function deleteItem(storeName, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => { showToast('⚠️ فشل حذف العنصر'); reject(tx.error); };
    tx.onabort = () => { showToast('⚠️ فشل حذف العنصر'); reject(tx.error); };
  });
}

async function loadAll() {
  state.students = await getAll('students');
  state.groups = await getAll('groups');
  state.attendance = await getAll('attendance');
  state.payments = await getAll('payments');
  state.expenses = await getAll('expenses');
  state.quizzes = await getAll('quizzes');
  state.questions = await getAll('questions');
  state.results = await getAll('results');

  if (state.groups.length === 0) {
    const def = { id: uid(), name: 'مجموعة عامة' };
    state.groups.push(def);
    await putItem('groups', def);
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}

/* ---------------- NAVIGATION ---------------- */
function goPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.drawer-item').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.getElementById('nav-' + name).classList.add('active');

  const fab = document.getElementById('fabBtn');
  fab.style.display = (name === 'students' || name === 'quizzes') ? 'flex' : 'none';

  if (name === 'home') renderDashboard();
  if (name === 'students') renderStudents();
  if (name === 'attendance') renderAttendancePage();
  if (name === 'payments') renderPayments();
  if (name === 'quizzes') renderQuizzes();

  if (name !== 'attendance') numpadValue = '', updateNumDisplay();
  closeDrawer();
}

function openDrawer() {
  document.getElementById('drawer').classList.add('active');
  document.getElementById('drawerOverlay').classList.add('active');
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('active');
  document.getElementById('drawerOverlay').classList.remove('active');
}

function fabAction() {
  const active = document.querySelector('.page.active').id;
  if (active === 'page-students') openStudentModal();
  if (active === 'page-quizzes') openQuizModal();
}

/* ---------------- TOAST ---------------- */
function showToast(msg, duration) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration || 2200);
}

/* ---------------- MODALS ---------------- */
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

/* =========================================================
   DASHBOARD
   ========================================================= */
function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0,10);
}
function thisMonthStr() {
  const d = new Date();
  return d.toISOString().slice(0,7);
}

function renderDashboard() {
  document.getElementById('statStudents').textContent = state.students.length;

  const today = todayStr();
  const todayAtt = state.attendance.filter(a => a.date === today);
  document.getElementById('statToday').textContent = todayAtt.length;

  const month = thisMonthStr();
  const monthPayments = state.payments.filter(p => (p.month || '').slice(0,7) === month);
  const totalPay = monthPayments.reduce((s,p) => s + Number(p.amount||0), 0);
  document.getElementById('statRevenue').textContent = totalPay.toLocaleString();

  const monthExpenses = state.expenses.filter(e => (e.date || '').slice(0,7) === month);
  const totalExp = monthExpenses.reduce((s,e) => s + Number(e.amount||0), 0);
  document.getElementById('statExpenses').textContent = totalExp.toLocaleString();

  document.getElementById('statNet').textContent = (totalPay - totalExp).toLocaleString() + ' ج.م';

  const recentBox = document.getElementById('recentAttendance');
  if (todayAtt.length === 0) {
    recentBox.innerHTML = `<div class="empty"><div class="ic">📋</div><p>لسه مفيش تسجيل حضور النهارده</p></div>`;
  } else {
    recentBox.innerHTML = todayAtt.slice().reverse().slice(0,8).map(a => {
      const st = state.students.find(s => s.id === a.studentId);
      const name = st ? st.name : 'طالب محذوف';
      const time = new Date(a.time).toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'});
      return `<div class="list-item">
        <div class="info"><div class="avatar">${initials(name)}</div>
          <div><div class="li-name">${escapeHtml(name)}</div><div class="li-sub">${time}</div></div>
        </div>
        <span class="badge green">حاضر</span>
      </div>`;
    }).join('');
  }

  const today_d = new Date();
  const dateOpts = {weekday:'long', year:'numeric', month:'long', day:'numeric'};
  document.getElementById('todayDate').textContent = today_d.toLocaleDateString('ar-EG', dateOpts);
}

function initials(name) {
  const parts = name.trim().split(' ');
  return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* =========================================================
   STUDENTS
   ========================================================= */
let activeGroupFilter = 'all';

function renderGroupFilters() {
  const wrap = document.getElementById('groupFilters');
  let html = `<span class="group-pill ${activeGroupFilter==='all'?'active':''}" onclick="setGroupFilter('all')">الكل</span>`;
  state.groups.forEach(g => {
    html += `<span class="group-pill ${activeGroupFilter===g.id?'active':''}" onclick="setGroupFilter('${g.id}')">${escapeHtml(g.name)}</span>`;
  });
  wrap.innerHTML = html;
}
function setGroupFilter(id) {
  activeGroupFilter = id;
  renderGroupFilters();
  renderStudents();
}

function renderStudents() {
  renderGroupFilters();
  const search = document.getElementById('studentSearch').value.trim().toLowerCase();
  let list = state.students.slice();
  if (activeGroupFilter !== 'all') list = list.filter(s => s.groupId === activeGroupFilter);
  if (search) list = list.filter(s =>
    s.name.toLowerCase().includes(search) ||
    (s.code||'').toLowerCase().includes(search) ||
    (s.phone||'').includes(search) ||
    (s.parentPhone||'').includes(search)
  );

  const box = document.getElementById('studentsList');
  if (list.length === 0) {
    box.innerHTML = `<div class="empty"><div class="ic">👥</div><p>لا يوجد طلاب${search?' مطابقين للبحث':''}</p></div>`;
  } else {
    box.innerHTML = list.map(s => {
      const group = state.groups.find(g => g.id === s.groupId);
      return `<div class="list-item" onclick="openStudentDetail('${s.id}')">
        <div class="info"><div class="avatar">${initials(s.name)}</div>
          <div><div class="li-name">${escapeHtml(s.name)}</div><div class="li-sub">${escapeHtml(group?.name||'-')} · ${escapeHtml(s.code)}</div></div>
        </div>
        <span class="badge gold">${s.fee ? s.fee + ' ج.م' : '-'}</span>
      </div>`;
    }).join('');
  }

  renderGroupsManageList();
  populateGroupSelects();
}

function renderGroupsManageList() {
  const box = document.getElementById('groupsList');
  if (state.groups.length === 0) {
    box.innerHTML = `<div class="empty"><div class="ic">🏷️</div><p>لا توجد مجموعات</p></div>`;
    return;
  }
  box.innerHTML = state.groups.map(g => {
    const count = state.students.filter(s => s.groupId === g.id).length;
    return `<div class="list-item">
      <div class="info"><div><div class="li-name">${escapeHtml(g.name)}</div><div class="li-sub">${count} طالب</div></div></div>
      <button class="btn outline sm" onclick="deleteGroup('${g.id}')">حذف</button>
    </div>`;
  }).join('');
}

async function addGroup() {
  const input = document.getElementById('newGroupName');
  const name = input.value.trim();
  if (!name) return;
  const g = { id: uid(), name };
  state.groups.push(g);
  await putItem('groups', g);
  input.value = '';
  renderStudents();
  showToast('تمت إضافة المجموعة');
}

async function deleteGroup(id) {
  if (state.students.some(s => s.groupId === id)) {
    showToast('لا يمكن الحذف - يوجد طلاب بهذه المجموعة');
    return;
  }
  state.groups = state.groups.filter(g => g.id !== id);
  await deleteItem('groups', id);
  renderStudents();
}

function populateGroupSelects() {
  const selects = ['stGroup', 'attGroupFilter'];
  selects.forEach(id => {
    const sel = document.getElementById(id);
    const current = sel.value;
    let options = state.groups.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
    if (id === 'attGroupFilter') options = `<option value="all">كل المجموعات</option>` + options;
    sel.innerHTML = options;
    if (current) sel.value = current;
  });
}

function nextStudentCode() {
  const nums = state.students.map(s => parseInt(s.code) || 0);
  const max = nums.length ? Math.max(...nums) : 0;
  return String(max+1);
}

function openStudentModal(studentId = null) {
  populateGroupSelects();
  document.getElementById('studentModalTitle').textContent = studentId ? 'تعديل بيانات الطالب' : 'طالب جديد';
  document.getElementById('editStudentId').value = studentId || '';
  document.getElementById('delStudentBtn').style.display = studentId ? 'inline-flex' : 'none';

  if (studentId) {
    const s = state.students.find(x => x.id === studentId);
    document.getElementById('stName').value = s.name;
    document.getElementById('stPhone').value = s.phone || '';
    document.getElementById('stParentPhone').value = s.parentPhone || '';
    document.getElementById('stCode').value = s.code;
    document.getElementById('stGroup').value = s.groupId;
    document.getElementById('stFee').value = s.fee || '';
    document.getElementById('stNotes').value = s.notes || '';
  } else {
    document.getElementById('stName').value = '';
    document.getElementById('stPhone').value = '';
    document.getElementById('stParentPhone').value = '';
    document.getElementById('stCode').value = nextStudentCode();
    document.getElementById('stFee').value = '';
    document.getElementById('stNotes').value = '';
  }
  openModal('studentModal');
}

async function saveStudent() {
  const name = document.getElementById('stName').value.trim();
  if (!name) { showToast('من فضلك ادخل اسم الطالب'); return; }
  const editId = document.getElementById('editStudentId').value;
  const existingStudent = editId ? state.students.find(s => s.id === editId) : null;

  const data = {
    id: editId || uid(),
    name,
    phone: document.getElementById('stPhone').value.trim(),
    parentPhone: document.getElementById('stParentPhone').value.trim(),
    code: document.getElementById('stCode').value.trim(),
    groupId: document.getElementById('stGroup').value,
    fee: Number(document.getElementById('stFee').value) || 0,
    notes: document.getElementById('stNotes').value.trim(),
    createdAt: existingStudent ? (existingStudent.createdAt || Date.now()) : Date.now()
  };

  if (editId) {
    const idx = state.students.findIndex(s => s.id === editId);
    state.students[idx] = data;
  } else {
    state.students.push(data);
  }
  await putItem('students', data);
  closeModal('studentModal');
  renderStudents();
  renderDashboard();
  showToast('تم الحفظ بنجاح');
}

async function deleteStudent() {
  const id = document.getElementById('editStudentId').value;
  if (!id) return;
  if (!confirm('هل أنت متأكد من حذف هذا الطالب؟')) return;
  state.students = state.students.filter(s => s.id !== id);
  await deleteItem('students', id);
  closeModal('studentModal');
  closeModal('studentDetailModal');
  renderStudents();
  renderDashboard();
  showToast('تم الحذف');
}

let currentDetailId = null;
function openStudentDetail(id) {
  const s = state.students.find(x => x.id === id);
  if (!s) return;
  currentDetailId = id;
  document.getElementById('sdName').textContent = s.name;
  document.getElementById('sdCode').textContent = s.code;
  document.getElementById('sdPhone').textContent = s.phone || '-';
  const g = state.groups.find(g => g.id === s.groupId);
  document.getElementById('sdGroup').textContent = g ? g.name : '-';

  document.getElementById('sdQrWrap').innerHTML = `<div class="qr-box" style="max-width:180px;"><canvas id="sdQrCanvas"></canvas></div>`;
  drawQR(s.code, document.getElementById('sdQrCanvas'));

  const att = state.attendance.filter(a => a.studentId === id).slice().reverse().slice(0,10);
  const box = document.getElementById('sdAttendance');
  if (att.length === 0) {
    box.innerHTML = `<div class="empty"><div class="ic">📋</div><p>لا يوجد سجل حضور</p></div>`;
  } else {
    box.innerHTML = att.map(a => {
      const d = new Date(a.time);
      return `<div class="list-item"><div class="li-name">${d.toLocaleDateString('ar-EG')}</div><div class="li-sub">${d.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})}</div></div>`;
    }).join('');
  }
  openModal('studentDetailModal');
}

function editFromDetail() {
  closeModal('studentDetailModal');
  openStudentModal(currentDetailId);
}

/* ---- Minimal QR code generator (no external libs) ---- */
/* Simple QR rendering using a tiny embedded encoder (Model 2, low ECC) */
function drawQR(text, canvas) {
  try {
    const qr = QRGen.create(text, { ecLevel: 'L' });
    const size = qr.size;
    const scale = Math.floor(180 / size) || 4;
    canvas.width = size * scale;
    canvas.height = size * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = '#1B2A4A';
    for (let y=0;y<size;y++){
      for (let x=0;x<size;x++){
        if (qr.modules[y][x]) ctx.fillRect(x*scale, y*scale, scale, scale);
      }
    }
  } catch (e) {
    canvas.parentElement.innerHTML = `<div style="text-align:center;padding:20px;"><div style="font-size:13px;color:var(--muted)">كود الطالب</div><div style="font-size:22px;font-weight:800;color:var(--navy);margin-top:6px;">${text}</div></div>`;
  }
}

/* =========================================================
   ATTENDANCE
   ========================================================= */
function renderAttendancePage() {
  updateNumDisplay();
  const dateSel = document.getElementById('attDateInput');
  if (!dateSel.dataset.init) {
    const opts = [];
    for (let i=0;i<14;i++){
      const d = new Date();
      d.setDate(d.getDate()-i);
      const iso = d.toISOString().slice(0,10);
      const label = i===0 ? 'اليوم - ' + d.toLocaleDateString('ar-EG') : d.toLocaleDateString('ar-EG');
      opts.push(`<option value="${iso}">${label}</option>`);
    }
    dateSel.innerHTML = opts.join('');
    dateSel.dataset.init = '1';
    dateSel.onchange = renderAttendanceList;
  }
  populateGroupSelects();
  renderAttendanceList();
}

function renderAttendanceList() {
  const date = document.getElementById('attDateInput').value || todayStr();
  const groupFilter = document.getElementById('attGroupFilter').value || 'all';
  let students = state.students.slice();
  if (groupFilter !== 'all') students = students.filter(s => s.groupId === groupFilter);

  const presentIds = new Set(state.attendance.filter(a => a.date === date).map(a => a.studentId));

  const box = document.getElementById('attendanceList');
  if (students.length === 0) {
    box.innerHTML = `<div class="empty"><div class="ic">👥</div><p>لا يوجد طلاب</p></div>`;
    return;
  }
  const month = thisMonthStr();
  box.innerHTML = students.map(s => {
    const present = presentIds.has(s.id);
    const paid = state.payments.some(p => p.studentId===s.id && (p.month||'').slice(0,7)===month);
    let btnClass='outline', label='تسجيل';
    if (present) {
      btnClass = paid ? 'green' : 'danger';
      label = paid ? '✅ حاضر - دافع' : '✅ حاضر - لم يدفع';
    }
    return `<div class="list-item">
      <div class="info"><div class="avatar">${initials(s.name)}</div>
        <div><div class="li-name">${escapeHtml(s.name)}</div><div class="li-sub">${escapeHtml(s.code)}</div></div>
      </div>
      <div style="display:flex; gap:6px; align-items:center;">
        <button class="btn outline sm" style="padding:10px 13px; font-size:18px;" onclick="whatsappParentAbsent('${s.id}')" title="إرسال غياب لولي الأمر">💬</button>
        <button class="btn ${btnClass} sm" onclick="toggleAttendance('${s.id}','${date}')">${label}</button>
      </div>
    </div>`;
  }).join('');
}

async function toggleAttendance(studentId, date) {
  const existing = state.attendance.find(a => a.studentId === studentId && a.date === date);
  if (existing) {
    state.attendance = state.attendance.filter(a => a !== existing);
    await deleteItem('attendance', existing.id);
    showToast('تم إلغاء الحضور');
  } else {
    const rec = { id: uid(), studentId, date, time: Date.now() };
    state.attendance.push(rec);
    await putItem('attendance', rec);
    showToast('تم تسجيل الحضور ✅');

    const student = state.students.find(s => s.id === studentId);
    const paid = state.payments.some(p => p.studentId === studentId && (p.month || '').slice(0, 7) === thisMonthStr());
    if (!paid) playWarningSound();
    const missedLast = wasAbsentLastCycle(studentId, date);
    fullScreenFlash(student, paid, missedLast);
  }
  renderAttendanceList();
  renderDashboard();
}

/* =========================================================
   NUMPAD ATTENDANCE
   ========================================================= */
/* =========================================================
   NUMPAD ATTENDANCE
   ========================================================= */
function updateNumDisplay() {
  const d = document.getElementById('codeDisplay');
  if (!d) return;
  d.textContent = numpadValue || '—';
  d.style.color = numpadValue ? '#fff' : 'rgba(255,255,255,.25)';
}

function numPress(n) {
  if (numpadValue.length >= 6) return;
  numpadValue += n;
  updateNumDisplay();
}

function numDel() {
  numpadValue = numpadValue.slice(0, -1);
  updateNumDisplay();
}

async function numConfirm() {
  if (!numpadValue) return;
  const code = numpadValue.trim();
  const student = state.students.find(s => String(s.code) === code);
  const flash = document.getElementById('attFlash');

  if (!student) {
    flash.innerHTML = `<div class="flash-err">❌ لا يوجد طالب بالكود ${escapeHtml(code)}</div>`;
    setTimeout(() => { flash.innerHTML = ''; },10000);
    playWarningSound();
    numpadValue = ''; 
    updateNumDisplay();
    return;
  }

  const date = document.getElementById('attDateInput').value || todayStr();
  const existing = state.attendance.find(a => a.studentId === student.id && a.date === date);
  const paid = state.payments.some(p => p.studentId === student.id && (p.month || '').slice(0, 7) === thisMonthStr());

  if (existing) {
    flash.innerHTML = `<div class="flash-err">⚠️ ${escapeHtml(student.name)} — حضوره مسجل مسبقًا</div>`;
    playWarningSound();
    fullScreenFlash(student, false, false);
  } else {
    const rec = { id: uid(), studentId: student.id, date, time: Date.now() };
    state.attendance.push(rec);
    await putItem('attendance', rec);
    const payLabel = paid ? '✅ دافع' : '⚠️ لم يدفع';
    const cls = paid ? 'flash-ok' : 'flash-err';
    flash.innerHTML = `<div class="${cls}">✅ ${escapeHtml(student.name)} — ${payLabel}</div>`;
    if (!paid) playWarningSound();
    const missedLast = wasAbsentLastCycle(student.id, date);
    fullScreenFlash(student, paid, missedLast);
    renderAttendanceList();
    renderDashboard();
  }

  setTimeout(() => { flash.innerHTML = ''; },10000);
  numpadValue = ''; 
  updateNumDisplay();
}

/* ---------------- FULL SCREEN FLASH + SOUND ---------------- */
let audioCtx;
function playWarningSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx;
    const playBeep = (delay, freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.value = 0.25;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const start = ctx.currentTime + delay;
      osc.start(start);
      gain.gain.setValueAtTime(0.25, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
      osc.stop(start + 0.2);
    };
    playBeep(0, 440);
    playBeep(0.22, 440);
  } catch (e) {}
}

/* =========================================================
   نظام الحضور بدورتين أسبوعياً (الطالب يحضر مرتين فقط في الأسبوع)
   - الدورة الأولى: السبت + الأحد + الاتنين
   - الدورة الثانية: الثلاثاء + الأربعاء + الخميس + الجمعة
   الطالب يُعتبر "حاضر" في الدورة لو سجّل حضور يوم واحد على الأقل
   جوه أيامها، ومش لازم يحضر كل أيامها.
   ========================================================= */
function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function fmtLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/* نطاق الدورة الحالية اللي يقع فيها تاريخ معين */
function getCycleRange(dateStr) {
  const d = parseLocalDate(dateStr);
  const dow = d.getDay(); // 0=أحد..6=سبت
  const backToSat = (dow + 1) % 7;
  const weekSat = addDays(d, -backToSat);
  const inCycleA = (dow === 6 || dow === 0 || dow === 1);
  const start = inCycleA ? weekSat : addDays(weekSat, 3);
  const end = inCycleA ? addDays(weekSat, 2) : addDays(weekSat, 6);
  return { cycle: inCycleA ? 'A' : 'B', start: fmtLocalDate(start), end: fmtLocalDate(end) };
}

/* نطاق الدورة اللي قبل الدورة الحالية مباشرة (المفروض الطالب حضر فيها) */
function getPrevCycleRange(dateStr) {
  const d = parseLocalDate(dateStr);
  const dow = d.getDay();
  const backToSat = (dow + 1) % 7;
  const weekSat = addDays(d, -backToSat);
  const inCycleA = (dow === 6 || dow === 0 || dow === 1);

  let start, end;
  if (inCycleA) {
    // الدورة اللي قبلها هي الدورة الثانية بتاعة الأسبوع اللي فات
    start = addDays(weekSat, -4);
    end = addDays(weekSat, -1);
  } else {
    // الدورة اللي قبلها هي الدورة الأولى بتاعة نفس الأسبوع
    start = weekSat;
    end = addDays(weekSat, 2);
  }
  return { start: fmtLocalDate(start), end: fmtLocalDate(end) };
}

/* true لو الطالب فوّت كل الدورة اللي قبل تاريخ الحضور الحالي بالكامل */
function wasAbsentLastCycle(studentId, date) {
  const { start, end } = getPrevCycleRange(date);
  const student = state.students.find(s => s.id === studentId);
  // لو الطالب اتسجل بعد ما الدورة اللي فاتت خلصت، مش عادل نعتبره غايب فيها
  if (student && student.createdAt) {
    const endDate = parseLocalDate(end);
    endDate.setHours(23, 59, 59, 999);
    if (student.createdAt > endDate.getTime()) return false;
  }
  return !state.attendance.some(a => a.studentId === studentId && a.date >= start && a.date <= end);
}

function fullScreenFlash(student, paid, missedLast) {
  const overlay = document.getElementById('fullFlash');
  const icon = document.getElementById('ffIcon');
  const name = document.getElementById('ffName');
  const status = document.getElementById('ffStatus');
  const warn = document.getElementById('ffWarn');

  overlay.classList.remove('show','ok','err');
  // force reflow to restart animation
  void overlay.offsetWidth;

  if (paid) {
    overlay.classList.add('ok');
    icon.textContent = '✅';
    status.textContent = 'حاضر — دافع';
  } else {
    overlay.classList.add('err');
    icon.textContent = '❌';
    status.textContent = student ? 'حاضر — لم يدفع' : '⚠️ حضور مسجل مسبقًا';
  }
  name.textContent = student ? student.name : '';

  if (missedLast) {
    warn.style.display = 'inline-block';
    warn.textContent = '⚠️ ملحوظة: الطالب غايب عن الدورة اللي فاتت';
  } else {
    warn.style.display = 'none';
  }

  overlay.classList.add('show');
  setTimeout(() => { overlay.classList.remove('show','ok','err'); }, 1450);
}
/* =========================================================
   PAYMENTS & EXPENSES
   ========================================================= */
function setPayTab(tab) {
  payTab = tab;
  document.getElementById('payTabIncome').classList.toggle('active', tab==='income');
  document.getElementById('payTabExpense').classList.toggle('active', tab==='expense');
  document.getElementById('incomeSection').style.display = tab==='income' ? 'block':'none';
  document.getElementById('expenseSection').style.display = tab==='expense' ? 'block':'none';
  renderPayments();
}

function renderPayments() {
  const month = thisMonthStr();

  if (payTab === 'income') {
    let paid = 0, due = 0;
    const box = document.getElementById('paymentsList');
    if (state.students.length === 0) {
      box.innerHTML = `<div class="empty"><div class="ic">👥</div><p>لا يوجد طلاب</p></div>`;
    } else {
      box.innerHTML = state.students.map(s => {
        const pay = state.payments.find(p => p.studentId === s.id && (p.month||'').slice(0,7) === month);
        const status = pay ? 'paid' : 'due';
        if (pay) paid += Number(pay.amount||0); else due += Number(s.fee||0);
        return `<div class="list-item">
          <div class="info"><div class="avatar">${initials(s.name)}</div>
            <div><div class="li-name">${escapeHtml(s.name)}</div><div class="li-sub">${s.fee||0} ج.م / شهريًا</div></div>
          </div>
          ${status==='paid'
            ? `<span class="badge green">مدفوع ${pay.amount}</span>`
            : `<button class="btn gold sm" onclick="openPaymentModal('${s.id}')">تسجيل دفعة</button>`}
        </div>`;
      }).join('');
    }
    document.getElementById('incPaidTotal').textContent = paid.toLocaleString() + ' ج.م';
    document.getElementById('incDueTotal').textContent = due.toLocaleString() + ' ج.م';

    const log = document.getElementById('paymentsLog');
    const recent = state.payments.slice().sort((a,b)=>b.createdAt-a.createdAt).slice(0,10);
    if (recent.length === 0) {
      log.innerHTML = `<div class="empty"><div class="ic">🧾</div><p>لا توجد دفعات مسجلة</p></div>`;
    } else {
      log.innerHTML = recent.map(p => {
        const st = state.students.find(s => s.id === p.studentId);
        return `<div class="list-item">
          <div class="info"><div><div class="li-name">${escapeHtml(st?st.name:'-')}</div><div class="li-sub">${p.month} ${p.note?'· '+escapeHtml(p.note):''}</div></div></div>
          <span class="badge gold">${p.amount} ج.م</span>
        </div>`;
      }).join('');
    }
  } else {
    const monthExp = state.expenses.filter(e => (e.date||'').slice(0,7) === month);
    const total = monthExp.reduce((s,e)=>s+Number(e.amount||0),0);
    document.getElementById('expTotal').textContent = total.toLocaleString() + ' ج.م';

    const log = document.getElementById('expensesLog');
    const all = state.expenses.slice().sort((a,b)=>b.createdAt-a.createdAt);
    if (all.length === 0) {
      log.innerHTML = `<div class="empty"><div class="ic">📭</div><p>لا توجد مصروفات مسجلة</p></div>`;
    } else {
      log.innerHTML = all.map(e => `<div class="list-item">
        <div class="info"><div><div class="li-name">${escapeHtml(e.desc)}</div><div class="li-sub">${e.date}</div></div></div>
        <span class="badge red">${e.amount} ج.م</span>
      </div>`).join('');
    }
  }
}

function openPaymentModal(studentId=null) {
  const sel = document.getElementById('payStudent');
  sel.innerHTML = state.students.map(s => `<option value="${s.id}">${escapeHtml(s.name)} (${s.code})</option>`).join('');
  if (studentId) sel.value = studentId;
  const st = state.students.find(s=>s.id===sel.value);
  document.getElementById('payAmount').value = st ? (st.fee||'') : '';
  document.getElementById('payMonth').value = thisMonthStr();
  document.getElementById('payNote').value = '';
  openModal('paymentModal');
}

async function savePayment() {
  const studentId = document.getElementById('payStudent').value;
  const amount = Number(document.getElementById('payAmount').value);
  const month = document.getElementById('payMonth').value;
  if (!studentId || !amount || !month) { showToast('من فضلك أكمل البيانات'); return; }

  const existing = state.payments.find(p => p.studentId===studentId && (p.month||'').slice(0,7)===month);
  const data = {
    id: existing ? existing.id : uid(),
    studentId, amount, month,
    note: document.getElementById('payNote').value.trim(),
    createdAt: Date.now()
  };
  if (existing) {
    const idx = state.payments.indexOf(existing);
    state.payments[idx] = data;
  } else {
    state.payments.push(data);
  }
  await putItem('payments', data);
  closeModal('paymentModal');
  renderPayments();
  renderDashboard();
  showToast('تم حفظ الدفعة');
}

function openExpenseModal() {
  document.getElementById('expDesc').value = '';
  document.getElementById('expAmount').value = '';
  document.getElementById('expDate').value = todayStr();
  openModal('expenseModal');
}

async function saveExpense() {
  const desc = document.getElementById('expDesc').value.trim();
  const amount = Number(document.getElementById('expAmount').value);
  const date = document.getElementById('expDate').value;
  if (!desc || !amount || !date) { showToast('من فضلك أكمل البيانات'); return; }
  const data = { id: uid(), desc, amount, date, createdAt: Date.now() };
  state.expenses.push(data);
  await putItem('expenses', data);
  closeModal('expenseModal');
  renderPayments();
  renderDashboard();
  showToast('تم حفظ المصروف');
}

/* =========================================================
   BACKUP / RESTORE
   ========================================================= */
function exportBackup() {
  const data = {
    app: 'sentry',
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    state: {
      students: state.students,
      groups: state.groups,
      attendance: state.attendance,
      payments: state.payments,
      expenses: state.expenses,
      quizzes: state.quizzes,
      questions: state.questions,
      results: state.results
    }
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = todayStr();
  a.href = url;
  a.download = `sentry-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  try { localStorage.setItem('sentry_last_backup', Date.now().toString()); } catch(e) {}
  showToast('تم تحميل النسخة الاحتياطية');
}

/* تذكير بأخذ نسخة احتياطية لو فاتت 7 أيام من آخر مرة - عشان البيانات
   كلها متخزنة محلياً على الجهاز بس، وأي مسح للمتصفح أو ضياع للموبايل
   ممكن يضيعها لو مفيش نسخة محفوظة في مكان تاني */
function checkBackupReminder() {
  try {
    const last = parseInt(localStorage.getItem('sentry_last_backup') || '0', 10);
    const days = (Date.now() - last) / (1000 * 60 * 60 * 24);
    if (!last || days >= 7) {
      showToast('⚠️ لم تأخذ نسخة احتياطية منذ فترة - يُفضّل تحميل نسخة من صفحة الإعدادات', 6000);
    }
  } catch(e) {}
}

async function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!confirm('سيتم استبدال كل البيانات الحالية بالبيانات الموجودة في الملف. هل تريد الاستمرار؟')) {
    event.target.value = '';
    return;
  }

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const incoming = data.state || data;

    const stores = ['students','groups','attendance','payments','expenses','quizzes','questions','results'];
    for (const name of stores) {
      if (!Array.isArray(incoming[name])) continue;
      const tx = db.transaction(name, 'readwrite');
      const store = tx.objectStore(name);
      store.clear();
      incoming[name].forEach(item => store.put(item));
      await new Promise(res => { tx.oncomplete = res; tx.onerror = res; });
      state[name] = incoming[name];
    }

    if (!state.groups || state.groups.length === 0) {
      const def = { id: uid(), name: 'مجموعة عامة' };
      state.groups = [def];
      await putItem('groups', def);
    }

    renderDashboard();
    renderStudents();
    renderAttendancePage();
    renderPayments();
    renderQuizzes();
    showToast('تمت استعادة البيانات بنجاح ✅');
  } catch (e) {
    showToast('فشل قراءة الملف - تأكد أنه ملف نسخة احتياطية صحيح');
  }
  event.target.value = '';
}


function renderQuizzes() {
  const box = document.getElementById('quizzesList');
  if (state.quizzes.length === 0) {
    box.innerHTML = `<div class="empty"><div class="ic">📝</div><p>لا توجد اختبارات - اضغط + لإضافة اختبار</p></div>`;
    document.getElementById('quizDetailCard').style.display = 'none';
    return;
  }
  box.innerHTML = state.quizzes.map(q => {
    const qCount = state.questions.filter(x=>x.quizId===q.id).length;
    const active = q.id === currentQuizId;
    return `<div class="list-item" onclick="openQuiz('${q.id}')" style="cursor:pointer;${active?'background:#FBF3DF;border-radius:10px;padding:12px 10px;':''}">
      <div class="info"><div><div class="li-name">${escapeHtml(q.title)}</div><div class="li-sub">${qCount} سؤال</div></div></div>
      <button class="btn outline sm" onclick="event.stopPropagation();deleteQuiz('${q.id}')">حذف</button>
    </div>`;
  }).join('');
}

function openQuizModal() {
  document.getElementById('quizTitle').value = '';
  openModal('quizModal');
}

async function saveQuiz() {
  const title = document.getElementById('quizTitle').value.trim();
  if (!title) return;
  const data = { id: uid(), title, createdAt: Date.now() };
  state.quizzes.push(data);
  await putItem('quizzes', data);
  closeModal('quizModal');
  renderQuizzes();
  showToast('تم إضافة الاختبار');
}

async function deleteQuiz(id) {
  if (!confirm('حذف الاختبار وكل أسئلته ونتائجه؟')) return;
  state.quizzes = state.quizzes.filter(q=>q.id!==id);
  const qs = state.questions.filter(x=>x.quizId===id);
  for (const q of qs) await deleteItem('questions', q.id);
  state.questions = state.questions.filter(x=>x.quizId!==id);
  const rs = state.results.filter(x=>x.quizId===id);
  for (const r of rs) await deleteItem('results', r.id);
  state.results = state.results.filter(x=>x.quizId!==id);
  await deleteItem('quizzes', id);
  if (currentQuizId===id) currentQuizId=null;
  renderQuizzes();
}

function openQuiz(id) {
  currentQuizId = id;
  const quiz = state.quizzes.find(q=>q.id===id);
  document.getElementById('quizDetailCard').style.display = 'block';
  document.getElementById('quizDetailTitle').textContent = quiz.title;
  renderQuizQuestions();
  renderQuizResultsList();
  const sel = document.getElementById('quizResultStudent');
  sel.innerHTML = state.students.map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  renderQuizzes();
}

function renderQuizQuestions() {
  const qs = state.questions.filter(q=>q.quizId===currentQuizId);
  const box = document.getElementById('quizQuestions');
  if (qs.length===0) {
    box.innerHTML = `<div class="empty"><div class="ic">❓</div><p>لا توجد أسئلة بعد</p></div>`;
    return;
  }
  box.innerHTML = qs.map((q,i)=>{
    const opts = q.options.map((o,idx)=>`<div class="opt-row">${idx===q.correct?'✅':'⬜'} ${escapeHtml(o)}</div>`).join('');
    return `<div class="q-card">
      <div class="qtext">${i+1}. ${escapeHtml(q.text)}</div>
      ${opts}
      <button class="small-link" onclick="deleteQuestion('${q.id}')">حذف السؤال</button>
    </div>`;
  }).join('');
}

async function deleteQuestion(id) {
  state.questions = state.questions.filter(q=>q.id!==id);
  await deleteItem('questions', id);
  renderQuizQuestions();
}

function openQuestionModal(quizId) {
  document.getElementById('qQuizId').value = quizId;
  ['qText','qOpt1','qOpt2','qOpt3','qOpt4'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('qCorrect').value = '0';
  openModal('questionModal');
}

async function saveQuestion() {
  const quizId = document.getElementById('qQuizId').value;
  const text = document.getElementById('qText').value.trim();
  const opts = [
    document.getElementById('qOpt1').value.trim(),
    document.getElementById('qOpt2').value.trim(),
    document.getElementById('qOpt3').value.trim(),
    document.getElementById('qOpt4').value.trim()
  ].filter(o=>o);
  const correct = Number(document.getElementById('qCorrect').value);
  if (!text || opts.length<2) { showToast('أدخل السؤال وعلى الأقل اختيارين'); return; }
  if (correct >= opts.length) { showToast('اختر إجابة صحيحة موجودة'); return; }

  const data = { id: uid(), quizId, text, options: opts, correct, createdAt: Date.now() };
  state.questions.push(data);
  await putItem('questions', data);
  closeModal('questionModal');
  renderQuizQuestions();
  renderQuizzes();
  showToast('تم إضافة السؤال');
}

async function saveQuizResult() {
  const studentId = document.getElementById('quizResultStudent').value;
  const score = Number(document.getElementById('quizResultScore').value);
  if (!studentId || isNaN(score)) { showToast('أكمل البيانات'); return; }
  const existing = state.results.find(r=>r.quizId===currentQuizId && r.studentId===studentId);
  const data = { id: existing?existing.id:uid(), quizId: currentQuizId, studentId, score, createdAt: Date.now() };
  if (existing) { const idx=state.results.indexOf(existing); state.results[idx]=data; }
  else state.results.push(data);
  await putItem('results', data);
  document.getElementById('quizResultScore').value = '';
  renderQuizResultsList();
  showToast('تم حفظ النتيجة');
}

function renderQuizResultsList() {
  const results = state.results.filter(r=>r.quizId===currentQuizId).sort((a,b)=>b.score-a.score);
  const box = document.getElementById('quizResultsList');
  const totalQ = state.questions.filter(q=>q.quizId===currentQuizId).length;
  if (results.length===0) {
    box.innerHTML = `<div class="empty"><div class="ic">📊</div><p>لا توجد نتائج مسجلة</p></div>`;
    return;
  }
  box.innerHTML = results.map(r=>{
    const st = state.students.find(s=>s.id===r.studentId);
    return `<div class="list-item">
      <div class="info"><div class="avatar">${initials(st?st.name:'?')}</div><div class="li-name">${escapeHtml(st?st.name:'-')}</div></div>
      <span class="badge gold">${r.score}${totalQ?(' / '+totalQ):''}</span>
    </div>`;
  }).join('');
}

/* =========================================================
   PAYMENT MODAL helper hooks
   ========================================================= */
document.addEventListener('change', (e)=>{
  if (e.target.id==='payStudent') {
    const st = state.students.find(s=>s.id===e.target.value);
    document.getElementById('payAmount').value = st ? (st.fee||'') : '';
  }
});

/* expense quick-add via payments page button injection */
function wireExpenseButton() {
  const expSection = document.getElementById('expenseSection');
  if (!expSection.querySelector('.addExpBtn')) {
    const btn = document.createElement('button');
    btn.className = 'btn danger block addExpBtn';
    btn.style.marginBottom = '14px';
    btn.textContent = '➕ إضافة مصروف';
    btn.onclick = openExpenseModal;
    expSection.insertBefore(btn, expSection.firstChild);
  }
}

/* =========================================================
   IMPORT FROM CSV
   ========================================================= */
function parseCSVLine(line) {
  const result = [];
  let cur = '', inQuotes = false;
  for (let i=0;i<line.length;i++){
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === ',' && !inQuotes) { result.push(cur); cur=''; continue; }
    cur += c;
  }
  result.push(cur);
  return result.map(s=>s.trim());
}

async function importCSV() {
  const fileInput = document.getElementById('importFile');
  const file = fileInput.files[0];
  if (!file) { showToast('من فضلك اختر ملف CSV'); return; }

  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) { showToast('الملف فاضي'); return; }

  const header = parseCSVLine(lines[0]).map(h=>h.toLowerCase());
  const idxName = header.findIndex(h=>h.includes('اسم')||h.includes('name'));
  const idxPhone = header.findIndex(h=>(h.includes('موبايل')||h.includes('phone'))&&!h.includes('ولي')&&!h.includes('امر')&&!h.includes('parent'));
  const idxParent = header.findIndex(h=>h.includes('ولي')||h.includes('امر')||h.includes('parent'));
  const idxGroup = header.findIndex(h=>h.includes('مجموع')||h.includes('group'));

  if (idxName === -1) { showToast('لم يتم العثور على عمود الاسم'); return; }

  let added = 0;
  for (let i=1;i<lines.length;i++) {
    const cols = parseCSVLine(lines[i]);
    const name = cols[idxName]?.trim();
    if (!name) continue;

    let groupId = state.groups[0]?.id;
    if (idxGroup !== -1 && cols[idxGroup]?.trim()) {
      const gName = cols[idxGroup].trim();
      let g = state.groups.find(g=>g.name===gName);
      if (!g) {
        g = { id: uid(), name: gName };
        state.groups.push(g);
        await putItem('groups', g);
      }
      groupId = g.id;
    }

    const data = {
      id: uid(),
      name,
      phone: idxPhone!==-1 ? (cols[idxPhone]||'').trim() : '',
      parentPhone: idxParent!==-1 ? (cols[idxParent]||'').trim() : '',
      code: nextStudentCode(),
      groupId,
      fee: 0,
      notes: '',
      createdAt: Date.now()
    };
    state.students.push(data);
    await putItem('students', data);
    added++;
  }

  fileInput.value = '';
  renderStudents();
  renderDashboard();
  showToast(`تم استيراد ${added} طالب`);
}


function callStudent(studentId) {
  const s = state.students.find(x => x.id === studentId);
  if (!s) return;
  if (!s.phone) { showToast('لا يوجد رقم موبايل للطالب'); return; }
  window.location.href = `tel:${s.phone}`;
}

function callParent(studentId) {
  const s = state.students.find(x => x.id === studentId);
  if (!s) return;
  if (!s.parentPhone) { showToast('لا يوجد رقم ولي أمر مسجل'); return; }
  window.location.href = `tel:${s.parentPhone}`;
}

/* ---------------- قوالب الرسائل التلقائية (قابلة للتعديل) ---------------- */
const DEFAULT_TEMPLATES = {
  studentCode: 'كودك هو ({code})\nمع تحيات eng.MohamedAshraf',
  parentAbsent: 'الطالب/ {name} المسجل لم يحضر اليوم'
};

function getMessageTemplates() {
  try {
    const saved = JSON.parse(localStorage.getItem('sentry_msg_templates') || '{}');
    return { ...DEFAULT_TEMPLATES, ...saved };
  } catch (e) {
    return { ...DEFAULT_TEMPLATES };
  }
}

function loadMessageTemplatesUI() {
  const t = getMessageTemplates();
  const a = document.getElementById('tplStudentCode');
  const b = document.getElementById('tplParentAbsent');
  if (a) a.value = t.studentCode;
  if (b) b.value = t.parentAbsent;
}

function saveMessageTemplates() {
  const studentCode = document.getElementById('tplStudentCode').value.trim() || DEFAULT_TEMPLATES.studentCode;
  const parentAbsent = document.getElementById('tplParentAbsent').value.trim() || DEFAULT_TEMPLATES.parentAbsent;
  try {
    localStorage.setItem('sentry_msg_templates', JSON.stringify({ studentCode, parentAbsent }));
    showToast('تم حفظ الرسائل بنجاح');
  } catch (e) {
    showToast('⚠️ فشل حفظ الرسائل');
  }
}

function fillTemplate(tpl, s) {
  return tpl.replace(/\{name\}/g, s.name || '').replace(/\{code\}/g, s.code || '');
}

/* بتاخد الرقم بأي صيغة وترجّعه بصيغة واتساب الصح (+20xxxxxxxxxx)
   المنطق: شيل كل حاجة غير أرقام، خد آخر 10 أرقام من اليمين (الأرقام
   الفعلية بدون أي صفر أو كود دولة)، وحط +20 قدامهم.
   ده بيحل مشكلة الإكسل اللي بيشيل الصفر الأول (01012345678→1012345678)
   وكمان لو حد سجل الرقم بـ 00201x أو 2010x أو +201x كلها هتتحول صح */
function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits || digits.length < 9) return null;
  const last10 = digits.slice(-10);
  return '20' + last10;
}

function whatsappStudent(studentId) {
  const s = state.students.find(x => x.id === studentId);
  if (!s) return;
  const phone = normalizePhone(s.phone);
  if (!phone) { showToast('لا يوجد رقم موبايل للطالب'); return; }
  const msg = fillTemplate(getMessageTemplates().studentCode, s);
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
}

function whatsappParentAbsent(studentId) {
  const s = state.students.find(x => x.id === studentId);
  if (!s) return;
  const phone = normalizePhone(s.parentPhone);
  if (!phone) { showToast('لا يوجد رقم ولي أمر مسجل'); return; }
  const msg = fillTemplate(getMessageTemplates().parentAbsent, s);
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
}

/* =========================================================
   STARTUP
   ========================================================= */
window.addEventListener('load', async () => {
  try {
    await openDB();
  } catch (err) {
    document.body.innerHTML = `
      <div style="padding:40px 20px; text-align:center; color:#fff; font-family:Tahoma,sans-serif;">
        <div style="font-size:48px; margin-bottom:14px;">⚠️</div>
        <h2 style="margin:0 0 10px;">تعذّر فتح قاعدة البيانات</h2>
        <p style="color:#aab;line-height:1.7;">
          ده ممكن يحصل لو فاتح التطبيق في وضع التصفح الخفي (Incognito/Private)،
          أو المتصفح مانع تخزين البيانات. جرّب تفتح التطبيق من الأيقونة اللي
          ضفتها على الشاشة الرئيسية (Add to Home Screen) بدل المتصفح العادي،
          أو من متصفح Chrome في الوضع العادي.
        </p>
      </div>`;
    return;
  }

  // نطلب من المتصفح يخلي تخزين البيانات "دائم" بدل ما يكون عرضة للحذف
  // التلقائي وقت ضغط مساحة التخزين على الجهاز
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  await loadAll();
  populateGroupSelects();
  wireExpenseButton();
  renderDashboard();
  renderAttendancePage();
  loadMessageTemplatesUI();

  document.getElementById('todayDate').textContent = new Date().toLocaleDateString('ar-EG', {weekday:'long', year:'numeric', month:'long', day:'numeric'});

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // لو فيه نسخة جديدة شغالة بالفعل وعندها التحكم، يبقى لازم نعرض البانر
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner();
          }
        });
      });
    }).catch(()=>{});
  }

  setTimeout(checkBackupReminder, 2500);
});

/* بانر بسيط يظهر لما تتحدث ملفات التطبيق (ميزة جديدة / تعديل) على
   السيرفر، عشان المستخدم يعرف إن فيه نسخة أحدث ويحدّث براحته بدون
   أي تأثير على البيانات المخزنة (البيانات في IndexedDB منفصلة تماماً
   عن ملفات الكود ومحدش يلمسها أبداً عند التحديث) */
function showUpdateBanner() {
  if (document.getElementById('updateBanner')) return;
  const div = document.createElement('div');
  div.id = 'updateBanner';
  div.style.cssText = `
    position:fixed; bottom:14px; left:14px; right:14px; z-index:9999;
    background:linear-gradient(135deg, var(--blue), var(--purple));
    color:#fff; padding:13px 16px; border-radius:14px;
    box-shadow:var(--shadow); display:flex; align-items:center;
    justify-content:space-between; gap:10px; font-size:13px;
  `;
  div.innerHTML = `
    <span>🔄 يوجد تحديث جديد للنظام</span>
    <button style="background:#fff; color:var(--navy); border:none; border-radius:8px; padding:7px 12px; font-weight:700; font-size:12px;">تحديث الآن</button>
  `;
  div.querySelector('button').onclick = () => location.reload();
  document.body.appendChild(div);
}

/* =========================================================
   EXPORT ENGINE — Excel (.xlsx) + Printable PDF
   ========================================================= */

/* --- SheetJS loader (loads once from CDN on first export) --- */
let _xlsxLoaded = false;
function loadXLSX() {
  return new Promise((resolve, reject) => {
    if (_xlsxLoaded || window.XLSX) { _xlsxLoaded = true; return resolve(); }
    const s = document.createElement('script');
    s.src = 'https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js';
    s.onload = () => { _xlsxLoaded = true; resolve(); };
    s.onerror = () => reject(new Error('تعذّر تحميل مكتبة Excel - تأكد من الاتصال بالنت عند أول تصدير'));
    document.head.appendChild(s);
  });
}

/* --- helpers --- */
function xlsxDownload(wb, filename) {
  XLSX.writeFile(wb, filename);
}

function arDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('ar-EG');
}
function arTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'});
}

/* =========================================================
   EXPORT: ATTENDANCE
   ========================================================= */
async function exportAttendance(format) {
  showToast('جاري التصدير...');
  // Build pivot: rows = students, cols = unique dates
  const dates = [...new Set(state.attendance.map(a=>a.date))].sort();
  const rows = state.students.map(s => {
    const g = state.groups.find(g=>g.id===s.groupId);
    const row = { 'الكود': s.code, 'الاسم': s.name, 'المجموعة': g?g.name:'-' };
    let total = 0;
    dates.forEach(d => {
      const present = state.attendance.some(a=>a.studentId===s.id && a.date===d);
      row[d] = present ? '✓' : '';
      if (present) total++;
    });
    row['إجمالي الحضور'] = total;
    return row;
  });

  if (format === 'excel') {
    try { await loadXLSX(); } catch(e) { showToast(e.message); return; }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    // col widths
    ws['!cols'] = [{ wch:8 },{ wch:22 },{ wch:14 }, ...dates.map(()=>({wch:12})), {wch:14}];
    XLSX.utils.book_append_sheet(wb, ws, 'الحضور');
    xlsxDownload(wb, `حضور_${thisMonthStr()}.xlsx`);
    showToast('✅ تم تصدير ملف Excel');
  } else {
    printTable('كشف الحضور — ' + thisMonthStr(),
      ['الكود','الاسم','المجموعة',...dates,'إجمالي الحضور'],
      rows.map(r => ['الكود','الاسم','المجموعة',...dates,'إجمالي الحضور'].map(k=>r[k]||''))
    );
  }
}

/* =========================================================
   EXPORT: PAYMENTS
   ========================================================= */
async function exportPayments(format) {
  showToast('جاري التصدير...');
  const month = thisMonthStr();
  const rows = state.students.map(s => {
    const g = state.groups.find(g=>g.id===s.groupId);
    const pay = state.payments.find(p=>p.studentId===s.id && (p.month||'').slice(0,7)===month);
    return {
      'الكود': s.code,
      'الاسم': s.name,
      'المجموعة': g?g.name:'-',
      'الرسوم الشهرية': s.fee||0,
      'المبلغ المدفوع': pay ? pay.amount : 0,
      'حالة الدفع': pay ? 'مدفوع ✓' : 'لم يدفع ✗',
      'تاريخ الدفع': pay ? arDate(pay.createdAt) : '',
      'ملاحظات': pay ? (pay.note||'') : ''
    };
  });

  const totalPaid = rows.reduce((s,r)=>s+Number(r['المبلغ المدفوع']||0),0);
  const totalDue  = rows.reduce((s,r)=>s+Number(r['الرسوم الشهرية']||0),0) - totalPaid;

  if (format === 'excel') {
    try { await loadXLSX(); } catch(e) { showToast(e.message); return; }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{wch:8},{wch:22},{wch:14},{wch:14},{wch:14},{wch:14},{wch:14},{wch:20}];
    // summary rows
    XLSX.utils.sheet_add_aoa(ws, [
      [],
      ['إجمالي المحصّل:', totalPaid, 'ج.م'],
      ['إجمالي المتأخرات:', totalDue, 'ج.م']
    ], { origin: -1 });
    XLSX.utils.book_append_sheet(wb, ws, 'الدفعات');
    xlsxDownload(wb, `دفعات_${month}.xlsx`);
    showToast('✅ تم تصدير ملف Excel');
  } else {
    const cols = ['الكود','الاسم','المجموعة','الرسوم الشهرية','المبلغ المدفوع','حالة الدفع','تاريخ الدفع','ملاحظات'];
    printTable('كشف الدفعات — ' + month, cols,
      rows.map(r=>cols.map(k=>r[k]||'')),
      [`إجمالي المحصّل: ${totalPaid} ج.م`, `إجمالي المتأخرات: ${totalDue} ج.م`]
    );
  }
}

/* =========================================================
   EXPORT: STUDENTS
   ========================================================= */
async function exportStudents(format) {
  showToast('جاري التصدير...');
  const rows = state.students.map(s => {
    const g = state.groups.find(g=>g.id===s.groupId);
    const attCount = state.attendance.filter(a=>a.studentId===s.id).length;
    const lastAtt  = state.attendance.filter(a=>a.studentId===s.id).sort((a,b)=>b.time-a.time)[0];
    return {
      'الكود': s.code,
      'الاسم': s.name,
      'المجموعة': g?g.name:'-',
      'موبايل الطالب': s.phone||'',
      'موبايل ولي الأمر': s.parentPhone||'',
      'الرسوم الشهرية': s.fee||0,
      'إجمالي الحضور': attCount,
      'آخر حضور': lastAtt ? arDate(lastAtt.time) : 'لم يحضر',
      'ملاحظات': s.notes||''
    };
  });

  if (format === 'excel') {
    try { await loadXLSX(); } catch(e) { showToast(e.message); return; }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{wch:8},{wch:22},{wch:14},{wch:15},{wch:15},{wch:14},{wch:14},{wch:14},{wch:22}];
    XLSX.utils.book_append_sheet(wb, ws, 'الطلاب');
    xlsxDownload(wb, `الطلاب_${todayStr()}.xlsx`);
    showToast('✅ تم تصدير ملف Excel');
  } else {
    const cols = ['الكود','الاسم','المجموعة','موبايل الطالب','موبايل ولي الأمر','الرسوم الشهرية','إجمالي الحضور','آخر حضور'];
    printTable('بيانات الطلاب', cols, rows.map(r=>cols.map(k=>r[k]||'')));
  }
}

/* =========================================================
   EXPORT: QUIZZES
   ========================================================= */
async function exportQuizzes(format) {
  if (!currentQuizId) { showToast('اختر اختبارًا أولاً'); return; }
  showToast('جاري التصدير...');
  const quiz = state.quizzes.find(q=>q.id===currentQuizId);
  const totalQ = state.questions.filter(q=>q.quizId===currentQuizId).length;
  const rows = state.results
    .filter(r=>r.quizId===currentQuizId)
    .sort((a,b)=>b.score-a.score)
    .map((r,i) => {
      const st = state.students.find(s=>s.id===r.studentId);
      const g  = st ? state.groups.find(g=>g.id===st.groupId) : null;
      return {
        'الترتيب': i+1,
        'الكود': st?st.code:'—',
        'الاسم': st?st.name:'—',
        'المجموعة': g?g.name:'—',
        'الدرجة': r.score,
        'من': totalQ||'—',
        'النسبة': totalQ ? Math.round(r.score/totalQ*100)+'%' : '—',
        'تاريخ التسجيل': arDate(r.createdAt)
      };
    });

  const title = `نتائج ${quiz.title}`;
  if (format === 'excel') {
    try { await loadXLSX(); } catch(e) { showToast(e.message); return; }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{wch:8},{wch:8},{wch:22},{wch:14},{wch:10},{wch:8},{wch:10},{wch:14}];
    XLSX.utils.book_append_sheet(wb, ws, 'النتائج');
    xlsxDownload(wb, `${title}.xlsx`);
    showToast('✅ تم تصدير ملف Excel');
  } else {
    const cols = ['الترتيب','الكود','الاسم','المجموعة','الدرجة','من','النسبة'];
    printTable(title, cols, rows.map(r=>cols.map(k=>r[k]||'')));
  }
}

/* =========================================================
   PRINT / PDF helper — opens a styled print window
   ========================================================= */
function printTable(title, cols, rowsData, summaryLines=[]) {
  const now = new Date().toLocaleDateString('ar-EG', {year:'numeric',month:'long',day:'numeric'});
  const tableRows = rowsData.map(row =>
    `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`
  ).join('');
  const summaryHtml = summaryLines.map(l=>`<div class="summary">${l}</div>`).join('');

  const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');
  *{box-sizing:border-box; margin:0; padding:0;}
  body{font-family:'Cairo','Tahoma',sans-serif; background:#fff; color:#1a1a2e; padding:28px 24px; direction:rtl;}
  .header{display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px; padding-bottom:14px; border-bottom:2.5px solid #4D8AFF;}
  .header .logo{font-size:26px; font-weight:900; color:#4D8AFF; letter-spacing:1px;}
  .header .logo span{color:#8B5CF6;}
  .header .meta{text-align:left; font-size:12px; color:#666; line-height:1.8;}
  h1{font-size:18px; font-weight:900; color:#1a1a2e; margin-bottom:14px;}
  table{width:100%; border-collapse:collapse; font-size:12px;}
  thead{background:linear-gradient(135deg,#4D8AFF,#8B5CF6); color:#fff;}
  thead th{padding:10px 8px; font-weight:700; border:1px solid rgba(255,255,255,.2);}
  tbody tr:nth-child(even){background:#f5f6ff;}
  tbody tr:hover{background:#ede9ff;}
  td{padding:8px; border:1px solid #e0e0f0; text-align:center;}
  td:nth-child(2){text-align:right; font-weight:700;}
  .summary{margin-top:14px; font-size:14px; font-weight:700; color:#4D8AFF; background:#f0f4ff; padding:8px 14px; border-radius:8px; display:inline-block; margin-left:8px;}
  .footer{margin-top:28px; padding-top:12px; border-top:1.5px solid #e0e0f0; display:flex; justify-content:space-between; font-size:11px; color:#999;}
  @media print{
    body{padding:10px;}
    .no-print{display:none;}
    thead{-webkit-print-color-adjust:exact; print-color-adjust:exact;}
    tbody tr:nth-child(even){-webkit-print-color-adjust:exact; print-color-adjust:exact;}
  }
  .print-btn{
    display:block; margin:0 auto 20px; padding:12px 32px;
    background:linear-gradient(135deg,#4D8AFF,#8B5CF6); color:#fff;
    border:none; border-radius:10px; font-size:16px; font-weight:700;
    cursor:pointer; font-family:inherit;
  }
</style>
</head><body>
<div class="header">
  <div class="logo">سن<span>تري</span></div>
  <div class="meta">
    <div><b>Eng. Mohamed Ashraf</b></div>
    <div>01020614529 — 01158668841</div>
    <div>${now}</div>
  </div>
</div>
<h1>${title}</h1>
<button class="print-btn no-print" onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
<table>
  <thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead>
  <tbody>${tableRows}</tbody>
</table>
${summaryHtml}
<div class="footer">
  <span>سنتري — نظام إدارة السنتر</span>
  <span>${now}</span>
</div>
</body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

/* =========================================================
   EXPORT MODAL / PANEL
   ========================================================= */
function openExportPanel(section) {
  // section: 'attendance' | 'payments' | 'students' | 'quizzes'
  const labels = {
    attendance: 'كشف الحضور',
    payments:   'كشف الدفعات',
    students:   'بيانات الطلاب',
    quizzes:    'نتائج الاختبار'
  };
  const existing = document.getElementById('exportPanel');
  if (existing) existing.remove();

  const panel = document.createElement('div');
  panel.id = 'exportPanel';
  panel.style.cssText = `
    position:fixed; bottom:0; right:0; left:0; z-index:150;
    background:#1B2038; border:1px solid #2E3552;
    border-radius:22px 22px 0 0;
    padding:20px 16px calc(20px + env(safe-area-inset-bottom));
    box-shadow:0 -8px 30px rgba(0,0,0,.5);
    animation:slideUp .25s ease;
  `;
  panel.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
      <div style="font-size:17px; font-weight:800; color:#fff;">📤 تصدير — ${labels[section]}</div>
      <button onclick="document.getElementById('exportPanel').remove()"
        style="width:32px;height:32px;border-radius:50%;border:1px solid #2E3552;background:#232A45;color:#E7E9F5;font-size:16px;font-weight:700;">✕</button>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
      <button onclick="export${cap(section)}('excel'); document.getElementById('exportPanel').remove();"
        style="padding:16px; border-radius:14px; background:linear-gradient(135deg,#1E6B3C,#2D9A5B); color:#fff; border:none; font-size:15px; font-weight:800; font-family:inherit;">
        <div style="font-size:28px; margin-bottom:6px;">📊</div>
        Excel (.xlsx)
        <div style="font-size:11px; opacity:.75; margin-top:4px;">فتح في برنامج الإكسل</div>
      </button>
      <button onclick="export${cap(section)}('pdf'); document.getElementById('exportPanel').remove();"
        style="padding:16px; border-radius:14px; background:linear-gradient(135deg,#7B1E1E,#C0392B); color:#fff; border:none; font-size:15px; font-weight:800; font-family:inherit;">
        <div style="font-size:28px; margin-bottom:6px;">🖨️</div>
        PDF / طباعة
        <div style="font-size:11px; opacity:.75; margin-top:4px;">حفظ PDF أو طباعة</div>
      </button>
    </div>
  `;
  document.body.appendChild(panel);
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }


const QRGen = (function(){
  // Galois field tables for Reed-Solomon
  const EXP = new Array(256), LOG = new Array(256);
  (function(){
    let x=1;
    for(let i=0;i<255;i++){ EXP[i]=x; LOG[x]=i; x = x<<1; if (x & 0x100) x ^= 0x11D; }
    EXP[255]=EXP[0];
  })();
  function gMul(a,b){ if(a===0||b===0) return 0; return EXP[(LOG[a]+LOG[b])%255]; }

  function rsGenPoly(degree){
    let poly=[1];
    for(let i=0;i<degree;i++){
      let next = new Array(poly.length+1).fill(0);
      for(let j=0;j<poly.length;j++){
        next[j] ^= gMul(poly[j], EXP[i]);
        next[j+1] ^= poly[j];
      }
      poly = next;
    }
    return poly;
  }
  function rsEncode(data, ecLen){
    const gen = rsGenPoly(ecLen);
    let res = data.slice();
    res = res.concat(new Array(ecLen).fill(0));
    for(let i=0;i<data.length;i++){
      const coef = res[i];
      if(coef!==0){
        for(let j=0;j<gen.length;j++){
          res[i+j] ^= gMul(gen[j], coef);
        }
      }
    }
    return res.slice(data.length);
  }

  // QR version configs for byte mode, EC level L (subset, versions 1-10 sufficient for short codes)
  // [version, totalCodewords, ecCodewordsPerBlock, numBlocks, dataCapacityBytes]
  const VERSIONS = [
    {v:1, size:21, total:26, ec:7, blocks:1, dataCap:19},
    {v:2, size:25, total:44, ec:10, blocks:1, dataCap:34},
    {v:3, size:29, total:70, ec:15, blocks:1, dataCap:55},
    {v:4, size:33, total:100, ec:20, blocks:1, dataCap:80},
    {v:5, size:37, total:134, ec:26, blocks:1, dataCap:108},
    {v:6, size:41, total:172, ec:18, blocks:2, dataCap:136},
    {v:7, size:45, total:196, ec:20, blocks:2, dataCap:156},
    {v:8, size:49, total:242, ec:24, blocks:2, dataCap:194},
    {v:9, size:53, total:292, ec:30, blocks:2, dataCap:232},
    {v:10,size:57, total:346, ec:18, blocks:4, dataCap:274}
  ];

  function selectVersion(byteLen){
    for(const cfg of VERSIONS){
      // capacity check accounting for mode+length header (~3 bytes)
      if (byteLen + 3 <= cfg.dataCap) return cfg;
    }
    return VERSIONS[VERSIONS.length-1];
  }

  function create(text, opts){
    const bytes = [];
    for (let i=0;i<text.length;i++) bytes.push(text.charCodeAt(i) & 0xFF);

    const cfg = selectVersion(bytes.length);
    const dataCodewords = cfg.total - cfg.ec*cfg.blocks;

    // Build bit stream: mode(4 bits)=0100, length(8 bits for v1-9 byte mode), data
    let bits = '0100'; // byte mode
    const lenBits = cfg.v < 10 ? 8 : 16;
    bits += bytes.length.toString(2).padStart(lenBits,'0');
    for(const b of bytes) bits += b.toString(2).padStart(8,'0');
    // terminator
    bits += '0000';
    // pad to byte boundary
    while(bits.length % 8 !== 0) bits += '0';
    // pad bytes
    const padBytes = [0xEC,0x11];
    let pi=0;
    while(bits.length/8 < dataCodewords){
      bits += padBytes[pi%2].toString(2).padStart(8,'0');
      pi++;
    }
    // convert to codewords
    let dataCw = [];
    for(let i=0;i<bits.length;i+=8) dataCw.push(parseInt(bits.substr(i,8),2));
    dataCw = dataCw.slice(0,dataCodewords);

    // split into blocks (simplified: equal blocks)
    const blockSize = Math.floor(dataCw.length / cfg.blocks);
    const blocks = [];
    let pos=0;
    for(let i=0;i<cfg.blocks;i++){
      const size = (i===cfg.blocks-1) ? dataCw.length-pos : blockSize;
      blocks.push(dataCw.slice(pos,pos+size));
      pos+=size;
    }
    // interleave data + ec
    const ecBlocks = blocks.map(b=>rsEncode(b, cfg.ec));
    const finalCw = [];
    const maxLen = Math.max(...blocks.map(b=>b.length));
    for(let i=0;i<maxLen;i++) for(const b of blocks) if(i<b.length) finalCw.push(b[i]);
    for(let i=0;i<cfg.ec;i++) for(const e of ecBlocks) finalCw.push(e[i]);

    // build matrix
    const size = cfg.size;
    const modules = Array.from({length:size},()=>new Array(size).fill(null));
    const reserved = Array.from({length:size},()=>new Array(size).fill(false));

    function setModule(x,y,val){ modules[y][x]=val; reserved[y][x]=true; }

    // finder patterns
    function placeFinder(px,py){
      for(let y=-1;y<=7;y++) for(let x=-1;x<=7;x++){
        const xi=px+x, yi=py+y;
        if(xi<0||yi<0||xi>=size||yi>=size) continue;
        let val=0;
        if(x>=0&&x<=6&&y>=0&&y<=6){
          if(x===0||x===6||y===0||y===6) val=1;
          else if(x>=2&&x<=4&&y>=2&&y<=4) val=1;
          else val=0;
        }
        setModule(xi,yi,val);
      }
    }
    placeFinder(0,0);
    placeFinder(size-7,0);
    placeFinder(0,size-7);

    // timing patterns
    for(let i=8;i<size-8;i++){
      setModule(i,6, i%2===0?1:0);
      setModule(6,i, i%2===0?1:0);
    }

    // dark module
    setModule(8, size-8, 1);

    // alignment patterns (version >=2)
    function placeAlign(px,py){
      for(let y=-2;y<=2;y++) for(let x=-2;x<=2;x++){
        let val=0;
        if(Math.max(Math.abs(x),Math.abs(y))===2||(x===0&&y===0)) val=1;
        setModule(px+x,py+y,val);
      }
    }
    const alignPos = {2:[6,18],3:[6,22],4:[6,26],5:[6,30],6:[6,34],7:[6,22,38],8:[6,24,42],9:[6,26,46],10:[6,28,50]};
    if(alignPos[cfg.v]){
      const positions = alignPos[cfg.v];
      for(const px of positions) for(const py of positions){
        if((px<=8&&py<=8)||(px<=8&&py>=size-9)||(px>=size-9&&py<=8)) continue;
        placeAlign(px,py);
      }
    }

    // format info reserved areas (we'll fill with EC level L + mask 0 fixed, simplified)
    // reserve format info strips
    for(let i=0;i<9;i++){
      if(!reserved[8][i]) reserved[8][i]=true, modules[8][i]=0;
      if(!reserved[i][8]) reserved[i][8]=true, modules[i][8]=0;
    }
    for(let i=size-8;i<size;i++){
      if(!reserved[8][i]) reserved[8][i]=true, modules[8][i]=0;
      if(!reserved[i][8]) reserved[i][8]=true, modules[i][8]=0;
    }

    // place data bits in zigzag
    const bitsAll = [];
    for(const cw of finalCw) for(let b=7;b>=0;b--) bitsAll.push((cw>>b)&1);
    // add remainder bits as 0
    let bi=0;
    let dir=-1;
    let col=size-1;
    while(col>0){
      if(col===6) col--; // skip timing column
      for(let i=0;i<size;i++){
        const row = dir===-1 ? size-1-i : i;
        for(const c of [col,col-1]){
          if(c<0) continue;
          if(reserved[row][c]) continue;
          const bit = bi<bitsAll.length ? bitsAll[bi]:0;
          bi++;
          // mask pattern 0: (row+col)%2==0
          const masked = ((row+c)%2===0) ? bit^1 : bit;
          modules[row][c]=masked;
          reserved[row][c]=true;
        }
      }
      dir = -dir;
      col -= 2;
    }

    // fill any remaining nulls with 0
    for(let y=0;y<size;y++) for(let x=0;x<size;x++) if(modules[y][x]===null) modules[y][x]=0;

    // format info (EC level L=01, mask=000) -> BCH encode
    function formatInfo(){
      const data = 0b01000; // ECL L (01) + mask(000)
      let bch = data << 10;
      const g = 0b10100110111;
      let temp = bch;
      for(let i=14;i>=10;i--){
        if((temp>>i)&1) temp ^= (g << (i-10));
      }
      let fmt = (data<<10 | temp) ^ 0b101010000010010;
      return fmt;
    }
    const fmt = formatInfo();
    const fmtBits=[];
    for(let i=14;i>=0;i--) fmtBits.push((fmt>>i)&1);
    // place around top-left finder
    const fmtPos1 = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
    for(let i=0;i<15;i++){ const [x,y]=fmtPos1[i]; modules[y][x]=fmtBits[i]; }
    const fmtPos2 = [[size-1,8],[size-2,8],[size-3,8],[size-4,8],[size-5,8],[size-6,8],[size-7,8],[size-8,8],[8,size-7],[8,size-6],[8,size-5],[8,size-4],[8,size-3],[8,size-2],[8,size-1]];
    for(let i=0;i<15;i++){ const [x,y]=fmtPos2[i]; modules[y][x]=fmtBits[i]; }

    return {size, modules};
  }

  return { create };
})();
