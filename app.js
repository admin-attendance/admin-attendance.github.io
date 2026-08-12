import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc,
  onSnapshot, query, orderBy, limit, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

const $ = (id) => document.getElementById(id);
const state = { user:null, admin:null, schools:[], classes:[], teachers:[], students:[], audit:[], system:{} };
const unsubs = [];

const pageMeta = {
  dashboard:['대시보드','전체 시스템 현황을 확인합니다.'],
  schools:['학교','학생 앱에 노출되는 학교를 관리합니다.'],
  classes:['반','개설된 반과 출석 정책을 관리합니다.'],
  teachers:['선생님','교사 계정과 담당 반을 관리합니다.'],
  students:['학생','학생 계정과 소속 정보를 관리합니다.'],
  system:['시스템 설정','서비스 전체의 기본값을 관리합니다.'],
  audit:['감사 로그','관리자 변경 이력을 확인합니다.']
};

function esc(v=''){ return String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function dateText(v){ if(!v) return '-'; const d=v.toDate ? v.toDate() : new Date(v); return Number.isNaN(d.getTime())?'-':new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short'}).format(d); }
function toast(message, bad=false){ const el=$('toast'); el.textContent=message; el.className=`toast show ${bad?'bad':''}`; setTimeout(()=>el.className='toast',2600); }
function statusBadge(active){ return `<span class="badge ${active?'ok':'off'}">${active?'활성':'비활성'}</span>`; }
function classLabel(c){ return c.className || `${c.grade ?? '-'}학년 ${c.classNumber ?? '-'}반`; }

async function writeAudit(action, targetType, targetId, details=''){
  try { await addDoc(collection(db,'auditLogs'), { action,targetType,targetId,details,adminUid:state.user.uid,adminEmail:state.user.email,createdAt:serverTimestamp() }); } catch(e){ console.warn('audit log failed',e); }
}

function showLogin(){ $('loginView').classList.remove('hidden'); $('appView').classList.add('hidden'); $('deniedView').classList.add('hidden'); }
function showDenied(user){ $('loginView').classList.add('hidden'); $('appView').classList.add('hidden'); $('deniedView').classList.remove('hidden'); $('deniedEmail').textContent=user.email||''; $('deniedUid').textContent=user.uid; }
function showApp(user, admin){ $('loginView').classList.add('hidden'); $('deniedView').classList.add('hidden'); $('appView').classList.remove('hidden'); $('adminName').textContent=admin.displayName || user.displayName || '관리자'; $('adminEmail').textContent=user.email||''; $('adminAvatar').textContent=(admin.displayName||user.displayName||'A').slice(0,1).toUpperCase(); }

async function verifyAdmin(user){
  const snap = await getDoc(doc(db,'admins',user.uid));
  if(!snap.exists() || snap.data().active !== true) return null;
  return snap.data();
}

function clearListeners(){ while(unsubs.length){ try{unsubs.pop()();}catch{} } }
function startRealtime(){
  clearListeners();
  unsubs.push(onSnapshot(collection(db,'schools'), s=>{ state.schools=s.docs.map(d=>({id:d.id,...d.data()})); renderAll(); }));
  unsubs.push(onSnapshot(collection(db,'classes'), s=>{ state.classes=s.docs.map(d=>({id:d.id,...d.data()})); renderAll(); }));
  unsubs.push(onSnapshot(collection(db,'teachers'), s=>{ state.teachers=s.docs.map(d=>({id:d.id,...d.data()})); renderAll(); }));
  unsubs.push(onSnapshot(collection(db,'students'), s=>{ state.students=s.docs.map(d=>({id:d.id,...d.data()})); renderAll(); }));
  unsubs.push(onSnapshot(doc(db,'system','config'), s=>{ state.system=s.exists()?s.data():{}; renderAll(); }));
  const aq=query(collection(db,'auditLogs'),orderBy('createdAt','desc'),limit(100));
  unsubs.push(onSnapshot(aq, s=>{ state.audit=s.docs.map(d=>({id:d.id,...d.data()})); renderAudit(); }));
}

function renderAll(){ renderDashboard(); renderSchools(); renderClasses(); renderTeachers(); renderStudents(); renderSystem(); }
function renderDashboard(){
  $('metricSchools').textContent=state.schools.filter(x=>x.active!==false).length;
  $('metricClasses').textContent=state.classes.filter(x=>x.active!==false).length;
  $('metricTeachers').textContent=state.teachers.filter(x=>x.active!==false && x.status!=='disabled').length;
  $('metricStudents').textContent=state.students.filter(x=>x.active!==false && x.status!=='disabled').length;
  const recent=[...state.classes].sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)).slice(0,6);
  $('recentClasses').innerHTML=recent.length?recent.map(c=>`<div class="list-row"><div><strong>${esc(c.schoolName||'-')} · ${esc(classLabel(c))}</strong><span>${esc(c.teacherName||'담당교사 미지정')}</span></div>${statusBadge(c.active!==false)}</div>`).join(''):'<div class="empty">아직 개설된 반이 없습니다.</div>';
  $('systemSummary').innerHTML=`
    <div><span>기본 출석 반경</span><strong>${state.system.defaultAttendanceRadiusMeters||300}m</strong></div>
    <div><span>신규 가입</span><strong>${state.system.registrationEnabled===false?'중지':'허용'}</strong></div>
    <div><span>유지보수 모드</span><strong>${state.system.maintenanceMode===true?'ON':'OFF'}</strong></div>`;
}

