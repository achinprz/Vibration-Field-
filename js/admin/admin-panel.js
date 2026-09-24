/* VibeMon — admin panel (users, custom schedule) */

// ======= ADMIN PANEL =======
function openAdminPanel() {
  if (AUTH.role !== 'admin') return;
  renderUserTable();
  document.getElementById('admin-panel-modal').classList.add('open');
}
function closeAdminPanel() {
  document.getElementById('admin-panel-modal').classList.remove('open');
}

async function renderUserTable() {
  const tbody = document.getElementById('user-table-body'); tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted);font-size:11px">Loading users from Supabase...</td></tr>';
  const users = await getUsers();
  tbody.innerHTML = '';
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted);font-size:11px">No users found. Add them in Supabase → users table.</td></tr>';
    return;
  }
  users.forEach((u) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${u.username}</td><td>${u.name||u.displayName||''}</td>
      <td><span class="role-badge role-${(u.role||'viewer').toLowerCase()}">${u.role === 'EDITOR' ? 'ENGINEER' : u.role}</span></td>
      <td><span style="color:var(--muted);font-size:11px">Edit in Supabase</span></td>`;
    tbody.appendChild(tr);
  });
}

async function createEditorUser() {
  const msg = document.getElementById('admin-msg');
  const uname   = (document.getElementById('new-user-name')?.value    || '').trim();
  const display  = (document.getElementById('new-user-display')?.value || '').trim();
  const pass     = document.getElementById('new-user-pass')?.value   || '';
  const pass2    = document.getElementById('new-user-pass2')?.value  || '';
  if (!uname || !display || !pass) { msg.innerHTML='<div class="alert-box alert-warn">⚠️ Please fill in all fields.</div>'; return; }
  if (pass !== pass2) { msg.innerHTML='<div class="alert-box alert-warn">⚠️ Passwords do not match.</div>'; return; }
  if (pass.length < 6) { msg.innerHTML='<div class="alert-box alert-warn">⚠️ Password must be at least 6 characters.</div>'; return; }
  msg.innerHTML='<div class="alert-box alert-info">⏳ Creating account...</div>';
  try {
    const hash = await _sha256(pass);
    const { error } = await _supabase.from('users').insert([{
      username: uname, name: display, role: 'EDITOR', password_hash: hash, active: true
    }]);
    if (error) throw error;
    msg.innerHTML=`<div class="alert-box alert-suc">✅ Engineer account created for <strong>${display}</strong> (${uname}). They can now login.</div>`;
    document.getElementById('new-user-name').value='';
    document.getElementById('new-user-display').value='';
    document.getElementById('new-user-pass').value='';
    document.getElementById('new-user-pass2').value='';
    renderUserTable();
  } catch(e) {
    msg.innerHTML=`<div class="alert-box alert-warn">⚠️ Failed: ${e.message}</div>`;
  }
}

function uploadCustomSchedule() {
  const fileInput = document.getElementById('admin-schedule-upload');
  const msgEl = document.getElementById('admin-schedule-msg');
  if (!fileInput || !fileInput.files.length) {
    if (msgEl) msgEl.innerHTML = '<span style="color:var(--red)">⚠️ Please select an Excel file first.</span>';
    return;
  }
  
  if (msgEl) msgEl.innerHTML = '<span style="color:var(--blue)">⏳ Parsing Excel file...</span>';
  
  const file = fileInput.files[0];
  const reader = new FileReader();
  
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      
      const newSchedule = {};
      const sheetMapping = {
        'Precise': 'Precise',
        'Chaitanya Bharthi': 'CB',
        'Chaitanya Bharthi-A': 'CBA'
      };
      
      let parsedSheetsCount = 0;
      
      workbook.SheetNames.forEach(sheetName => {
        const teamKey = sheetMapping[sheetName.trim()];
        if (!teamKey) return;
        
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        const teamSchedule = {};
        let currentWD = null;
        
        rows.forEach(row => {
          if (!row || !row.length) return;
          const firstCell = String(row[0] || '').trim();
          
          const wdMatch = firstCell.match(/WORKING\s+DAY\s+(\d+)/i);
          if (wdMatch) {
            currentWD = parseInt(wdMatch[1], 10);
            teamSchedule[currentWD] = [];
            return;
          }
          
          if (currentWD !== null) {
            const idx = parseInt(row[0], 10);
            if (!isNaN(idx) && row[4]) {
              teamSchedule[currentWD].push({
                n: String(row[4]).trim(),
                u: row[2] ? String(row[2]).trim() : '',
                a: row[3] ? String(row[3]).trim() : '',
                f: row[7] ? String(row[7]).trim() : '',
                l: row[8] ? String(row[8]).trim() : '',
                r: row[9] ? String(row[9]).trim() : ''
              });
            }
          }
        });
        
        newSchedule[teamKey] = teamSchedule;
        parsedSheetsCount++;
      });
      
      if (parsedSheetsCount === 0) {
        if (msgEl) msgEl.innerHTML = '<span style="color:var(--red)">⚠️ Error: Could not find sheets named \'Precise\', \'Chaitanya Bharthi\', or \'Chaitanya Bharthi-A\'.</span>';
        return;
      }
      
      localStorage.setItem(VIBE_SCHEDULE_CACHE_KEY, JSON.stringify(newSchedule));
      localStorage.removeItem(VIBE_VERSIONS_KEY);   // the override replaces the cached month-by-month versions too
      if (msgEl) msgEl.innerHTML = `<span style="color:var(--green)">✅ Successfully loaded schedule! Found ${parsedSheetsCount} teams. Reloading page...</span><br><small style="color:var(--muted)">Note: this is a local override only. To update the schedule for everyone, edit the vibe_schedule table in Supabase instead.</small>`;
      
      setTimeout(() => {
        location.reload();
      }, 1500);
      
    } catch(err) {
      console.error(err);
      if (msgEl) msgEl.innerHTML = `<span style="color:var(--red)">⚠️ Error parsing file: ${err.message}</span>`;
    }
  };
  
  reader.readAsArrayBuffer(file);
}

function resetCustomSchedule() {
  if (confirm("Are you sure you want to clear any local schedule override and re-sync from Supabase?")) {
    localStorage.removeItem(VIBE_SCHEDULE_CACHE_KEY);
    localStorage.removeItem(VIBE_VERSIONS_KEY);
    alert("Local override cleared. Reloading page (schedule will re-sync from Supabase)...");
    location.reload();
  }
}

function deleteUser(idx) {
  alert('To delete users, remove them from Supabase → users table (or set active = false).');
}

function resetUserPass(idx) {
  alert('To reset passwords, update the password_hash in Supabase → users table (use SHA-256 of new password).');
}
