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
  if (name === 'payments') { guardPaymentsPage(); } else { paymentsUnlocked = false; }
  if (name === 'quizzes') renderQuizzes();
  if (name === 'followup') renderFollowupPage();
  if (name === 'settings') loadPaymentsPasswordStatusUI();

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

/* بيحسب النسبة المئوية والتقدير من الدرجة والدرجة النهائية */
function getGradeInfo(score, total) {
  if (!total || total <= 0 || score === null || score === undefined || score === '') return null;
  const pct = Math.round((Number(score) / Number(total)) * 1000) / 10;
  let label, color;
  if (pct >= 90) { label = 'ممتاز'; color = 'var(--green)'; }
  else if (pct >= 80) { label = 'جيد جدًا'; color = 'var(--green)'; }
  else if (pct >= 65) { label = 'جيد'; color = 'var(--blue)'; }
  else if (pct >= 50) { label = 'مقبول'; color = 'var(--orange)'; }
  else { label = 'ضعيف'; color = 'var(--red)'; }
  return { pct, label, color };
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
  let list = state.students.slice().sort((a,b)=> (a.code||'').localeCompare(b.code||'', undefined, {numeric:true}));
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

  const defaultFees = getDefaultFees();

  if (studentId) {
    const s = state.students.find(x => x.id === studentId);
    document.getElementById('stName').value = s.name;
    document.getElementById('stPhone').value = s.phone || '';
    document.getElementById('stParentPhone').value = s.parentPhone || '';
    document.getElementById('stParentPhone2').value = s.parentPhone2 || '';
    document.getElementById('stCode').value = s.code;
    document.getElementById('stGroup').value = s.groupId;
    document.getElementById('stFee').value = s.fee || '';
    document.getElementById('stNotes').value = s.notes || '';
  } else {
    document.getElementById('stName').value = '';
    document.getElementById('stPhone').value = '';
    document.getElementById('stParentPhone').value = '';
    document.getElementById('stParentPhone2').value = '';
    document.getElementById('stCode').value = nextStudentCode();
    document.getElementById('stFee').value = defaultFees.old || 300;
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
    parentPhone2: document.getElementById('stParentPhone2').value.trim(),
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

  // إظهار صف ولي الأمر الثاني لو في رقم
  const p2Row = document.getElementById('sdParent2Row');
  if (p2Row) p2Row.style.display = s.parentPhone2 ? 'flex' : 'none';

  // حالة الدفع ومعاد آخر دفعة
  const month = thisMonthStr();
  const payThisMonth = state.payments.find(p => p.studentId === id && (p.month||'').slice(0,7) === month);
  const sdPayStatus = document.getElementById('sdPayStatus');
  if (sdPayStatus) {
    if (payThisMonth) {
      sdPayStatus.textContent = `✅ دافع (${payThisMonth.amount} ج.م)`;
      sdPayStatus.style.color = 'var(--green)';
    } else {
      sdPayStatus.textContent = '⚠️ لم يدفع';
      sdPayStatus.style.color = 'var(--red)';
    }
  }
  const lastPayments = state.payments.filter(p => p.studentId === id).slice().sort((a,b)=>b.createdAt-a.createdAt);
  const sdPayDate = document.getElementById('sdPayDate');
  if (sdPayDate) {
    sdPayDate.textContent = lastPayments.length ? new Date(lastPayments[0].createdAt).toLocaleDateString('ar-EG') : 'لا يوجد';
  }

  renderAttendanceCycleSummary(id);

  openModal('studentDetailModal');
}

function editFromDetail() {
  closeModal('studentDetailModal');
  openStudentModal(currentDetailId);
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

let showAbsentOnly = false;

function toggleAbsentOnlyFilter() {
  showAbsentOnly = !showAbsentOnly;
  const btn = document.getElementById('absentOnlyBtn');
  if (btn) {
    btn.innerHTML = showAbsentOnly ? '👁️ عرض الكل' : '📵 عرض الغائبين فقط';
    btn.style.background = showAbsentOnly ? 'var(--red)' : 'transparent';
    btn.style.color = showAbsentOnly ? '#fff' : 'var(--red)';
  }
  renderAttendanceList();
}

function renderAttendanceList() {
  const date = document.getElementById('attDateInput').value || todayStr();
  const groupFilter = document.getElementById('attGroupFilter').value || 'all';
  const search = (document.getElementById('attSearch')?.value || '').trim().toLowerCase();
  let students = state.students.slice().sort((a,b)=> (a.code||'').localeCompare(b.code||'', undefined, {numeric:true}));
  if (groupFilter !== 'all') students = students.filter(s => s.groupId === groupFilter);
  if (search) students = students.filter(s =>
    (s.name||'').toLowerCase().includes(search) || (s.code||'').toLowerCase().includes(search)
  );

  const presentIds = new Set(state.attendance.filter(a => a.date === date).map(a => a.studentId));

  if (showAbsentOnly) students = students.filter(s => !presentIds.has(s.id));

  const box = document.getElementById('attendanceList');
  if (students.length === 0) {
    box.innerHTML = showAbsentOnly
      ? `<div class="empty"><div class="ic">🎉</div><p>مفيش غائبين — كل الطلاب حاضرين!</p></div>`
      : `<div class="empty"><div class="ic">👥</div><p>لا يوجد طلاب${search?' مطابقين للبحث':''}</p></div>`;
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
  if (currentDetailId === studentId) renderAttendanceCycleSummary(studentId);
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
    if (currentDetailId === student.id) renderAttendanceCycleSummary(student.id);
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

/* =========================================================
   ملخص الحضور/الغياب الدوري كل 8 حصص
   ========================================================= */
/* بيحسب لكل طالب، من تاريخ تسجيله، كام دورة (Cycle) المفروض كانت
   حصلت لحد آخر تاريخ موجود، وبيقارنها بعدد حصص الحضور الفعلية.
   كل ما الفرق (دورات فاتت - حضور فعلي) يدل على وصول الطالب لعتبة
   8 حصص مستهدفة، بيتعمل ملخص جديد */
function getAttendanceCycleSummary(studentId) {
  const student = state.students.find(s => s.id === studentId);
  if (!student) return null;

  const records = state.attendance.filter(a => a.studentId === studentId).slice().sort((a,b)=> a.date < b.date ? -1 : 1);
  const totalAttended = records.length;
  if (totalAttended === 0) return { totalAttended: 0, totalExpected: 0, totalAbsent: 0, periods: [] };

  // نحسب كل الدورات (cycles) اللي وقعت من تاريخ أول حصة لحد تاريخ آخر حصة (أو النهاردة)
  const startDate = parseLocalDate(records[0].date);
  const today = new Date();
  today.setHours(0,0,0,0);

  let cursor = new Date(startDate);
  const allCycles = [];
  // نلف على كل الدورات بداية من أول حصة لحد النهاردة
  const seen = new Set();
  while (cursor <= today) {
    const dStr = fmtLocalDate(cursor);
    const { start, end } = getCycleRange(dStr);
    const key = start + '_' + end;
    if (!seen.has(key)) {
      seen.add(key);
      const hasAttendance = state.attendance.some(a => a.studentId === studentId && a.date >= start && a.date <= end);
      allCycles.push({ start, end, attended: hasAttendance });
    }
    cursor = addDays(cursor, 1);
  }

  const totalExpected = allCycles.length;
  const totalAbsent = allCycles.filter(c => !c.attended).length;

  // تقسيم لفترات كل 8 دورات
  const periods = [];
  let i = 0;
  for (; i < allCycles.length; i += 8) {
    const chunk = allCycles.slice(i, i + 8);
    if (chunk.length < 8) break; // لسه الفترة معملتش 8 حصص كاملة
    const present = chunk.filter(c => c.attended).length;
    const absent = chunk.length - present;
    periods.push({
      from: chunk[0].start,
      to: chunk[chunk.length - 1].end,
      present, absent, total: chunk.length
    });
  }

  // الفترة الجارية (لسه ما اكتملتش 8 دورات)
  let currentPeriod = null;
  const remaining = allCycles.slice(i);
  if (remaining.length > 0) {
    const present = remaining.filter(c => c.attended).length;
    const absent = remaining.length - present;
    currentPeriod = {
      from: remaining[0].start,
      to: remaining[remaining.length - 1].end,
      present, absent, total: remaining.length
    };
  }

  return { totalAttended, totalExpected, totalAbsent, periods, currentPeriod, allCycles };
}

function renderAttendanceCycleSummary(studentId) {
  const box = document.getElementById('sdCycleSummary');
  if (!box) return;
  const summary = getAttendanceCycleSummary(studentId);

  if (!summary || !summary.allCycles || summary.allCycles.length === 0) {
    box.innerHTML = `<div class="empty" style="padding:14px;"><p style="font-size:12.5px;">لسه مفيش حصص مسجلة للطالب ده</p></div>`;
    return;
  }

  // كل حصة في صف لوحدها، من الأحدث للأقدم
  const rowsHtml = summary.allCycles
    .slice()
    .reverse()
    .map((c, idx, arr) => {
      const num = arr.length - idx; // رقم الحصة من الأقدم
      const dateLabel = c.start === c.end ? c.start : `${c.start}`;
      const statusHtml = c.attended
        ? `<span style="color:var(--green); font-weight:700;">✅ حضر</span>`
        : `<span style="color:var(--red); font-weight:700;">❌ غاب</span>`;
      return `<tr style="border-bottom:1px solid var(--line);">
        <td style="padding:9px 6px; font-size:12px; color:var(--muted); font-weight:600;">${num}</td>
        <td style="padding:9px 6px; font-size:12.5px;">${dateLabel}</td>
        <td style="padding:9px 6px; text-align:center; font-size:13px;">${statusHtml}</td>
      </tr>`;
    })
    .join('');

  box.innerHTML = `
    <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead>
          <tr style="border-bottom:2px solid var(--line);">
            <th style="padding:8px 6px; text-align:right; color:var(--muted); font-size:11px; width:32px;">#</th>
            <th style="padding:8px 6px; text-align:right; color:var(--muted); font-size:11px;">التاريخ</th>
            <th style="padding:8px 6px; text-align:center; color:var(--muted); font-size:11px;">الحالة</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
    <p style="font-size:11px; color:var(--muted); margin:8px 2px 0; text-align:right;">
      إجمالي: ${summary.totalExpected} حصة | حضر: ${summary.totalAttended} | غاب: ${summary.totalAbsent}
    </p>
  `;
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
    const search = (document.getElementById('paymentsSearch')?.value || '').trim().toLowerCase();
    let payStudents = state.students.slice().sort((a,b)=> (a.code||'').localeCompare(b.code||'', undefined, {numeric:true}));
    // نحسب الإجمالي/المتأخرات على كل الطلاب، مش بس نتيجة البحث
    state.students.forEach(s => {
      const pay = state.payments.find(p => p.studentId === s.id && (p.month||'').slice(0,7) === month);
      if (pay) paid += Number(pay.amount||0); else due += Number(s.fee||0);
    });
    if (search) payStudents = payStudents.filter(s =>
      (s.name||'').toLowerCase().includes(search) || (s.code||'').toLowerCase().includes(search)
    );
    if (payStudents.length === 0) {
      box.innerHTML = `<div class="empty"><div class="ic">👥</div><p>لا يوجد طلاب${search?' مطابقين للبحث':''}</p></div>`;
    } else {
      box.innerHTML = payStudents.map(s => {
        const pay = state.payments.find(p => p.studentId === s.id && (p.month||'').slice(0,7) === month);
        const status = pay ? 'paid' : 'due';
        return `<div class="list-item">
          <div class="info" style="cursor:pointer;" onclick="openPaymentHistoryModal('${s.id}')"><div class="avatar">${initials(s.name)}</div>
            <div><div class="li-name">${escapeHtml(s.name)}</div><div class="li-sub">${escapeHtml(s.code||'')} · ${s.fee||0} ج.م / شهريًا</div></div>
          </div>
          ${status==='paid'
            ? `<div style="display:flex; gap:6px; align-items:center;">
                 <span class="badge green">مدفوع ${pay.amount}</span>
                 <button class="btn outline sm" style="padding:6px 10px; font-size:12px; color:var(--red); border-color:var(--red);" onclick="cancelPayment('${pay.id}')">إلغاء الدفع</button>
               </div>`
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
          <div style="display:flex; gap:6px; align-items:center;">
            <span class="badge gold">${p.amount} ج.م</span>
            <button class="btn outline sm" style="padding:6px 10px; font-size:12px; color:var(--red); border-color:var(--red);" onclick="cancelPayment('${p.id}')">إلغاء</button>
          </div>
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

async function cancelPayment(paymentId) {
  const pay = state.payments.find(p => p.id === paymentId);
  if (!pay) return;
  const st = state.students.find(s => s.id === pay.studentId);
  if (!confirm(`متأكد إنك عايز تلغي دفعة ${escapeHtml(st ? st.name : '')} (${pay.amount} ج.م)؟`)) return;
  state.payments = state.payments.filter(p => p.id !== paymentId);
  await deleteItem('payments', paymentId);
  renderPayments();
  renderDashboard();
  showToast('تم إلغاء الدفعة');
}

function openPaymentHistoryModal(studentId) {
  const st = state.students.find(s => s.id === studentId);
  if (!st) return;

  document.getElementById('phName').textContent = st.name;
  document.getElementById('phCode').textContent = `${st.code || ''} · ${st.fee||0} ج.م / شهريًا`;

  const moNames = ['','يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const records = state.payments
    .filter(p => p.studentId === studentId)
    .slice()
    .sort((a,b) => (b.month||'').localeCompare(a.month||''));

  const total = records.reduce((s,p) => s + Number(p.amount||0), 0);
  document.getElementById('phTotal').textContent = total.toLocaleString() + ' ج.م';
  document.getElementById('phCount').textContent = records.length;

  const list = document.getElementById('phList');
  if (records.length === 0) {
    list.innerHTML = `<div class="empty"><div class="ic">🧾</div><p>لا توجد دفعات مسجلة لهذا الطالب</p></div>`;
  } else {
    list.innerHTML = records.map(p => {
      const [yr, mo] = (p.month||'').split('-');
      const monthLabel = mo ? `${moNames[Number(mo)]} ${yr}` : (p.month || '—');
      return `<div class="list-item">
        <div class="info"><div><div class="li-name">${escapeHtml(monthLabel)}</div><div class="li-sub">${arDate(p.createdAt)}${p.note ? ' · '+escapeHtml(p.note) : ''}</div></div></div>
        <span class="badge green">${p.amount} ج.م</span>
      </div>`;
    }).join('');
  }

  openModal('paymentHistoryModal');
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


/* =========================================================
   EXAMS (الاختبارات) - نظام مبسط: اسم الامتحان + رصد الدرجات
   ========================================================= */
function renderQuizzes() {
  const box = document.getElementById('quizzesList');
  if (state.quizzes.length === 0) {
    box.innerHTML = `<div class="empty"><div class="ic">📝</div><p>لا توجد اختبارات — اضغط + لإضافة امتحان</p></div>`;
    document.getElementById('quizDetailCard').style.display = 'none';
    return;
  }
  box.innerHTML = state.quizzes.map(q => {
    const rCount = state.results.filter(x=>x.quizId===q.id).length;
    const active = q.id === currentQuizId;
    return `<div class="list-item" onclick="openQuiz('${q.id}')" style="cursor:pointer;${active?'background:#FBF3DF;border-radius:10px;padding:12px 10px;':''}">
      <div class="info"><div>
        <div class="li-name">${escapeHtml(q.title)}</div>
        <div class="li-sub">من ${q.total||'?'} درجة &nbsp;·&nbsp; ${rCount} طالب</div>
      </div></div>
      <button class="btn outline sm" onclick="event.stopPropagation();deleteQuiz('${q.id}')">حذف</button>
    </div>`;
  }).join('');
}

function openQuizModal() {
  document.getElementById('quizTitle').value = '';
  document.getElementById('quizTotalScore').value = '';
  openModal('quizModal');
}

async function saveQuiz() {
  const title = document.getElementById('quizTitle').value.trim();
  const total = Number(document.getElementById('quizTotalScore').value) || null;
  if (!title) { showToast('اكتب اسم الامتحان'); return; }
  const data = { id: uid(), title, total, createdAt: Date.now() };
  state.quizzes.push(data);
  await putItem('quizzes', data);
  closeModal('quizModal');
  renderQuizzes();
  showToast('تم إضافة الامتحان ✅');
}

async function deleteQuiz(id) {
  if (!confirm('حذف الامتحان وكل درجاته؟')) return;
  state.quizzes = state.quizzes.filter(q=>q.id!==id);
  const rs = state.results.filter(x=>x.quizId===id);
  for (const r of rs) await deleteItem('results', r.id);
  state.results = state.results.filter(x=>x.quizId!==id);
  await deleteItem('quizzes', id);
  if (currentQuizId===id) { currentQuizId=null; document.getElementById('quizDetailCard').style.display='none'; }
  renderQuizzes();
}

function openQuiz(id) {
  currentQuizId = id;
  const quiz = state.quizzes.find(q=>q.id===id);
  document.getElementById('quizDetailCard').style.display = 'block';
  document.getElementById('quizDetailTitle').textContent = quiz.title;
  document.getElementById('quizDetailTotal').textContent = quiz.total ? ' / ' + quiz.total : '';
  renderBulkGradeEntry();
  renderQuizResultsList();
  renderQuizzes();
}

/* إدخال درجات جميع الطلاب دفعة واحدة */
function renderBulkGradeEntry() {
  const quiz = state.quizzes.find(q=>q.id===currentQuizId);
  const box = document.getElementById('bulkGradeEntryBox');
  if (!box) return;
  const search = (document.getElementById('gradeEntrySearch')?.value || '').trim().toLowerCase();
  let students = state.students.slice().sort((a,b)=> (a.code||'').localeCompare(b.code||'', undefined, {numeric:true}));
  if (search) students = students.filter(s =>
    (s.name||'').toLowerCase().includes(search) || (s.code||'').toLowerCase().includes(search)
  );
  if (students.length === 0) { box.innerHTML = `<p style="color:var(--muted); font-size:13px;">لا يوجد طلاب${search?' مطابقين للبحث':''}</p>`; return; }

  box.innerHTML = students.map(s => {
    const res = state.results.find(r=>r.quizId===currentQuizId && r.studentId===s.id);
    const gi = res && quiz?.total ? getGradeInfo(res.score, quiz.total) : null;
    return `<div style="display:flex; align-items:center; gap:10px; padding:7px 0; border-bottom:1px solid var(--line);">
      <div style="flex:1; font-size:13px; font-weight:600;">${escapeHtml(s.name)}</div>
      <span id="gradeInfo_${s.id}" style="font-size:11px; font-weight:700; color:${gi?gi.color:'var(--muted)'}; min-width:70px; text-align:center;">${gi ? gi.pct+'% · '+gi.label : ''}</span>
      <input type="number" min="0" max="${quiz?.total||9999}" placeholder="درجة"
        value="${res ? res.score : ''}"
        id="grade_${s.id}"
        style="width:80px; padding:7px 10px; border-radius:9px; border:1.5px solid var(--line); background:var(--paper); color:var(--ink); font-size:14px; font-family:inherit; text-align:center;"
        onchange="saveOneGrade('${s.id}')" />
    </div>`;
  }).join('');
}

async function saveOneGrade(studentId) {
  const inp = document.getElementById('grade_' + studentId);
  if (!inp) return;
  const val = inp.value.trim();
  if (val === '') {
    // حذف الدرجة لو فاضية
    const existing = state.results.find(r=>r.quizId===currentQuizId && r.studentId===studentId);
    if (existing) { await deleteItem('results', existing.id); state.results = state.results.filter(r=>r!==existing); }
    renderBulkGradeEntry(); renderQuizResultsList(); renderQuizzes(); return;
  }
  let score = Number(val);
  const quiz = state.quizzes.find(q=>q.id===currentQuizId);
  // الدرجة مينفعش تبقى أكبر من الدرجة النهائية للامتحان
  if (quiz && quiz.total && score > quiz.total) {
    showToast(`⚠️ الدرجة أكبر من الدرجة النهائية (${quiz.total}) — تم التعديل تلقائياً`);
    score = quiz.total;
  }
  if (score < 0) score = 0;
  inp.value = score;
  const existing = state.results.find(r=>r.quizId===currentQuizId && r.studentId===studentId);
  const data = { id: existing?existing.id:uid(), quizId: currentQuizId, studentId, score, createdAt: Date.now() };
  if (existing) { const idx=state.results.indexOf(existing); state.results[idx]=data; }
  else state.results.push(data);
  await putItem('results', data);
  renderBulkGradeEntry(); renderQuizResultsList(); renderQuizzes();
}

function renderQuizResultsList() {
  const quiz = state.quizzes.find(q=>q.id===currentQuizId);
  const search = (document.getElementById('resultsSearch')?.value || '').trim().toLowerCase();
  let results = state.results.filter(r=>r.quizId===currentQuizId).slice().sort((a,b)=>b.score-a.score);
  if (search) results = results.filter(r => {
    const st = state.students.find(s=>s.id===r.studentId);
    return st && ((st.name||'').toLowerCase().includes(search) || (st.code||'').toLowerCase().includes(search));
  });
  const box = document.getElementById('quizResultsList');
  if (!box) return;
  if (results.length===0) {
    box.innerHTML = `<div class="empty"><div class="ic">📊</div><p>${search?'لا يوجد نتائج مطابقة للبحث':'لسه مفيش درجات مسجلة'}</p></div>`;
    return;
  }
  box.innerHTML = results.map((r,idx)=>{
    const st = state.students.find(s=>s.id===r.studentId);
    const parentPhone = normalizePhone(st?.parentPhone);
    const stuPhone = normalizePhone(st?.phone);
    const quizName = quiz?.title||'الامتحان';
    const total = quiz?.total ? ' / '+quiz.total : '';
    const gi = quiz?.total ? getGradeInfo(r.score, quiz.total) : null;
    const giText = gi ? ` (${gi.pct}% — ${gi.label})` : '';
    const waMsg = `مرحباً ولي أمر ${st?.name||''}،
نتيجة ${quizName}: ${r.score}${total} درجة${giText} 📊
من ${CENTER_CONFIG.appName} — نظام إدارة الدرس`;
    const waStu = `أهلاً ${st?.name||''}،
نتيجتك في ${quizName}: ${r.score}${total} درجة${giText} 📊
من ${CENTER_CONFIG.appName}`;
    return `<div class="list-item" style="gap:8px;">
      <div style="width:28px; height:28px; border-radius:50%; background:var(--blue); color:#fff; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:800; flex-shrink:0;">${idx+1}</div>
      <div class="info" style="flex:1;"><div class="li-name">${escapeHtml(st?st.name:'-')}</div>${gi?`<div class="li-sub" style="color:${gi.color}; font-weight:700;">${gi.pct}% · ${gi.label}</div>`:''}</div>
      <span class="badge gold" style="font-size:14px; min-width:54px; text-align:center;">${r.score}${total}</span>
      ${parentPhone ? `<button title="إرسال لولي الأمر" onclick="window.open('https://wa.me/${parentPhone}?text='+encodeURIComponent('${waMsg.replace(/'/g,"\'")}'),'_blank')" style="background:none;border:none;font-size:20px;cursor:pointer;padding:0;">👨‍👩‍👦</button>` : ''}
      ${stuPhone ? `<button title="إرسال للطالب" onclick="window.open('https://wa.me/${stuPhone}?text='+encodeURIComponent('${waStu.replace(/'/g,"\'")}'),'_blank')" style="background:none;border:none;font-size:20px;cursor:pointer;padding:0;">🧑</button>` : ''}
    </div>`;
  }).join('');
}

/* =========================================================
   FOLLOW-UP PAGE (المتابعة) - تقرير PDF شامل لكل طالب
   ========================================================= */
let openFollowupId = null;

function renderFollowupPage() {
  const box = document.getElementById('followupStudentList');
  if (!box) return;
  const search = (document.getElementById('followupSearch')?.value || '').trim().toLowerCase();
  let students = state.students.slice().sort((a,b)=> (a.code||'').localeCompare(b.code||'', undefined, {numeric:true}));
  if (search) {
    students = students.filter(s =>
      (s.name||'').toLowerCase().includes(search) ||
      (s.code||'').toLowerCase().includes(search)
    );
  }
  if (students.length === 0) {
    box.innerHTML = `<div class="empty"><div class="ic">📋</div><p>لا يوجد طلاب${search ? ' مطابقين للبحث' : ''}</p></div>`;
    return;
  }
  box.innerHTML = students.map(s => {
    const attCount = state.attendance.filter(a=>a.studentId===s.id).length;
    const isOpen = openFollowupId === s.id;
    let html = `<div class="list-item" style="flex-direction:column; align-items:stretch; cursor:default;">
      <div style="display:flex; align-items:center; justify-content:space-between; cursor:pointer;" onclick="toggleStudentFollowup('${s.id}')">
        <div class="info"><div class="avatar">${initials(s.name)}</div><div>
          <div class="li-name">${escapeHtml(s.name)}</div>
          <div class="li-sub">${escapeHtml(s.code||'')} · ${attCount} حصة حضر</div>
        </div></div>
        <span style="font-size:20px;">${isOpen ? '📂' : '📋'}</span>
      </div>`;
    if (isOpen) html += renderFollowupDetailHTML(s.id);
    html += `</div>`;
    return html;
  }).join('');
}

function toggleStudentFollowup(studentId) {
  openFollowupId = (openFollowupId === studentId) ? null : studentId;
  renderFollowupPage();
}

function renderFollowupDetailHTML(studentId) {
  const s = state.students.find(x=>x.id===studentId);
  if (!s) return '';

  // ===== حضور مجمّع بالشهر =====
  const attRecords = state.attendance.filter(a=>a.studentId===studentId).sort((a,b)=>a.date<b.date?-1:1);
  const attByMonth = {};
  attRecords.forEach(a => {
    const m = a.date.slice(0,7);
    if (!attByMonth[m]) attByMonth[m] = 0;
    attByMonth[m]++;
  });
  const moNames = ['','يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const attRows = Object.entries(attByMonth).map(([m,cnt]) => {
    const [yr,mo] = m.split('-');
    return `<tr><td style="padding:7px 8px;">${moNames[Number(mo)]} ${yr}</td><td style="padding:7px 8px; text-align:center; font-weight:700; color:var(--green);">${cnt} ✅</td></tr>`;
  }).join('');

  // ===== الدرجات (مع النسبة والتقدير) =====
  const quizRows = state.quizzes.map(q => {
    const res = state.results.find(r=>r.quizId===q.id && r.studentId===studentId);
    const score = res ? res.score : '—';
    const total = q.total ? ' / '+q.total : '';
    const gi = res && q.total ? getGradeInfo(res.score, q.total) : null;
    const color = gi ? gi.color : (res ? 'var(--green)' : 'var(--muted)');
    const giText = gi ? `<div style="font-size:11px; font-weight:700; color:${gi.color};">${gi.pct}% · ${gi.label}</div>` : '';
    return `<tr><td style="padding:7px 8px;">${escapeHtml(q.title)}</td><td style="padding:7px 8px; text-align:center; font-weight:700; color:${color};">${score}${total}${giText}</td></tr>`;
  }).join('');

  // ===== الدفعات =====
  const payRecords = state.payments.filter(p=>p.studentId===studentId).sort((a,b)=>b.createdAt-a.createdAt);
  const payRows = payRecords.map(p => {
    const d = new Date(p.createdAt);
    const dateStr = `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
    return `<tr><td style="padding:7px 8px;">${p.month||'—'}</td><td style="padding:7px 8px; text-align:center;">${dateStr}</td><td style="padding:7px 8px; text-align:center; font-weight:700; color:var(--green);">${p.amount||'—'} ج.م</td></tr>`;
  }).join('');

  return `
    <div style="margin-top:12px; padding-top:12px; border-top:1px dashed var(--line);">
      <div style="margin-bottom:16px;">
        <div style="font-size:13px; font-weight:700; color:var(--blue); margin-bottom:6px;">📅 الحضور بالشهر</div>
        ${attRows ? `<table style="width:100%; border-collapse:collapse; font-size:13px; border:1px solid var(--line); border-radius:8px; overflow:hidden;">
          <thead><tr style="background:var(--paper2);">
            <th style="padding:7px 8px; text-align:right; font-size:12px;">الشهر</th>
            <th style="padding:7px 8px; text-align:center; font-size:12px;">عدد الحصص</th>
          </tr></thead><tbody>${attRows}</tbody></table>` : '<p style="color:var(--muted); font-size:12px;">لا يوجد حضور مسجل</p>'}
      </div>
      <div style="margin-bottom:16px;">
        <div style="font-size:13px; font-weight:700; color:var(--blue); margin-bottom:6px;">📊 الدرجات</div>
        ${quizRows ? `<table style="width:100%; border-collapse:collapse; font-size:13px; border:1px solid var(--line); border-radius:8px; overflow:hidden;">
          <thead><tr style="background:var(--paper2);">
            <th style="padding:7px 8px; text-align:right; font-size:12px;">الامتحان</th>
            <th style="padding:7px 8px; text-align:center; font-size:12px;">الدرجة / النسبة</th>
          </tr></thead><tbody>${quizRows}</tbody></table>` : '<p style="color:var(--muted); font-size:12px;">لا توجد درجات مسجلة</p>'}
      </div>
      <div style="margin-bottom:16px;">
        <div style="font-size:13px; font-weight:700; color:var(--blue); margin-bottom:6px;">💰 سجل الدفعات</div>
        ${payRows ? `<table style="width:100%; border-collapse:collapse; font-size:13px; border:1px solid var(--line); border-radius:8px; overflow:hidden;">
          <thead><tr style="background:var(--paper2);">
            <th style="padding:7px 8px; text-align:right; font-size:12px;">الشهر</th>
            <th style="padding:7px 8px; text-align:center; font-size:12px;">تاريخ الدفع</th>
            <th style="padding:7px 8px; text-align:center; font-size:12px;">المبلغ</th>
          </tr></thead><tbody>${payRows}</tbody></table>` : '<p style="color:var(--muted); font-size:12px;">لا توجد دفعات مسجلة</p>'}
      </div>
      <div class="field" style="margin-bottom:10px;">
        <label style="font-size:12px; color:var(--muted);">رسالة ختامية (اختيارية)</label>
        <textarea id="followupClosingMsg_${studentId}" rows="2" placeholder="مثال: نتمنى التوفيق والنجاح لطفلكم 🌟"
          style="width:100%; padding:10px; border-radius:10px; border:1.5px solid var(--line); background:var(--paper); color:var(--ink); font-family:inherit; font-size:13px; resize:vertical; box-sizing:border-box;"></textarea>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        <button class="btn gold block" onclick="printFollowupPDF('${studentId}')">🖨️ PDF / طباعة</button>
        <button class="btn block" style="background:var(--green); color:#fff;" onclick="sendFollowupWhatsApp('${studentId}')">💬 WhatsApp ولي الأمر</button>
      </div>
    </div>
  `;
}

function sendFollowupWhatsApp(studentId) {
  const s = state.students.find(x=>x.id===studentId);
  if (!s) return;
  const parentPhone = normalizePhone(s.parentPhone);
  if (!parentPhone) { showToast('لا يوجد رقم ولي أمر'); return; }

  // حضور
  const attRecords = state.attendance.filter(a=>a.studentId===studentId);
  const attTotal = attRecords.length;
  const moNames = ['','يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const attByMonth = {};
  attRecords.forEach(a => { const m=a.date.slice(0,7); attByMonth[m]=(attByMonth[m]||0)+1; });
  const attLines = Object.entries(attByMonth).map(([m,c])=>{
    const [yr,mo]=m.split('-'); return `• ${moNames[Number(mo)]} ${yr}: ${c} حصة`;
  }).join('\n');

  // درجات (مع النسبة والتقدير)
  const gradeLines = state.quizzes.map(q => {
    const res = state.results.find(r=>r.quizId===q.id && r.studentId===studentId);
    if (!res) return `• ${q.title}: لم يُسجَّل`;
    const gi = q.total ? getGradeInfo(res.score, q.total) : null;
    const score = res.score + (q.total?' / '+q.total:'');
    return `• ${q.title}: ${score}${gi ? ` (${gi.pct}% — ${gi.label})` : ''}`;
  }).join('\n');

  // دفعات
  const pays = state.payments.filter(p=>p.studentId===studentId).sort((a,b)=>b.createdAt-a.createdAt);
  const payLines = pays.map(p => {
    const d = new Date(p.createdAt);
    return `• ${p.month||''} — ${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()} — ${p.amount||'—'} ج.م`;
  }).join('\n');

  const closingMsg = (document.getElementById('followupClosingMsg_' + studentId)?.value || '').trim() ||
    'نتمنى التوفيق والنجاح لطفلكم 🌟';

  const msg = `السلام عليكم ورحمة الله،
ولي أمر الطالب: ${s.name}

📅 *الحضور* (إجمالي: ${attTotal} حصة):
${attLines || 'لا يوجد حضور مسجل'}

📊 *الدرجات*:
${gradeLines || 'لا توجد درجات مسجلة'}

💰 *الدفعات*:
${payLines || 'لا توجد دفعات مسجلة'}

${closingMsg}

— ${CENTER_CONFIG.appName}، نظام إدارة السنتر`;

  window.open(`https://wa.me/${parentPhone}?text=${encodeURIComponent(msg)}`, '_blank');
}

function printFollowupPDF(studentId) {
  const s = state.students.find(x=>x.id===studentId);
  if (!s) return;

  const moNames = ['','يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const attRecords = state.attendance.filter(a=>a.studentId===studentId).sort((a,b)=>a.date<b.date?-1:1);
  const attByMonth = {};
  attRecords.forEach(a => { const m=a.date.slice(0,7); attByMonth[m]=(attByMonth[m]||0)+1; });
  const attRows = Object.entries(attByMonth).map(([m,c]) => {
    const [yr,mo]=m.split('-');
    return `<tr><td>${moNames[Number(mo)]} ${yr}</td><td style="text-align:center; color:#2d9a5b; font-weight:700;">${c} حصة ✅</td></tr>`;
  }).join('');

  const printColors = { 'var(--green)':'#2d9a5b', 'var(--blue)':'#4d8aff', 'var(--orange)':'#e67e22', 'var(--red)':'#c0392b' };
  const quizRows = state.quizzes.map(q => {
    const res = state.results.find(r=>r.quizId===q.id && r.studentId===studentId);
    const score = res ? res.score+(q.total?' / '+q.total:'') : '—';
    const gi = res && q.total ? getGradeInfo(res.score, q.total) : null;
    const color = gi ? (printColors[gi.color]||'#2d9a5b') : (res ? '#2d9a5b' : '#888');
    return `<tr><td>${q.title}</td><td style="text-align:center; font-weight:700; color:${color};">${score}</td><td style="text-align:center;">${gi ? gi.pct+'% — '+gi.label : '—'}</td></tr>`;
  }).join('');

  const pays = state.payments.filter(p=>p.studentId===studentId).sort((a,b)=>b.createdAt-a.createdAt);
  const payRows = pays.map(p => {
    const d = new Date(p.createdAt);
    return `<tr><td>${p.month||'—'}</td><td style="text-align:center;">${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}</td><td style="text-align:center; font-weight:700; color:#2d9a5b;">${p.amount||'—'} ج.م</td></tr>`;
  }).join('');

  const closingMsg = (document.getElementById('followupClosingMsg_' + studentId)?.value || '').trim() || 'نتمنى التوفيق والنجاح 🌟';
  const todayStr = new Date().toLocaleDateString('ar-EG');

  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
  <title>تقرير متابعة — ${s.name}</title>
  <style>
    body{font-family:Arial,sans-serif; direction:rtl; padding:24px; color:#1B2A4A; background:#fff;}
    h1{font-size:22px; color:#1B2A4A; margin-bottom:4px;}
    .sub{color:#888; font-size:13px; margin-bottom:20px;}
    h2{font-size:15px; color:#4d8aff; margin:18px 0 8px; border-bottom:2px solid #e0e5f0; padding-bottom:4px;}
    table{width:100%; border-collapse:collapse; font-size:13px; margin-bottom:8px;}
    th,td{padding:8px 10px; border:1px solid #dde2ee; text-align:right;}
    th{background:#f0f4ff; font-weight:700;}
    .footer{margin-top:24px; font-size:12px; color:#888; border-top:1px solid #eee; padding-top:12px;}
    .closing{background:#f0f4ff; border-radius:8px; padding:12px 16px; font-size:13px; margin-top:16px;}
    @media print{body{padding:12px;}}
  </style></head><body>
  <h1>📋 تقرير متابعة الطالب</h1>
  <div class="sub">الطالب: <strong>${s.name}</strong> &nbsp;|&nbsp; كود: ${s.code||'—'} &nbsp;|&nbsp; تاريخ التقرير: ${todayStr}</div>

  <h2>📅 الحضور بالشهر (إجمالي: ${attRecords.length} حصة)</h2>
  <table><thead><tr><th>الشهر</th><th style="text-align:center;">عدد الحصص</th></tr></thead>
  <tbody>${attRows || '<tr><td colspan="2" style="text-align:center; color:#888;">لا يوجد حضور مسجل</td></tr>'}</tbody></table>

  <h2>📊 الدرجات</h2>
  <table><thead><tr><th>الامتحان</th><th style="text-align:center;">الدرجة</th><th style="text-align:center;">النسبة / التقدير</th></tr></thead>
  <tbody>${quizRows || '<tr><td colspan="3" style="text-align:center; color:#888;">لا توجد درجات</td></tr>'}</tbody></table>

  <h2>💰 سجل الدفعات</h2>
  <table><thead><tr><th>الشهر</th><th style="text-align:center;">تاريخ الدفع</th><th style="text-align:center;">المبلغ</th></tr></thead>
  <tbody>${payRows || '<tr><td colspan="3" style="text-align:center; color:#888;">لا توجد دفعات</td></tr>'}</tbody></table>

  <div class="closing">${closingMsg}</div>
  <div class="footer">صادر من ${CENTER_CONFIG.appName} Eng.Mohamed Ashraf</div>
  <script>window.onload=()=>{ window.print(); }<\/script>
  </body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
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


/* ---- إعدادات الأسعار الافتراضية ---- */
function getDefaultFees() {
  try {
    return JSON.parse(localStorage.getItem('sentry_default_fees') || '{}');
  } catch(e) { return {}; }
}

function saveDefaultFees() {
  const oldFee = Number(document.getElementById('defaultFeeOld').value) || 300;
  const newFee = Number(document.getElementById('defaultFeeNew').value) || 300;
  localStorage.setItem('sentry_default_fees', JSON.stringify({ old: oldFee, new: newFee }));
  showToast('✅ تم حفظ الأسعار الافتراضية');
}

function loadDefaultFeesUI() {
  const f = getDefaultFees();
  const elOld = document.getElementById('defaultFeeOld');
  const elNew = document.getElementById('defaultFeeNew');
  if (elOld) elOld.value = f.old || 300;
  if (elNew) elNew.value = f.new || 300;
}

/* =========================================================
   تأمين صفحة الدفعات بكلمة سر
   ========================================================= */
let paymentsUnlocked = false;

async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function getPaymentsPasswordHash() {
  return localStorage.getItem('sentry_payments_pwhash') || '';
}

async function savePaymentsPassword() {
  const inputEl = document.getElementById('paymentsPwSetInput');
  const val = inputEl.value;
  if (!val.trim()) {
    // الحقل فاضي: مفيش أي فيدباك ظاهر هنا عمداً
    registerSecretResetTap();
    return;
  }
  if (getPaymentsPasswordHash()) {
    // فيه كلمة سر متحطة بالفعل — مينفعش تتغيّر مباشرة، لازم تتلغي الأول
    showToast('⚠️ فيه كلمة سر متحطة بالفعل. لازم تلغيها الأول قبل ما تحط واحدة جديدة');
    inputEl.value = '';
    return;
  }
  const hash = await sha256Hex(val.trim());
  localStorage.setItem('sentry_payments_pwhash', hash);
  showToast('🔒 تم حفظ كلمة سر الدفعات');
  inputEl.value = '';
  paymentsUnlocked = false;
  loadPaymentsPasswordStatusUI();
}

/* تصفير سري لكلمة سر الدفعات: دوس على "حفظ" ٧ مرات متتالية بسرعة
   والخانة فاضية. لو حصل تأخير بين ضغطتين، العداد يترجع صفر ويبدأ من الأول. */
let secretResetTapCount = 0;
let secretResetTapTimer = null;
const SECRET_RESET_TAP_WINDOW = 600; // ملل ثانية بين كل ضغطة والتانية

function registerSecretResetTap() {
  secretResetTapCount++;
  clearTimeout(secretResetTapTimer);
  secretResetTapTimer = setTimeout(() => { secretResetTapCount = 0; }, SECRET_RESET_TAP_WINDOW);
  if (secretResetTapCount >= 7) {
    secretResetTapCount = 0;
    clearTimeout(secretResetTapTimer);
    localStorage.removeItem('sentry_payments_pwhash');
    paymentsUnlocked = false;
    loadPaymentsPasswordStatusUI();
    showToast('🔓 تم إلغاء كلمة سر الدفعات');
  }
}

function loadPaymentsPasswordStatusUI() {
  const el = document.getElementById('paymentsPwStatus');
  if (!el) return;
  el.textContent = getPaymentsPasswordHash()
    ? '🔒 صفحة الدفعات محمية بكلمة سر حالياً.'
    : 'لسه مفيش كلمة سر متحطة — أي حد يقدر يفتح صفحة الدفعات.';
}

/* بتتنادى كل ما المستخدم يدخل صفحة الدفعات */
function guardPaymentsPage() {
  const lock = document.getElementById('paymentsLockScreen');
  const content = document.getElementById('paymentsContentWrap');
  const hash = getPaymentsPasswordHash();
  if (!hash || paymentsUnlocked) {
    lock.style.display = 'none';
    content.style.display = 'block';
    renderPayments();
  } else {
    lock.style.display = 'block';
    content.style.display = 'none';
    const inp = document.getElementById('paymentsPwInput');
    const err = document.getElementById('paymentsPwError');
    if (inp) inp.value = '';
    if (err) err.textContent = '';
    setTimeout(() => inp && inp.focus(), 50);
  }
}

async function unlockPayments() {
  const inp = document.getElementById('paymentsPwInput');
  const err = document.getElementById('paymentsPwError');
  const val = inp.value;
  const hash = await sha256Hex(val);
  if (hash === getPaymentsPasswordHash()) {
    paymentsUnlocked = true;
    err.textContent = '';
    guardPaymentsPage();
  } else {
    err.textContent = '⚠️ كلمة السر غلط';
    inp.value = '';
    inp.focus();
  }
}

function normalizePhoneLocal(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits || digits.length < 9) return null;
  return '0' + digits.slice(-10);
}

function callStudent(studentId) {
  const s = state.students.find(x => x.id === studentId);
  if (!s) return;
  const phone = normalizePhoneLocal(s.phone);
  if (!phone) { showToast('لا يوجد رقم موبايل للطالب'); return; }
  window.location.href = `tel:${phone}`;
}

function callParent(studentId) {
  const s = state.students.find(x => x.id === studentId);
  if (!s) return;
  const phone = normalizePhoneLocal(s.parentPhone);
  if (!phone) { showToast('لا يوجد رقم ولي أمر مسجل'); return; }
  window.location.href = `tel:${phone}`;
}

function callParent2(studentId) {
  const s = state.students.find(x => x.id === studentId);
  if (!s) return;
  const phone = normalizePhoneLocal(s.parentPhone2);
  if (!phone) { showToast('لا يوجد رقم ولي أمر ثاني'); return; }
  window.location.href = `tel:${phone}`;
}

/* حفظ جهة اتصال في تليفون المستخدم عبر vCard */
function saveContact(studentId, type) {
  const s = state.students.find(x => x.id === studentId);
  if (!s) return;
  const isParent = type === 'parent';
  const isParent2 = type === 'parent2';
  const rawPhone = isParent2 ? s.parentPhone2 : isParent ? s.parentPhone : s.phone;
  const phone = normalizePhoneLocal(rawPhone);
  if (!phone) {
    showToast(isParent2 ? 'لا يوجد رقم ولي أمر ثاني' : isParent ? 'لا يوجد رقم ولي أمر' : 'لا يوجد رقم للطالب');
    return;
  }
  const name = isParent2
    ? `ولي أمر2 ${s.name || ''} [${s.code || ''}]`
    : isParent
      ? `ولي أمر ${s.name || ''} [${s.code || ''}]`
      : `${s.name || ''} [${s.code || ''}]`;
  const vcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${name}`,
    `TEL;TYPE=CELL:${phone}`,
    'END:VCARD'
  ].join('\r\n');
  const blob = new Blob([vcard], { type: 'text/vcard' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.vcf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`📇 تم تحميل جهة الاتصال: ${name}`);
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

/* رسالة جماعية لكل أولياء أمور الغائبين في اليوم/المجموعة المختارة حالياً
   في صفحة الحضور. بتفتح شات واتساب منفصل لكل ولي أمر عنده رقم مسجل. */
function sendBulkAbsentWhatsApp() {
  const date = document.getElementById('attDateInput').value || todayStr();
  const groupFilter = document.getElementById('attGroupFilter').value || 'all';
  let students = state.students.slice();
  if (groupFilter !== 'all') students = students.filter(s => s.groupId === groupFilter);

  const presentIds = new Set(state.attendance.filter(a => a.date === date).map(a => a.studentId));
  const absentees = students.filter(s => !presentIds.has(s.id));

  if (absentees.length === 0) { showToast('🎉 مفيش غائبين في التاريخ ده'); return; }

  const withPhone = absentees.filter(s => normalizePhone(s.parentPhone));
  const withoutPhone = absentees.length - withPhone.length;

  if (withPhone.length === 0) { showToast('⚠️ مفيش أرقام أولياء أمور مسجلة للغائبين دول'); return; }

  const ok = confirm(
    `هيتفتح ${withPhone.length} محادثة واتساب لأولياء أمور الغائبين (كل واحدة في تبويب/شات منفصل)، وهتحتاج تدوس "إرسال" بنفسك في كل واحدة.\n` +
    (withoutPhone ? `\n⚠️ ${withoutPhone} من الغائبين مفيش رقم ولي أمر مسجل ليهم.\n` : '') +
    `\nتحب تكمل؟`
  );
  if (!ok) return;

  withPhone.forEach(s => {
    const phone = normalizePhone(s.parentPhone);
    const msg = fillTemplate(getMessageTemplates().parentAbsent, s);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  });

  showToast(`📨 تم فتح ${withPhone.length} محادثة واتساب${withoutPhone ? ` (و${withoutPhone} من غير رقم)` : ''}`);
}

/* =========================================================
   STARTUP
   ========================================================= */
window.addEventListener('load', () => {
  startApp();
});

/* بيطبّق بيانات المعلم/السنتر من config.js على الواجهة كلها.
   عشان يبقى ملف config.js هو المكان الوحيد اللي محتاج تتعدّل فيه
   البيانات لو التطبيق اتكرر لمعلم تاني. */
function applyBranding() {
  const cfg = (typeof CENTER_CONFIG !== 'undefined') ? CENTER_CONFIG : null;
  if (!cfg) return;

  document.title = `${cfg.appName} - نظام إدارة السنتر`;

  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set('appTitleText', cfg.systemLabel);
  set('centerNameSub', cfg.centerTagline);
  set('drawerAppName', cfg.systemLabel);
  set('drawerTeacherName', cfg.teacherNameShort);
  set('footerTeacherName', cfg.teacherName);
  set('footerPhones', (cfg.phones || []).join(' — '));
  set('markLetter1', cfg.markLetter);
  set('markLetter2', cfg.markLetter);
}
applyBranding();

async function startApp() {
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
  loadPaymentsPasswordStatusUI();
  loadDefaultFeesUI();

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
}

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
  const _logoName = CENTER_CONFIG.appName || 'سنتري';
  const _logoHalf = Math.ceil(_logoName.length/2);
  const logoHtml = `${_logoName.slice(0,_logoHalf)}<span>${_logoName.slice(_logoHalf)}</span>`;
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
  <div class="logo">${logoHtml}</div>
  <div class="meta">
    <div><b>${CENTER_CONFIG.teacherName}</b></div>
    <div>${(CENTER_CONFIG.phones||[]).join(' — ')}</div>
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
  <span>${CENTER_CONFIG.appName} — نظام إدارة السنتر</span>
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