function filtered(items,id,fn){ const term=$(id).value.trim().toLowerCase(); return term?items.filter(x=>fn(x).toLowerCase().includes(term)):items; }
function renderSchools(){
  const rows=filtered(state.schools,'schoolSearch',s=>`${s.name||''} ${s.schoolName||''}`);
  $('schoolsBody').innerHTML=rows.length?rows.map(s=>`<tr><td><strong>${esc(s.name||s.schoolName||'이름 없음')}</strong><small>${esc(s.id)}</small></td><td>${statusBadge(s.active!==false)}</td><td>${dateText(s.createdAt)}</td><td class="actions"><button class="mini-btn" data-action="school-edit" data-id="${esc(s.id)}">수정</button></td></tr>`).join(''):'<tr><td colspan="4" class="empty">학교가 없습니다.</td></tr>';
}
function renderClasses(){
  const rows=filtered(state.classes,'classSearch',c=>`${c.schoolName||''} ${classLabel(c)} ${c.teacherName||''}`);
  $('classesBody').innerHTML=rows.length?rows.map(c=>`<tr><td>${esc(c.schoolName||'-')}</td><td><strong>${esc(classLabel(c))}</strong><small>${esc(c.id)}</small></td><td>${esc(c.teacherName||'-')}</td><td>${c.attendanceRadiusMeters?`${esc(c.attendanceRadiusMeters)}m`:'미설정'}</td><td>${statusBadge(c.active!==false)}</td><td class="actions"><button class="mini-btn" data-action="class-edit" data-id="${esc(c.id)}">관리</button></td></tr>`).join(''):'<tr><td colspan="6" class="empty">반이 없습니다.</td></tr>';
}
function renderTeachers(){
  const rows=filtered(state.teachers,'teacherSearch',t=>`${t.displayName||t.googleName||''} ${t.email||''}`);
  $('teachersBody').innerHTML=rows.length?rows.map(t=>{ const assigned=state.classes.filter(c=>c.teacherUid===t.id).map(classLabel).join(', ')||'-'; const active=t.active!==false&&t.status!=='disabled'; return `<tr><td><strong>${esc(t.displayName||t.googleName||'이름 미설정')}</strong><small>${esc(t.id)}</small></td><td>${esc(t.email||'-')}</td><td>${esc(assigned)}</td><td>${statusBadge(active)}</td><td class="actions"><button class="mini-btn" data-action="teacher-edit" data-id="${esc(t.id)}">관리</button></td></tr>`; }).join(''):'<tr><td colspan="5" class="empty">선생님이 없습니다.</td></tr>';
}
function renderStudents(){
  const rows=filtered(state.students,'studentSearch',s=>`${s.studentNumber||''} ${s.name||s.studentName||''}`);
  $('studentsBody').innerHTML=rows.length?rows.map(s=>{ const c=state.classes.find(x=>x.id===s.classId); const active=s.active!==false&&s.status!=='disabled'; const studentName=s.name||s.studentName||'이름 미설정'; return `<tr><td>${esc(s.studentNumber||'-')}</td><td><strong>${esc(studentName)}</strong><small>${esc(s.id)}</small></td><td>${esc(c?`${c.schoolName||''} ${classLabel(c)}`:(s.className||'-'))}</td><td>${statusBadge(active)}</td><td class="actions"><button class="mini-btn" data-action="student-edit" data-id="${esc(s.id)}">관리</button></td></tr>`; }).join(''):'<tr><td colspan="5" class="empty">학생이 없습니다.</td></tr>';
}
function renderSystem(){ $('defaultRadius').value=state.system.defaultAttendanceRadiusMeters||300; $('registrationEnabled').checked=state.system.registrationEnabled!==false; $('maintenanceMode').checked=state.system.maintenanceMode===true; }
function renderAudit(){ $('auditList').innerHTML=state.audit.length?state.audit.map(a=>`<div class="audit-row"><div class="audit-icon">•</div><div><strong>${esc(a.action||'변경')}</strong><span>${esc(a.details||`${a.targetType||''} ${a.targetId||''}`)}</span><small>${esc(a.adminEmail||'')} · ${dateText(a.createdAt)}</small></div></div>`).join(''):'<div class="empty">기록된 관리자 작업이 없습니다.</div>'; }

let modalSaveHandler=null;
function openModal(title,html,onSave){ $('modalTitle').textContent=title; $('modalBody').innerHTML=html; $('modalBackdrop').classList.remove('hidden'); modalSaveHandler=onSave; }
function closeModal(){ $('modalBackdrop').classList.add('hidden'); modalSaveHandler=null; }

function schoolModal(id=null){
  const s=id?state.schools.find(x=>x.id===id):null;
  openModal(s?'학교 수정':'학교 추가',`<label class="field"><span>학교명</span><input id="mSchoolName" value="${esc(s?.name||s?.schoolName||'')}" placeholder="예: 해강중학교" /></label><label class="switch-row"><span><strong>활성</strong><small>학생 앱의 학교 검색에 사용할 수 있습니다.</small></span><input id="mSchoolActive" type="checkbox" ${s?.active===false?'':'checked'} /></label>`,async()=>{
    const name=$('mSchoolName').value.trim(); if(!name) return toast('학교명을 입력하세요.',true);
    const ref=id?doc(db,'schools',id):doc(collection(db,'schools'));
    await setDoc(ref,{name,active:$('mSchoolActive').checked,updatedAt:serverTimestamp(),...(id?{}:{createdAt:serverTimestamp()})},{merge:true});
    await writeAudit(id?'학교 수정':'학교 추가','school',ref.id,name); closeModal(); toast('저장했습니다.');
  });
}

async function deleteClass(id){
  const c=state.classes.find(x=>x.id===id); if(!c)return;
  const assignedStudents=state.students.filter(s=>s.classId===id);
  if(assignedStudents.length){
    toast(`학생 ${assignedStudents.length}명이 소속되어 있어 반을 삭제할 수 없습니다. 먼저 학생의 소속을 정리하세요.`,true);
    return;
  }
  const ok=window.confirm(`"${c.schoolName||''} ${classLabel(c)}" 반을 완전히 삭제할까요?\n\n삭제하면 학생 앱의 반 목록에서도 즉시 사라집니다.`);
  if(!ok)return;
  try{
    await deleteDoc(doc(db,'classes',id));
    await writeAudit('반 삭제','class',id,`${c.schoolName||''} ${classLabel(c)}`);
    closeModal();
    toast('반을 삭제했습니다.');
  }catch(e){
    console.error(e);
    toast(`반 삭제 실패: ${e.message}`,true);
  }
}

function classModal(id){
  const c=state.classes.find(x=>x.id===id); if(!c)return;
  const assignedCount=state.students.filter(s=>s.classId===id).length;
  openModal('반 관리',`<div class="info-box"><strong>${esc(c.schoolName||'-')} · ${esc(classLabel(c))}</strong><span>${esc(c.teacherName||'담당교사 미지정')}</span></div><label class="field"><span>출석 인정 반경 (m)</span><input id="mClassRadius" type="number" min="150" max="1000" step="50" value="${esc(c.attendanceRadiusMeters||300)}" /><small>최소 150m, 최대 1,000m</small></label><label class="switch-row"><span><strong>반 활성</strong><small>비활성화하면 신규 가입/출석에서 제외할 수 있습니다.</small></span><input id="mClassActive" type="checkbox" ${c.active===false?'':'checked'} /></label><div style="margin-top:18px;padding:16px;border:1px solid #ffd5d9;border-radius:15px;background:#fff8f8;display:flex;align-items:center;justify-content:space-between;gap:14px"><div style="display:grid;gap:4px"><strong style="color:#ba3545">반 삭제</strong><small style="color:#9b5962">${assignedCount?`현재 학생 ${assignedCount}명이 소속되어 있어 삭제할 수 없습니다.`:'반 문서를 Firestore에서 완전히 삭제합니다.'}</small></div><button class="secondary-btn" style="background:#fff0f1;color:#ba3545" type="button" data-action="class-delete" data-id="${esc(id)}" ${assignedCount?'disabled':''}>반 삭제</button></div>`,async()=>{
    const radius=Number($('mClassRadius').value); if(radius<150||radius>1000) return toast('반경은 150~1000m여야 합니다.',true);
    await updateDoc(doc(db,'classes',id),{attendanceRadiusMeters:Math.round(radius),active:$('mClassActive').checked,updatedAt:serverTimestamp()});
    await writeAudit('반 설정 수정','class',id,`${c.schoolName||''} ${classLabel(c)} / ${radius}m`); closeModal(); toast('반 설정을 저장했습니다.');
  });
}
function teacherModal(id){
  const t=state.teachers.find(x=>x.id===id); if(!t)return;
  const active=t.active!==false&&t.status!=='disabled';
  openModal('선생님 관리',`<div class="info-box"><strong>${esc(t.displayName||t.googleName||'이름 미설정')}</strong><span>${esc(t.email||'')}</span></div><label class="switch-row"><span><strong>계정 활성</strong><small>끄면 교사용 앱 접근을 서버 규칙과 함께 제한할 수 있습니다.</small></span><input id="mTeacherActive" type="checkbox" ${active?'checked':''} /></label>`,async()=>{
    const v=$('mTeacherActive').checked;
    await updateDoc(doc(db,'teachers',id),{active:v,status:v?'active':'disabled',updatedAt:serverTimestamp()});
    await writeAudit(v?'교사 활성화':'교사 비활성화','teacher',id,t.email||''); closeModal(); toast('선생님 상태를 변경했습니다.');
  });
}
function studentModal(id){
  const s=state.students.find(x=>x.id===id); if(!s)return;
  const active=s.active!==false&&s.status!=='disabled';
  const studentName=s.name||s.studentName||'';
  openModal('학생 관리',`<label class="field"><span>학번</span><input id="mStudentNo" value="${esc(s.studentNumber||'')}" /></label><label class="field"><span>이름</span><input id="mStudentName" value="${esc(studentName)}" /></label><label class="switch-row"><span><strong>계정 활성</strong><small>학생 앱 사용 가능 상태입니다.</small></span><input id="mStudentActive" type="checkbox" ${active?'checked':''} /></label><label class="switch-row"><span><strong>PIN 초기화 요청</strong><small>현재 PIN은 표시하지 않습니다. 학생에게 새 PIN 설정을 요구합니다.</small></span><input id="mPinReset" type="checkbox" /></label>`,async()=>{
    const studentNumber=$('mStudentNo').value.trim(), name=$('mStudentName').value.trim(); if(!studentNumber||!name)return toast('학번과 이름을 입력하세요.',true);
    const v=$('mStudentActive').checked, reset=$('mPinReset').checked;
    const patch={studentNumber,name,studentName:name,active:v,status:v?'active':'disabled',updatedAt:serverTimestamp()};
    if(reset){ patch.pinResetRequired=true; patch.pinResetRequestedAt=serverTimestamp(); }
    await updateDoc(doc(db,'students',id),patch);
    await writeAudit('학생 정보 수정','student',id,`${studentNumber} ${name}${reset?' / PIN 초기화 요청':''}`); closeModal(); toast('학생 정보를 저장했습니다.');
  });
}

$('googleLoginBtn').onclick=async()=>{ try{ await signInWithPopup(auth,googleProvider); }catch(e){ console.error(e); toast(`로그인 실패: ${e.message}`,true); } };
$('logoutBtn').onclick=()=>signOut(auth); $('deniedLogoutBtn').onclick=()=>signOut(auth);
$('copyUidBtn').onclick=async()=>{ await navigator.clipboard.writeText($('deniedUid').textContent); toast('UID를 복사했습니다.'); };
$('modalCloseBtn').onclick=closeModal; $('modalCancelBtn').onclick=closeModal; $('modalBackdrop').onclick=e=>{ if(e.target===$('modalBackdrop'))closeModal(); };
$('modalSaveBtn').onclick=async()=>{ if(!modalSaveHandler)return; $('modalSaveBtn').disabled=true; try{ await modalSaveHandler(); }catch(e){ console.error(e); toast(`저장 실패: ${e.message}`,true); }finally{$('modalSaveBtn').disabled=false;} };
$('addSchoolBtn').onclick=()=>schoolModal();
$('saveSystemBtn').onclick=async()=>{ const r=Number($('defaultRadius').value); if(r<150||r>1000)return toast('기본 반경은 150~1000m여야 합니다.',true); try{ await setDoc(doc(db,'system','config'),{defaultAttendanceRadiusMeters:Math.round(r),registrationEnabled:$('registrationEnabled').checked,maintenanceMode:$('maintenanceMode').checked,updatedAt:serverTimestamp()},{merge:true}); await writeAudit('시스템 설정 변경','system','config',`기본반경 ${r}m`); toast('시스템 설정을 저장했습니다.'); }catch(e){toast(`저장 실패: ${e.message}`,true);} };

['schoolSearch','classSearch','teacherSearch','studentSearch'].forEach(id=>$(id).addEventListener('input',renderAll));
document.addEventListener('click',e=>{ const b=e.target.closest('[data-action]'); if(!b)return; const {action,id}=b.dataset; if(action==='school-edit')schoolModal(id); if(action==='class-edit')classModal(id); if(action==='class-delete')deleteClass(id); if(action==='teacher-edit')teacherModal(id); if(action==='student-edit')studentModal(id); });
$('nav').addEventListener('click',e=>{ const b=e.target.closest('[data-page]'); if(!b)return; const p=b.dataset.page; document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x===b)); document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id===`page-${p}`)); $('pageTitle').textContent=pageMeta[p][0]; $('pageSubtitle').textContent=pageMeta[p][1]; });

onAuthStateChanged(auth,async user=>{
  clearListeners(); state.user=user;
  if(!user){ state.admin=null; showLogin(); return; }
  try{
    const admin=await verifyAdmin(user);
    if(!admin){ showDenied(user); return; }
    state.admin=admin; showApp(user,admin); startRealtime();
  }catch(e){ console.error(e); toast(`권한 확인 실패: ${e.message}`,true); showDenied(user); }
});
